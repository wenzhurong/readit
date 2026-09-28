use std::{
    collections::{HashMap, VecDeque},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

use serde::Serialize;

use crate::{protocol::ResourceRoots, watcher::DocumentWatcher};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocumentPayload {
    pub(crate) path: String,
    pub(crate) source: String,
    pub(crate) generation: u64,
}

/// 表里的一份已开文档。watcher 随表项一起释放。
struct OpenDocument {
    path: PathBuf,
    _watcher: DocumentWatcher,
}

#[derive(Default)]
pub(crate) struct AppState {
    pub(crate) resources: ResourceRoots,
    /// 以 generation 为键的已开文档表（多标签设计 §3.1）。保存期间持有这把锁：打开、关闭
    /// 都要等它写完，内容不会写到被关掉或换掉的文档上。
    documents: Mutex<HashMap<u64, OpenDocument>>,
    next_generation: AtomicU64,
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

    /// 待打开队列的唯一入口：Finder、第二实例的 argv、「打开…」对话框都走这里，只收 Markdown。
    pub(crate) fn enqueue_paths(&self, paths: impl IntoIterator<Item = PathBuf>) -> usize {
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

    pub(crate) fn open_document_with_watcher<F>(
        &self,
        path: &Path,
        on_change: F,
    ) -> Result<DocumentPayload, String>
    where
        F: Fn(u64, PathBuf) + Send + Sync + 'static,
    {
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

        // 先分配 generation：watcher 的回调要带着它，前端据此把变更分派给对应的标签。
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed) + 1;
        let watcher = DocumentWatcher::new(&canonical, move |changed| on_change(generation, changed))
            .map_err(|error| format!("cannot watch {}: {error}", canonical.display()))?;
        self.resources.insert(generation, &canonical).map_err(|error| {
            format!(
                "cannot scope resources for {}: {error}",
                canonical.display()
            )
        })?;
        let mut documents = match self.documents.lock() {
            Ok(documents) => documents,
            Err(_) => {
                self.resources.remove(generation);
                return Err("document table lock poisoned".to_owned());
            }
        };
        documents.insert(
            generation,
            OpenDocument {
                path: canonical,
                _watcher: watcher,
            },
        );
        Ok(DocumentPayload {
            path,
            source,
            generation,
        })
    }

    /// 释放一份已开文档：watcher 与资源根一起走。未知 generation 当作已经关过。
    pub(crate) fn close_document(&self, generation: u64) -> Result<(), String> {
        let removed = self
            .documents
            .lock()
            .map_err(|_| "document table lock poisoned".to_owned())?
            .remove(&generation);
        self.resources.remove(generation);
        // watcher 在锁外释放：停掉文件系统监听可能要等它的线程。
        drop(removed);
        Ok(())
    }

    pub(crate) fn save_document(&self, generation: u64, content: &str) -> Result<(), String> {
        // Keep the table locked for the whole replacement. An open or close that arrives while a
        // save is in flight waits here, so content can never land on a document that was closed or
        // replaced after Save was requested.
        let documents = self
            .documents
            .lock()
            .map_err(|_| "document table lock poisoned".to_owned())?;
        let document = documents.get(&generation).ok_or_else(|| {
            format!("cannot save: document generation {generation} is not open")
        })?;
        let path = document.path.as_path();
        if !is_markdown(path) {
            return Err(format!(
                "cannot save a non-Markdown document: {}",
                path.display()
            ));
        }
        atomic_write(path, content.as_bytes())
    }

    pub(crate) fn read_document(&self, generation: u64) -> Result<String, String> {
        let path = self
            .documents
            .lock()
            .map_err(|_| "document table lock poisoned".to_owned())?
            .get(&generation)
            .map(|document| document.path.clone())
            .ok_or_else(|| {
                format!("cannot reload: document generation {generation} is not open")
            })?;
        let bytes = std::fs::read(&path)
            .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
        String::from_utf8(bytes)
            .map_err(|_| format!("document is not valid UTF-8: {}", path.display()))
    }

    /// 「打开…」对话框的起始目录：该 generation 的文件所在目录。
    pub(crate) fn document_directory(&self, generation: u64) -> Option<PathBuf> {
        self.documents
            .lock()
            .ok()?
            .get(&generation)?
            .path
            .parent()
            .map(Path::to_path_buf)
    }

    #[cfg(test)]
    fn open_document(&self, path: &Path) -> Result<DocumentPayload, String> {
        self.open_document_with_watcher(path, |_, _| {})
    }
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        })
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    atomic_write_with(path, content, |temporary, target| {
        temporary
            .persist(target)
            .map(|_| ())
            .map_err(|error| error.error)
    })
}

fn atomic_write_with<F>(path: &Path, content: &[u8], persist: F) -> Result<(), String>
where
    F: FnOnce(tempfile::NamedTempFile, &Path) -> std::io::Result<()>,
{
    let parent = path.parent().ok_or_else(|| {
        format!(
            "cannot save {}: document has no parent directory",
            path.display()
        )
    })?;
    let permissions = std::fs::metadata(path)
        .map_err(|error| format!("cannot inspect {} before saving: {error}", path.display()))?
        .permissions();
    let mut temporary = tempfile::Builder::new()
        .prefix(".readit-save-")
        .tempfile_in(parent)
        .map_err(|error| {
            format!(
                "cannot create a temporary file beside {}: {error}",
                path.display()
            )
        })?;

    temporary
        .as_file_mut()
        .write_all(content)
        .map_err(|error| {
            format!(
                "cannot write temporary file for {}: {error}",
                path.display()
            )
        })?;
    temporary
        .as_file()
        .set_permissions(permissions)
        .map_err(|error| {
            format!(
                "cannot preserve permissions for {}: {error}",
                path.display()
            )
        })?;
    temporary.as_file_mut().flush().map_err(|error| {
        format!(
            "cannot flush temporary file for {}: {error}",
            path.display()
        )
    })?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("cannot sync temporary file for {}: {error}", path.display()))?;

    persist(temporary, path)
        .map_err(|error| format!("cannot atomically replace {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicU64, Ordering},
            mpsc,
        },
        time::{Duration, Instant},
    };

    use tauri::http::StatusCode;

    use super::{atomic_write_with, AppState};

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

    #[cfg(windows)]
    #[test]
    fn opens_an_extended_length_windows_document_path() {
        use std::os::windows::ffi::OsStrExt;

        let tree = TempTree::new();
        let mut directory = tree.path().canonicalize().unwrap();
        for index in 0..10 {
            directory.push(format!("long-segment-{index:02}-abcdefghijklmnop"));
        }
        fs::create_dir_all(&directory).unwrap();
        let document = directory.join("extended-path.md");
        fs::write(&document, "# extended path\n").unwrap();
        assert!(document.as_os_str().encode_wide().count() > 260);

        let state = AppState::default();
        let payload = state.open_document(&document).unwrap();

        assert_eq!(payload.source, "# extended path\n");
        assert_eq!(
            payload.path,
            document.canonicalize().unwrap().to_str().unwrap()
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
    fn saving_atomically_replaces_the_open_document_without_changing_its_permissions() {
        let tree = TempTree::new();
        let document = tree.path().join("editable.md");
        fs::write(&document, "old").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&document, fs::Permissions::from_mode(0o640)).unwrap();
        }
        let state = AppState::default();
        let payload = state.open_document(&document).unwrap();
        #[cfg(unix)]
        let old_inode = {
            use std::os::unix::fs::MetadataExt;
            fs::metadata(&document).unwrap().ino()
        };

        let expected = "# 已保存\r\n\r\n尾随换行\r\n";
        state.save_document(payload.generation, expected).unwrap();

        assert_eq!(fs::read(&document).unwrap(), expected.as_bytes());
        #[cfg(unix)]
        {
            use std::os::unix::fs::{MetadataExt, PermissionsExt};
            let metadata = fs::metadata(&document).unwrap();
            assert_ne!(metadata.ino(), old_inode);
            assert_eq!(metadata.permissions().mode() & 0o777, 0o640);
        }
        assert!(fs::read_dir(tree.path()).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".readit-save-")));
    }

    #[test]
    fn failed_atomic_replace_reports_the_target_and_removes_the_temporary_file() {
        let tree = TempTree::new();
        let document = tree.path().join("failure.md");
        fs::write(&document, "unchanged").unwrap();

        let error = atomic_write_with(&document, b"replacement", |_temporary, _target| {
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "injected rename denial",
            ))
        })
        .unwrap_err();

        assert!(error.contains("cannot atomically replace"));
        assert!(error.contains("failure.md"));
        assert_eq!(fs::read_to_string(&document).unwrap(), "unchanged");
        assert!(fs::read_dir(tree.path()).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".readit-save-")));
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

    #[test]
    fn opening_markdown_reads_it_and_scopes_its_resources_by_generation() {
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
            state
                .resources
                .response_for(&format!("/{}/diagram.svg", payload.generation))
                .status(),
            StatusCode::OK
        );
    }

    #[test]
    fn saving_requires_an_open_document() {
        let error = AppState::default()
            .save_document(1, "# nowhere\n")
            .unwrap_err();
        assert!(error.contains("is not open"));
    }

    #[test]
    fn two_open_documents_save_independently_and_a_closed_one_rejects_writes() {
        let tree = TempTree::new();
        let first = tree.path().join("first.md");
        let second = tree.path().join("second.md");
        fs::write(&first, "first").unwrap();
        fs::write(&second, "second").unwrap();
        let state = AppState::default();
        let first_payload = state.open_document(&first).unwrap();
        let second_payload = state.open_document(&second).unwrap();

        state
            .save_document(first_payload.generation, "first saved")
            .unwrap();
        state
            .save_document(second_payload.generation, "second saved")
            .unwrap();
        state.close_document(first_payload.generation).unwrap();
        let error = state
            .save_document(first_payload.generation, "late write")
            .unwrap_err();

        assert!(error.contains("is not open"));
        assert_eq!(fs::read_to_string(&first).unwrap(), "first saved");
        assert_eq!(fs::read_to_string(&second).unwrap(), "second saved");
        assert!(second_payload.generation > first_payload.generation);
    }

    #[test]
    fn reload_reads_only_an_open_generation() {
        let tree = TempTree::new();
        let document = tree.path().join("watched.md");
        fs::write(&document, "before").unwrap();
        let state = AppState::default();
        let payload = state.open_document(&document).unwrap();
        fs::write(&document, "after").unwrap();

        assert_eq!(state.read_document(payload.generation).unwrap(), "after");
        assert!(state
            .read_document(payload.generation + 1)
            .unwrap_err()
            .contains("is not open"));
        state.close_document(payload.generation).unwrap();
        assert!(state
            .read_document(payload.generation)
            .unwrap_err()
            .contains("is not open"));
    }

    #[test]
    fn closing_a_document_releases_its_resource_scope_and_tolerates_repeats() {
        let tree = TempTree::new();
        let document = tree.path().join("README.md");
        fs::write(&document, "# hello\n").unwrap();
        fs::write(tree.path().join("image.png"), b"png").unwrap();
        let state = AppState::default();
        let payload = state.open_document(&document).unwrap();
        let uri = format!("/{}/image.png", payload.generation);
        assert_eq!(state.resources.response_for(&uri).status(), StatusCode::OK);

        state.close_document(payload.generation).unwrap();
        state.close_document(payload.generation).unwrap();

        assert_eq!(
            state.resources.response_for(&uri).status(),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn each_document_reports_disk_changes_with_its_own_generation() {
        let tree = TempTree::new();
        let first_dir = tree.path().join("first");
        let second_dir = tree.path().join("second");
        fs::create_dir_all(&first_dir).unwrap();
        fs::create_dir_all(&second_dir).unwrap();
        let first = first_dir.join("doc.md");
        let second = second_dir.join("doc.md");
        fs::write(&first, "first").unwrap();
        fs::write(&second, "second").unwrap();
        let state = AppState::default();
        let (sender, receiver) = mpsc::channel();
        let first_sender = sender.clone();
        // 通道关闭时不能在 notify 的回调里 unwind，照 watcher.rs 的测试用 `let _ =`。
        let first_payload = state
            .open_document_with_watcher(&first, move |generation, path| {
                let _ = first_sender.send((generation, path));
            })
            .unwrap();
        let second_payload = state
            .open_document_with_watcher(&second, move |generation, path| {
                let _ = sender.send((generation, path));
            })
            .unwrap();

        let first_path = first.canonicalize().unwrap();
        let second_path = second.canonicalize().unwrap();

        // 两份依次改、两份都要各自报到。只留一个 watcher 的回归（打开第二份时把第一份的
        // 丢掉——正是改动前的行为）会在第二轮卡住。重扫事件可能让另一份也报一次，所以不断言
        // 「只有一条」，只断言每条事件的 generation 与路径是配对的。
        let mut seen = Vec::new();
        for (target, generation, path) in [
            (&second, second_payload.generation, &second_path),
            (&first, first_payload.generation, &first_path),
        ] {
            fs::write(target, "changed").unwrap();
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut found = false;
            while !found && Instant::now() < deadline {
                if let Ok(event) = receiver.recv_timeout(Duration::from_millis(200)) {
                    found = event.0 == generation && &event.1 == path;
                    seen.push(event);
                }
            }
            assert!(found, "no event for generation {generation}: {seen:?}");
        }
        assert!(
            seen.iter().all(|(generation, path)| {
                (*generation == first_payload.generation && *path == first_path)
                    || (*generation == second_payload.generation && *path == second_path)
            }),
            "{seen:?}"
        );
    }

    #[test]
    fn dialog_selections_join_the_pending_queue_and_keep_only_markdown() {
        let tree = TempTree::new();
        let first = tree.path().join("a.md");
        let text = tree.path().join("b.txt");
        let second = tree.path().join("c.markdown");
        let state = AppState::default();

        assert_eq!(state.enqueue_paths([first.clone(), text, second.clone()]), 2);
        assert_eq!(state.take_pending_path().as_deref(), first.to_str());
        assert_eq!(state.take_pending_path().as_deref(), second.to_str());
        assert_eq!(state.take_pending_path(), None);
    }

    #[test]
    fn the_dialog_starts_in_the_directory_of_an_open_document() {
        let tree = TempTree::new();
        let docs = tree.path().join("docs");
        fs::create_dir_all(&docs).unwrap();
        let document = docs.join("README.md");
        fs::write(&document, "# hello\n").unwrap();
        let state = AppState::default();
        let payload = state.open_document(&document).unwrap();

        assert_eq!(
            state.document_directory(payload.generation),
            Some(docs.canonicalize().unwrap())
        );
        assert_eq!(state.document_directory(payload.generation + 1), None);
    }
}
