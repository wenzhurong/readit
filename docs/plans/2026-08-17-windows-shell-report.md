# Windows 壳推进报告

> 对应方案：[`2026-08-17-windows-shell.md`](./2026-08-17-windows-shell.md)  
> 分支：`agent/windows-shell`  
> 同步基线：`33b5ea7 docs: Windows 壳构建方案`

## 当前结论

工作仍在推进中。W1 已完成：当前源码能够在 Windows x64 上编译为原生程序并生成 NSIS 安装包，安装包也能完成当前用户静默安装。W2–W6 尚未完成，因此此时还不能给出“完整符合预期、可正式发布”的结论。

测试主机为 Windows `10.0.26200.9168`、AMD64，已安装 Microsoft Edge WebView2 Runtime `151.0.4129.86`。干净 Windows 10 且没有 WebView2 Runtime 的场景尚未执行，不以当前主机结果代替该场景。

## W1：Windows 构建链与 NSIS

### 选择

- 唯一 Windows 安装目标为 NSIS，安装模式为 `currentUser`。
- WebView2 使用 `downloadBootstrapper` 且静默安装。这样安装包保持较小；运行时缺失时需要联网下载，因此离线安装不属于当前方案的保证范围。
- `minimumWebview2Version` 明确为 `null`。项目依赖 Evergreen WebView2，不把安装卡在某个旧的最低版本；兼容性由后续 Windows 验收和持续集成守护。

### 红灯与绿灯

1. 新增 Windows bundle 配置测试后先运行红灯：2 个断言失败，分别证明原配置没有 `bundle.targets` 和 Windows WebView2 配置。
2. 加入 NSIS、WebView2 和当前用户安装配置后，测试变绿：`1 file / 2 tests passed`。
3. Windows Rust 测试首次跑完 27 个用例后，`notify` 仍可能在测试接收端销毁期间送达排队事件，测试回调中的 `unwrap()` 跨 extern 回调解栈并导致进程退出。回调改为忽略已关闭断言通道后，`cargo test --lib` 为 `27 passed / 0 failed`。

### 构建和安装结果

| 项目 | 结果 |
| --- | --- |
| readit 发布包构建 | 成功；7 个 ESM 入口和 CJS 入口完成，自包含类型闭包检查通过 |
| 壳前端生产构建 | 成功；Vite 转换 441 个模块 |
| Windows 原生程序 | 成功；`x86_64-pc-windows-gnu/release/readit-shell.exe` |
| NSIS | 成功；`readit_0.1.0_x64-setup.exe` |
| 安装包体积 | 9,108,829 bytes（8.69 MiB） |
| 安装后文件 | 31,745,925 bytes（30.28 MiB），共 3 个文件 |
| 静默安装 | 成功，退出码 0；受测试沙箱写权限限制，安装目录显式设为 `D:\robot\installed-readit` |

### 构建环境说明

本机没有可用的 MSVC/Windows SDK，且系统级 Build Tools 安装被权限策略拒绝。为取得真实 Windows 二进制和安装包，本次本地验证使用 Rust `stable-x86_64-pc-windows-gnu` 与便携 LLVM-MinGW。Tauri 官方发布工作流仍应使用 MSVC；GNU 工具链、离线 Cargo vendor 和沙箱构建辅助脚本均位于仓库外，不构成产品改动。

## W2：文件关联与用户默认选择

### 实现

- 保留基础配置里的 macOS `fileAssociations`，但在 `tauri.windows.conf.json` 中把 Windows 的该数组覆盖为空。原因是 Tauri 2.11.4 的默认 NSIS `APP_ASSOCIATE` 会直接写扩展名默认 ProgID，与“不抢默认应用”的产品策略冲突。
- 自定义 NSIS hook 只写 `HKCU\Software\Classes\readit.md`，以及 `.md` / `.markdown` 下的 `OpenWithProgids` 值；安装和卸载后均通知 Explorer 刷新关联。
- hook 不含 `HKLM`、`SHCTX` 或 `UserChoice` 写入。卸载只删除 readit 自己的 ProgID和值，不删除其他应用的 Open With 项。
- README 已写明 Windows 设置页和资源管理器两条由用户主动选择默认应用的路径。

### 红灯、绿灯与安装脚本证据

1. 新增守卫后先运行红灯：平台覆盖配置、installer hook 和 README 三项均失败。
2. 实现后变绿：`1 file / 3 tests passed`。
3. 用新配置重新生成 NSIS 成功；生成的 `installer.nsi` 中“Create/Delete file associations”区为空，自定义 hook 被 include，证明 Windows 平台覆盖配置实际参与打包，而不是只让文本测试变绿。

### 三种初始状态

| 初始状态 | 结果 |
| --- | --- |
| 系统没有 `.md` 默认程序 | **环境阻塞，未形成产品结论。** 当前状态已确认无默认值、无 `UserChoice`；但受 Codex shell 沙箱策略影响，NSIS 的所有 HKCU 写入被拦截，故无法观察 Open With 正向落盘。 |
| 已有其他默认程序 | **环境阻塞，未执行。** 沙箱同时禁止为测试创建临时默认 ProgID，不能安全构造状态。 |
| 全新用户配置 | **未执行。** 当前会话没有创建临时 Windows 用户/配置文件的权限，也不把现有用户冒充全新用户。 |

以上三项必须在不拦截 HKCU 的 Windows 会话中补验；当前只证明安装脚本的静态策略和可编译性，不能把它们写成运行时通过。

## 待完成

- W2：实现已完成；三种初始注册表状态的运行时验证仍受沙箱阻塞。
- W3：接管 Windows 原生 `Ctrl+F`，并记录对其他 WebView2 浏览器快捷键的影响。
- W4：在真实应用窗口执行六项人工验收，并补 Windows 路径/标题边界测试。
- W5：Windows 发布、更新签名与双平台 `latest.json`。
- W6：收口 README、SPEC、测试计划、债务与最终结论。
