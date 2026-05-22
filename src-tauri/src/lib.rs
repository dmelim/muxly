mod commands;
mod error;
mod events;
mod history;
mod import;
mod net;
mod open;
mod process;
mod services;

use commands::{
    app_version, check_port, load_services, save_services, start_service, stop_service,
};
use history::{get_service_history, HistoryDb};
use import::scan_importable;
use open::{open_in_editor, open_in_file_manager, open_url};
use process::{ProcessRegistry, ProcessTerminator};
use services::config::ServicesConfigDir;
use std::{
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ProcessRegistry::default())
        .manage(ServicesConfigDir::default())
        .setup(|app| {
            // The history DB lives in the app data directory, which needs the
            // resolved app handle — hence setup() rather than an eager manage().
            let db = HistoryDb::open(app.handle())?;
            app.manage(db);
            // Live-reload services.json when it changes on disk.
            services::config::watch_service_config(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                let registry = window.state::<ProcessRegistry>();
                let terminators = registry.running_terminators();

                thread::spawn(move || {
                    terminate_with_timeout(terminators, Duration::from_secs(3));
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            check_port,
            load_services,
            save_services,
            start_service,
            stop_service,
            open_in_editor,
            open_in_file_manager,
            open_url,
            scan_importable,
            get_service_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn terminate_with_timeout(terminators: Vec<ProcessTerminator>, timeout: Duration) {
    let total = terminators.len();
    if total == 0 {
        return;
    }

    let (tx, rx) = mpsc::channel();

    for terminator in terminators {
        let tx = tx.clone();
        thread::spawn(move || {
            let _ = terminator.terminate();
            let _ = tx.send(());
        });
    }

    drop(tx);

    let deadline = Instant::now() + timeout;
    for _ in 0..total {
        let now = Instant::now();
        if now >= deadline {
            break;
        }

        if rx
            .recv_timeout(deadline.saturating_duration_since(now))
            .is_err()
        {
            break;
        }
    }
}
