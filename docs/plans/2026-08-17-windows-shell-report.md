# Windows 壳推进报告

> 对应方案：[`2026-08-17-windows-shell.md`](./2026-08-17-windows-shell.md)  
> 分支：`agent/windows-shell`  
> 同步基线：`33b5ea7 docs: Windows 壳构建方案`

## 当前结论

W1–W6 的仓库内实现已经完成：Windows 壳能生成当前用户 NSIS，文件关联采取不抢默认的
Open With 策略，Windows `Ctrl+F` 进入 readit 文档查找，路径/目录联接/扩展长度路径已有
自动化守卫，桌面发布工作流也已覆盖 macOS 双架构与 Windows x64。

**实现和自动化表现符合本方案的预期，但当前证据不足以断言应用已能在普通 Windows 环境
正常使用或正式发布。** 真实 WebView2 窗口、三种注册表初始状态、无 WebView2 的干净
Windows 10、以及线上 Release/updater manifest 都没有跑通对应的真实环境。这里的结论是
“工程链路已建立，真机发布门仍未通过”，不是“Windows 已验收通过”。

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
