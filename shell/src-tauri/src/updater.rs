use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub(crate) struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateMetadata {
    version: String,
    current_version: String,
}

#[tauri::command]
pub(crate) async fn check_for_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateMetadata>, String> {
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    let metadata = update.as_ref().map(|update| UpdateMetadata {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
    });
    *pending
        .0
        .lock()
        .map_err(|_| "pending update lock poisoned".to_owned())? = update;
    Ok(metadata)
}

#[tauri::command]
pub(crate) async fn install_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .map_err(|_| "pending update lock poisoned".to_owned())?
        .take()
        .ok_or_else(|| "there is no pending update".to_owned())?;

    if let Err(error) = update.download_and_install(|_, _| {}, || {}).await {
        *pending
            .0
            .lock()
            .map_err(|_| "pending update lock poisoned".to_owned())? = Some(update);
        return Err(error.to_string());
    }
    app.restart();
}

#[cfg(test)]
mod tests {
    #[test]
    fn updater_is_pinned_and_configured_for_static_github_releases() {
        let manifest = include_str!("../Cargo.toml");
        let source = include_str!("lib.rs");
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            serde_json::json!({
                "dependencyPinned": manifest.contains("tauri-plugin-updater = \"=2.10.1\""),
                "pluginRegistered": source.contains(
                    ".plugin(tauri_plugin_updater::Builder::new().build())"
                ),
                "createArtifacts": config["bundle"]["createUpdaterArtifacts"],
                "signingIdentity": config["bundle"]["macOS"]["signingIdentity"],
                "endpoints": config["plugins"]["updater"]["endpoints"],
                "publicKeyLooksGenerated": config["plugins"]["updater"]["pubkey"]
                    .as_str()
                    .is_some_and(|key| key.starts_with("dW50cnVzdGVkIGNvbW1lbnQ6") && key.len() > 100),
            }),
            serde_json::json!({
                "dependencyPinned": true,
                "pluginRegistered": true,
                "createArtifacts": true,
                "signingIdentity": "-",
                "endpoints": [
                    "https://github.com/wenzhurong/readit/releases/latest/download/latest.json"
                ],
                "publicKeyLooksGenerated": true,
            })
        );
    }

    #[test]
    fn desktop_release_workflow_builds_both_platforms_with_ci_only_secrets() {
        let workflow = include_str!("../../../.github/workflows/release-desktop.yml");
        let requirements = [
            ("manual trigger", "workflow_dispatch:"),
            ("release permission", "contents: write"),
            ("Apple Silicon", "aarch64-apple-darwin"),
            ("Intel", "x86_64-apple-darwin"),
            ("Windows runner", "windows-latest"),
            ("Windows x64", "x86_64-pc-windows-msvc"),
            ("macOS bundles", "bundles: app,dmg"),
            ("Windows bundle", "bundles: nsis"),
            (
                "private key secret",
                "TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}",
            ),
            (
                "private key password secret",
                "TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}",
            ),
            ("official release action", "tauri-apps/tauri-action@v1"),
            ("static updater JSON", "uploadUpdaterJson: true"),
            ("NSIS updater", "updaterJsonPreferNsis: true"),
            ("serialized manifest merge", "max-parallel: 1"),
            (
                "per-platform bundle override",
                "--bundles ${{ matrix.bundles }}",
            ),
        ];
        let missing = requirements
            .into_iter()
            .filter_map(|(name, needle)| (!workflow.contains(needle)).then_some(name))
            .collect::<Vec<_>>();

        assert_eq!(
            (missing, workflow.contains("BEGIN PRIVATE KEY")),
            (Vec::<&str>::new(), false)
        );
    }
}
