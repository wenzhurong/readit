# Windows 壳推进报告

> 对应方案：[`2026-08-17-windows-shell.md`](./2026-08-17-windows-shell.md)  
> 分支：`agent/windows-shell`  
> 同步基线：`33b5ea7 docs: Windows 壳构建方案`

## 当前结论

W1–W6 的仓库内实现已经完成：Windows 壳能生成当前用户 NSIS，文件关联采取不抢默认的
Open With 策略，Windows `Ctrl+F` 进入 readit 文档查找，路径/目录联接/扩展长度路径已有
自动化守卫，桌面发布工作流也已覆盖 macOS 双架构与 Windows x64。

**实现、自动化和本机 Windows 11 核心路径符合本方案预期，0.1.3 草稿的三平台发布构建、
Windows 静默安装器生命周期以及真 WebView2 保存时序也已通过；但 Windows 仍未完全验收
放行。** 真实“已有其他默认应用”和“全新用户”文件关联、无 WebView2 的干净 Windows 10、
真实微软拼音预编辑仍缺环境证据；全仓长路径 job 已实现但尚待下一次远端 CI，0.1.3 也仍是
未发布草稿，不能完成公开 updater 链。当前结论是“本机覆盖的日常核心路径可用，发布与产品
下限仍有明确缺口”，不是“Windows 已全面验收通过”。

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

## W5：桌面发布工作流

原 `release-macos.yml` 已收敛为单一 `release-desktop.yml`。同一手动工作流依次构建
macOS Apple Silicon、macOS Intel 和 Windows x64 MSVC；Windows 明确产出 NSIS，macOS
明确产出 app/dmg，避免 W1 的全局 NSIS 默认值误伤 macOS runner。

三个矩阵项共享 updater minisign 的私钥和密码，只使用 GitHub 内建 token 写 draft
Release；没有加入 Windows OS 代码签名证书。`uploadUpdaterJson: true` 与
`updaterJsonPreferNsis: true` 保证 Windows updater 选择 NSIS 产物。矩阵设置
`max-parallel: 1`，使各平台按顺序把自身条目合并进同一个 `latest.json`，避免多个 job
从同一旧 manifest 并发覆盖。Windows v1 只交付 x64；ARM64 没有本地构建或真机验收证据，
不在本次工作流里虚增一个声明。

测试先指向尚不存在的桌面工作流，Rust 编译按预期因 `include_str!` 找不到文件而红；
加入工作流后定向测试通过。随后把两个 macOS bundle 临时退化成只有 dmg，新增守卫按预期
报告缺少 `macOS bundles`；恢复 app/dmg 后变绿。守卫同时覆盖两个 macOS 架构、Windows
runner/target、两项 minisign secret、NSIS 偏好、串行 manifest 合并和显式 bundle override。

本轮没有触发 GitHub Actions、创建 Release 或上传线上 `latest.json`，所以结论是工作流
结构与本地守卫完成，不是线上发布链已经实跑。

## W6：文档、台账与收口验证

- README 已改为桌面双平台口径，补齐 Windows 源码构建、非劫持默认程序步骤、M6 状态、
  已知缺口和报告入口。
- SPEC §11.3 记录 2026-08-18 的方案 B 修订，并把整组浏览器加速键被关闭的副作用和
  “编译通过不等于真窗口通过”写入契约。
- `docs/windows-test-plan.md` 不再声称 Windows 壳不存在，新增真 WebView2/NSIS 步骤；
  D2-21 保持开启，D2-27 只记录文档打开路径面的部分证据，不用它冒充全仓长路径通过。
- 发布文档收敛为 `docs/releasing-desktop.md`，明确 updater minisign 与两个 OS 的代码签名
  是不同信任链，并要求草稿 Release 同时核对两个 Darwin 架构和 Windows NSIS 条目。

### 四条不变量实测

| 不变量 | 2026-08-18 实测 |
|---|---|
| `npm test` | **原命令未能在当前沙箱完成。** readit 的 global setup 内调用 esbuild、npm/Node 子进程时被系统以 `spawn EPERM` 拒绝。按原 project 配置拆开后，线程池内实际执行 `2862 passed / 0 product failures`；余下 6 条依赖子进程的断言分别用 shell 启动独立命令复现，全部通过，合计覆盖当前 2868 条行为检查。不能把等价拆跑写成“原命令通过”。 |
| `cargo test` / clippy | Windows GNU 离线 vendor 下 `30 passed / 0 failed`；`cargo-clippy` 未安装且离线环境不能补装，故本轮没有新的 clippy 结论。 |
| 债务台账条目数 | 16，未新增或删除；D2-21、D2-27 都仍开启。 |
| `TEMPORARY` 标记 | 0（`known-failures.json` 全量检查）。 |

拆跑中的关键补充结果：根级 100/100、core 2340/2340、element 247/247、shell
39/39；其余 workspace 全绿。11 份 TypeScript 配置（根、browser、8 个包和 shell）均
typecheck 通过。readit tarball 在仓库外的空宿主中离线安装成功，ESM/CJS 渲染字节一致，
`require.resolve()` 命中 `dist/core.cjs`；`publint --strict` 和两个
`@arethetypeswrong` profile 均通过。数学渲染 worker 由两个独立 shell 进程运行，得到相同
SHA-256 `9bbbb2a88d1c6c49022f242f6c490c95cd94b500abb437e85bca7def4d0b40c8`。

### 证据自审

| 结论 | 证据口径 |
|---|---|
| NSIS/安装体积、Windows GNU 二进制、静默安装 | 本机实际构建和执行；不能泛化成 MSVC CI 或普通用户安装已通过 |
| 路径归一化、扩展长度文档、junction 越界、Ctrl+F 路由、workflow 结构 | 自动化测试和代码编译；不是窗口交互或线上 Actions 证据 |
| WebView2 真窗口 | 实际启动在 setup 阶段返回系统错误 5，窗口没有出现；因此六项均为未执行，而不是失败或通过 |
| 文件关联三种状态 | 只完成配置/NSIS 脚本检查；HKCU 运行时写入被沙箱拦截，没有形成行为结论 |
| Playwright Chromium | 来自 2026-08-14 Windows 报告的浏览器代理信号；本轮没有把它重写成 WebView2 信号 |
| WebView2 bootstrapper、UserChoice、Tauri Action manifest 行为 | 配置/schema、方案资料和官方 Action 文档的阅读结论；无对应干净系统或线上 Release 实跑 |

## 阶段边界与剩余工作

1. 在普通交互式 Windows 会话执行唯一的 M6 六项清单，包括双击/第二进程、Ctrl+F、
   两种保存刷新、Mermaid、5 次启动和 60 秒内存。
2. 在允许写 HKCU 的环境分别验证无默认程序、已有其他默认程序、全新用户配置，并确认
   卸载不删除其他应用的 Open With 项。
3. 在无 WebView2 Runtime 的干净 Windows 10 验证 `downloadBootstrapper` 的联网、失败和
   安装后行为；在 `LongPathsEnabled=1` 环境完成 D2-27 的深路径 clone/install/build。
4. 手动触发一次 `release desktop` 草稿工作流，核对 Windows MSVC 构建、三个平台条目、
   `.sig` 与单一 `latest.json`。本方案不推送、不创建线上 Release。
5. M7 再处理 Authenticode、Apple Developer ID/公证和 SmartScreen/Gatekeeper 信任；
   Windows ARM64 也仍在 v1 x64 边界之外。

---

## 控制端复核（2026-08-18，macOS 26.5.2 / M1 Pro）

复核的着眼点是**报告作者的环境看不见、而 macOS 能看见的东西**。结论：实现与报告都
扎实，但分支当时**不可直接合并**——两个阻塞项，都是沙箱环境结构性看不到的那一类。

### 🔴 阻塞 1：`npm test` 在规范路径下红 5 条（已修）

`shell/test/windows-bundle.test.ts` 与 `shell/test/windows-installer.test.ts` 用
`process.cwd()` 拼路径，隐含假设 cwd 是 `shell/`。规范命令 `npm test` 从仓库根跑，
于是文件读成空串、断言以 `expected '' to contain …` 失败。

**这一条最值得留档的是它怎么溜过去的**：报告自己写着「不能把等价拆跑写成『原命令
通过』」——**这个判断完全正确，而正是那次在 `shell/` 目录内的拆跑（39/39）掩盖了缺陷**。
分支上也没有任何 CI 运行记录，没有第二道闸。

修的时候撞到第二层坑：直接照仓库根那几个测试（`ci-wiring` / `spec-sync` /
`import-direction` / `offline-gate`）改成 `new URL(rel, import.meta.url)` **仍然失败**。
实测原因是**壳这个 vitest project 的 environment 是 happy-dom**
（`shell/vitest.config.ts:5`），它的 `URL` 按文档位置解析，把传入的 base 丢掉：

```
new URL('../src-tauri/tauri.conf.json', import.meta.url)
  → http://localhost:3000/src-tauri/tauri.conf.json
```

最终改用纯 node 的 `dirname(fileURLToPath(import.meta.url))` + `join`，并把这两个坑
写进了文件头注释。

### 🔴 阻塞 2：macOS 上 `tauri build` 静默不产出任何包（已修）

`"targets": ["nsis"]` 落在**基础** `tauri.conf.json` 里，对所有平台生效。macOS 实测：

| | 结果 |
|---|---|
| 基础配置直接构建 | exit 0，打印 `Built application at: …/readit-shell`（裸二进制），**bundle/macos/ 下无产出** |
| 对照 `--config targets:["app"]` | 正常产出 `.app` |

不报错、只是什么都不生成。发布工作流传了显式 `--bundles` 所以线上不受影响，但任何本地
macOS 构建都坏了，而 M6 清单第 6 项要求的正是「用 release 配置生成并安装 `.app`/`.dmg`」。

已把 `targets` 从基础配置移进 `tauri.windows.conf.json`，并加了一条**反漂移守卫**
断言基础配置不得再钉 `targets`（把缺陷注回基础配置验证过它变红：
`expected [ 'nsis' ] to be undefined`）。修复后不带 `--bundles` 的构建重新产出
`.app` + `.dmg`。

### 🟡 clippy 警告（已修）

`lib.rs` 的 `.setup(|app| …)` 里 `app` 只在 `#[cfg(windows)]` 分支用到，macOS 上留下
`unused variable` 警告。改成 `|_app|`，与同文件 `app.run(move |_app_handle, _event|)`
的既有写法一致。报告诚实地说了本轮跑不成 clippy、没有下结论，所以这不是虚报。

### 🟡 记为 D2-30，未在本轮修改

`packages/element/src/navigate.ts` 为 Windows 无条件把 `\` 换成 `/`，而那是共享库。
POSIX 上反斜杠是合法文件名字符。理由与还清路径见台账 D2-30——简言之壳侧已在边界
归一化，元素这层之所以还需要懂 Windows 只因为壳对 UNC 保留了反斜杠；但控制端在 macOS
上无法验证改动后的 Windows 行为，贸然改会在无法复核的平台上制造回归。

### ✅ 复核确认没问题的

- **`RunEvent::Opened` 完好**。`app.run(move |app_handle, event|` → `|_app_handle, _event|`
  的改名看着像删了 macOS 双击投递，专门查过，分支体原样保留。
- `watcher.rs` 的修法正确且只动测试（关闭的断言通道不能跨 `notify` 的 extern 回调解栈）。
- `releasing-macos.md` → `releasing-desktop.md` 改名无悬空引用，`updater.rs` 的
  `include_str!` 已跟着改。
- M6 清单加平台列时**没有丢掉 macOS 那一侧的结果**（5 勾 / 1 留空原样保留）。
- 分支构建出的 macOS 应用**能装、能跑、渲染正常**（已装到 `/Applications` 并截图核对）。

### 复核后的四条不变量（macOS 实测）

| 不变量 | 值 |
|---|---|
| `npm test`（仓库根，规范命令） | **2869 通过 / 90 文件 / 0 失败** |
| `npm run test:browser` | 72 通过 / 2 具名跳过 |
| `cargo test` + `cargo clippy --all-targets` | 29 通过；**clippy 0 警告** |
| `npm run typecheck` | 全绿（11 份 tsconfig） |
| 债务台账条目数 | 17（新增 D2-30） |
| 不带 `--bundles` 的 macOS 构建 | 产出 `.app` + `.dmg` |

### 关于报告本身

**这是整批交付里最强的部分。** 它三次主动拒绝拔高：clippy 跑不了就写「本轮没有新的
clippy 结论」；拆跑就写「不能把等价拆跑写成原命令通过」；窗口起不来就把六项记「未执行」
而不是「通过」或「失败」。证据自审表把「本机实测」与「读文档得出」分列，Playwright
Chromium 没有被改写成 WebView2 信号。

**而且正是这些自陈的保留意见把复核直接指向了两个阻塞项。** 如果报告粉饰过，它们会更晚
才被发现——很可能是在第一个真实用户手里。

W3 也值得记一笔：方案里推测 `with_webview()` → `ICoreWebView2Settings3` 也许能绕开给
wry 打补丁，明确标注为「控制端未验证」。**执行方验证了，可行**，省掉了 SPEC §11.3
当初假设的那笔补丁维护成本。

---

## v0.1.0 Windows 真机缺陷修复与复测（2026-08-22）

### 结论

基于 2026-08-20 首轮发布包真机测试发现的四项问题，先写
`docs/plans/2026-08-21-windows-v0.1.0-fixes.md`，再按“旧实现定向红 → 最小修复 →
完整自动化 → 新 release 真 WebView2”推进。四项均已在新构建上通过。

对当前 Windows 11 + Evergreen WebView2 环境，可以给出以下受限结论：**阅读本地 Markdown、
加载同目录资源、第二实例投递文档、文档内历史导航和长文档查找已符合规格，应用可正常完成
本轮覆盖的核心阅读路径。** 这不是对所有 Windows 版本和安装场景的无条件放行；文件关联双击、
无 WebView2 的 Windows 10 bootstrapper、完整编辑/监听矩阵、代码签名与卸载隔离没有在本轮重测。

### 修复内容

| 编号 | 根因 | 修复 |
|---|---|---|
| WRF-1 | Windows WebView2 的 Tauri 自定义协议 origin 实际为 `http://readit.localhost/`，DOM 却统一写成 `readit://localhost/` | 新增可测试的平台 base 选择；Windows 对 `img/source/audio/video/poster` 及异步节点统一使用 mapped origin，其他平台保持原协议 |
| WRF-2 | 壳的 capture 外链门把 `D:/...` 中的单字母盘符当成 scheme | 与元素层统一最小 scheme 长度；盘符路径继续冒泡给文档路由，两个字母以上的 scheme 仍进入安全门且仅放行 http(s) |
| WRF-3 | 通用查找 UI 为 `position:absolute`，桌面文档滚动时跟随内容离开视口 | 元素提供 `--readit-find-position`，默认仍为 `absolute`；桌面壳的 `#reader` 显式裁决为 `fixed` |
| WRF-4 | 历史键监听在元素宿主上，但点击普通正文不会使宿主获得焦点 | 普通主按钮 pointerdown 将已有 `.readit-root[tabindex=-1]` 以 `preventScroll` 聚焦；链接、表单、contenteditable 与可 Tab 元素不被抢焦点 |

没有放宽资源路径守卫、外链协议白名单或 Markdown 打开边界；没有把快捷键监听上移到
`window`/`document`，也没有改变通用元素的默认查找栏定位语义。

### 自动化证据

1. 在修改生产代码前，新增的 5 个定向测试文件共执行 73 项；旧实现结果为
   `66 passed / 7 failed`，失败分别命中上述四条真机现象。修复后同组为 `73 passed / 0 failed`。
2. 仓库根完整 Vitest：`97 files / 2914 tests passed / 0 failed`。
3. `npm run typecheck`：根、browser、各 workspace 与 shell 全部通过。
4. 完整浏览器矩阵：`80 total / 78 passed / 2 existing WebKit skips / 0 failed`；新增的
   fixed 查找栏与正文点击历史键用例均在 Chromium、WebKit 通过。
5. `cargo test` 在 Rust 1.97 GNU 下完成所有依赖和测试程序编译，但生成的 Tauri/WebView2
   测试 exe 在测试入口前以 `0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND` 退出；LLVM-MinGW 与
   MSYS2 GCC 链接均相同。普通 Rust hello 在同一工具链可运行，且本轮没有修改 Rust 源码，
   因此只记录为本机原生测试运行时限制，**不声称 Rust 测试通过**。
6. `cargo clippy --all-targets -- -D warnings` 编译到项目后命中既有
   `AppState::enqueue_opened_urls` 的 `dead_code`，所以本轮也没有新的 clippy 全绿结论。

构建日志另有 Vite 大分块提示；它是包体积/首载性能后续项，不影响本轮行为验收。

### 真 WebView2 复测

环境：Windows 11 `10.0.26200`，Edge/WebView2 `151.0.4129.93`，窗口默认 `960×720`。
测试使用新 release 二进制，并仅为证据采集临时加入本机 `--remote-debugging-port=9222`；
端口没有写入源码、配置或交付包。

| 项 | 结果 | 实测值 |
|---|---|---|
| 相对图片 | **通过** | doc-a 的蓝、红、两张绿色图片均 `complete=true`、自然尺寸 `220×130`；DOM URL 均为 `http://readit.localhost/...` |
| 第二实例绝对路径 | **通过** | doc-a 已开时以 `D:\...\doc-b.markdown` 再启动；第二进程 exit 0，运行实例数仍为 1，标题和正文切到 doc-b |
| 普通正文后的 `Alt+Left` | **通过** | 点击后焦点为 `.readit-root[tabindex=-1]`；doc-b 返回 doc-a |
| 固定查找栏 | **通过** | 查询 `sentinel` 到第 3/6 项，`scrollY=1864.67`；栏为 `fixed`，矩形 `top=8 / bottom=51.53`，完全位于 720px 视口内且按钮可用 |

资源和查找栏均留有真窗口截图，位于仓库外测试目录
`D:\robot\readit-release-test\screenshots\`，未作为产品资产提交。

### 本地 Windows 构建产物

正式 crate 类型已在构建前恢复，仓库配置未因本地工具链绕行而改变。release 与 unsigned
NSIS 均成功生成；本地打包通过 CLI override 关闭 updater artifact，只是为了不使用发布
minisign 私钥，项目的正式 `createUpdaterArtifacts: true` 配置保持不变。

| 产物 | 大小 | SHA-256 |
|---|---:|---|
| `shell/src-tauri/target/release/readit-shell.exe` | 30.99 MiB | `9814CF3F97C5EDCB4386E5B0DB4FC83499F5F19867E44A6EAB354DE4BAED4122` |
| `shell/src-tauri/target/release/bundle/nsis/readit_0.1.0_x64-setup.exe` | 8.70 MiB | `D656D1BBF8771BF64A2CCB08792B5EB99A73040C8BF133568C589B6067E29E3F` |

NSIS 本轮只完成生成，没有覆盖安装旧版、文件关联、卸载和 updater 签名链；不能把直接运行
release exe 的结果写成“新安装包全流程通过”。

---

## readit-v0.1.2 Windows 发布包验收（2026-08-27；A4 于 2026-08-29 复核）

本节保留 0.1.2 当次验收的历史口径；2026-08-29 随后的 0.1.3 草稿发布、安装器 sentinel、
E2 补验和 F3 CI 进展见文末追加节。不要用后续草稿证据反向改写 0.1.2 当时未执行的项目。

### 结论

远端 `main` 已同步到 `61afc1510d1cc222bf53eec8ba7a6f4df623b077`，该提交正是标签
`readit-v0.1.2`。本轮不从源码打包，而是下载、安装并直接操作 GitHub Release 的
`readit_0.1.2_x64-setup.exe`。

**核心使用路径在本机 Windows 11 + 真 WebView2 上可用，但尚未完全通过 Windows 验收。**
文件打开/相对资源、既有单实例路由、查找、监听、Mermaid、基本编辑保存、外部冲突和脏关闭
保护均符合本轮判据；A4 已在 2026-08-29 以完整 UI 与静默卸载两条路径复核通过。F1 只完成
三种起始状态中的一种，F2、F3、E2、E5 以及可选 updater 仍未执行。因此本轮仍不能写成
“Windows 全面放行”。

### 环境与产物

| 项 | 实测值 |
|---|---|
| 系统 | Windows 11 Home 25H2，build `26200.9168`，AMD64 |
| 机器 | Alienware m18 R2，63.7 GiB RAM |
| WebView2 | Evergreen `151.0.4129.107` |
| 仓库 | `D:\robot\readit-publish`；`main` / `61afc1510d1cc222bf53eec8ba7a6f4df623b077` |
| Release | `readit-v0.1.2`，公开 unsigned NSIS |
| 安装包 | 6,777,623 bytes（6.46 MiB） |
| 安装包 SHA-256 | `33734C6C410E1261082BF5D3256D2C5F6D19C9A25D0BA151A7F1096AB382AA51` |
| 安装位置 | `D:\robot\readit-release-test\installed-readit-v0.1.0`（目录名沿用旧测试位置；注册表与二进制版本为 0.1.2） |
| 安装后体积 | 16,507,828 bytes（15.74 MiB；`readit-shell.exe` + `uninstall.exe`） |

SmartScreen 对 unsigned 首次运行的拦截是清单已裁决风险，不记产品缺陷。测试结束后已重新安装
0.1.2；`HKCU` 卸载项的 `DisplayVersion`、主程序及卸载器 PE `ProductVersion` 均为 `0.1.2`，
主程序可以正常启动。

### 剩余清单逐项结果

| 项 | 结果 | 真窗口/系统证据 |
|---|---|---|
| A1 全新安装 | **部分** | 当前用户下完成交互安装且未抢 `.md` 默认程序；此前测试过旧版，不能冒充全新 Windows 用户配置 |
| A2 `.md` / `.markdown` 打开 | **通过（当前起始状态）** | “打开方式”含 readit 且保留 VS Code/WPS 等候选；两种扩展名均打开正确文档，相对蓝/红/中文含空格图片可见 |
| A3 覆盖安装 | **通过** | 同版本 `/S` 覆盖 exit 0；程序目录仍只有两个文件，开始菜单/桌面各一份快捷方式，关联与 0.1.2 版本保持 |
| A4 卸载 | **通过（2026-08-29 复核）** | UI 路径观察到完成页，点击 Close 并确认卸载进程退出后，安装目录、卸载项、`HKCU\Software\Classes\readit.md`、`.md`/`.markdown` 的 `OpenWithProgids` 及开始/桌面快捷方式均不存在；`/S` 路径同样通过 |
| B1–B3 查找矩阵 | **通过** | 阅读/源码模式均为 `1 / 6`；首项 `Shift+Enter` 回绕 `6 / 6`；Escape 关闭栏、清计数/高亮并还焦点 |
| C1–C2 文件监听 | **通过** | 临时文件 + rename 的版本 1 与普通原地写入的版本 2 均刷新成完整内容 |
| C3 非原子长间隔边界 | **未重测（既有 D2-29）** | 清单已明确这不是本轮新缺陷，不用它否定 C1/C2 |
| D1–D3 Mermaid | **通过** | 三张合法图渲出 SVG；长标签未裁切；H1/H2 标签在框内；错误图保留源码并显示具名红色错误态 |
| E1 基本保存/CRLF | **通过** | 标题 `●` 与“未保存”随 dirty 出现，保存后清除；UTF-8 中文、CRLF、无 BOM、尾随换行保真 |
| E2 保存时序 | **未执行** | 受控输入不能可靠命中“第一次保存仍在途时继续改 B”的窗口，不用自动化状态机替代真窗口结论 |
| E3 外部冲突 | **通过** | “保留我的修改”维持 dirty 且可写回；“使用磁盘版本”应用版本 2、删除本地草稿并清 dirty |
| E4 关闭保护 | **通过** | 窗口 × 与 `Alt+F4` 均弹出保存并关闭/放弃并关闭/取消；三个动作分别验证写盘、弃盘和留窗 |
| E5 微软拼音 | **未执行** | 没有取得可证明预编辑串状态的真实系统输入法操作；合成输入不作替代 |
| F1 三种文件关联起始状态 | **部分（1/3）** | 已测“`.md` 原先无默认程序”；“已有其他默认程序”“全新 Windows 用户配置”未执行 |
| F2 无 WebView2 的干净 Win10 | **未执行** | 当前主机已有 Evergreen WebView2，且没有对应干净虚拟机 |
| F3 全仓长路径 | **未执行** | 本机 `LongPathsEnabled=0`、Git `core.longpaths` 未启用；遵照手册未修改注册表压绿，D2-27 保持开启 |
| G Windows updater | **未执行（可选）** | 本轮目标是最新 0.1.2 发布包，没有从 0.1.0 走完整在线更新/验签链 |
| H1 模式按钮 | **主体通过** | 阅读/源码/分栏可见可用，`Ctrl+1/2/3` 与按钮一致；可访问描述为 Windows 快捷键。未单独取得鼠标悬停 tooltip 画面 |
| H2 拖动与记忆 | **通过** | 从右上拖到窗口中部不误切模式；关掉再开仍在该绝对位置 |
| H3 边界/窄窗 | **部分通过** | 拖到左上、右下边缘后控件完整可见；窗口缩到 621px 后标签不竖排、不丢失。控制工具拒绝窗口外负坐标，未完成“指针在窗口外松手”这一小步 |
| H4 宽/窄正文布局 | **通过** | 宽窗正文约 52rem 居中、两侧留白随宽度增加；621px 窄窗正文重新占满。控件可被用户主动放到正文上方，这是自由绝对位置的 UX 观察，不改写 H4 判据 |

### 安装器复核与版本观察

1. **A4 的 2026-08-27 失败记录已被后续完整复核更正。** 2026-08-29 对原始 Release 先执行
   `/S` 安装/卸载，再执行完整 UI 卸载；UI 明确显示 `Uninstallation Complete`，点击 `Close`
   后卸载窗口与进程均退出，上述 readit 自有项目全部消失。旧残留结果未能复现，按后续可重复
   证据改判为取样/前置状态问题，不再作为产品缺陷；现有 POST hook 无需侵入修改。
2. “程序和功能”列表曾显示 **0.1.0** 的观察同样未复现。五处源码版本、HKCU
   `DisplayVersion`、主程序和卸载器 PE `ProductVersion` 均为 **0.1.2**，且没有第二个 readit
   卸载项。旧 appwiz 窗口缓存是候选解释，但历史根因未定；当前按未复现观察处理，并增加版本
   同步和真实安装器静默生命周期守卫。若关闭并重开控制面板后再现，才升级为产品缺陷。
3. 模式控件允许记住任意绝对位置；放到页面中部后会覆盖正文。当前 H2 明确允许“任意位置”，
   H4 只裁决正文列宽，所以本轮不把它伪写成 H4 失败；若产品不希望遮挡内容，需要另立交互裁决。

### 第 6 项性能数据

| 指标 | 值 |
|---|---:|
| 冷启动 ×5（未 reboot / purge；轮询主窗口句柄） | 116 / 72 / 64 / 63 / 59 ms |
| 中位数 | 64 ms |
| `plain.md` 静置 60 秒 | 446.7 MB（readit + 本轮新增 6 个 WebView2 进程的 `WorkingSet64`） |
| `stress.md` 静置 60 秒 | 527.0 MB（同口径） |
| 压力增量 | 80.3 MB |

Windows `WorkingSet64` 与 macOS `phys_footprint` 不是同一口径，不能直接比较；项目也没有裁决
Windows 性能预算，所以这里只记录数据，不宣称“性能通过”。

### 自动化补充证据

- 根级 `npm test`：`100 files / 2948 tests passed / 0 failed`。
- `npm run typecheck`：根、browser、全部 packages workspace 与 shell 均通过。
- 原始 `readit_0.1.2_x64-setup.exe` 的本机静默生命周期 smoke 通过；发布工作流现会先执行
  五处版本同步守卫，再在 Windows 打包后核对 PE/注册表版本、默认关联不变、ProgID、
  OpenWith、快捷方式及卸载零残留。该自动化只覆盖静默路径，UI A4 仍由本次真窗口证据承担。
- 本机交互安装、注册表、资源管理器、控制面板和真 WebView2 结论与上述自动化结果分开记录；
  自动化没有被写成安装器或真引擎替代证据。

### 发布判断与下一步

0.1.2 在这台 Windows 11 上可以完成日常 Markdown 阅读和当轮覆盖的编辑保存路径，核心应用
不是“不可用”，本机当前用户下已覆盖的安装/卸载路径也已通过。后续 0.1.3 草稿补验已经关闭
E2 真窗口保存时序缺口，并为 F1 增加第三方 Open With sentinel 证据；但 F1 的两个真实起始
状态、F2、E5 仍无证据，F3 也必须等新增远端 job 成功，因此**当前仍不是完全验收通过**。

---

## readit-v0.1.3 草稿发布与补充验收（2026-08-29）

### 远端提交、CI 与草稿产物

首次修复提交 `a8b2bc12e2184250d622935ff7a3e11441995f0f` 已推送到 `main`。该 push
触发的四条 CI 均成功：

| Workflow | Run | 结果 |
|---|---:|---|
| browser | `33200841620` | success |
| test | `33200841621` | success |
| visual | `33200841655` | success |
| offline | `33200841632` | success |

随后触发的
[`release desktop` run 33201027207](https://github.com/wenzhurong/readit/actions/runs/33201027207)
在 macOS Apple Silicon、macOS Intel、Windows x64 三个 job 上全部成功。Windows job 的真实
打包后步骤明确输出 `Windows installer silent smoke passed for readit 0.1.3`，因此这不是
只检查 workflow YAML 的结构性绿灯。

该 run 生成的是 **未发布的 `readit-v0.1.3` draft**，目标提交为 `a8b2bc1`，包含 9 个预期
资产：单一 `latest.json`、两个 macOS 架构各自的 app tarball/签名/DMG，以及 Windows x64
NSIS setup/签名。资产数量与平台覆盖已核对，但 draft 没有进入公开 latest release。

### 本地 0.1.3 安装器复测

| 项 | 结果 |
|---|---|
| 安装包 | draft 的 `readit_0.1.3_x64-setup.exe` |
| SHA-256 | `20B904BD6B91A8C649FA98BDAF01F139DD1D08ED053F7F2D27032D2806D0D902` |
| 版本一致性 | HKCU `DisplayVersion`、`readit-shell.exe` 与 `uninstall.exe` 均为 `0.1.3` |
| 生命周期 | 静默安装、启动前后状态核对、静默卸载和残留核对通过 |

安装器 smoke 还在 `.md` 与 `.markdown` 的 `OpenWithProgids` 中注入唯一第三方 sentinel
ProgID；安装后和卸载后它都仍存在，脚本最终恢复了测试前精确基线。这证明 readit 的生命周期
不会误删其他 Open With 候选。sentinel 不是 Windows 的真实默认应用选择，也不是全新用户，
所以 F1 手工矩阵仍只能记 1/3，不能因这条自动化扩写为 3/3。

### E2 真 WebView2 + 真 Rust IPC 补验

E2 在 0.1.3 草稿安装版上用真实 WebView2 窗口和真实 Rust `save_document` IPC 执行。测试用
双闸门稳定控制第一次保存的在途区间，而不是用状态机单测或合成 watcher 代替：

1. 磁盘初始内容为 O；界面改为 A 并触发第一次保存。
2. 第一次保存仍在途时，界面继续改为 B。
3. 放行第一次 Rust 写入后，磁盘为 A；watcher 回读 A 没有覆盖界面的 B、没有弹出外部冲突，
   B 继续保持 dirty。
4. 第二次保存后磁盘为 B，界面清除 dirty。

结果符合 E2 的全部判据，E2 改判 **通过**；这次没有出现需要修改保存实现的新产品缺陷。

### F3 自动化进展与仍未关闭的门

新的阻塞式 `windows-long-path` CI job 已实现。它要求 runner 的 `LongPathsEnabled=1`，在
长度至少 200 的临时路径中以仓库局部 `core.longpaths=true` clone 同一提交，并从深路径执行
`npm ci`、根测试、typecheck 与 Rust 测试。代码和本地静态守卫完成不等于环境通过；只有下次
远端该 job 成功，F3 才能改判。本节记录时该远端证据尚不存在。

当前仍缺：

- F1 的真实“已有其他默认应用”和“全新 Windows 用户配置”；
- F2 没有 WebView2 Runtime 的干净 Windows 10；
- E5 真实微软拼音的预编辑串操作；
- H1 鼠标悬停 tooltip、H3 指针在窗口外松手等尚未取得的人工小项证据；
- 0.1.3 的公开 updater 全链。

最后一项尤其不能由草稿资产推断为通过：0.1.3 尚未发布，公开 latest release 仍不能提供该
版本，因此没有完成旧版发现 0.1.3、下载、验签、安装、重启与版本确认的整条链。当前结论是：
**0.1.3 草稿安装包在本机覆盖的核心路径可用，E2 与静默生命周期通过；Windows 全面验收和
updater 发布门仍未通过。**
