use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};
use tauri::{AppHandle, Manager};

pub struct Startup {
    started: Instant,
    revealed: AtomicBool,
}
impl Default for Startup {
    fn default() -> Self {
        Self {
            started: Instant::now(),
            revealed: AtomicBool::new(false),
        }
    }
}
impl Startup {
    pub fn mark(&self, phase: &str) {
        eprintln!(
            "[startup] {phase}: {} ms since native start",
            self.started.elapsed().as_millis()
        );
    }
}

// Serialize the fast path and fallbacks on the window thread. Only a successful
// first reveal focuses the window; a late fallback must not steal focus.
pub fn reveal(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let startup = handle.state::<Startup>();
        if startup.revealed.load(Ordering::SeqCst) {
            return;
        }
        if let Some(window) = handle.get_webview_window("main") {
            if window.show().is_ok() {
                startup.revealed.store(true, Ordering::SeqCst);
                let _ = window.set_focus();
                startup.mark("window revealed");
            }
        }
    });
}
#[tauri::command]
pub fn reveal_main_window(app: AppHandle) {
    reveal(&app);
}
