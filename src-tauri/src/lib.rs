mod commands;
mod error;
mod events;
mod history;
mod import;
mod net;
mod open;
mod process;
mod pty;
mod runtime;
mod services;
mod settings;
mod shell_env;

use commands::{
    activate_runtime_fallback, app_version, check_port, check_runtime_requirements,
    find_port_holder, kill_pid, load_services, pty_close, pty_open, pty_resize, pty_write,
    resolve_icon_image, save_services, service_pty_resize, service_pty_write, start_service,
    stop_service,
};
use history::{get_service_history, HistoryDb};
use import::scan_importable;
use open::{open_in_editor, open_in_file_manager, open_url};
use process::{ProcessRegistry, ProcessTerminator, ServicePtyRegistry};
use pty::PtyRegistry;
use runtime::RuntimeFallbacks;
use services::config::ServicesConfigDir;
use settings::{load_settings, save_settings};
use shell_env::LoginPath;
use std::{
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, RunEvent, WindowEvent};

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(ProcessRegistry::default())
        .manage(PtyRegistry::default())
        .manage(ServicePtyRegistry::default())
        .manage(ServicesConfigDir::default())
        .manage(RuntimeFallbacks::default())
        .manage(LoginPath::default())
        .setup(|app| {
            // The history DB lives in the app data directory, which needs the
            // resolved app handle — hence setup() rather than an eager manage().
            let db = HistoryDb::open(app.handle())?;
            app.manage(db);
            // Live-reload services.json when it changes on disk.
            services::config::watch_service_config(app.handle().clone());
            // Recover the user's real PATH when we were launched from the GUI
            // and inherited launchd's minimal one. Runs off-thread — nothing
            // needs the answer until a service is started.
            shell_env::resolve_in_background(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                let registry = window.state::<ProcessRegistry>();
                let terminators = registry.running_terminators();

                // Kill any open interactive shells synchronously — they don't
                // need the graceful-shutdown dance services get, and we don't
                // want orphan PTY children outliving the window.
                window.state::<PtyRegistry>().close_all();

                thread::spawn(move || {
                    terminate_with_timeout(terminators, Duration::from_secs(3));
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            check_port,
            find_port_holder,
            kill_pid,
            load_services,
            check_runtime_requirements,
            activate_runtime_fallback,
            load_settings,
            save_settings,
            resolve_icon_image,
            save_services,
            start_service,
            stop_service,
            open_in_editor,
            open_in_file_manager,
            open_url,
            scan_importable,
            get_service_history,
            pty_open,
            pty_write,
            pty_resize,
            pty_close,
            service_pty_write,
            service_pty_resize
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // Closing the window is not the only way out. On macOS ⌘Q (and the
        // Quit menu item) terminate the app through the run loop, which does
        // not necessarily deliver a per-window CloseRequested first — so
        // without this every running service would be orphaned on quit,
        // holding its port with no window left to stop it from.
        //
        // This is the blocking backstop: the CloseRequested handler above only
        // kicks termination off on a detached thread, which is fine while the
        // window is tearing down but useless once the process is about to go
        // away. Here we wait for the children to actually die.
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            app_handle.state::<PtyRegistry>().close_all();

            let terminators = app_handle.state::<ProcessRegistry>().running_terminators();
            terminate_with_timeout(terminators, Duration::from_secs(3));
        }
    });
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
