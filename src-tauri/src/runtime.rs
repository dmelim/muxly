use crate::{
    error::AppError,
    services::{config::resolve_cwd, ServiceConfig},
};
use parking_lot::Mutex;
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap},
    env, fs,
    path::{Path, PathBuf},
};

#[derive(Default)]
pub struct RuntimeFallbacks(Mutex<Vec<PathBuf>>);

impl RuntimeFallbacks {
    pub fn paths(&self) -> Vec<PathBuf> {
        self.0.lock().clone()
    }

    fn activate(&self, path: PathBuf) {
        let mut paths = self.0.lock();
        if !paths.iter().any(|existing| paths_equal(existing, &path)) {
            paths.push(path);
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRequirementReport {
    pub issues: Vec<RuntimeRequirementIssue>,
    pub active_fallback_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRequirementIssue {
    pub runtime: String,
    pub executable: String,
    pub service_ids: Vec<String>,
    pub service_names: Vec<String>,
    pub candidates: Vec<RuntimeCandidate>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCandidate {
    pub label: String,
    pub path: String,
}

struct PendingIssue {
    runtime: String,
    executable: String,
    service_ids: Vec<String>,
    service_names: Vec<String>,
}

/// Every directory a service's program may be found in, in priority order:
/// runtime fallbacks the user explicitly activated, then the login shell's
/// `PATH` (see `shell_env` — a GUI-launched app does not inherit it).
///
/// Both spawn paths merge this into the child's `PATH` and use it to resolve
/// the program itself, so what the requirements check reports as "available"
/// matches what a spawn will actually find.
pub fn search_paths(app: &tauri::AppHandle) -> Vec<PathBuf> {
    use tauri::Manager;

    let mut paths = app
        .try_state::<RuntimeFallbacks>()
        .map(|fallbacks| fallbacks.paths())
        .unwrap_or_default();
    paths.extend(crate::shell_env::login_paths(app));
    paths
}

pub fn check_requirements(
    services: &[ServiceConfig],
    config_base: Option<&Path>,
    fallbacks: &RuntimeFallbacks,
    login_paths: &[PathBuf],
) -> RuntimeRequirementReport {
    // The activated fallbacks are what the UI echoes back as "active"; the
    // login-shell paths are search scope only, not something the user chose.
    let mut fallback_paths = fallbacks.paths();
    let reported_fallbacks = fallback_paths.clone();
    fallback_paths.extend_from_slice(login_paths);
    let mut missing: BTreeMap<String, PendingIssue> = BTreeMap::new();

    for service in services {
        // A pre-run command intentionally establishes the executable context
        // (nvm, a virtualenv, direnv, etc.). We cannot safely execute arbitrary
        // setup code during a startup check, so leave these services to their
        // explicit activation contract instead of reporting a false positive.
        if service
            .pre_run
            .as_deref()
            .map(str::trim)
            .is_some_and(|pre_run| !pre_run.is_empty())
        {
            continue;
        }
        let mut requirements = vec![(
            service.program.clone(),
            runtime_name(&service.program).to_string(),
        )];
        if depends_on_node(&service.program)
            && !program_key(&service.program).eq_ignore_ascii_case("node")
        {
            requirements.push(("node".to_string(), "Node.js".to_string()));
        }

        for (executable, runtime) in requirements {
            if executable_available(&executable, service, config_base, &fallback_paths) {
                continue;
            }

            let key = format!("{}:{}", runtime.to_lowercase(), executable.to_lowercase());
            let issue = missing.entry(key).or_insert_with(|| PendingIssue {
                runtime,
                executable: display_executable(&executable),
                service_ids: Vec::new(),
                service_names: Vec::new(),
            });
            if !issue.service_ids.contains(&service.id) {
                issue.service_ids.push(service.id.clone());
                issue.service_names.push(service.name.clone());
            }
        }
    }

    let issues = missing
        .into_values()
        .map(|issue| RuntimeRequirementIssue {
            candidates: discover_candidates(&issue.executable),
            runtime: issue.runtime,
            executable: issue.executable,
            service_ids: issue.service_ids,
            service_names: issue.service_names,
        })
        .collect();

    RuntimeRequirementReport {
        issues,
        active_fallback_paths: reported_fallbacks
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
    }
}

pub fn activate_fallback(path: &str, fallbacks: &RuntimeFallbacks) -> Result<(), AppError> {
    let requested = PathBuf::from(path.trim());
    if !requested.is_dir() {
        return Err(AppError::ConfigUnavailable(format!(
            "Runtime fallback directory does not exist: {}",
            requested.display()
        )));
    }
    let canonical = fs::canonicalize(&requested).unwrap_or(requested);
    fallbacks.activate(canonical);
    Ok(())
}

pub fn inject_fallback_path(env_map: &mut HashMap<String, String>, paths: &[PathBuf]) {
    if paths.is_empty() {
        return;
    }

    let existing_key = env_map
        .keys()
        .find(|key| key.eq_ignore_ascii_case("PATH"))
        .cloned();
    let inherited = existing_key
        .as_ref()
        .and_then(|key| env_map.get(key).cloned())
        .or_else(|| env::var_os("PATH").map(|value| value.to_string_lossy().into_owned()))
        .unwrap_or_default();

    let mut entries = paths.to_vec();
    entries.extend(env::split_paths(&inherited));
    if let Ok(joined) = env::join_paths(entries) {
        env_map.insert(
            existing_key.unwrap_or_else(|| "PATH".to_string()),
            joined.to_string_lossy().into_owned(),
        );
    }
}

pub fn resolve_from_fallbacks(program: &str, paths: &[PathBuf]) -> Option<PathBuf> {
    if program.contains('/') || program.contains('\\') {
        return None;
    }
    for dir in paths {
        for name in executable_variants(program) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn executable_available(
    executable: &str,
    service: &ServiceConfig,
    config_base: Option<&Path>,
    fallback_paths: &[PathBuf],
) -> bool {
    let path = PathBuf::from(executable);
    if path.is_absolute() {
        return path.is_file();
    }
    if executable.contains('/') || executable.contains('\\') {
        return resolve_cwd(&service.cwd, config_base)
            .map(|cwd| cwd.join(path).is_file())
            .unwrap_or(false);
    }

    let mut search_paths = fallback_paths.to_vec();
    let service_path = service
        .env
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("PATH"))
        .map(|(_, value)| value.clone());
    let inherited = service_path
        .or_else(|| env::var("PATH").ok())
        .unwrap_or_default();
    search_paths.extend(env::split_paths(&inherited));

    search_paths.into_iter().any(|dir| {
        executable_variants(executable)
            .iter()
            .any(|name| dir.join(name).is_file())
    })
}

fn executable_variants(executable: &str) -> Vec<String> {
    #[cfg(windows)]
    {
        if Path::new(executable).extension().is_some() {
            vec![executable.to_string()]
        } else {
            vec![
                executable.to_string(),
                format!("{executable}.cmd"),
                format!("{executable}.bat"),
                format!("{executable}.exe"),
            ]
        }
    }
    #[cfg(not(windows))]
    {
        vec![executable.to_string()]
    }
}

fn depends_on_node(program: &str) -> bool {
    matches!(
        program_key(program).as_str(),
        "node" | "npm" | "npx" | "pnpm" | "yarn" | "vite" | "wxt"
    )
}

fn runtime_name(program: &str) -> &'static str {
    match program_key(program).as_str() {
        "node" => "Node.js",
        "npm" | "npx" => "npm",
        "pnpm" => "pnpm",
        "yarn" => "Yarn",
        "vite" => "Vite",
        "wxt" => "WXT",
        "bun" | "bunx" => "Bun",
        "python" | "python3" | "py" => "Python",
        _ => "Executable",
    }
}

fn program_key(program: &str) -> String {
    let name = Path::new(program)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(program)
        .to_lowercase();
    for suffix in [".exe", ".cmd", ".bat", ".ps1"] {
        if let Some(stripped) = name.strip_suffix(suffix) {
            return stripped.to_string();
        }
    }
    name
}

fn display_executable(executable: &str) -> String {
    if executable.eq_ignore_ascii_case("node") {
        "node".to_string()
    } else {
        executable.to_string()
    }
}

fn discover_candidates(executable: &str) -> Vec<RuntimeCandidate> {
    let executable_path = Path::new(executable);
    if executable_path.is_absolute() || executable.contains('/') || executable.contains('\\') {
        return Vec::new();
    }
    let key = program_key(executable);
    dedup_candidates(platform_candidates(executable, &key))
}

/// Drop repeated directories, keeping the first (highest-priority) mention.
///
/// Ordering carries meaning here — a version manager is listed before a system
/// package manager because it is the more likely intent — so this preserves
/// order rather than sorting. Several sources legitimately point at the same
/// directory (Homebrew's prefix on an Intel Mac is also a conventional system
/// prefix), and those collisions are not adjacent, so a pairwise `dedup_by`
/// would let them through.
fn dedup_candidates(candidates: Vec<RuntimeCandidate>) -> Vec<RuntimeCandidate> {
    let mut seen: Vec<PathBuf> = Vec::new();
    let mut unique = Vec::with_capacity(candidates.len());

    for candidate in candidates {
        let path = PathBuf::from(&candidate.path);
        if seen.iter().any(|existing| paths_equal(existing, &path)) {
            continue;
        }
        seen.push(path);
        unique.push(candidate);
    }

    unique
}

#[cfg(windows)]
fn platform_candidates(_executable: &str, key: &str) -> Vec<RuntimeCandidate> {
    match key {
        "node" | "npm" | "npx" => discover_nvm_candidates(key),
        "bun" | "bunx" => discover_bun_candidates(key),
        "python" | "python3" => discover_python_candidates(),
        "pnpm" | "yarn" => discover_roaming_npm_candidate(key),
        _ => Vec::new(),
    }
}

/// Where a missing runtime plausibly lives on macOS and Linux.
///
/// The Windows equivalents key off `NVM_HOME`, `APPDATA` and `LOCALAPPDATA`,
/// none of which exist here — so without this the "runtime not found" report
/// offered Unix users no candidates at all, which is exactly when the suggestion
/// matters most: a `.app` launched from Finder inherits launchd's minimal PATH
/// and cannot see any of these directories on its own.
///
/// Order is priority order: a version manager the user deliberately installed
/// beats a system package manager, and both beat the OS's own copy.
#[cfg(not(windows))]
fn platform_candidates(executable: &str, key: &str) -> Vec<RuntimeCandidate> {
    let mut dirs: Vec<(String, PathBuf)> = Vec::new();

    match key {
        // The JavaScript tools all ship together, so every Node version
        // manager is a candidate source for any of them.
        "node" | "npm" | "npx" | "pnpm" | "yarn" => node_manager_dirs(&mut dirs),
        "bun" | "bunx" => bun_dirs(&mut dirs),
        "python" | "python3" => python_dirs(&mut dirs),
        _ => {}
    }
    system_prefix_dirs(&mut dirs);

    // A directory only helps if the executable we're missing is actually in it.
    dirs.into_iter()
        .filter(|(_, dir)| dir.join(executable).is_file() || dir.join(key).is_file())
        .map(|(label, dir)| RuntimeCandidate {
            label,
            path: dir.to_string_lossy().into_owned(),
        })
        .collect()
}

/// `bin` directories belonging to Node version managers, newest version first.
#[cfg(not(windows))]
fn node_manager_dirs(dirs: &mut Vec<(String, PathBuf)>) {
    let Some(home) = home_dir() else {
        return;
    };

    // nvm keeps each version under `versions/node/vX.Y.Z/bin`.
    let nvm_root = env::var_os("NVM_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".nvm"));
    for (version, dir) in versioned_dirs(&nvm_root.join("versions").join("node"), "bin") {
        dirs.push((format!("Node {version} (nvm)"), dir));
    }

    // fnm's data directory is platform-specific and overridable.
    let fnm_roots = [
        env::var_os("FNM_DIR").map(PathBuf::from),
        Some(home.join("Library").join("Application Support").join("fnm")),
        Some(
            env::var_os("XDG_DATA_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".local").join("share"))
                .join("fnm"),
        ),
    ];
    for root in fnm_roots.into_iter().flatten() {
        for (version, dir) in versioned_dirs(&root.join("node-versions"), "installation/bin") {
            dirs.push((format!("Node {version} (fnm)"), dir));
        }
    }

    // Volta, asdf and mise expose shims rather than per-version directories,
    // so there is a single entry each and the tool picks the version.
    dirs.push(("Volta".to_string(), home.join(".volta").join("bin")));
    dirs.push(("asdf shims".to_string(), home.join(".asdf").join("shims")));
    dirs.push((
        "mise shims".to_string(),
        home.join(".local").join("share").join("mise").join("shims"),
    ));
}

#[cfg(not(windows))]
fn bun_dirs(dirs: &mut Vec<(String, PathBuf)>) {
    if let Some(root) = env::var_os("BUN_INSTALL") {
        dirs.push((
            "Bun installation".to_string(),
            PathBuf::from(root).join("bin"),
        ));
    }
    if let Some(home) = home_dir() {
        dirs.push((
            "Bun installation".to_string(),
            home.join(".bun").join("bin"),
        ));
    }
}

#[cfg(not(windows))]
fn python_dirs(dirs: &mut Vec<(String, PathBuf)>) {
    let Some(home) = home_dir() else {
        return;
    };

    let pyenv_root = env::var_os("PYENV_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".pyenv"));
    for (version, dir) in versioned_dirs(&pyenv_root.join("versions"), "bin") {
        dirs.push((format!("Python {version} (pyenv)"), dir));
    }
    dirs.push(("pyenv shims".to_string(), pyenv_root.join("shims")));
}

/// Conventional install prefixes: Homebrew on Apple Silicon, then the shared
/// `/usr/local` prefix (Homebrew on Intel and most manual installs), then the
/// system's own binaries.
#[cfg(not(windows))]
fn system_prefix_dirs(dirs: &mut Vec<(String, PathBuf)>) {
    dirs.push(("Homebrew".to_string(), PathBuf::from("/opt/homebrew/bin")));
    dirs.push((
        "/usr/local/bin".to_string(),
        PathBuf::from("/usr/local/bin"),
    ));
    if let Some(home) = home_dir() {
        dirs.push(("User binaries".to_string(), home.join(".local").join("bin")));
    }
    dirs.push(("System".to_string(), PathBuf::from("/usr/bin")));
}

/// Read a version-manager root whose children are version directories, and
/// return `(display_version, child/suffix)` newest first.
///
/// Names are compared by parsed numeric components rather than as strings so
/// `v20` sorts above `v9`, matching the Windows nvm discovery.
#[cfg(not(windows))]
fn versioned_dirs(root: &Path, suffix: &str) -> Vec<(String, PathBuf)> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };

    let mut found: Vec<(Vec<u64>, String, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let dir = suffix
                .split('/')
                .fold(entry.path(), |path, segment| path.join(segment));
            if !dir.is_dir() {
                return None;
            }
            let display = name.strip_prefix('v').unwrap_or(&name).to_string();
            let version: Vec<u64> = display
                .split('.')
                .map(|part| part.parse().unwrap_or(0))
                .collect();
            Some((version, display, dir))
        })
        .collect();

    found.sort_by(|left, right| right.0.cmp(&left.0));
    found
        .into_iter()
        .map(|(_, display, dir)| (display, dir))
        .collect()
}

#[cfg(not(windows))]
fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|home| home.is_dir())
}

#[cfg(windows)]
fn discover_nvm_candidates(executable: &str) -> Vec<RuntimeCandidate> {
    let Some(root) = env::var_os("NVM_HOME").map(PathBuf::from) else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let expected = match executable {
        "node" => "node.exe",
        "npx" => "npx.cmd",
        _ => "npm.cmd",
    };
    let mut found: Vec<(Vec<u64>, RuntimeCandidate)> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if !path.join(expected).is_file() || !name.starts_with('v') {
                return None;
            }
            let version: Vec<u64> = name[1..]
                .split('.')
                .map(|part| part.parse().unwrap_or(0))
                .collect();
            Some((
                version,
                RuntimeCandidate {
                    label: format!("Node {}", &name[1..]),
                    path: path.to_string_lossy().into_owned(),
                },
            ))
        })
        .collect();
    found.sort_by(|left, right| right.0.cmp(&left.0));
    found.into_iter().map(|(_, candidate)| candidate).collect()
}

#[cfg(windows)]
fn discover_bun_candidates(executable: &str) -> Vec<RuntimeCandidate> {
    let mut dirs = Vec::new();
    if let Some(root) = env::var_os("BUN_INSTALL") {
        dirs.push(PathBuf::from(root).join("bin"));
    }
    if let Some(home) = env::var_os("USERPROFILE") {
        dirs.push(PathBuf::from(home).join(".bun").join("bin"));
    }
    dirs.into_iter()
        .filter(|dir| dir.join(format!("{executable}.exe")).is_file())
        .map(|dir| RuntimeCandidate {
            label: "Bun installation".to_string(),
            path: dir.to_string_lossy().into_owned(),
        })
        .collect()
}

#[cfg(windows)]
fn discover_python_candidates() -> Vec<RuntimeCandidate> {
    let Some(local) = env::var_os("LOCALAPPDATA").map(PathBuf::from) else {
        return Vec::new();
    };
    let root = local.join("Programs").join("Python");
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|dir| dir.join("python.exe").is_file())
        .map(|dir| RuntimeCandidate {
            label: dir
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Python installation")
                .to_string(),
            path: dir.to_string_lossy().into_owned(),
        })
        .collect()
}

#[cfg(windows)]
fn discover_roaming_npm_candidate(executable: &str) -> Vec<RuntimeCandidate> {
    let Some(app_data) = env::var_os("APPDATA").map(PathBuf::from) else {
        return Vec::new();
    };
    let dir = app_data.join("npm");
    if dir.join(format!("{executable}.cmd")).is_file() {
        vec![RuntimeCandidate {
            label: format!("Global {executable} launcher"),
            path: dir.to_string_lossy().into_owned(),
        }]
    } else {
        Vec::new()
    }
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    if cfg!(windows) {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    } else {
        left == right
    }
}

#[cfg(test)]
#[cfg(not(windows))]
mod tests {
    use super::*;

    /// The Unix discovery paths existed only as Windows equivalents before, so
    /// a missing runtime on macOS or Linux offered the user no candidates at
    /// all. Asserts against a real installation rather than a fixture, and
    /// skips where there is none, so it stays honest about what it proves.
    #[test]
    fn discovers_a_real_node_installation() {
        let installed = ["/opt/homebrew/bin", "/usr/local/bin"]
            .iter()
            .map(PathBuf::from)
            .chain(
                home_dir()
                    .into_iter()
                    .flat_map(|home| [home.join(".nvm"), home.join(".volta")]),
            )
            .any(|dir| dir.join("node").is_file() || dir.is_dir() && dir.ends_with(".nvm"));
        if !installed {
            return;
        }

        let candidates = discover_candidates("node");

        assert!(
            !candidates.is_empty(),
            "node is installed on this machine but discovery offered no candidates"
        );
        for candidate in &candidates {
            assert!(
                Path::new(&candidate.path).join("node").is_file(),
                "candidate {} does not actually contain node",
                candidate.path
            );
        }
    }

    /// Directories reached by more than one route (Homebrew's Intel prefix is
    /// also a conventional system prefix) must be offered once, and the
    /// higher-priority label must be the one that survives.
    #[test]
    fn candidate_directories_are_deduplicated() {
        let candidates = dedup_candidates(vec![
            RuntimeCandidate {
                label: "Homebrew".to_string(),
                path: "/usr/local/bin".to_string(),
            },
            RuntimeCandidate {
                label: "Something else".to_string(),
                path: "/usr/bin".to_string(),
            },
            RuntimeCandidate {
                label: "/usr/local/bin".to_string(),
                path: "/usr/local/bin".to_string(),
            },
        ]);

        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].label, "Homebrew");
        assert_eq!(candidates[1].label, "Something else");
    }
}
