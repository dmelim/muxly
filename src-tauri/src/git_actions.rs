use super::{git_command, inspect, run_git, same_path, AppError, AppHandle, GitOperations, GitState};
use serde::{Deserialize, Serialize};
use std::{collections::hash_map::DefaultHasher, hash::{Hash, Hasher}, path::{Path, PathBuf}};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    path: String,
    status: String,
    staged: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    state: GitState,
    changes: Vec<Change>,
    remotes: Vec<String>,
    token: String,
    blocked: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    expected_root: String,
    expected_token: String,
    kind: String,
    message: String,
    stage_all: bool,
    remote: String,
}

#[derive(Serialize)]
pub struct Outcome {
    committed: bool,
    pushed: bool,
    error: Option<String>,
}

fn unavailable(message: &str) -> AppError {
    AppError::ConfigUnavailable(message.into())
}

fn snapshot(app: &AppHandle, cwd: &Path) -> Result<Snapshot, AppError> {
    let state = inspect(app, cwd)?.ok_or_else(|| unavailable("Service is not inside a Git repository"))?;
    let root = Path::new(&state.root);
    let status = run_git(app, root, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
    let mut records = status.split('\0').filter(|record| !record.is_empty());
    let mut changes = Vec::new();
    let mut conflict = false;
    while let Some(record) = records.next() {
        let bytes = record.as_bytes();
        if bytes.len() < 4 { continue; }
        let code = &record[..2];
        conflict |= matches!(code, "DD" | "AU" | "UD" | "UA" | "DU" | "AA" | "UU");
        let mut path = record[3..].to_string();
        if bytes[0] == b'R' || bytes[0] == b'C' || bytes[1] == b'R' || bytes[1] == b'C' {
            if let Some(previous) = records.next() { path = format!("{previous} → {path}"); }
        }
        changes.push(Change { path, status: code.into(), staged: bytes[0] != b' ' && bytes[0] != b'?' });
    }
    let mut hasher = DefaultHasher::new();
    state.root.hash(&mut hasher);
    state.branch.hash(&mut hasher);
    status.hash(&mut hasher);
    // Include staged and unstaged content so edits made while the modal is open
    // require a fresh review before a commit. Untracked files are listed by path.
    for args in [vec!["diff", "--no-ext-diff", "--no-textconv", "--binary"], vec!["diff", "--cached", "--no-ext-diff", "--no-textconv", "--binary"], vec!["rev-parse", "--verify", "--quiet", "HEAD"]] {
        let reading_head = args[0] == "rev-parse";
        let output = git_command(app, root).args(args).output()
            .map_err(|error| unavailable(&format!("Could not run Git: {error}")))?;
        if !output.status.success() && !(reading_head && output.status.code() == Some(1)) {
            return Err(unavailable(&format!("Could not read repository changes: {}", String::from_utf8_lossy(&output.stderr).trim())));
        }
        output.stdout.hash(&mut hasher);
    }
    let remotes = run_git(app, root, &["remote"])?.lines().map(str::to_string).collect();
    let mut in_progress = false;
    for marker in ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"] {
        let path = run_git(app, root, &["rev-parse", "--git-path", marker])?;
        let path = Path::new(path.trim());
        in_progress |= if path.is_absolute() { path.exists() } else { root.join(path).exists() };
    }
    let blocked = if state.detached { Some("Check out a branch before committing or pushing.".into()) }
        else if conflict || in_progress { Some("Finish the current merge, rebase, or conflict resolution in your editor first.".into()) }
        else { None };
    Ok(Snapshot { state, changes, remotes, token: format!("{:x}", hasher.finish()), blocked })
}

#[tauri::command(async)]
pub fn git_action_snapshot(app: AppHandle, cwd: String) -> Result<Snapshot, AppError> {
    snapshot(&app, Path::new(&cwd))
}

struct OperationGuard<'a> { operations: &'a GitOperations, root: PathBuf }
impl Drop for OperationGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.operations.0.lock() { active.remove(&self.root); }
    }
}

#[tauri::command(async)]
pub fn git_run_action(app: AppHandle, operations: tauri::State<'_, GitOperations>, cwd: String, action: Action) -> Result<Outcome, AppError> {
    if !matches!(action.kind.as_str(), "commit" | "push" | "commit-push") {
        return Err(unavailable("Unknown Git action"));
    }
    let root = inspect(&app, Path::new(&cwd))?.ok_or_else(|| unavailable("Repository is unavailable"))?.root;
    if !same_path(Path::new(&root), Path::new(&action.expected_root)) {
        return Err(unavailable("Repository changed. Reopen the dialog."));
    }
    let root = PathBuf::from(root);
    {
        let mut active = operations.0.lock().map_err(|_| unavailable("Git operation lock is unavailable"))?;
        if !active.insert(root.clone()) { return Err(unavailable("Another Git operation is already running for this repository")); }
    }
    let _guard = OperationGuard { operations: &operations, root: root.clone() };
    let before = snapshot(&app, &root)?;
    if before.token != action.expected_token { return Err(unavailable("Repository changes have changed. Refresh the dialog and review them again.")); }
    if let Some(blocked) = before.blocked { return Err(unavailable(&blocked)); }
    let commit = action.kind != "push";
    let push = action.kind != "commit";
    if commit && (action.message.trim().is_empty() || action.message.len() > 10000 || action.message.contains('\0')) {
        return Err(unavailable("Enter a commit message of 1–10,000 characters."));
    }
    if push && (action.remote.starts_with('-') || !before.remotes.contains(&action.remote)) {
        return Err(unavailable("Choose an existing remote before pushing."));
    }
    let mut outcome = Outcome { committed: false, pushed: false, error: None };
    let result = (|| -> Result<(), AppError> {
        if commit {
            if !before.changes.iter().any(|change| action.stage_all || change.staged) {
                return Err(unavailable("No changes are selected for commit."));
            }
            if action.stage_all { run_git(&app, &root, &["add", "--all", "--", "."])?; }
            run_git(&app, &root, &["-c", "core.editor=false", "commit", "-m", action.message.trim()])?;
            outcome.committed = true;
        }
        if push {
            // Explicit refspec: only the displayed branch, without forced updates
            // or implicitly pushing tags/submodules from user configuration.
            let mirror = format!("remote.{}.mirror=false", action.remote);
            let destination = format!("refs/heads/{0}:refs/heads/{0}", before.state.branch);
            run_git(&app, &root, &["-c", &mirror, "push", "--no-force", "--no-follow-tags", "--recurse-submodules=no", "--set-upstream", "--", &action.remote, &destination])?;
            outcome.pushed = true;
        }
        Ok(())
    })();
    if let Err(error) = result { outcome.error = Some(error.to_string()); }
    Ok(outcome)
}
