# Windows 壳推进报告

> 对应方案：[`2026-08-17-windows-shell.md`](./2026-08-17-windows-shell.md)  
> 分支：`agent/windows-shell`  
> 同步基线：`33b5ea7 docs: Windows 壳构建方案`

## 当前结论

工作仍在推进中。W1–W3 已完成实现，W4 已补齐 Windows 路径、安全与长路径自动化，
但真实 WebView2 窗口验收受当前桌面沙箱阻塞。W5–W6 尚未完成，因此此时还不能给出
“完整符合预期、可正式发布”的结论。

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

## W3：Windows `Ctrl+F`

### 决策：方案 B

Windows 壳通过 Tauri 2.11.5 的 `WebviewWindow::with_webview()` 取得 WebView2 controller，沿 `CoreWebView2()` → `Settings()` → `ICoreWebView2Settings3` 调用 `SetAreBrowserAcceleratorKeysEnabled(false)`。对应 COM 依赖只在 `cfg(windows)` 下加入，并精确钉住 `webview2-com = 0.38.2`、`windows-core = 0.61.2`。

选择 B 而不是保留 WebView2 原生查找栏，是因为原生栏只能搜索当前 DOM，不能遵守 readit 在源码/分栏模式下的文档模型查找语义。禁用设置在 Tauri `setup()` 的 UI 线程同步完成；controller、settings 或接口转换失败会让 setup 明确失败，不静默退回两个查找栏竞争的状态。

前端按平台选择主修饰键：macOS 仍是独占 `Meta+F`，Windows 是独占 `Control+F`，两边都排除另一主修饰键以及 Alt/Shift 组合。

### 可见副作用

`AreBrowserAcceleratorKeysEnabled=false` 关闭的是 WebView2 的整组浏览器加速键，不只 `Ctrl+F`。Windows 壳中 WebView2 自带的打印、刷新和开发者工具快捷键（例如 `Ctrl+P`、`Ctrl+R`、`F12`）因此也不再由浏览器进程处理；键盘事件仍可由页面/壳显式接管。readit 当前没有把这些浏览器快捷键列为产品入口，所以接受该影响；若以后需要其中任何一项，应在壳层显式绑定并测试，而不是重新开启整组原生加速键。

### 红灯与绿灯

1. Windows `Control+F` 行为测试先红：事件未被阻止，反而仍由 `Meta+F` 触发。
2. 平台分流后变绿：`1 file / 5 tests passed`，同时守住 macOS 既有行为。
3. Rust 守卫先红于缺少精确 COM 依赖；实现后定向测试变绿。
4. Windows GNU 下完整 `cargo test --lib`：`28 passed / 0 failed`。

真实 WebView2 窗口中的 `Ctrl+F` 行为并入 W4 人工验收，不用单元测试结果冒充真引擎结果。

## W4：Windows 路径补强与真 WebView2 验收

### Windows 路径与安全修正

- 新增壳边界的原生路径归一化：`C:\…` 转成前端导航使用的斜杠形式，去除
  `\\?\` 扩展长度前缀，并把 `\\?\UNC\server\share\…` 还原为 UNC 路径。
- 窗口标题只取文件名，不再把 Windows 完整路径或扩展长度前缀暴露到标题。
- OS 级打开在进入元素导航历史前先归一化；元素层能正确解析反斜杠 base、盘符绝对路径
  和 UNC 路径，不会把 `C:` 误作外链 scheme，也不会把新的绝对盘符路径拼到旧目录后。
- Windows Rust 测试创建真实目录联接（junction），证明 `readit://` 资源根会拒绝联接到
  文档目录外部的文件。
- Windows Rust 测试创建并打开超过 260 个 UTF-16 code unit 的 Markdown 路径；本机
  `LongPathsEnabled=0`，测试依靠 canonical extended path 仍成功。由于方案明确要求在
  `LongPathsEnabled=1` 的机器上还清 D2-27，本轮只记录实测，不关闭该债务。

### 红灯与绿灯

1. 壳路径测试先红：新模块尚不存在，且扩展长度路径仍以原始反斜杠进入路由；修复后
   `document-path` 与 `navigation` 共 `7 passed / 0 failed`。
2. 元素导航加入 Windows base 与盘符绝对路径用例后先有 2 个失败；归一化后该文件
   `45 passed / 0 failed`。合并定向运行最终为 `3 files / 52 tests passed`。
3. 目录联接测试的越界护栏被临时改为恒不执行后，测试由预期的
   `OutsideDocumentRoot` 变为返回外部文件路径，证明断言对真实缺陷敏感；恢复护栏后通过。
4. 长路径守卫中临时注入传统 260 字符拒绝分支后，定向测试按预期失败并报告
   `injected legacy Windows path limit`；移除注入后通过。
5. Windows GNU 下完整 Rust 库测试：`30 passed / 0 failed`。壳与元素 TypeScript
   typecheck 均通过。Vitest 默认 forks 在当前沙箱以 `spawn EPERM` 失败，改用同一
   Vitest 的 `vmThreads` 池后 52 个定向断言全部实际执行；不把前一次“no tests”当成功。

### 六项真引擎清单结果

结果已直接写回唯一清单 `2026-08-13-m6-manual-acceptance.md`，并增加 macOS/Windows
平台列，没有复制第二份清单。本轮六项 Windows 结果为：第 1–5 项未执行，第 6 项只有
体积数据。

阻塞证据是可复现的：直接启动刚构建的 release exe 后，Tauri 在创建主 WebView2 窗口时
退出并报告 `Failed to setup app: Access is denied (os error 5)`。把 WebView2 profile 和
`LOCALAPPDATA` 临时指向可写的 `D:\robot` 后结果不变；Computer Use 初始化后列出了唯一
资源管理器窗口，但环境明确返回 `Computer Use was not approved to use explorer`。因此没有
取得应用窗口、截图或交互证据。

这不是产品“通过”或“失败”的证据，而是测试环境阻塞。以下项目仍须在普通交互式 Windows
会话完成：资源管理器双击与三种默认程序状态、直接二次进程 argv、Ctrl+F 单栏行为、
原子/原地保存刷新、真 WebView2 Mermaid、5 次启动与 60 秒内存。Chromium 与自动化测试
的绿色结果没有写成真 WebView2 结果。

## 待完成

- W2：实现已完成；三种初始注册表状态的运行时验证仍受沙箱阻塞。
- W3：实现已完成；真实 WebView2 行为仍受 W4 的环境阻塞。
- W4：路径、junction 与长路径自动化已完成；六项真实窗口验收仍需在非沙箱 Windows
  会话补验。
- W5：Windows 发布、更新签名与双平台 `latest.json`。
- W6：收口 README、SPEC、测试计划、债务与最终结论。
