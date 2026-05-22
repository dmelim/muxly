use crate::{
    error::AppError,
    events::SERVICES_CHANGED,
    services::{validate_services, ServiceConfig},
};
use notify::{RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::{
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
) -> Result<Vec<ServiceConfig>, AppError> {
    let path = service_config_path(app)?;
    let text = fs::read_to_string(&path).map_err(|source| AppError::IoPath {
        action: "read",
        path: path.clone(),
        source,
    })?;

    let services: Vec<ServiceConfig> =
        serde_json::from_str(&text).map_err(|source| AppError::ConfigParse {
            path: path.clone(),
            source,
        })?;

    validate_services(&services).map_err(|problems| AppError::ConfigInvalid {
        path: path.clone(),
        problems,
    })?;

    config_dir.set_from_path(&path);
    Ok(services)
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
    use super::resolve_cwd;
    use std::path::{Path, PathBuf};

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
