use crate::{
    error::AppError,
    events::{ProcessOutputEvent, PtyOutputEvent},
    net::{find_port_holder_pid, is_port_available, kill_external_pid},
    process::{
        resize_service_pty, spawn_process, write_service_pty, ProcessRegistry, ServicePtyRegistry,
    },
    pty::{self, PtyRegistry},
    runtime::{activate_fallback, check_requirements, RuntimeFallbacks, RuntimeRequirementReport},
    services::{
        config::{load_service_config, resolve_cwd, save_service_config, ServicesConfigDir},
        LoadedServices, ServiceConfig,
    },
};
use std::{fs, path::Path};
use tauri::{ipc::Channel, AppHandle, State};

#[tauri::command]
pub fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Check whether a TCP port is currently bindable. Returns `true` if free.
#[tauri::command]
pub fn check_port(port: u16) -> bool {
    is_port_available(port)
}

/// Find the PID of whatever foreign process is listening on `port`, if any.
/// Returns `None` when the port is free or when we couldn't determine the
/// holder (no `netstat`/`lsof`/`ss` available, parse failure, etc.).
#[tauri::command]
pub fn find_port_holder(port: u16) -> Option<u32> {
    find_port_holder_pid(port)
}

/// Forcibly kill a process by raw PID. Used by the "stop blocker and
/// restart" action when a service's configured port is held by another
/// process. Errors are returned as `AppError::ProcessStop` so they surface
/// in the UI with the same plumbing as our own stop failures.
#[tauri::command]
pub fn kill_pid(pid: u32) -> Result<(), AppError> {
    kill_external_pid(pid).map_err(AppError::ProcessStop)
}

#[tauri::command]
pub fn load_services(
    app: AppHandle,
    config_dir: State<'_, ServicesConfigDir>,
) -> Result<LoadedServices, AppError> {
    load_service_config(&app, &config_dir)
}

#[tauri::command]
pub fn check_runtime_requirements(
    config_dir: State<'_, ServicesConfigDir>,
    fallbacks: State<'_, RuntimeFallbacks>,
    services: Vec<ServiceConfig>,
) -> RuntimeRequirementReport {
    check_requirements(&services, config_dir.current().as_deref(), &fallbacks)
}

#[tauri::command]
pub fn activate_runtime_fallback(
    fallbacks: State<'_, RuntimeFallbacks>,
    path: String,
) -> Result<(), AppError> {
    activate_fallback(&path, &fallbacks)
}

#[tauri::command]
pub fn start_service(
    app: AppHandle,
    registry: State<'_, ProcessRegistry>,
    config_dir: State<'_, ServicesConfigDir>,
    service: ServiceConfig,
    on_output: Channel<ProcessOutputEvent>,
) -> Result<(), AppError> {
    spawn_process(app, &registry, &config_dir, service, on_output)
}

#[tauri::command]
pub fn save_services(
    app: AppHandle,
    config_dir: State<'_, ServicesConfigDir>,
    services: Vec<ServiceConfig>,
) -> Result<(), AppError> {
    save_service_config(&app, &config_dir, &services)
}

#[tauri::command]
pub fn resolve_icon_image(
    config_dir: State<'_, ServicesConfigDir>,
    cwd: String,
    path: String,
) -> Result<String, AppError> {
    const MAX_ICON_BYTES: u64 = 1024 * 1024;

    let image_path = resolve_icon_path(&cwd, &path, &config_dir)?;
    let metadata = fs::metadata(&image_path).map_err(|source| AppError::IoPath {
        action: "read icon metadata",
        path: image_path.clone(),
        source,
    })?;
    if metadata.len() > MAX_ICON_BYTES {
        return Err(AppError::ConfigUnavailable(format!(
            "Icon image is larger than {} KB",
            MAX_ICON_BYTES / 1024
        )));
    }

    let mime = icon_mime_type(&image_path).ok_or_else(|| {
        AppError::ConfigUnavailable("Icon image must be png, jpg, jpeg, webp, gif, or svg".into())
    })?;
    let bytes = fs::read(&image_path).map_err(|source| AppError::IoPath {
        action: "read icon image",
        path: image_path,
        source,
    })?;

    Ok(format!("data:{mime};base64,{}", base64_encode(&bytes)))
}

#[tauri::command]
pub async fn stop_service(
    registry: State<'_, ProcessRegistry>,
    service_id: String,
) -> Result<(), AppError> {
    // `mark_stop_requested` is fast (flips state, hands back the terminator).
    // The actual `terminate()` is slow on Windows — `taskkill /T` walks the
    // whole live process tree and `.status()` blocks until it exits. This
    // command is `async` so Tauri runs it off the main thread, and we push the
    // blocking kill onto the blocking pool so a deep tree (cargo/next) can't
    // freeze the UI while the button flips to "Stopped".
    let terminator =
        registry
            .mark_stop_requested(&service_id)
            .ok_or_else(|| AppError::NotRunning {
                service_id: service_id.clone(),
            })?;

    tauri::async_runtime::spawn_blocking(move || terminator.terminate())
        .await
        .map_err(|error| AppError::ProcessStop(format!("stop task failed to join: {error}")))?
}

/// Open an interactive shell PTY. The frontend chooses `pty_id` so multiple
/// shells can coexist without coordination round-trips.
#[tauri::command]
pub fn pty_open(
    app: AppHandle,
    registry: State<'_, PtyRegistry>,
    pty_id: String,
    rows: u16,
    cols: u16,
    cwd: Option<String>,
    on_output: Channel<PtyOutputEvent>,
) -> Result<(), AppError> {
    pty::open_pty(app, &registry, pty_id, rows, cols, cwd, on_output)
}

#[tauri::command]
pub fn pty_write(
    registry: State<'_, PtyRegistry>,
    pty_id: String,
    data: String,
) -> Result<(), AppError> {
    pty::write_pty(&registry, &pty_id, data)
}

#[tauri::command]
pub fn pty_resize(
    registry: State<'_, PtyRegistry>,
    pty_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), AppError> {
    pty::resize_pty(&registry, &pty_id, rows, cols)
}

#[tauri::command]
pub fn pty_close(registry: State<'_, PtyRegistry>, pty_id: String) -> Result<(), AppError> {
    pty::close_pty(&registry, &pty_id)
}

/// Send keystrokes from a PTY-backed service pane to that service's stdin.
#[tauri::command]
pub fn service_pty_write(
    registry: State<'_, ServicePtyRegistry>,
    service_id: String,
    data: String,
) -> Result<(), AppError> {
    write_service_pty(&registry, &service_id, data)
}

/// Resize a PTY-backed service's terminal to match its pane.
#[tauri::command]
pub fn service_pty_resize(
    registry: State<'_, ServicePtyRegistry>,
    service_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), AppError> {
    resize_service_pty(&registry, &service_id, rows, cols)
}

fn resolve_icon_path(
    cwd: &str,
    icon_path: &str,
    config_dir: &ServicesConfigDir,
) -> Result<std::path::PathBuf, AppError> {
    let path = std::path::PathBuf::from(icon_path);
    if path.is_absolute() {
        return Ok(path);
    }
    Ok(resolve_cwd(cwd, config_dir.current().as_deref())?.join(path))
}

fn icon_mime_type(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => Some("image/png"),
        Some("jpg") | Some("jpeg") => Some("image/jpeg"),
        Some("webp") => Some("image/webp"),
        Some("gif") => Some("image/gif"),
        Some("svg") => Some("image/svg+xml"),
        _ => None,
    }
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);

        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(b2 & 0b0011_1111) as usize] as char);
        } else {
            out.push('=');
        }
    }

    out
}
