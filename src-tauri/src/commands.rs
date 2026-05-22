use crate::{
    error::AppError,
    events::ProcessOutputEvent,
    net::is_port_available,
    process::{spawn_process, ProcessRegistry},
    services::{
        config::{load_service_config, save_service_config, ServicesConfigDir},
        ServiceConfig,
    },
};
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
