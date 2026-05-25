use crate::{
    error::AppError,
    events::ProcessOutputEvent,
    net::is_port_available,
    process::{spawn_process, ProcessRegistry},
    services::{
        config::{load_service_config, resolve_cwd, save_service_config, ServicesConfigDir},
        ServiceConfig,
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

#[tauri::command]
pub fn load_services(
    app: AppHandle,
    config_dir: State<'_, ServicesConfigDir>,
) -> Result<Vec<ServiceConfig>, AppError> {
    load_service_config(&app, &config_dir)
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
pub fn stop_service(
    registry: State<'_, ProcessRegistry>,
    service_id: String,
) -> Result<(), AppError> {
    let terminator =
        registry
            .mark_stop_requested(&service_id)
            .ok_or_else(|| AppError::NotRunning {
                service_id: service_id.clone(),
            })?;

    terminator.terminate()
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
