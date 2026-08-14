mod document;
mod protocol;

use std::sync::Arc;

use document::{AppState, DocumentPayload};
use tauri::Manager;

const DOCUMENTS_PENDING_EVENT: &str = "readit-documents-pending";

#[tauri::command]
fn take_pending_path(state: tauri::State<'_, Arc<AppState>>) -> Option<String> {
    state.take_pending_path()
}

#[tauri::command]
async fn open_document(
    path: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<DocumentPayload, String> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || state.open_document(std::path::Path::new(&path)))
        .await
        .map_err(|error| format!("document read task failed: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = Arc::new(AppState::default());
    let protocol_state = Arc::clone(&state);

    let app = tauri::Builder::default()
        .manage(state)
        .register_asynchronous_uri_scheme_protocol("readit", move |_context, request, responder| {
            let state = Arc::clone(&protocol_state);
            std::thread::spawn(move || {
                responder.respond(state.resources.response_for(request.uri().path()));
            });
        })
        .invoke_handler(tauri::generate_handler![take_pending_path, open_document])
        .build(tauri::generate_context!())
        .expect("failed to build readit");

    app.run(move |app_handle, event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = event {
            use tauri::Emitter;

            app_handle
                .state::<Arc<AppState>>()
                .enqueue_opened_urls(urls);
            // If JS already exists this wakes it; if Opened precedes Ready/Window, the queue in
            // AppState is the durable handoff and the frontend drains it after mounting.
            let _ = app_handle.emit(DOCUMENTS_PENDING_EVENT, ());
        }
    });
}
