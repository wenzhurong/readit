// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// M0 spike instrumentation: log a timestamped stage relative to process start,
/// both to stdout (captured when we launch the .app binary directly from a
/// terminal) and to a fixed file on disk (works even when launched via `open`,
/// which detaches stdout from the parent shell).
#[tauri::command]
fn probe_log(stage: String) {
    let elapsed = crate::PROCESS_START
        .get()
        .map(|t| t.elapsed().as_secs_f64() * 1000.0)
        .unwrap_or(-1.0);
    let line = format!("[probe] {stage}: {elapsed:.1} ms since process start\n");
    print!("{line}");
    use std::io::Write;
    let _ = std::io::stdout().flush();
    if let Some(dir) = probe_output_dir() {
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("timing.log"))
        {
            let _ = f.write_all(line.as_bytes());
        }
    }
}

/// Write an arbitrary JSON payload produced by the frontend (e.g. mermaid
/// label/node bounding-box geometry) to a fixed file so it can be inspected
/// from outside the running app, without needing screen-recording permission.
#[tauri::command]
fn probe_write_json(name: String, json: String) {
    if let Some(dir) = probe_output_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join(format!("{name}.json")), json);
    }
}

fn probe_output_dir() -> Option<std::path::PathBuf> {
    // Fixed, spike-only location outside dist/target so results survive
    // even when the app is launched via `open` with an unpredictable cwd.
    // This path never ships in a real build; it only exists in this
    // throwaway probe.
    Some(std::path::PathBuf::from(
        "/Users/mac08/Desktop/robot/readit/spike/tauri-probe/probe-output",
    ))
}

pub static PROCESS_START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    PROCESS_START.get_or_init(std::time::Instant::now);
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, probe_log, probe_write_json])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
