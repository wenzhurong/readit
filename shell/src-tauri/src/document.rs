use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::Serialize;

use crate::protocol::ResourceRoot;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocumentPayload {
    pub(crate) path: String,
    pub(crate) source: String,
}

#[derive(Default)]
pub(crate) struct AppState {
    pub(crate) resources: ResourceRoot,
    pending: Mutex<VecDeque<PathBuf>>,
}

impl AppState {
    pub(crate) fn enqueue_opened_urls(&self, urls: impl IntoIterator<Item = tauri::Url>) {
        let paths = urls
            .into_iter()
            .filter_map(|url| url.to_file_path().ok())
            .filter_map(|path| path.canonicalize().ok());
        self.enqueue_paths(paths);
    }

    fn enqueue_paths(&self, paths: impl IntoIterator<Item = PathBuf>) -> usize {
        let paths = paths
            .into_iter()
            .filter(|path| is_markdown(path))
            .collect::<Vec<_>>();
        let count = paths.len();
        self.pending
            .lock()
            .expect("pending document lock poisoned")
            .extend(paths);
        count
    }

    pub(crate) fn take_pending_path(&self) -> Option<String> {
        let mut pending = self.pending.lock().expect("pending document lock poisoned");
        while let Some(path) = pending.pop_front() {
            if let Some(path) = path.to_str() {
                return Some(path.to_owned());
            }
        }
        None
    }

    pub(crate) fn enqueue_argv(&self, args: &[String], cwd: &Path) -> usize {
        let paths = args.iter().skip(1).filter_map(|raw| {
            // These are OS argv strings, not URLs. In particular, do not feed a Windows
            // `C:\Users\...` path through a URL parser; just reject actual URL-shaped args.
            if raw.starts_with('-') || raw.contains("://") {
                return None;
            }
            let path = PathBuf::from(raw);
            Some(if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            })
        });
        self.enqueue_paths(paths)
    }

    pub(crate) fn open_document(&self, path: &Path) -> Result<DocumentPayload, String> {
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("cannot open {}: {error}", path.display()))?;
        if !is_markdown(&canonical) {
            return Err(format!(
                "only Markdown files (.md or .markdown) can be opened: {}",
                canonical.display()
            ));
        }
        let bytes = std::fs::read(&canonical)
            .map_err(|error| format!("cannot read {}: {error}", canonical.display()))?;
        let source = String::from_utf8(bytes)
            .map_err(|_| format!("document is not valid UTF-8: {}", canonical.display()))?;
        let path = canonical
            .to_str()
            .ok_or_else(|| format!("document path is not valid UTF-8: {}", canonical.display()))?
            .to_owned();

        // Change the protocol scope only after the new document has been read successfully.
        // A failed navigation must leave the currently visible document's images working.
        self.resources.set_document(&canonical).map_err(|error| {
            format!(
                "cannot scope resources for {}: {error}",
                canonical.display()
            )
        })?;
        Ok(DocumentPayload { path, source })
    }
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        })
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
    };

    use tauri::http::StatusCode;

    use super::AppState;

    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

    struct TempTree(PathBuf);

    impl TempTree {
        fn new() -> Self {
            let serial = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("readit-document-{}-{serial}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn opened_urls_wait_in_app_state_until_the_frontend_takes_them() {
        let tree = TempTree::new();
        let first = tree.path().join("first.md");
        let second = tree.path().join("second.markdown");
        fs::write(&first, "first").unwrap();
        fs::write(&second, "second").unwrap();
        let state = AppState::default();

        state.enqueue_opened_urls([
            tauri::Url::from_file_path(&first).unwrap(),
            tauri::Url::from_file_path(&second).unwrap(),
            tauri::Url::parse("https://example.com/not-a-file.md").unwrap(),
        ]);

        assert_eq!(
            state.take_pending_path().unwrap(),
            first.canonicalize().unwrap().to_str().unwrap()
        );
        assert_eq!(
            state.take_pending_path().unwrap(),
            second.canonicalize().unwrap().to_str().unwrap()
        );
        assert_eq!(state.take_pending_path(), None);
    }

    #[test]
    fn second_instance_uses_raw_argv_paths_relative_to_its_cwd() {
        let tree = TempTree::new();
        let cwd = tree.path().join("working directory");
        fs::create_dir_all(&cwd).unwrap();
        let relative = cwd.join("relative file.md");
        let absolute = tree.path().join("absolute.markdown");
        fs::write(&relative, "relative").unwrap();
        fs::write(&absolute, "absolute").unwrap();
        let state = AppState::default();
        let args = vec![
            "readit.md".to_owned(),
            "relative file.md".to_owned(),
            absolute.to_str().unwrap().to_owned(),
            "--flag".to_owned(),
            "https://example.com/not-local.md".to_owned(),
            "notes.txt".to_owned(),
        ];

        assert_eq!(state.enqueue_argv(&args, &cwd), 2);
        assert_eq!(state.take_pending_path().as_deref(), relative.to_str());
        assert_eq!(state.take_pending_path().as_deref(), absolute.to_str());
        assert_eq!(state.take_pending_path(), None);
    }

    #[test]
    fn opening_markdown_reads_it_and_moves_the_resource_scope() {
        let tree = TempTree::new();
        let docs = tree.path().join("docs");
        fs::create_dir_all(&docs).unwrap();
        let document = docs.join("README.md");
        fs::write(&document, "# hello\n").unwrap();
        fs::write(docs.join("diagram.svg"), "<svg></svg>").unwrap();
        let state = AppState::default();

        let payload = state.open_document(&document).unwrap();

        assert_eq!(payload.source, "# hello\n");
        assert_eq!(
            payload.path,
            document.canonicalize().unwrap().to_str().unwrap()
        );
        assert_eq!(
            state.resources.response_for("/diagram.svg").status(),
            StatusCode::OK
        );
    }

    #[test]
    fn opening_rejects_non_markdown_and_non_utf8_documents() {
        let tree = TempTree::new();
        let text = tree.path().join("notes.txt");
        let binary = tree.path().join("broken.md");
        fs::write(&text, "plain").unwrap();
        fs::write(&binary, [0xff, 0xfe]).unwrap();
        let state = AppState::default();

        assert!(state.open_document(&text).unwrap_err().contains("Markdown"));
        assert!(state.open_document(&binary).unwrap_err().contains("UTF-8"));
    }

    #[test]
    fn bundle_declares_both_markdown_extensions_as_a_default_viewer() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let associations = config["bundle"]["fileAssociations"].as_array().unwrap();

        assert_eq!(associations.len(), 1);
        assert_eq!(
            associations[0]["ext"],
            serde_json::json!(["md", "markdown"])
        );
        assert_eq!(associations[0]["role"], "Viewer");
        assert_eq!(associations[0]["rank"], "Default");
    }
}
