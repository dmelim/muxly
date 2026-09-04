use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    ffi::OsString,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};
use tauri::AppHandle;

use crate::{
    error::AppError,
    runtime::{inject_fallback_path, resolve_from_fallbacks, search_paths},
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitState {
    pub root: String,
    pub branch: String,
    pub detached: bool,
    pub dirty: bool,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOverview {
    pub state: Option<GitState>,
    pub branches: Vec<String>,
}

#[derive(Default)]
pub struct GitOperations(Mutex<HashSet<PathBuf>>);

// Git may traverse a large worktree or run checkout hooks. Force every command
// onto Tauri's asynchronous command executor so repository discovery and
// branch changes can never block the webview/main thread.
#[tauri::command(async)]
pub fn git_overview(app: AppHandle, cwd: String) -> Result<GitOverview, AppError> {
    let Some(state) = inspect(&app, Path::new(&cwd))? else {
        return Ok(GitOverview {
            state: None,
            branches: Vec::new(),
        });
    };
    let branches = local_branches(&app, Path::new(&state.root))?;
    Ok(GitOverview {
        state: Some(state),
        branches,
    })
}

#[tauri::command(async)]
pub fn git_switch_branch(
    app: AppHandle,
    operations: tauri::State<'_, GitOperations>,
    cwd: String,
    branch: String,
    expected_root: String,
) -> Result<GitState, AppError> {
    let Some(before) = inspect(&app, Path::new(&cwd))? else {
        return Err(AppError::ConfigUnavailable(
            "Service is not inside a Git repository".into(),
        ));
    };
    if !same_path(Path::new(&before.root), Path::new(&expected_root)) {
        return Err(AppError::ConfigUnavailable(
            "The selected service repository changed. Refresh Git state before switching branches."
                .into(),
        ));
    }
    if before.dirty {
        return Err(AppError::ConfigUnavailable(
            "The repository has uncommitted changes. Commit, stash, or discard them outside Muxly before switching branches.".into(),
        ));
    }
    let branches = local_branches(&app, Path::new(&before.root))?;
    if !branches.iter().any(|candidate| candidate == &branch) {
        return Err(AppError::ConfigUnavailable(
            "Branch is not an existing local branch".into(),
        ));
    }

    let root = PathBuf::from(&before.root);
    {
        let mut active = operations
            .0
            .lock()
            .map_err(|_| AppError::ConfigUnavailable("Git operation lock is unavailable".into()))?;
        if !active.insert(root.clone()) {
            return Err(AppError::ConfigUnavailable(
                "Another Git operation is already running for this repository".into(),
            ));
        }
    }
    let result = run_git(&app, &root, &["switch", "--", &branch]);
    if let Ok(mut active) = operations.0.lock() {
        active.remove(&root);
    }
    result?;
    inspect(&app, &root)?.ok_or_else(|| {
        AppError::ConfigUnavailable("Repository disappeared after branch switch".into())
    })
}

fn local_branches(app: &AppHandle, root: &Path) -> Result<Vec<String>, AppError> {
    let output = run_git(
        app,
        root,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

fn inspect(app: &AppHandle, cwd: &Path) -> Result<Option<GitState>, AppError> {
    let root_output = git_command(app, cwd)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .map_err(|error| AppError::ConfigUnavailable(format!("Could not run Git: {error}")))?;
    if !root_output.status.success() {
        return Ok(None);
    }
    let root = String::from_utf8_lossy(&root_output.stdout)
        .trim()
        .to_string();
    if root.is_empty() {
        return Ok(None);
    }

    let root_path = Path::new(&root);
    if !same_path(root_path, cwd) && is_ignored_by_repository(app, root_path, cwd) {
        return Ok(None);
    }

    let status = run_git(app, root_path, &["status", "--porcelain=v2", "--branch"])?;
    let (mut branch, detached, ahead, behind, dirty) = parse_status(&status);
    if detached {
        let short = run_git(app, Path::new(&root), &["rev-parse", "--short", "HEAD"])?;
        branch = format!("detached @ {}", short.trim());
    }
    Ok(Some(GitState {
        root,
        branch,
        detached,
        dirty,
        ahead,
        behind,
    }))
}

fn is_ignored_by_repository(app: &AppHandle, root: &Path, cwd: &Path) -> bool {
    git_command(app, root)
        .args(["check-ignore", "-q", "--"])
        .arg(cwd)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn same_path(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn parse_status(status: &str) -> (String, bool, u32, u32, bool) {
    let mut branch = String::new();
    let mut detached = false;
    let mut ahead = 0;
    let mut behind = 0;
    let mut dirty = false;
    for line in status.lines() {
        if let Some(value) = line.strip_prefix("# branch.head ") {
            detached = value == "(detached)";
            branch = value.to_string();
        } else if let Some(value) = line.strip_prefix("# branch.ab ") {
            for part in value.split_whitespace() {
                if let Some(value) = part.strip_prefix('+') {
                    ahead = value.parse().unwrap_or(0);
                }
                if let Some(value) = part.strip_prefix('-') {
                    behind = value.parse().unwrap_or(0);
                }
            }
        } else if !line.starts_with('#') && !line.trim().is_empty() {
            dirty = true;
        }
    }
    (branch, detached, ahead, behind, dirty)
}

fn run_git(app: &AppHandle, cwd: &Path, args: &[&str]) -> Result<String, AppError> {
    let output = git_command(app, cwd)
        .args(args)
        .output()
        .map_err(|error| AppError::ConfigUnavailable(format!("Could not run Git: {error}")))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::ConfigUnavailable(if message.is_empty() {
            "Git command failed".into()
        } else {
            message
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn git_command(app: &AppHandle, cwd: &Path) -> Command {
    // Finder, the Dock, and Spotlight launch apps with launchd's minimal PATH.
    // Resolve Git through the login-shell paths already recovered for services
    // and editors, then pass that PATH to Git so checkout hooks can find their
    // own Homebrew or version-manager tools too.
    let paths = search_paths(app);
    let resolved = resolve_from_fallbacks("git", &paths)
        .map(PathBuf::into_os_string)
        .unwrap_or_else(|| OsString::from("git"));
    let mut command = Command::new(resolved);
    command.arg("-C").arg(cwd);
    let mut environment = HashMap::new();
    inject_fallback_path(&mut environment, &paths);
    command.envs(environment);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

#[cfg(test)]
mod tests {
    use super::parse_status;

    #[test]
    fn parses_branch_tracking_and_dirty_state() {
        let status = "# branch.head preview/roadmap\n# branch.ab +3 -2\n1 .M N... 100644 100644 100644 abc abc src/App.tsx\n";
        assert_eq!(
            parse_status(status),
            ("preview/roadmap".into(), false, 3, 2, true)
        );
    }

    #[test]
    fn parses_clean_detached_head() {
        let status = "# branch.head (detached)\n";
        assert_eq!(
            parse_status(status),
            ("(detached)".into(), true, 0, 0, false)
        );
    }
}
