mod protocol;

use std::sync::Arc;

use protocol::ResourceRoot;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let resources = Arc::new(ResourceRoot::default());
    let protocol_resources = Arc::clone(&resources);

    tauri::Builder::default()
        .manage(resources)
        .register_asynchronous_uri_scheme_protocol("readit", move |_context, request, responder| {
            let resources = Arc::clone(&protocol_resources);
            std::thread::spawn(move || {
                responder.respond(resources.response_for(request.uri().path()));
            });
        })
        .run(tauri::generate_context!())
        .expect("failed to run readit");
}
