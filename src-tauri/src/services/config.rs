use crate::{
    error::AppError,
    events::SERVICES_CHANGED,
    services::{validate_service_fields, validate_services, LoadedServices, ServiceConfig},
};
use notify::{RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::mpsc,
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

/// Watch the app config directory and emit `SERVICES_CHANGED` whenever
/// `services.json` is written. This makes the config file a live integration
/// point: an agent, a script, or the user's editor can change it and the app
/// picks it up without a restart.
pub fn watch_service_config(app: AppHandle) {
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }

    thread::spawn(move || {
        let (tx, rx) = mpsc::channel();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(watcher) => watcher,
            Err(_) => return,
        };
        if watcher.watch(&dir, RecursiveMode::NonRecursive).is_err() {
            return;
        }

        // `watcher` is kept alive for the lifetime of this thread (and thus the
        // app); dropping it would stop notifications.
        loop {
            match rx.recv() {
                Ok(Ok(event)) => {
                    let touches_config = event.paths.iter().any(|path| {
                        path.file_name()
                            .map(|name| name == "services.json")
                            .unwrap_or(false)
                    });
                    if !touches_config {
                        continue;
                    }
                    // Coalesce bursts (editors often write in several steps).
                    while rx.recv_timeout(Duration::from_millis(200)).is_ok() {}
                    let _ = app.emit(SERVICES_CHANGED, ());
                }
                Ok(Err(_)) => {}
                Err(_) => break,
            }
        }
    });
}

#[derive(Default)]
pub struct ServicesConfigDir(Mutex<Option<PathBuf>>);

impl ServicesConfigDir {
    pub fn set_from_path(&self, path: &Path) {
        if let Some(parent) = path.parent() {
            let mut guard = self.0.lock();
            *guard = Some(parent.to_path_buf());
        }
    }

    pub fn current(&self) -> Option<PathBuf> {
        self.0.lock().clone()
    }
}

pub fn load_service_config(
    app: &AppHandle,
    config_dir: &ServicesConfigDir,
) -> Result<LoadedServices, AppError> {
    let path = service_config_path(app)?;
    let text = fs::read_to_string(&path).map_err(|source| AppError::IoPath {
        action: "read",
        path: path.clone(),
        source,
    })?;

    let loaded = parse_service_list(&text).map_err(|source| AppError::ConfigParse {
        path: path.clone(),
        source,
    })?;

    config_dir.set_from_path(&path);
    Ok(loaded)
}

/// Parse the services file resiliently. Only a missing/invalid top-level JSON
/// array is a hard error (the whole file is unsalvageable); individual entries
/// that fail to deserialize or validate are skipped and recorded in `problems`.
/// Kept free of `AppHandle`/IO so it can be unit-tested directly.
fn parse_service_list(text: &str) -> Result<LoadedServices, serde_json::Error> {
    let raw: Vec<serde_json::Value> = serde_json::from_str(text)?;

    let mut services = Vec::new();
    let mut problems = Vec::new();
    let mut ids = HashSet::new();

    for (index, value) in raw.into_iter().enumerate() {
        // Prefer the entry's own id for the label so errors are easy to locate;
        // fall back to a 1-based position when there is no usable id.
        let label = match value.get("id").and_then(|id| id.as_str()).map(str::trim) {
            Some(id) if !id.is_empty() => format!("service '{id}'"),
            _ => format!("service #{}", index + 1),
        };

        let service: ServiceConfig = match serde_json::from_value(value) {
            Ok(service) => service,
            Err(source) => {
                problems.push(format!("{label}: {source}"));
                continue;
            }
        };

        let field_problems = validate_service_fields(index, &service);
        if !field_problems.is_empty() {
            problems.extend(field_problems);
            continue;
        }

        let id = service.id.trim().to_string();
        if !ids.insert(id.clone()) {
            problems.push(format!("{label}: duplicate id '{id}' (entry skipped)"));
            continue;
        }

        services.push(service);
    }

    Ok(LoadedServices { services, problems })
}

/// Persist a new services list to the app config directory. Validates first
/// so we never write a config that the next `load_services` would reject.
pub fn save_service_config(
    app: &AppHandle,
    config_dir: &ServicesConfigDir,
    services: &[ServiceConfig],
) -> Result<(), AppError> {
    validate_services(services).map_err(|problems| AppError::ConfigInvalid {
        path: PathBuf::from("(unsaved)"),
        problems,
    })?;

    let path = writable_config_path(app)?;
    let text = serde_json::to_string_pretty(services).map_err(|source| AppError::ConfigParse {
        path: path.clone(),
        source,
    })?;
    fs::write(&path, text).map_err(|source| AppError::IoPath {
        action: "write",
        path: path.clone(),
        source,
    })?;

    config_dir.set_from_path(&path);
    Ok(())
}

/// Path to write to: always `app_config_dir/services.json`. Creates the
/// directory if missing. We deliberately do not write to a `services.json` in
/// the current working directory — that file is for dev-time hand-editing only.
fn writable_config_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let app_config_dir = app
        .path()
        .app_config_dir()
        .map_err(|source| AppError::PathResolve {
            action: "resolve app config directory",
            message: source.to_string(),
        })?;
    fs::create_dir_all(&app_config_dir).map_err(|source| AppError::IoPath {
        action: "create app config directory",
        path: app_config_dir.clone(),
        source,
    })?;
    Ok(app_config_dir.join("services.json"))
}

pub fn service_config_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let app_config_dir = app
        .path()
        .app_config_dir()
        .map_err(|source| AppError::PathResolve {
            action: "resolve app config directory",
            message: source.to_string(),
        })?;

    fs::create_dir_all(&app_config_dir).map_err(|source| AppError::IoPath {
        action: "create app config directory",
        path: app_config_dir.clone(),
        source,
    })?;

    let app_config = app_config_dir.join("services.json");
    if app_config.exists() {
        return Ok(app_config);
    }

    let cwd_config = std::env::current_dir()
        .map_err(|source| AppError::Io {
            action: "resolve current directory",
            source,
        })?
        .join("services.json");

    if cwd_config.exists() {
        return Ok(cwd_config);
    }

    let sample_config = app
        .path()
        .resolve("services.sample.json", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|path| path.exists())
        .or_else(|| {
            // The bundled resource is missing in `tauri dev`, where the working
            // directory is `src-tauri/`. Probe the cwd and its parent (the
            // project root) so the sample is found during development too.
            let cwd = std::env::current_dir().ok()?;
            [cwd.join("services.sample.json")]
                .into_iter()
                .chain(cwd.parent().map(|p| p.join("services.sample.json")))
                .find(|path| path.exists())
        })
        .ok_or_else(|| {
            AppError::ConfigUnavailable("Could not resolve services.sample.json".to_string())
        })?;

    fs::copy(&sample_config, &app_config).map_err(|source| AppError::IoPath {
        action: "copy sample service config",
        path: app_config.clone(),
        source,
    })?;

    Ok(app_config)
}

pub fn resolve_cwd(cwd: &str, base_dir: Option<&Path>) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(cwd);
    if path.is_absolute() {
        return Ok(path);
    }

    if let Some(base) = base_dir {
        return Ok(base.join(path));
    }

    let fallback = std::env::current_dir().map_err(|source| AppError::Io {
        action: "resolve working directory base",
        source,
    })?;

    Ok(fallback.join(path))
}

#[cfg(test)]
mod tests {
    use super::{parse_service_list, resolve_cwd};
    use std::path::{Path, PathBuf};

    #[test]
    fn parse_skips_malformed_entry_and_keeps_the_rest() {
        // The exact corruption the PowerShell register-service helper produced:
        // `args` written as an empty object instead of an array. Previously this
        // failed the whole file; now only the offending entry is dropped.
        let text = r#"[
            {"id":"good","name":"Good","program":"node","cwd":".","args":["run"]},
            {"id":"node-test","name":"Node Test","program":"node","cwd":".","args":{}}
        ]"#;

        let loaded = parse_service_list(text).unwrap();

        assert_eq!(loaded.services.len(), 1);
        assert_eq!(loaded.services[0].id, "good");
        assert_eq!(loaded.problems.len(), 1);
        assert!(loaded.problems[0].contains("node-test"));
    }

    #[test]
    fn parse_skips_invalid_entry_and_duplicate_ids() {
        let text = r#"[
            {"id":"web","name":"Web","program":"npm","cwd":"."},
            {"id":"","name":"No Id","program":"npm","cwd":"."},
            {"id":"web","name":"Dup","program":"npm","cwd":"."}
        ]"#;

        let loaded = parse_service_list(text).unwrap();

        assert_eq!(loaded.services.len(), 1);
        assert_eq!(loaded.services[0].id, "web");
        assert!(loaded
            .problems
            .iter()
            .any(|problem| problem.contains("id must not be empty")));
        assert!(loaded
            .problems
            .iter()
            .any(|problem| problem.contains("duplicate id 'web'")));
    }

    #[test]
    fn parse_errors_only_when_top_level_is_not_an_array() {
        assert!(parse_service_list("{ not an array }").is_err());
        // A valid-but-empty array is fine and yields no services.
        let loaded = parse_service_list("[]").unwrap();
        assert!(loaded.services.is_empty());
        assert!(loaded.problems.is_empty());
    }

    #[test]
    fn resolve_cwd_absolute_passes_through() {
        let absolute = if cfg!(windows) {
            PathBuf::from(r"C:\workspace\app")
        } else {
            PathBuf::from("/workspace/app")
        };

        assert_eq!(
            resolve_cwd(absolute.to_str().unwrap(), None).unwrap(),
            absolute
        );
    }

    #[test]
    fn resolve_cwd_relative_uses_config_directory() {
        let base = Path::new(if cfg!(windows) {
            r"C:\workspace"
        } else {
            "/workspace"
        });

        assert_eq!(resolve_cwd("app", Some(base)).unwrap(), base.join("app"));
    }
}
