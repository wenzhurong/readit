mod document;
mod external;
mod protocol;
mod updater;
mod watcher;

use std::sync::Arc;

use document::{AppState, DocumentPayload};
use serde::Serialize;
use tauri::{Emitter, Manager, Runtime};
use updater::PendingUpdate;

const DOCUMENTS_PENDING_EVENT: &str = "readit-documents-pending";
const DOCUMENT_CHANGED_EVENT: &str = "readit-document-changed";

#[derive(Clone, Serialize)]
struct DocumentChangedPayload {
    path: String,
}

#[tauri::command]
fn take_pending_path(state: tauri::State<'_, Arc<AppState>>) -> Option<String> {
    state.take_pending_path()
}

#[tauri::command]
async fn open_document(
    app: tauri::AppHandle,
    path: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<DocumentPayload, String> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        state.open_document_with_watcher(std::path::Path::new(&path), move |changed| {
            if let Some(path) = changed.to_str() {
                let _ = app.emit(
                    DOCUMENT_CHANGED_EVENT,
                    DocumentChangedPayload {
                        path: path.to_owned(),
                    },
                );
            }
        })
    })
    .await
    .map_err(|error| format!("document read task failed: {error}"))?
}

fn announce_pending_documents<R: Runtime>(app: &tauri::AppHandle<R>) {
    let _ = app.emit(DOCUMENTS_PENDING_EVENT, ());
}

fn focus_main_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn handle_second_instance<R: Runtime>(app: &tauri::AppHandle<R>, args: Vec<String>, cwd: String) {
    let queued = app
        .state::<Arc<AppState>>()
        .enqueue_argv(&args, std::path::Path::new(&cwd));
    if queued > 0 {
        announce_pending_documents(app);
    }
    focus_main_window(app);
}

#[cfg(windows)]
fn disable_browser_accelerator_keys<R: Runtime>(
    app: &tauri::App<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| std::io::Error::other("main webview was not created"))?;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);

    // setup() runs on the UI thread, so Tauri executes this callback synchronously.
    window.with_webview(move |webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows_core::Interface;

        let result: windows_core::Result<()> = (|| unsafe {
            let core = webview.controller().CoreWebView2()?;
            let settings = core.Settings()?;
            let settings3 = settings.cast::<ICoreWebView2Settings3>()?;
            settings3.SetAreBrowserAcceleratorKeysEnabled(false)
        })();
        let _ = sender.send(result.map_err(|error| error.to_string()));
    })?;

    let result = receiver.try_recv().map_err(|error| {
        std::io::Error::other(format!(
            "WebView2 accelerator callback did not complete during setup: {error}"
        ))
    })?;
    result.map_err(std::io::Error::other)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = Arc::new(AppState::default());
    let initial_args = std::env::args().collect::<Vec<_>>();
    let initial_cwd = std::env::current_dir().unwrap_or_default();
    state.enqueue_argv(&initial_args, &initial_cwd);
    let protocol_state = Arc::clone(&state);

    let app = tauri::Builder::default()
        // SPEC §10.1: this must remain the first plugin so a second process cannot race
        // setup performed by any later plugin.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            handle_second_instance(app, args, cwd)
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        // The plugin's default JS injection also opens mailto:/tel: for _blank links.
        // Disable it so the narrower http(s)-only command is the sole authority.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .manage(state)
        .manage(PendingUpdate::default())
        // 下划线前缀与下面 app.run(|_app_handle, _event|) 同理：这两个形参都只在
        // 某一个平台的 cfg 分支里用到，不加前缀就会在另一个平台上留下未使用警告。
        .setup(|_app| {
            #[cfg(windows)]
            disable_browser_accelerator_keys(_app)?;
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("readit", move |_context, request, responder| {
            let state = Arc::clone(&protocol_state);
            std::thread::spawn(move || {
                responder.respond(state.resources.response_for(request.uri().path()));
            });
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_path,
            open_document,
            external::open_external,
            updater::check_for_update,
            updater::install_update
        ])
        .build(tauri::generate_context!())
        .expect("failed to build readit");

    app.run(move |_app_handle, _event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = _event {
            _app_handle
                .state::<Arc<AppState>>()
                .enqueue_opened_urls(urls);
            // If JS already exists this wakes it; if Opened precedes Ready/Window, the queue in
            // AppState is the durable handoff and the frontend drains it after mounting.
            announce_pending_documents(_app_handle);
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn single_instance_is_exactly_pinned_and_is_the_first_registered_plugin() {
        let manifest = include_str!("../Cargo.toml");
        assert!(manifest.contains("tauri-plugin-single-instance = \"=2.4.3\""));

        let source = include_str!("lib.rs");
        let first_plugin = source
            .match_indices(".plugin(")
            .next()
            .map(|(index, _)| &source[index..])
            .expect("the shell must register the single-instance plugin");
        assert!(first_plugin.starts_with(".plugin(tauri_plugin_single_instance::init("));
    }

    #[test]
    fn external_opener_is_pinned_without_broad_js_link_injection() {
        let manifest = include_str!("../Cargo.toml");
        let source = include_str!("lib.rs");
        let production = source
            .split("#[cfg(test)]")
            .next()
            .expect("lib.rs must contain production code before tests");
        assert_eq!(
            (
                manifest.contains("tauri-plugin-opener = \"=2.5.4\""),
                production.contains(".open_js_links_on_click(false)"),
                production.contains("external::open_external"),
            ),
            (true, true, true)
        );
    }

    #[test]
    fn main_capability_grants_only_the_event_listener_lifecycle() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/main.json"))
                .expect("main capability must be valid JSON");
        assert_eq!(
            capability["permissions"],
            serde_json::json!(["core:event:allow-listen", "core:event:allow-unlisten"])
        );
    }

    #[test]
    fn windows_disables_native_browser_accelerators_through_the_pinned_com_api() {
        let manifest = include_str!("../Cargo.toml");
        let source = include_str!("lib.rs");

        assert!(manifest.contains("webview2-com = \"=0.38.2\""));
        assert!(manifest.contains("windows-core = \"=0.61.2\""));
        assert!(source.contains("SetAreBrowserAcceleratorKeysEnabled(false)"));
        assert!(source.contains("disable_browser_accelerator_keys(app)?"));
    }
}
