mod document;
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
        .manage(state)
        .manage(PendingUpdate::default())
        .register_asynchronous_uri_scheme_protocol("readit", move |_context, request, responder| {
            let state = Arc::clone(&protocol_state);
            std::thread::spawn(move || {
                responder.respond(state.resources.response_for(request.uri().path()));
            });
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_path,
            open_document,
            updater::check_for_update,
            updater::install_update
        ])
        .build(tauri::generate_context!())
        .expect("failed to build readit");

    app.run(move |app_handle, event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = event {
            app_handle
                .state::<Arc<AppState>>()
                .enqueue_opened_urls(urls);
            // If JS already exists this wakes it; if Opened precedes Ready/Window, the queue in
            // AppState is the durable handoff and the frontend drains it after mounting.
            announce_pending_documents(app_handle);
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
}
