use tauri_plugin_opener::OpenerExt;

fn validate_web_url(raw: &str) -> Result<(), String> {
    let url =
        tauri::Url::parse(raw).map_err(|_| "external link is not an absolute URL".to_owned())?;
    match url.scheme() {
        "http" | "https" => Ok(()),
        _ => Err("external link scheme is not allowed".to_owned()),
    }
}

fn open_external_with(
    url: &str,
    opener: impl FnOnce(&str) -> Result<(), String>,
) -> Result<(), String> {
    validate_web_url(url)?;
    opener(url)
}

#[tauri::command]
pub fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    open_external_with(&url, |allowed| {
        app.opener()
            .open_url(allowed, None::<&str>)
            .map_err(|error| format!("system browser rejected the URL: {error}"))
    })
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::open_external_with;

    fn rejected_without_opening(url: &str) -> (bool, usize) {
        let calls = Cell::new(0);
        let result = open_external_with(url, |_| {
            calls.set(calls.get() + 1);
            Ok(())
        });
        (result.is_err(), calls.get())
    }

    #[test]
    fn rejects_javascript_without_calling_opener() {
        assert_eq!(rejected_without_opening("javascript:alert(1)"), (true, 0));
    }

    #[test]
    fn rejects_file_without_calling_opener() {
        assert_eq!(rejected_without_opening("file:///etc/passwd"), (true, 0));
    }

    #[test]
    fn rejects_data_without_calling_opener() {
        assert_eq!(
            rejected_without_opening("data:text/html,<h1>bad</h1>"),
            (true, 0)
        );
    }

    #[test]
    fn rejects_vscode_without_calling_opener() {
        assert_eq!(
            rejected_without_opening("vscode://file/etc/passwd"),
            (true, 0)
        );
    }

    #[test]
    fn rejects_mixed_case_javascript_without_calling_opener() {
        assert_eq!(rejected_without_opening("JavaScript:alert(1)"), (true, 0));
    }

    #[test]
    fn rejects_mailto_and_protocol_relative_without_calling_opener() {
        assert_eq!(
            [
                rejected_without_opening("mailto:reader@example.com"),
                rejected_without_opening("//example.com/path"),
            ],
            [(true, 0), (true, 0)]
        );
    }

    #[test]
    fn allows_http_and_https_to_reach_opener() {
        let opened = std::cell::RefCell::new(Vec::new());
        for url in ["http://example.com/a", "HTTPS://example.com/b"] {
            open_external_with(url, |allowed| {
                opened.borrow_mut().push(allowed.to_owned());
                Ok(())
            })
            .expect("http(s) should be passed to opener");
        }
        assert_eq!(
            opened.into_inner(),
            ["http://example.com/a", "HTTPS://example.com/b"]
        );
    }
}
