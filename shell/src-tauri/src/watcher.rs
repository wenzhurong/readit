use std::path::{Path, PathBuf};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

pub(crate) struct DocumentWatcher {
    _watcher: RecommendedWatcher,
    document: PathBuf,
}

impl DocumentWatcher {
    pub(crate) fn new<F>(document: &Path, on_change: F) -> notify::Result<Self>
    where
        F: Fn(PathBuf) + Send + Sync + 'static,
    {
        let document = document.to_path_buf();
        let watched_document = document.clone();
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<Event>| match result {
                Ok(event) if event_targets_document(&event, &watched_document) => {
                    on_change(watched_document.clone());
                }
                Ok(_) => {}
                Err(error) => eprintln!("readit document watch error: {error}"),
            })?;
        let parent = document.parent().ok_or_else(|| {
            notify::Error::generic(&format!(
                "document has no parent directory: {}",
                document.display()
            ))
        })?;

        // Watch the directory, not the file. Editors commonly replace a document by
        // renaming a temporary file over it, which detaches a file-only watch.
        watcher.watch(parent, RecursiveMode::NonRecursive)?;
        Ok(Self {
            _watcher: watcher,
            document,
        })
    }

    pub(crate) fn watches(&self, document: &Path) -> bool {
        self.document == document
    }
}

fn event_targets_document(event: &Event, document: &Path) -> bool {
    if event.need_rescan() {
        return true;
    }
    if matches!(event.kind, EventKind::Access(_)) {
        return false;
    }
    event.paths.iter().any(|path| path == document)
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
        time::Duration,
    };

    use super::DocumentWatcher;

    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

    struct TempTree(PathBuf);

    impl TempTree {
        fn new() -> Self {
            let serial = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("readit-watcher-{}-{serial}", std::process::id()));
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
    fn parent_watch_reports_atomic_replacement_but_ignores_siblings() {
        let tree = TempTree::new();
        let document = tree.path().join("current.md");
        let sibling = tree.path().join("other.md");
        let replacement = tree.path().join(".current.md.swp");
        fs::write(&document, "before").unwrap();
        let canonical = document.canonicalize().unwrap();
        let (sender, receiver) = mpsc::channel();
        let _watcher = DocumentWatcher::new(&canonical, move |path| {
            // Windows can deliver a queued directory event while the test receiver is dropping.
            // A closed assertion channel must not unwind through notify's extern callback.
            let _ = sender.send(path);
        })
        .unwrap();

        fs::write(&sibling, "unrelated").unwrap();
        assert!(receiver.recv_timeout(Duration::from_millis(500)).is_err());

        fs::write(&replacement, "after").unwrap();
        fs::rename(&replacement, &document).unwrap();
        assert_eq!(
            receiver.recv_timeout(Duration::from_secs(5)).unwrap(),
            canonical
        );
    }
}
