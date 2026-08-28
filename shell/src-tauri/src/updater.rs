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
    const PINNED_TAURI_ACTION: &str =
        "tauri-apps/tauri-action@1deb371b0cd8bd54025b384f1cd735e725c4060f";

    fn workflow_action_references(workflow: &str) -> Vec<(usize, &str)> {
        workflow
            .lines()
            .enumerate()
            .filter_map(|(line_number, line)| {
                // A step can start with `- uses:` or put `uses:` below `- name:`.
                let candidate = line.trim_start();
                let step = candidate
                    .strip_prefix('-')
                    .map(str::trim_start)
                    .unwrap_or(candidate);
                let reference = step.strip_prefix("uses:")?.trim_start();
                let reference = reference
                    .split_once(" #")
                    .map_or(reference, |(value, _)| value)
                    .trim()
                    .trim_matches(|character| character == '"' || character == '\'');

                reference
                    .to_ascii_lowercase()
                    .starts_with("tauri-apps/tauri-action@")
                    .then_some((line_number, reference))
            })
            .collect()
    }

    #[test]
    fn release_action_guard_recognizes_direct_and_named_steps() {
        let workflow = r#"
steps:
  # - uses: tauri-apps/tauri-action@ignored-comment
  - uses: tauri-apps/tauri-action@direct # audit note
  - name: Named release step
    uses: "Tauri-Apps/Tauri-Action@named"
"#;
        let references = workflow_action_references(workflow)
            .into_iter()
            .map(|(_, reference)| reference)
            .collect::<Vec<_>>();

        assert_eq!(
            references,
            vec![
                "tauri-apps/tauri-action@direct",
                "Tauri-Apps/Tauri-Action@named"
            ]
        );
    }

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
            ("pinned official release action", PINNED_TAURI_ACTION),
            ("static updater JSON", "uploadUpdaterJson: true"),
            ("NSIS updater", "updaterJsonPreferNsis: true"),
            ("serialized manifest merge", "max-parallel: 1"),
            (
                "per-platform bundle override",
                "--bundles ${{ matrix.bundles }}",
            ),
            // packages/readit 的 dist/ 不进仓库，而 shell 的 vite 构建通过 exports 走它。
            // 少了这一步，三个 job 全部挂在 vite 阶段（2026-08-19 首次真跑实测）。
            ("library build before bundling", "- run: npm run build\n"),
        ];
        // 不能只用 contains/find：旧 pin 若留在注释里，会让实际 action 已被替换时假绿。
        // 这里只接受唯一一条真实 uses step，并兼容 YAML 引号与行尾的审计注释。
        let release_actions = workflow_action_references(workflow);
        let action_line = match release_actions.as_slice() {
            [(line_number, reference)] if *reference == PINNED_TAURI_ACTION => *line_number,
            unexpected => panic!(
                "发布 workflow 必须且只能有一条固定到审核 commit 的 tauri-action uses step；实际为 {unexpected:?}"
            ),
        };

        // 顺序同样要钉：构建必须排在真实 action step 前，否则 dist 还没产出就开始 bundle。
        let build_line = workflow
            .lines()
            .position(|line| line.trim() == "- run: npm run build");
        assert!(
            matches!(build_line, Some(build_line) if build_line < action_line),
            "npm run build 必须排在 tauri-action 之前"
        );
        assert!(
            !workflow.contains("uses: tauri-apps/tauri-action@v1"),
            "发布 action 必须固定到审核过的 commit，不能退回浮动 v1 tag"
        );
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
