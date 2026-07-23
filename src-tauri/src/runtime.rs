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

pub fn check_requirements(
    services: &[ServiceConfig],
    config_base: Option<&Path>,
    fallbacks: &RuntimeFallbacks,
) -> RuntimeRequirementReport {
    let fallback_paths = fallbacks.paths();
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
        active_fallback_paths: fallback_paths
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
    let mut candidates = match key.as_str() {
        "node" | "npm" | "npx" => discover_nvm_candidates(&key),
        "bun" | "bunx" => discover_bun_candidates(&key),
        "python" | "python3" => discover_python_candidates(),
        "pnpm" | "yarn" => discover_roaming_npm_candidate(&key),
        _ => Vec::new(),
    };
    candidates.dedup_by(|left, right| paths_equal(Path::new(&left.path), Path::new(&right.path)));
    candidates
}

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
