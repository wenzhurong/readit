# Windows 壳构建方案（供 Codex 执行）

**日期**：2026-08-17
**前置状态**：`main` 在 `b71da90`。M0–M5 已交付；M6 的自动化齐备，macOS 六项真机验收
已执行（5 通过 / 1 按规则留空）。**Windows 侧只有引擎与浏览器层被验证过，壳不存在。**

**v1 的形状已定**：两个平台都**不签名**、先自用。所以本方案**不含签名与公证**——那属于
M7，且 Windows 侧还卡在辖区问题上（SPEC §M7 预算警告）。

---

## 0. 先读这一段

### 0.1 现状核实：Windows 壳比"不存在"更接近完成

这是本方案最重要的一节。**上一版 `docs/windows-test-plan.md` 说的「Windows 上没有壳可
测——不是没测，是没建」在 bundle 层面是对的，但在代码层面会误导人**：Rust 侧已经写了
不少平台中立乃至显式 Windows 感知的东西。

**开工前先自己复核下表**（控制端 2026-08-17 实测，但你要以你看到的代码为准）：

| 已经就位 | 位置 | 说明 |
|---|---|---|
| **argv 路径**（首次启动带文件） | `lib.rs:75-77` → `document.rs:57` | `enqueue_argv` 显式不把 `C:\Users\…` 喂给 URL 解析器，注释里就写着这件事——SPEC §10.1 点名 Tauri 官方示例在这里是错的 |
| **第二个进程转发 argv** | `lib.rs:83-85` | `tauri-plugin-single-instance` 已接，且被刻意放在第一个插件位 |
| **Windows 子系统属性** | `main.rs:1` | `windows_subsystem = "windows"`，release 下不弹控制台窗口 |
| **自定义协议 origin 的 CSP** | `protocol.rs:294` 有测试 | Windows 上 `readit://` 解析成 `http://readit.localhost`，CSP 里已经写了 |
| **Windows 式路径穿越守卫** | `protocol.rs:219` | `..%5c`（编码反斜杠）已在拒绝名单里 |
| **前端反斜杠归一化** | `resources.ts:27` | `replaceAll('\\', '/')` 已在 |

`RunEvent::Opened`（`lib.rs:113`）是 macOS/iOS 专有的第二条投递通道，**Windows 不需要
它**——双击在 Windows 上就是 argv，上面第 1、2 行已经覆盖。

**推论：不要重写这些。** 本方案的工作量集中在 bundle 配置、文件关联的默认程序之争、
Ctrl+F 的取舍、WebView2 运行时、发布工作流、以及真 WebView2 验收门。

### 0.2 四条不变量（每次提交前实测，不许照抄本文数字）

以你开工时的实际输出为准：

| 不变量 | 2026-08-17 值 |
|---|---|
| `npm test` | 2854 通过 / 87 文件 / 0 失败 |
| `cargo test`（`shell/src-tauri`） | 全绿 + clippy 干净 |
| 债务台账条目数 | 16（D2-2…D2-29，含已还清的 D2-19） |
| `TEMPORARY` 标记 | 0 |

### 0.3 约束

- **版本一律钉死**：Cargo 用 `=x.y.z`（照 `notify = "=8.2.0"` 的先例），npm 不写 `^`。
- **显式暂存路径，绝不 `git add -A`。**
- **提交身份已配好 `mmy420`，直接 `git commit`，不要改 git 配置。不要推送。**
- **`npm test` 全程离线**（`test/setup/no-network.ts` 拦 fetch/socket/dns）。测试里不要发
  网络请求。
- **每个任务一个提交**，提交信息写**为什么**。
- **每条新增断言都要证明它会红**——把缺陷注回去看它变红，再改回来。这是本项目的硬纪律。

### 0.4 一个反复出现的失效模式，本方案尤其容易撞

**「声明的广度由做声明的人自己选定」**——已有 ≥10 次记录。在这份方案里它会长成这样：
在 Windows 上跑通了 Playwright 的 Chromium，就写成「Windows 验证通过」。**不是。**
真正的引擎是 WebView2，Playwright 的 Chromium 只是代理信号（`docs/windows-debug-report-2026-08-14.md`
第 130 行已经把这条写死了）。**报告里必须分开写。**

---

## 1. 任务

### W1 — bundle 配置：让 `tauri build` 在 Windows 上产出安装包

`shell/src-tauri/tauri.conf.json` 目前 `bundle.targets` 为 null、只有 `macOS` 段。

**要加的**（键名已对 `node_modules/@tauri-apps/cli/config.schema.json` 核过）：

- `bundle.targets`：显式列出，不要依赖平台默认。Windows 侧可选 `nsis` 与 `msi`。
  **建议只做 `nsis`** —— W2 的注册表工作要用 NSIS 的 `installerHooks`，而 WiX/MSI 那边
  是另一套机制，同时维护两套没有收益。**若你不同意，写明理由。**
- `bundle.windows.webviewInstallMode`：五个取值
  `skip` / `downloadBootstrapper` / `embedBootstrapper` / `offlineInstaller` / `fixedRuntime`。
  **这是一个真实取舍，不要默认了事**：
  - Win11 自带 WebView2 运行时，Win10 不一定；
  - `downloadBootstrapper` 安装包最小但装机时要联网；
  - `offlineInstaller` / `fixedRuntime` 体积涨很多（`fixedRuntime` 要自己带一整份运行时）。
  **写明你选了哪个、以及在没有运行时的干净 Win10 上会发生什么**——后者是要实测的，
  不是推理的。
- `bundle.windows.minimumWebview2Version`：与产品下限一致地定一个，或明确不定并写理由。

**验收**：Windows 上 `npm run build` 后 `tauri build` 能产出安装包；**记录安装包体积与
安装后体积**（macOS 侧的对照数字是 dmg 7.7 MB / `.app` 18 MB，见 M6 清单第 6 项）。

---

### W2 — 文件关联与「默认程序」之争 ⚠️ 本方案里最可能挨骂的一项

`bundle.fileAssociations` 已经写好（`md` / `markdown`，rank `Default`），macOS 上它正确
落进了 Info.plist。**Windows 上注册关联只是第一步，远不是终点。**

SPEC **§15「诚实的局限」第 9 点**已经把话说死了：

> **Windows 上把 `.md` 变成默认打开程序**远比注册文件关联难。`.md` 被 VS Code、Notepad、
> Typora、浏览器激烈争夺，预计需要自定义 NSIS 注册表工作，且用户仍可能要手动"打开方式
> → 始终"。**这大概率是"它不工作"类报障的头号来源。**

而 macOS 侧的真机验收刚刚从另一个方向印证了同一件事：**装上 readit 并不会自动顶掉既有
默认程序**（本机原先归 Xcode，必须显式指定）。Windows 上的反劫持更强——Win10 起,
`HKCU\...\FileExts\.md\UserChoice` 带哈希保护，**程序无法静默改写用户的选择**。

**要求**：

1. 先**实测**「装完之后双击 `.md` 会发生什么」，三种起始状态各测一次：
   (a) `.md` 无默认程序 (b) `.md` 已归别的程序 (c) 全新用户配置。
2. 用 NSIS 的 `installerHooks`（`.nsh`）写注册表——**只写"我能打开 .md"这一层**
   （`HKCU\Software\Classes\readit.md` + `OpenWithProgids`），**不要试图强改 `UserChoice`**。
   任何号称能静默抢默认的做法都是在和 OS 的反劫持机制对抗，会被 Windows 反制、
   也会被杀毒软件盯上。**这条是硬要求，不是风格建议。**
3. **在 README 里写清用户怎么手动设默认**——macOS 那节已经这么做了
   （`README.md` 的「安装与运行（macOS）」），Windows 照写一节。**文档是这一项的
   交付物之一，不是附赠。**

**验收**：三种起始状态的实测结果 + 注册表写了哪些键 + README 新增一节。

---

### W3 — Ctrl+F 与 WebView2 内置查找栏 ⚠️ 这是决策，不是编码

SPEC §11.3 第 8 点：

> Windows 上 Ctrl+F 被 WebView2 内置查找栏吃掉（那个栏是好用的，含 shadow DOM）。要么在
> Windows 让原生栏赢，要么让壳禁用浏览器加速键——注意 Tauri 未再导出 wry 的
> `browser_accelerator_keys`，后者需要 wry 层补丁或上游 PR。

**但「让原生栏赢」不是无代价的，而且代价是正确性而不只是一致性**：SPEC §11.3 第 7 点
要求**源码模式必须查文档模型而非 DOM**——CodeMirror 6 的视口虚拟化会让任何基于 DOM 的
查找静默漏掉屏幕外的行。WebView2 的内置栏查的就是 DOM。所以：

- 阅读模式：原生栏确实好用（它连 shadow DOM 都遍历）
- **源码 / 分栏模式：原生栏会给出静默错误的结果**

`shell/src/find-shortcut.ts` 目前是 macOS-only 的 `Meta+F`（文件里已有注释说明 Windows 上
会与内置栏相争）。

**先去验一条 SPEC 写下时可能还不知道的路**（控制端未验证，你来定论）：

Tauri 2 的 `WebviewWindow::with_webview()` 在 Windows 上能拿到 `ICoreWebView2Controller`。
若能由此到达 `ICoreWebView2Settings::put_AreBrowserAcceleratorKeysEnabled(false)`，
就**不需要给 wry 打补丁**。请实际验证这条路在 tauri `=2.11.5` 上是否可行，并注意它会
**一次性关掉所有**浏览器加速键（Ctrl+P、Ctrl+R、F12…）——其中 Ctrl+R 重载页面在应用壳
里本来就该关掉，但 F12 关掉会影响你自己调试。**把连带影响写清楚。**

**三条路，选一条并写明理由与没选的那条的代价**：

| | 做法 | 代价 |
|---|---|---|
| A | Windows 让原生栏赢，我们的栏只在 macOS 绑 | **源码/分栏模式下查找结果静默错误**，与 SPEC §11.3 第 7 点冲突 |
| B | 关掉浏览器加速键，两平台都用我们的栏 | 连带关掉 Ctrl+P / Ctrl+R / F12；若 `with_webview()` 那条路不通则要补 wry |
| C | 阅读模式让原生栏赢、源码/分栏模式用我们的栏 | 仍需要 B 的能力（要能按模式抑制），复杂度最高 |

**如果你判断需要用户裁决，就停下来在报告里写明，不要自己拍板。**

---

### W4 — WebView2 运行时与真引擎冒烟

D2-21 挂着：SPEC §13.2 自己定的「验收门必须包含真 WebView2 里的一次运行」，
**至今零覆盖**。W1 做完之后这条才第一次变得可能。

**要求**：

1. 在装好的 Windows 应用里跑一遍 `docs/plans/2026-08-13-m6-manual-acceptance.md` 的六项
   （macOS 侧的执行结果与口径已经填在那份文件里，照它的形状写 Windows 侧）。
2. **不要新建一份重复清单**，需要补 Windows 特有步骤就改那一份、加平台栏。
3. macOS 侧那一轮抓出**四个只有真机能看见的缺陷**（语法高亮从未生效、Mermaid 长标签被裁、
   图层护栏被 classDef 绕过、查找命中不滚进视野），四个在库层、Rust 层、happy-dom 层
   乃至 Playwright 层**都是绿的**。**请以同样的怀疑度对待 Windows 侧的绿。**

---

### W5 — 发布工作流

照 `.github/workflows/release-macos.yml` 的形状加一份 Windows 的（或把它改成矩阵）。
现有那份用 `tauri-apps/tauri-action@v1` + `dtolnay/rust-toolchain` + `Swatinem/rust-cache`，
按 target 矩阵构建两个架构。

**注意**：updater 的 minisign 签名与 OS 代码签名是两套独立信任链（`docs/releasing-macos.md`
开篇就写了这件事）。Windows 侧**不做 OS 代码签名**（v1 决定），但 **updater 的
minisign 签名要照做**，否则 Windows 客户端收不到更新。`latest.json` 要同时含两个平台。

`shell/src-tauri/src/updater.rs:96` 有一条测试在读 `release-macos.yml` 的内容做断言——
**加 Windows 工作流时去看一眼那条测试，需要的话一并扩展**，不要让它变成只覆盖一半的守卫。

---

### W6 — 收口：文档与台账

- `docs/windows-test-plan.md` 的 §0 与 §7 现在说「Windows 壳尚未构建」「不要尝试自己补一个
  Tauri Windows 配置去跑」——**做完 W1 之后这两段就过期了**，一并订正。这份文档
  2026-08-14 刚因为落后三个里程碑被重写过一次，别让它再落后。
- 台账 **D2-21**（真引擎验收门）按 W4 的结果更新；**D2-27**（Windows 长路径仍未测量）
  若这次在 `LongPathsEnabled=1` 的机器上跑过就一并还清。
- `README.md` 的「里程碑状态」M6 行、「已知缺口」里的「Windows 壳不存在」条目要改。
- 若 W3 选了会改变跨平台行为的做法，**SPEC §11.3 要加一条带日期的 ⚠️ 修订**。

---

## 2. 已知陷阱（具名、有出处，不是泛泛提醒）

1. **`canonicalize()` 在 Windows 上返回 `\\?\C:\…` 扩展长度路径。**
   `document.rs:83` 就在用它。这个前缀会流进错误信息、`DocumentPayload.path`、以及
   `readit://` 的根。**逐个确认它不会渗进 UI。**

2. **`shell/src/main.ts:59` 只按 `/` 切路径**：
   ```ts
   document.title = `${documentPayload.path.split('/').pop() ?? 'readit'} — readit`
   ```
   Windows 上路径是反斜杠，`split('/')` 会原样返回整串——**窗口标题会变成完整路径**。
   控制端 2026-08-17 静态确认，**未在 Windows 上实测**。修的时候连 `\\?\` 前缀一起处理。
   注意 `resources.ts:27` 已经做了归一化，**别在那里重复做**。

3. **符号链接逃逸的守卫测试是 `#[cfg(unix)]`**（`protocol.rs:235`）。Windows 有符号链接、
   目录联接（junction）与硬链接，`readit://` 的沙箱在那边**没有等价覆盖**。这是安全面，
   优先级高于体验面。

4. **长路径**：D2-27 记着 Windows 长路径**仍未测量**（不是通过）——上次在 229 字符根路径下
   连 `git clone` 都没过去。包已经从 2 个涨到 8 个，`packages/readit/dist` 里还有 425 个
   shiki chunk。若你的机器 `LongPathsEnabled=1`，顺手把这条还了。

5. **`routeDocumentOpen`（`shell/src/navigation.ts`）把路径塞进 `<a href>` 再点击。**
   Windows 路径 `C:\foo\bar.md` 作为 href 会被元素的 `classifyHref()` 怎么分类？
   `C:` 是单字符 scheme，按 `navigate.ts:23` 的判据（scheme 长度 ≥ 2）**不算 external**,
   但反斜杠的解析行为要实测。**这条控制端只做了静态推理，你去验。**

6. **不要用 `open` 的等价物测单实例。** macOS 侧的教训：`open -a` 由 LaunchServices 直接
   激活既有应用、根本不起第二个进程，测不到 single-instance 插件。Windows 上要**直接执行
   安装后的 exe 并带参数**。

---

## 3. 明确不在本方案范围

| 项 | 原因 |
|---|---|
| **代码签名与 SmartScreen** | v1 决定不签名。且 Azure Trusted Signing 对 EU/UK 个人不开放，是辖区与预算问题不是工程问题（SPEC §M7）。**不要买 EV 证书**——微软 2024 年起取消了 EV 的即时 SmartScreen 信任 |
| **打印 / 导出 PDF** | SPEC §15 第 8 点：不在范围，且 WKWebView 与 WebView2 差异显著，是**最可能在 v1.1 反过来推翻壳选型**的需求 |
| **L4 视觉回归在 Windows 上跑** | 基线只在固定 Linux 容器里生成，字体栈不同必然全红且无信息量 |
| **修 macOS 侧的行为** | 除非 Windows 的需求逼出一个共用改动，否则不要动 |

---

## 4. 报告

追加到 `docs/plans/2026-08-17-windows-shell-report.md`（新建）：

- 每个任务：改了什么、**先红后绿的命令与实际输出**
- **每条新增断言「验证它会红」那一步的证据**
- W1：安装包体积、安装后体积、干净 Win10（无 WebView2 运行时）上的实测行为
- W2：三种起始状态下双击 `.md` 的实测结果、写了哪些注册表键
- W3：选了哪条路、为什么、没选的代价；`with_webview()` 那条路是否可行的**实测结论**
- W4：六项清单的 Windows 侧结果，**逐项写口径而不只是打勾**（照 macOS 侧那份的形状）
- 四条不变量实测值（§0.2 逐行对照，用你自己的数字）
- **自审：哪些结论来自你实际运行、哪些来自阅读文档——这两者不许混**
- **哪些是 Playwright Chromium 的信号、哪些是真 WebView2 的信号，分开写**（§0.4）
- 阶段边界：做完之后 Windows 侧还剩什么

**提交**：每任务一个提交；身份已配好 `mmy420`，直接 `git commit`；显式列暂存路径，
**绝不 `git add -A`**；**不要推送**。
