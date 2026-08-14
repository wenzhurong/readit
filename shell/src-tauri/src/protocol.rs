use std::{
    path::{Path, PathBuf},
    sync::RwLock,
};

use percent_encoding::percent_decode_str;
use tauri::http::{header, Response, StatusCode};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ResourceError {
    NoDocument,
    InvalidPath,
    OutsideDocumentRoot,
    NotFound,
}

#[derive(Default)]
pub(crate) struct ResourceRoot {
    current: RwLock<Option<PathBuf>>,
}

impl ResourceRoot {
    #[allow(dead_code)]
    pub(crate) fn set_document(&self, document: &Path) -> std::io::Result<()> {
        let document = document.canonicalize()?;
        if !document.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "current document is not a file",
            ));
        }
        let directory = document.parent().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "document has no parent")
        })?;
        *self.current.write().expect("resource root lock poisoned") = Some(directory.to_path_buf());
        Ok(())
    }

    fn resolve_path(&self, uri_path: &str) -> Result<PathBuf, ResourceError> {
        let root = self
            .current
            .read()
            .expect("resource root lock poisoned")
            .clone()
            .ok_or(ResourceError::NoDocument)?;
        let relative = decode_relative_path(uri_path)?;
        let resolved = root
            .join(relative)
            .canonicalize()
            .map_err(|_| ResourceError::NotFound)?;

        if !resolved.starts_with(&root) {
            return Err(ResourceError::OutsideDocumentRoot);
        }
        if !resolved.is_file() {
            return Err(ResourceError::NotFound);
        }
        Ok(resolved)
    }

    pub(crate) fn response_for(&self, uri_path: &str) -> Response<Vec<u8>> {
        match self.resolve_path(uri_path) {
            Ok(path) => match std::fs::read(&path) {
                Ok(bytes) => Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, content_type(&path))
                    .header(header::CACHE_CONTROL, "no-store")
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(bytes)
                    .expect("static resource response is valid"),
                Err(_) => error_response(ResourceError::NotFound),
            },
            Err(error) => error_response(error),
        }
    }
}

fn decode_relative_path(uri_path: &str) -> Result<PathBuf, ResourceError> {
    // Tauri gives both readit://localhost/x and http://readit.localhost/x as `/x`.
    // Remove that protocol separator before decoding so an encoded leading slash remains
    // distinguishable and cannot turn into an absolute filesystem path.
    let encoded = uri_path.strip_prefix('/').unwrap_or(uri_path);
    let decoded = percent_decode_str(encoded)
        .decode_utf8()
        .map_err(|_| ResourceError::InvalidPath)?;
    let normalized = decoded.replace('\\', "/");
    if normalized.starts_with('/') || normalized.contains('\0') {
        return Err(ResourceError::InvalidPath);
    }

    let mut relative = PathBuf::new();
    for segment in normalized.split('/') {
        match segment {
            "" | "." => {}
            ".." => return Err(ResourceError::InvalidPath),
            drive
                if drive.len() == 2
                    && drive.as_bytes()[0].is_ascii_alphabetic()
                    && drive.as_bytes()[1] == b':' =>
            {
                return Err(ResourceError::InvalidPath);
            }
            safe => relative.push(safe),
        }
    }
    if relative.as_os_str().is_empty() {
        return Err(ResourceError::InvalidPath);
    }
    Ok(relative)
}

fn error_response(error: ResourceError) -> Response<Vec<u8>> {
    let status = match error {
        ResourceError::NoDocument => StatusCode::SERVICE_UNAVAILABLE,
        ResourceError::InvalidPath => StatusCode::BAD_REQUEST,
        ResourceError::OutsideDocumentRoot => StatusCode::FORBIDDEN,
        ResourceError::NotFound => StatusCode::NOT_FOUND,
    };
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(
            status
                .canonical_reason()
                .unwrap_or("resource error")
                .as_bytes()
                .to_vec(),
        )
        .expect("static error response is valid")
}

fn content_type(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    match extension.as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("svg") => "image/svg+xml",
        Some("css") => "text/css; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("txt" | "md" | "markdown") => "text/plain; charset=utf-8",
        Some("pdf") => "application/pdf",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
    };

    use super::{ResourceError, ResourceRoot};

    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

    struct TempTree(PathBuf);

    impl TempTree {
        fn new() -> Self {
            let serial = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("readit-protocol-{}-{serial}", std::process::id()));
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
    fn refuses_resources_until_a_document_is_current() {
        assert_eq!(
            ResourceRoot::default().resolve_path("/image.png"),
            Err(ResourceError::NoDocument)
        );
    }

    #[test]
    fn resolves_percent_encoded_resources_beneath_the_current_document() {
        let tree = TempTree::new();
        let docs = tree.path().join("docs");
        fs::create_dir_all(docs.join("assets")).unwrap();
        let document = docs.join("README.md");
        let resource = docs.join("assets/hello world.png");
        fs::write(&document, "# current").unwrap();
        fs::write(&resource, b"png").unwrap();

        let root = ResourceRoot::default();
        root.set_document(&document).unwrap();

        assert_eq!(
            root.resolve_path("/assets/hello%20world.png").unwrap(),
            resource.canonicalize().unwrap()
        );
    }

    #[test]
    fn rejects_plain_encoded_and_windows_style_parent_traversal() {
        let tree = TempTree::new();
        let docs = tree.path().join("docs");
        fs::create_dir_all(&docs).unwrap();
        let document = docs.join("README.md");
        fs::write(&document, "# current").unwrap();
        fs::write(tree.path().join("secret.txt"), "secret").unwrap();

        let root = ResourceRoot::default();
        root.set_document(&document).unwrap();

        for path in ["/../secret.txt", "/%2e%2e/secret.txt", "/..%5csecret.txt"] {
            assert_eq!(root.resolve_path(path), Err(ResourceError::InvalidPath));
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_that_escapes_the_current_document_directory() {
        use std::os::unix::fs::symlink;

        let tree = TempTree::new();
        let docs = tree.path().join("docs");
        fs::create_dir_all(&docs).unwrap();
        let document = docs.join("README.md");
        let secret = tree.path().join("secret.txt");
        fs::write(&document, "# current").unwrap();
        fs::write(&secret, "secret").unwrap();
        symlink(&secret, docs.join("alias.txt")).unwrap();

        let root = ResourceRoot::default();
        root.set_document(&document).unwrap();

        assert_eq!(
            root.resolve_path("/alias.txt"),
            Err(ResourceError::OutsideDocumentRoot)
        );
    }

    #[test]
    fn replacing_the_current_document_replaces_the_resource_scope() {
        let tree = TempTree::new();
        let first = tree.path().join("first");
        let second = tree.path().join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        fs::write(first.join("doc.md"), "first").unwrap();
        fs::write(second.join("doc.md"), "second").unwrap();
        fs::write(first.join("asset.txt"), "first").unwrap();
        fs::write(second.join("asset.txt"), "second").unwrap();

        let root = ResourceRoot::default();
        root.set_document(&first.join("doc.md")).unwrap();
        assert_eq!(
            root.resolve_path("/asset.txt").unwrap(),
            first.join("asset.txt").canonicalize().unwrap()
        );

        root.set_document(&second.join("doc.md")).unwrap();
        assert_eq!(
            root.resolve_path("/asset.txt").unwrap(),
            second.join("asset.txt").canonicalize().unwrap()
        );
    }

    #[test]
    fn csp_allows_the_native_custom_protocol_origin() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let csp = config["app"]["security"]["csp"].as_str().unwrap();

        assert!(csp.contains("readit:"));
    }

    #[test]
    fn csp_allows_the_windows_custom_protocol_origin() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let csp = config["app"]["security"]["csp"].as_str().unwrap();

        assert!(csp.contains("http://readit.localhost"));
    }

    #[test]
    fn protocol_response_serves_the_resource_with_its_content_type() {
        let tree = TempTree::new();
        let document = tree.path().join("README.md");
        let image = tree.path().join("diagram.svg");
        fs::write(&document, "# current").unwrap();
        fs::write(&image, "<svg></svg>").unwrap();

        let root = ResourceRoot::default();
        root.set_document(&document).unwrap();

        let success = root.response_for("/diagram.svg");
        assert_eq!(success.status(), tauri::http::StatusCode::OK);
        assert_eq!(
            success.headers()[tauri::http::header::CONTENT_TYPE],
            "image/svg+xml"
        );
        assert_eq!(success.body(), b"<svg></svg>");
        assert_eq!(
            success.headers()[tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN],
            "*"
        );
    }

    #[test]
    fn protocol_response_reports_a_missing_resource() {
        let tree = TempTree::new();
        let document = tree.path().join("README.md");
        fs::write(&document, "# current").unwrap();
        let root = ResourceRoot::default();
        root.set_document(&document).unwrap();

        assert_eq!(
            root.response_for("/missing.svg").status(),
            tauri::http::StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn protocol_response_reports_an_encoded_absolute_path() {
        let tree = TempTree::new();
        let document = tree.path().join("README.md");
        fs::write(&document, "# current").unwrap();
        let root = ResourceRoot::default();
        root.set_document(&document).unwrap();

        assert_eq!(
            root.response_for("/%2Fetc/passwd").status(),
            tauri::http::StatusCode::BAD_REQUEST
        );
    }
}
