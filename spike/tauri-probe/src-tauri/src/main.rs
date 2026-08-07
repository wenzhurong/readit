// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Capture process start as close to entry as possible; probe_log()
    // reports elapsed time relative to this instant.
    let _ = tauri_probe_lib::PROCESS_START.set(std::time::Instant::now());
    tauri_probe_lib::run()
}
