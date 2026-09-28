use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::RwLock,
};

use percent_encoding::percent_decode_str;
use tauri::http::{header, Response, StatusCode};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ResourceError {
    InvalidPath,
    OutsideDocumentRoot,
    NotFound,
}

/// 已开文档的资源根目录，以 generation 为键。
///
/// URL 形如 `/<generation>/<相对路径>`：每份文档只解析到它自己所在的目录，多标签下标签 B 的
/// 图片不会跑到标签 A 的目录里去找（多标签设计 §3.2）。
#[derive(Default)]
pub(crate) struct ResourceRoots {
    roots: RwLock<HashMap<u64, PathBuf>>,
}

impl ResourceRoots {
    pub(crate) fn insert(&self, generation: u64, document: &Path) -> std::io::Result<()> {
        let document = document.canonicalize()?;
        if !document.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "document is not a file",
            ));
        }
        let directory = document.parent().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "document has no parent")
        })?;
        self.roots
            .write()
            .expect("resource root lock poisoned")
            .insert(generation, directory.to_path_buf());
        Ok(())
    }

    pub(crate) fn remove(&self, generation: u64) {
        self.roots
            .write()
            .expect("resource root lock poisoned")
            .remove(&generation);
    }

    fn resolve_path(&self, uri_path: &str) -> Result<PathBuf, ResourceError> {
        let (generation, rest) = split_generation(uri_path)?;
        let root = self
            .roots
            .read()
            .expect("resource root lock poisoned")
            .get(&generation)
            .cloned()
            .ok_or(ResourceError::NotFound)?;
        let relative = decode_relative_path(rest)?;
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

/// `/<generation>/<rest>` → `(generation, "/<rest>")`。rest 保留自己的前导 `/`，原样交给
/// `decode_relative_path`，所以编码过的前导斜杠照旧认得出来。首段不是数字，就当作没有这份文档。
fn split_generation(uri_path: &str) -> Result<(u64, &str), ResourceError> {
    let without_separator = uri_path.strip_prefix('/').unwrap_or(uri_path);
    let slash = without_separator
        .find('/')
        .ok_or(ResourceError::NotFound)?;
    let generation = without_separator[..slash]
        .parse::<u64>()
        .map_err(|_| ResourceError::NotFound)?;
    Ok((generation, &without_separator[slash..]))
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

    use super::{ResourceError, ResourceRoots};

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
    fn rejects_plain_encoded_and_windows_style_parent_traversal() {
        let tree = TempTree::new();
        let docs = tree.path().join("docs");
        fs::create_dir_all(&docs).unwrap();
        let document = docs.join("README.md");
        fs::write(&document, "# current").unwrap();
        fs::write(tree.path().join("secret.txt"), "secret").unwrap();

        let root = ResourceRoots::default();
        root.insert(1, &document).unwrap();

        for path in ["/1/../secret.txt", "/1/%2e%2e/secret.txt", "/1/..%5csecret.txt"] {
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

        let root = ResourceRoots::default();
        root.insert(1, &document).unwrap();

        assert_eq!(
            root.resolve_path("/1/alias.txt"),
            Err(ResourceError::OutsideDocumentRoot)
        );
    }

    #[cfg(windows)]
    #[test]
    fn rejects_a_windows_junction_that_escapes_the_current_document_directory() {
        let tree = TempTree::new();
        let docs = tree.path().join("docs");
        let outside = tree.path().join("outside");
        fs::create_dir_all(&docs).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let document = docs.join("README.md");
        let secret = outside.join("secret.txt");
        let junction = docs.join("escape");
        fs::write(&document, "# current").unwrap();
        fs::write(&secret, "secret").unwrap();
        let output = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&outside)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "mklink /J failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );

        let root = ResourceRoots::default();
        root.insert(1, &document).unwrap();
        let result = root.resolve_path("/1/escape/secret.txt");
        fs::remove_dir(&junction).unwrap();

        assert_eq!(result, Err(ResourceError::OutsideDocumentRoot));
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

        let root = ResourceRoots::default();
        root.insert(1, &document).unwrap();

        let success = root.response_for("/1/diagram.svg");
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
        let root = ResourceRoots::default();
        root.insert(1, &document).unwrap();

        assert_eq!(
            root.response_for("/1/missing.svg").status(),
            tauri::http::StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn protocol_response_reports_an_encoded_absolute_path() {
        let tree = TempTree::new();
        let document = tree.path().join("README.md");
        fs::write(&document, "# current").unwrap();
        let root = ResourceRoots::default();
        root.insert(1, &document).unwrap();

        assert_eq!(
            root.response_for("/1/%2Fetc/passwd").status(),
            tauri::http::StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn refuses_resources_for_a_generation_that_is_not_open() {
        let tree = TempTree::new();
        let document = tree.path().join("README.md");
        fs::write(&document, "# current").unwrap();
        fs::write(tree.path().join("image.png"), b"png").unwrap();
        let roots = ResourceRoots::default();
        assert_eq!(roots.resolve_path("/1/image.png"), Err(ResourceError::NotFound));

        roots.insert(1, &document).unwrap();
        assert!(roots.resolve_path("/1/image.png").is_ok());
        for other in ["/2/image.png", "/image.png", "/x/image.png", "/1"] {
            assert_eq!(roots.resolve_path(other), Err(ResourceError::NotFound), "{other}");
        }

        roots.remove(1);
        assert_eq!(roots.resolve_path("/1/image.png"), Err(ResourceError::NotFound));
    }

    #[test]
    fn resolves_percent_encoded_resources_beneath_its_document() {
        let tree = TempTree::new();
        // 目录名与文件名都带空格、#、中文：多标签设计的评审关注第 4 条。
        let docs = tree.path().join("docs #1 中文");
        fs::create_dir_all(docs.join("assets")).unwrap();
        let document = docs.join("README.md");
        let spaced = docs.join("assets/hello world.png");
        let chinese = docs.join("assets/中文 图.png");
        fs::write(&document, "# current").unwrap();
        fs::write(&spaced, b"png").unwrap();
        fs::write(&chinese, b"png").unwrap();

        let roots = ResourceRoots::default();
        roots.insert(7, &document).unwrap();

        assert_eq!(
            roots.resolve_path("/7/assets/hello%20world.png").unwrap(),
            spaced.canonicalize().unwrap()
        );
        assert_eq!(
            roots
                .resolve_path("/7/assets/%E4%B8%AD%E6%96%87%20%E5%9B%BE.png")
                .unwrap(),
            chinese.canonicalize().unwrap()
        );
    }

    #[test]
    fn each_open_document_resolves_resources_in_its_own_directory() {
        let tree = TempTree::new();
        let first = tree.path().join("first");
        let second = tree.path().join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        fs::write(first.join("doc.md"), "first").unwrap();
        fs::write(second.join("doc.md"), "second").unwrap();
        fs::write(first.join("asset.txt"), "first").unwrap();
        fs::write(second.join("asset.txt"), "second").unwrap();

        let roots = ResourceRoots::default();
        roots.insert(1, &first.join("doc.md")).unwrap();
        roots.insert(2, &second.join("doc.md")).unwrap();

        assert_eq!(
            roots.resolve_path("/1/asset.txt").unwrap(),
            first.join("asset.txt").canonicalize().unwrap()
        );
        assert_eq!(
            roots.resolve_path("/2/asset.txt").unwrap(),
            second.join("asset.txt").canonicalize().unwrap()
        );
    }

    #[test]
    fn protocol_response_reports_an_unknown_generation_as_not_found() {
        let tree = TempTree::new();
        let document = tree.path().join("README.md");
        fs::write(&document, "# current").unwrap();
        fs::write(tree.path().join("diagram.svg"), "<svg></svg>").unwrap();
        let roots = ResourceRoots::default();
        roots.insert(1, &document).unwrap();

        assert_eq!(
            roots.response_for("/9/diagram.svg").status(),
            tauri::http::StatusCode::NOT_FOUND
        );
    }
}
