# readit macOS 发布与更新

## 更新签名材料

Tauri updater 的签名与 Apple 代码签名是两套独立信任链。当前 updater 公钥已写入
`shell/src-tauri/tauri.conf.json`；对应的加密私钥只存在于维护者机器的
`/Users/mac08/.tauri/readit.key`，口令保存在 macOS 钥匙串条目
`com.mmy420.readit.updater`（账户 `mac08`）。私钥或口令丢失后，已经安装的客户端将
无法接受用另一把密钥签出的更新，所以二者都必须另做安全备份。

首次运行发布工作流前，把材料写入仓库的 Actions secrets；下面两条命令通过标准输入
直传 `gh`，不会把内容保存到仓库文件：

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < /Users/mac08/.tauri/readit.key
security find-generic-password -a mac08 -s com.mmy420.readit.updater -w \
  | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

任何 `.env`、workflow YAML、issue、日志或 Release 说明都不得包含私钥或口令。仓库中
只允许出现公钥和两个 secret 的名字。

本机需要复现 updater 产物时，从钥匙串把口令只放进当前进程环境：

```bash
readit_signing_password="$(security find-generic-password \
  -a mac08 -s com.mmy420.readit.updater -w)"
TAURI_SIGNING_PRIVATE_KEY=/Users/mac08/.tauri/readit.key \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$readit_signing_password" \
  npm run tauri --workspace=readit-shell-frontend -- build --bundles app
unset readit_signing_password
```

不要经 `npm run … signer generate -p …` 把口令作为命令参数传入；npm 会回显展开后的
命令行。需要轮换密钥时直接调用 Tauri CLI，并在把新公钥提交进应用前先完成私钥与口令
的安全备份。

## 发布步骤

1. 同步 `shell/src-tauri/tauri.conf.json` 与 `shell/src-tauri/Cargo.toml` 的版本号。
2. 完成 `docs/plans/2026-08-13-m6-manual-acceptance.md` 中本次发布要求的真机验收；未勾选
   的项目必须作为发布缺口保留，不能写成已经通过。
3. 在 GitHub Actions 手动运行 `release macOS`。它分别构建 Apple Silicon 与 Intel
   产物，并使用官方 Tauri Action 生成、上传静态 `latest.json`。
4. 检查草稿 Release 同时含两个 macOS updater bundle、对应 `.sig` 和
   `latest.json`；确认 manifest 的 `signature` 是签名文件内容而不是文件路径。
5. 验证无误后再发布草稿。客户端固定从
   `https://github.com/wenzhurong/readit/releases/latest/download/latest.json` 检查更新。

当前 macOS bundle 使用 ad-hoc 身份 `-`，只解决无 Apple 身份时的本地签名要求；它不
提供 Developer ID 身份或 notarization。该分发信任缺口仍属于 M7，不能因为 updater
签名已完成而记为清偿。
