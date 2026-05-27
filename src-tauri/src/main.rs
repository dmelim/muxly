// Hide the extra Windows console window that would otherwise appear alongside
// the Tauri window in release builds. Debug builds keep the console so
// `println!` / panic output stays visible while developing.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    muxly_lib::run()
}
