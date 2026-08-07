# M0 Spike —— 壳可行性测量记录

> 本文档替换 SPEC §5.1 的估算式体积预算，所有数字均为实测，附产生它们的命令。
> **范围变更**：项目所有者要求本轮只做 macOS，Windows 项延后（记为「deferred」）。
> 探针工程：`spike/tauri-probe/`（一次性工程，不进 workspace，构建产物已 `.gitignore`）。

## 目录

- [0. 版本锁定](#0-版本锁定)
- [1. 四个大件的真实使用](#1-四个大件的真实使用)
- [2. 安装包体积（Step 3）](#2-安装包体积step-3)
- [3. dist/ 按依赖归因](#3-dist-按依赖归因)
- [4. WKWebView 里的真 Mermaid 渲染（Step 4）](#4-wkwebview-里的真-mermaid-渲染step-4)
- [5. Cmd+F 的真实状况（Step 5）](#5-cmdf-的真实状况step-5)
- [6. 冷启动与常驻内存（Step 6）](#6-冷启动与常驻内存step-6)
- [7. 结论](#7-结论)
- [8. 需要跟进的问题](#8-需要跟进的问题)
- [9. 环境相关的发现（非 readit 本身的问题）](#9-环境相关的发现非-readit-本身的问题)

---

## 0. 版本锁定

`spike/tauri-probe/` 用 `npm create tauri-app@latest . -- --template vanilla-ts --manager npm --yes` 脚手架生成后，在 `package.json` / `Cargo.toml` 里钉死到具体版本（脚手架默认给的是 `^2` 这种浮动范围，已改写）：

```bash
cd spike/tauri-probe && npm ls @tauri-apps/cli @tauri-apps/api mermaid @mathjax/src \
  @mathjax/mathjax-tex-font @codemirror/view @codemirror/state @codemirror/language \
  @codemirror/commands @codemirror/lang-markdown @wooorm/starry-night
```

| 包 | 锁定版本 | 说明 |
|---|---|---|
| `@tauri-apps/cli` | 2.11.4 | npm 上没有 2.11.5，最新 2.11.x 是 2.11.4 |
| `@tauri-apps/api` | 2.11.1 | npm 上没有 2.11.5，最新 2.11.x 是 2.11.1 |
| `tauri`（Rust crate） | **2.11.5** | `cargo info tauri` 确认；`Cargo.toml` 用 `=2.11.5` 精确钉死 |
| `tauri-build` | 2.6.3 | `=2.6.3` 精确钉死 |
| `tauri-plugin-opener` | 2.5.4 | `=2.5.4` 精确钉死 |
| `mermaid` | 11.16.1 | 任务要求版本 |
| `@mathjax/src` | 4.1.3 | 任务要求版本 |
| `@mathjax/mathjax-tex-font` | 4.1.3 | 任务要求版本 |
| `@codemirror/view` | 6.43.8 | 任务要求版本 |
| `@codemirror/state` | 6.7.1 | 任务要求版本 |
| `@codemirror/language` | 6.12.4 | 任务要求版本 |
| `@codemirror/commands` | 6.10.4 | 任务要求版本 |
| `@codemirror/lang-markdown` | 6.5.2 | 任务要求版本 |
| `@wooorm/starry-night` | 3.10.0 | 任务要求版本 |
| `hast-util-to-html` | ^9.0.5 | 非四大件之一，是 starry-night 输出 hast AST 转 HTML 字符串必需的配套包，任务简报未列但用了就要装 |

Rust / 工具链：`rustc 1.97.1` / `cargo 1.97.1`，`aarch64-apple-darwin`。

`git log` 里可查证 `src-tauri/Cargo.lock` 中 `tauri` 精确锁定在 `2.11.5`：
```
grep -A2 '^name = "tauri"$' spike/tauri-probe/src-tauri/Cargo.lock
```

---

## 1. 四个大件的真实使用

`spike/tauri-probe/src/main.ts` 对每个大件都产出真实、可见的 DOM 结果（不是只 import）：

- **CodeMirror 6**：`new EditorView({...})` 挂载到 `#editor`，配置 `markdown()` 语言、`history()`、`syntaxHighlighting`，随后把 40 KB 样本文档灌入编辑器（见下）。
- **starry-night**：`createStarryNight(common)` 后对一段真实 JS 代码调用 `.highlight()`，用 `hast-util-to-html` 序列化后写入 `#highlight`。
- **mermaid**：`mermaid.render()` 渲染一张 12 节点、含 subgraph、含 classDef 的流程图，结果 SVG 插入 `#diagram`（几何检查见 §4）。
- **MathJax**（`@mathjax/src` 4.1.3 + `@mathjax/mathjax-tex-font` 4.1.3）：用真正的模块化 v4 API（`mathjax` + `TeX` + `SVG` + `browserAdaptor` + `RegisterHTMLHandler` + `MathJaxTexFont`，不是 `tex-mml-svg-mathjax-tex.js` 那个单体 component 脚本）typeset 一条公式，插入 `#math`。

**一个中途发现的真实 bug，顺手修了**：`@wooorm/starry-night` 在浏览器环境下默认的 oniguruma WASM 加载器（`lib/get-oniguruma.default.js`）会 `fetch('https://esm.sh/vscode-oniguruma@2/release/onig.wasm')` —— 对一个离线桌面应用这是错的（且会让 dist/ 体积测量少算这块）。改成显式传入本地包内的 `onig.wasm`（Vite `?url` 资源导入 + `getOnigurumaUrlFetch` 选项），构建产物里才真正出现 `dist/assets/onig-*.wasm`（473 KB）。**这个坑本身就是"必须真的用起来才测得出"的一个例证。**

---

## 2. 安装包体积（Step 3）

```bash
cd spike/tauri-probe
npm run tauri build -- --target aarch64-apple-darwin
```

`tauri.conf.json` 的 `bundle.targets` 设为 `["app", "dmg"]`；**只打 arm64，没有打 universal binary**（`lipo -info` 确认单一架构）：

```
$ lipo -info src-tauri/target/aarch64-apple-darwin/release/bundle/macos/tauri-probe.app/Contents/MacOS/tauri-probe
Non-fat file: ... is architecture: arm64
```

| 产物 | 命令 | 字节数 | 换算 |
|---|---|---:|---|
| **`.dmg`（arm64）** | `stat -f%z .../bundle/dmg/tauri-probe_0.1.0_aarch64.dmg` | **5,270,073** | **5.27 MB / 5.03 MiB** |
| `.app` 总大小 | `find .../tauri-probe.app -type f -exec stat -f%z {} \; \| awk '{s+=$1} END{print s}'` | 12,502,515 | 12.50 MB / 11.92 MiB |
| 其中主可执行文件 | `stat -f%z .../Contents/MacOS/tauri-probe` | 12,403,088 | 12.40 MB |
| `dist/`（前端源，压入二进制前的未压缩体积） | `find dist -type f -exec stat -f%z {} \; \| awk '{s+=$1} END{print s}'` | 8,572,855 | 8.57 MB |
| Windows NSIS `.exe` | — | — | **deferred**（项目所有者要求本轮不做 Windows） |

`.app/Contents/Resources` 只有 ~100 KB（图标），没有 `Frameworks/`（macOS 用系统自带 `WebKit.framework`，不像 Electron 要打包 Chromium/Node 运行时——这正是体积对比的关键)。前端 `dist/` 是被 `tauri-build` 编译进主可执行文件的（`rust-embed` 式静态嵌入），不是作为独立 Resources 文件铺开，所以可执行文件体积（12.4 MB）≈ dist 源体积（8.57 MB）+ Tauri/WRY 运行时基线体积。`.dmg`（5.27 MB）比 `.app`（12.50 MB）小是因为 DMG 用 UDBZ/bzip2 压缩，对已压缩的 wasm 效果一般但对 JS/文本压得不错。

**复现性验证**：清空 `dist/` 后重新跑一遍完整构建，`.app` 总字节数与 `dist/` 总字节数**完全一致**（12,502,515 / 8,572,855），`.dmg` 字节数几乎一致（相差 10 字节，是 DMG 内嵌的 UUID/时间戳元数据，非内容差异）——构建是确定性的。

---

## 3. dist/ 按依赖归因

### 3.1 真实出货的 dist/（按文件分类求和）

```bash
python3 -c "
import os
total=index_js=wasm=css=mermaid_lazy=other=0
for root,_,files in os.walk('dist'):
    for f in files:
        sz = os.path.getsize(os.path.join(root,f)); total+=sz
        if f.startswith('index-') and f.endswith('.js'): index_js+=sz
        elif f.endswith('.wasm'): wasm+=sz
        elif f.endswith('.css'): css+=sz
        elif f.endswith('.js'): mermaid_lazy+=sz
        else: other+=sz
print(total,index_js,wasm,css,mermaid_lazy,other)
"
```

| 分类 | 字节数 | 说明 |
|---|---:|---|
| `index-*.js`（主同步 chunk） | 5,258,289 | CodeMirror + starry-night + MathJax 模块化 API + mermaid 核心 + 应用胶水代码 + Tauri JS API，全部静态 import，被 Rollup 合并进一个 chunk |
| `onig-*.wasm`（starry-night 的 oniguruma 引擎） | 473,151 | 见 §1 的默认 CDN fetch 坑 |
| mermaid 惰性 diagram-type chunks（≈60 个文件：`flowDiagram`、`sequenceDiagram`、`ganttDiagram`、`c4Diagram`、`cytoscape.esm`、`katex`——mermaid 自带的 KaTeX 用于内部数学节点、`cynefin`、`dagre` 等） | 2,797,272 | mermaid 内部对每种图表类型做动态 `import()`，Vite 把这些全部打进 dist（安装包里都在），但**运行时**只有实际渲染过的图表类型代码会被加载执行（本探针只渲染了 flowchart） |
| CSS | 1,739 | |
| 其它（`index.html` + 打包进去的 40 KB 样本文档） | 42,404 | |
| **合计** | **8,572,855** | 与 §2 表格一致 |

### 3.2 隔离出的单依赖体积（方法论交叉验证)

Rollup 把四个大件全部揉进一个 `index-*.js`，没法从这一个文件里精确切开各自的体积。为拿到干净的单依赖数字，另外用 `esbuild --bundle --minify --format=esm`（与 Vite 底层用的是同一个 esbuild，minify 语义一致）把每个依赖单独打包，入口文件与 `main.ts` 里对应大件的真实调用完全一致（`spike/tauri-probe/size-probes/*.js`）：

```bash
cd spike/tauri-probe
node_modules/.bin/esbuild size-probes/mermaid-only.js --bundle --minify --format=esm \
  --platform=browser --loader:.wasm=file --outdir=size-probes/out/mermaid-only
# 对 baseline / mathjax-only / codemirror-only / starrynight-only 同样处理
```

| 依赖 | raw 字节 | raw (MB) | gzip 字节 | gzip (MB) |
|---|---:|---:|---:|---:|
| baseline（仅 Tauri JS API，无大件） | 1,773 | 0.002 | 775 | 0.001 |
| **mermaid** | 3,454,019 | **3.29** | 945,054 | 0.90 |
| **MathJax**（`@mathjax/src` 模块化 API + tex-font） | 2,753,833 | **2.62** | 1,021,319 | 0.97 |
| **CodeMirror 6**（view+state+commands+language+lang-markdown） | 507,485 | **0.48** | 174,449 | 0.16 |
| **starry-night**（common 语法集 + 真实 onig.wasm） | 1,839,848 | **1.75**（1.3 MB JS + 462 KB wasm） | 428,896 | 0.40 |

四者 raw 之和 ≈ 8.14 MB，与真实 `dist/` 总量 8.57 MB 量级一致（差额来自 Tauri 胶水代码、共享代码去重方式不同）——两种方法互相印证。

**两个交叉验证点，增强对这批数字的信心**：
1. mermaid 单独打包测出 **3.29 MB**，与 SPEC §5.1 已经记录的"实测 `mermaid.min.js` 是 3.4 MB 而非 1.2 MB"高度吻合——本次测量独立复现了那个此前的发现。
2. starry-night 官方 README 自称"bundled/minified/gzip 后，本体+WASM 是 185 KB，`common` 语法集再加 250 KB"，即 gzip 后共 ≈435 KB；本次独立测得 gzip 428,896 字节（419 KB），几乎完全对得上。

---

## 4. WKWebView 里的真 Mermaid 渲染（Step 4）

### 4.1 渲染方式

图表：`flowchart TD`，含 `subgraph Ingestion[...]`、12 个节点（A–L，含长标签，最长约 90 字符）、一条 `classDef heavy` 应用于 3 个节点。默认 `htmlLabels: true`（mermaid 默认配置），即标签走 `foreignObject` + HTML `<div>`——正是 WebKit bug 23113（`foreignObject` 错位）的触发场景。

按简报要求的方式渲染（`spike/tauri-probe/src/main.ts` 的 `runMermaid()`）：
1. `await document.fonts.ready` 先等字体就绪。
2. 创建一个 `position: absolute; left: -99999px`（不是 `display: none`）的离屏 sandbox 容器，`font` 显式设成与可见容器一致，`appendChild` 到 `document.body`。
3. `await mermaid.render(id, code, sandbox)`，拿到 `{svg}` 字符串后立刻移除 sandbox。
4. 把 `svg` 字符串塞进**真正可见**的 `#diagram` 容器——几何检查在这个最终可见位置上做，这才是用户会看到的布局。

### 4.2 打包应用（不是 `tauri dev`）里的实测

不用截图（见 §9 的环境问题——screencapture 在这个沙箱里不可信），改用任务简报允许的替代方案：应用内跑 JS 读取渲染出的 SVG 各元素 `getBoundingClientRect()`，通过一个新增的 Tauri command（`probe_write_json`）把结果直接写到磁盘上的 JSON 文件——不需要屏幕录制权限：

```
spike/mermaid-geometry.json     # 从打包 app 实际产出的原始数据，直接拷贝进 spike/ 保存
```

结果摘要：

```json
{
  "nodeCount": 12,
  "anyLabelEscapesNodeBox": false,
  "anyTextClipped": false
}
```

12 个节点全部检查：每个标签 `foreignObject` 的 `getBoundingClientRect()` 都**完全落在**其形状（rect/polygon/circle）的边界框内部（"逃逸量"全部为负，即标签比形状边界内缩 5.6–37.7px），且没有一个标签的 `scrollWidth/scrollHeight` 超出 `clientWidth/clientHeight`（即无裁切）。

**结论：本次测试的这张图，在这个 macOS / WebKit 版本的打包 WKWebView 里，未观察到 WebKit bug 23113（foreignObject 错位）或字体测量导致的文字裁切。** 这是对一张图、一个 WebKit 版本的验证，不是对所有可能图形/所有系统版本的证伪——后续里程碑如果要处理用户更复杂的图（更深嵌套、更多 opacity/transform 叠加），值得留一个回归检查点。

### 4.3 截图

**未能安全获取**——详见 §9。已用应用内几何检查数据代替（数字优于被拦截的截图，任务简报原话）。

---

## 5. Cmd+F 的真实状况（Step 5）

在打包好的 `.app`（不是 `tauri dev`）上验证，而不是靠推测：

```bash
APP_PID=$(打包应用的 PID)
osascript -e '
  tell application "System Events"
    set targetProc to first process whose unix id is '"$APP_PID"'
    set frontmost of targetProc to true
    delay 0.3
    keystroke "f" using command down
  end tell
'
```

这个沙箱环境里 Automation（System Events）权限已经是放行状态，没有弹出授权对话框，所以拿到的是**真实运行结果**而不是"could not measure"：

1. **发送 Cmd+F**：`osascript` 无报错返回，应用未崩溃。
2. **窗口数量**（`osascript ... get name of every window of targetProc`）：发送前后都是 **1 个窗口**（"tauri-probe"），**没有出现查找栏/查找面板**。
3. **Edit 菜单内容**（`osascript ... get name of every menu item of menu 1 of menu bar item "Edit"`）：

   ```
   Undo, Redo, (分隔线), Cut, Copy, Paste, Select All, (分隔线), AutoFill, Start Dictation…, Emoji & Symbols
   ```

   **没有任何 "Find" 相关菜单项**。（`AutoFill`/`Start Dictation…`/`Emoji & Symbols` 是 macOS AppKit 自动追加到任何应用 Edit 菜单的标准项，与 Tauri/查找无关。）

4. **结构性交叉验证**：在本机 cargo registry 缓存里 grep Tauri 的 webview crate（`wry 0.55.1`）与菜单 crate（`muda 0.19.3`）源码：
   - `muda` 源码里**没有任何 "find" 字样**作为菜单项逻辑。
   - `wry` 里唯一与 `NSTextFinder` 相关的代码是 `unsafe impl NSTextFinderClient for WKWebView {}`，位于 `src/wkwebview/**ios**/WKWebView.rs`——**iOS 专属代码路径，不会被编译进 macOS 构建**。macOS 专属的 `wkwebview/mod.rs`、`navigation.rs`、`download.rs` 等文件里完全没有 find 相关代码。

**结论：确认 —— macOS 打包应用里 Cmd+F 什么都不会发生**：没有菜单项、没有新窗口、JS/菜单层与 Rust/WRY 层都没有接入任何原生查找 UI。这与 tauri#9385 描述的现状一致，也印证了 SPEC §11.3 的判断——**v1 必须自建查找，不是可选优化**。

Windows Ctrl+F（预期弹出 WebView2 自带查找栏）：**deferred**（Windows 本轮不做）。

---

## 6. 冷启动与常驻内存（Step 6）

### 6.1 方法论

**冷启动**：前端在 `DOMContentLoaded` 后用双重 `requestAnimationFrame` 确认至少一帧已经真正绘制，然后 `invoke('probe_log', {stage: 'first_paint'})`；Rust 侧从 `fn main()` 最开头 `Instant::now()` 算起的 elapsed 同时写到 stdout 和 `probe-output/timing.log`。**这测的是"进程 `main()` 入口到应用内实测首帧绘制"，不是"双击图标到肉眼看到窗口"**——没有覆盖 `exec()`/dyld/代码签名校验（`main()` 之前）和窗口合成显示的系统延迟（JS 调用返回之后）。诚实起见按简报要求这样标注，而不是假装量到了"双击到可见"。

外部启动+采集命令（直接执行打包出的可执行文件，不经 `open`，这样才能拿到 stdout）：
```bash
.../tauri-probe.app/Contents/MacOS/tauri-probe > out.log 2>&1 &
# 轮询 probe-output/timing.log 直到出现 "first_paint" 行
```

**常驻内存**：中途发现一个重要陷阱并做了修正——**WKWebView 在 macOS 上把页面内容渲染放在独立的 XPC 子进程里**（`com.apple.WebKit.WebContent.xpc`，还有 `.Networking.xpc` / `.GPU.xpc`），这些进程的父进程是 `launchd`（PPID 1），**不是**应用主进程的子进程，`ps -o rss= -p <主进程PID>` 单独查会漏算绝大部分内存。用"杀主进程后这三个 XPC 进程也一起退出"验证了它们确实归属于本次启动，之后统一用"主进程 + 三个 XPC helper"的 RSS 之和作为真实数字。

打开的文档：`spike/tauri-probe/public/sample-40kb.md`，41,125 字节的真实 Markdown（含标题、段落、代码块、表格、数学公式、mermaid 代码块），构建时被 Vite 当静态资源拷进 `dist/`，运行时 `fetch('/sample-40kb.md')` 读入后灌进 CodeMirror——不是把文本硬编码进 JS bundle。

### 6.2 冷启动结果（5 次 + 5 次，共 10 次）

| 批次 | 命令产出的 5 次数值（ms，进程启动到应用内首帧） | 中位数 |
|---|---|---:|
| A | 2594.0（首次构建后第一次启动，见下方说明）, 931.9, 749.3, 854.0, 793.7 | 854.0 ms |
| B（与常驻内存修正测量同批） | 777.1, 671.6, 927.7, 851.0, 938.9 | 851.0 ms |

10 次合计中位数 ≈ 851–854 ms。**批次 A 的第一次（2594 ms）是明显的离群值**——是构建刚完成后的第一次启动（冷磁盘缓存/首次代码签名校验），之后所有启动（包括批次 A 剩余 4 次、批次 B 全部 5 次）稳定在 670–940 ms 区间。这个离群值原样保留在数据里，不做隐藏，但中位数计算和结论都不依赖它。

⚠️ 这个沙箱环境的磁盘/exec 特性未必代表真实用户 Mac；~850 ms 这个数字建议在真机（非虚拟化、已过 Gatekeeper 公证）上复核后再用于产品规划。

### 6.3 常驻内存结果

**先展示一次踩坑再纠正的过程**（为了透明，而不是只给"正确答案"）：

| 测量方式 | 5 次 RSS（KB，打开 40KB 文档后 settle） | 中位数 |
|---|---|---:|
| ❌ 只查主进程（**低估**，保留在此作为反面教材） | 99584, 105904, 98160, 120656, 120720 | 105,904 KB ≈ 103.4 MiB |
| ✅ 主进程 + GPU xpc + Networking xpc + WebContent xpc（**修正后**） | 503088, 515376, 509232, 513600, 517056 | **513,600 KB ≈ 501.6 MiB ≈ 525.9 MB** |

**基线对照**（临时把 `main.ts` 换成不加载任何大件的空实现，重新构建测量，再还原成真实探针代码——两次构建的 `.dmg`/`.app`/RSS 数字都记在这里，源码已还原为委托内容）：

| 场景 | `.dmg` | `.app` 总字节 | 全家族 RSS |
|---|---:|---:|---:|
| 基线（无四大件，空白页） | 2,911,192 B (2.91 MB) | 10,174,323 B (10.17 MB) | 178,192 KB ≈ 174.0 MiB / 182.5 MB |
| 完整探针（四大件全部同时渲染） | 5,270,073 B (5.27 MB) | 12,502,515 B (12.50 MB) | 513,600 KB ≈ 501.6 MiB / 525.9 MB |

也就是说：**WKWebView 本身在这台机器/这个 macOS 版本上的固定开销约 178 MB**（哪怕页面几乎是空的）；readit 要用的四个大件**同时**渲染时额外再加约 330 MB，落到约 514 MB 的家族 RSS 总量。

**重要限定**：这是"四个大件全部同时加载并渲染"的**压力测试**上限，不是典型稳态。SPEC §5.1 本身就要求四大件"必须是四个互相独立的动态 import"——真实 readit 只有文档真的含数学/图表/代码块/进入编辑模式时才会分别付出对应成本，一份没有数学没有图表的纯文本文档不会付出这 330 MB。本探针为了避免 tree-shaking 把未使用的库摇掉导致体积测量失真（任务简报明确要求），把四者都强制启用了，因此内存数字是保守（偏高）的上限,不是常态。

`ps` 的 RSS 本身是个不完美指标——多进程共享的框架页在每个进程里都会被计入而不去重，所以以上绝对值是真实唯一物理内存占用的上界；但基线 vs 满载的相对差值、"只查主进程"错误 vs 修正后的相对差值，都依然是有效、有意义的对比。

---

## 7. 结论

| 指标 | 实测值 | SPEC 原估算 / 阈值 |
|---|---:|---|
| **`.dmg`（arm64）** | **5.27 MB** | 12–18 MB（SPEC 自称低置信度估算）；> 25 MB 触发重新评估 |
| `.app` | 12.50 MB | — |
| `dist/`（四大件全部真实使用后） | 8.57 MB | — |

即使本探针刻意用了最悲观的加载方式——四个大件全部静态 import、mermaid 用默认方式引入因而带上全部 ~40 种图表类型的惰性 chunk（2.8 MB，真实 readit 若限定只注册需要的图表类型还能再瘦身）、且独立复现了 SPEC 已经记录的"mermaid 被低估 3 倍"这一发现——**最终 `.dmg` 体积仍然只有 5.27 MB，远低于 12–18 MB 的原估算，更远低于 25 MB 的重新评估阈值**。

### **Tauri 决策成立**

支撑这句结论的核心数字：**`.dmg` = 5,270,073 字节（5.27 MB）**，命令：
```bash
stat -f%z spike/tauri-probe/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/tauri-probe_0.1.0_aarch64.dmg
```
体积这一项——SPEC §16 决策 #3 里 Tauri vs Electron 的全部依据——不需要重新评估。

需要单独提请注意的是**内存**（§6.3）：四大件同时满载时的常驻内存（家族 RSS ≈ 514 MB）比直觉上"轻量"应有的数字高不少，其中约 178 MB 是 WebKit 自身固定开销、约 330 MB 是四大件本身的代价。这不影响体积结论（体积和内存是两个独立指标，SPEC §16 决策 #3 的依据明确是体积），但 M6（壳）落地时应该验证 SPEC §5.1 已经写明的"四个互相独立的动态 import"策略在真实使用模式下（大多数文档不含数学/图表）确实能把内存开销压回懒式的低水位,而不是像本探针这样一次性全部点燃。

---

## 8. 需要跟进的问题

1. **内存的稳态验证**：本探针测的是"全部四大件同时点燃"的上限（525.9 MB 家族 RSS）。需要在真实 SPEC 架构（四个独立动态 import）下，分别测"纯文本文档"“只含数学"“只含图表"“只含代码高亮"“进入编辑模式"这几种稳态场景各自的内存增量，才能验证"懒式轻量"这个说法在内存维度上也成立,而不只是体积维度。
2. **starry-night 默认联网取 WASM**：`getOnigurumaUrlFetch` 默认从 `https://esm.sh` 拉取，离线环境下会直接坏掉（且是"安静地"坏，不是明显报错）。真实实现里必须显式传入本地 `onig.wasm`（本探针已验证这样做可行，见 §1）。
3. **mermaid 全量引入的可瘦身空间**：`import mermaid from 'mermaid'` 会把全部 ~40 种图表类型的 chunk（2.8 MB）打进安装包，若 mermaid 的 API 支持只注册 flowchart/sequence/class 等 readit 实际需要的类型，还能进一步压缩体积——非本轮必需,留作后续优化项。
4. **首次冷启动离群值**：构建后第一次启动测到 2.59 s（后续稳定在 ~0.85 s），怀疑是沙箱磁盘冷缓存/代码签名校验,建议真机复核。
5. Cmd+F 缺失已经确认（§5），SPEC §11.3 的"v1 必须自建查找"结论有了实测依据,不是推测。

---

## 9. 环境相关的发现（非 readit 本身的问题）

在验证 Step 4 的截图要求时，`screencapture -x` **技术上执行成功**（返回一张真实、非空的 PNG），**但截到的内容不是探针应用的窗口，而是这台沙箱机器上某个看起来完全无关、疑似私密的其它会话内容**（另一个终端窗口里的对话记录）。这显然不对，已经**立刻删除该截图文件，没有进一步查看或保留**，且没有再尝试任何全屏截图。

后续改用窗口级 API（`Quartz`/`CGWindowListCopyWindowInfo`）想更安全地定位目标窗口再截图，但 Python 环境里没装 `pyobjc`（`Quartz` 模块），装它需要联网 pip install——考虑到已经发生过一次意外截到无关内容，判断不值得为了一张截图冒进一步的风险，**改为完全依赖 §4.2 的应用内几何检查数据**，这也正是任务简报本身给出的备选方案（"数字优于被拦截的截图"）。

这不是 readit 或 Tauri 的问题，是这个特定沙箱/共享显示环境的问题，但值得记录下来提醒后续在同类环境里工作的人：**在这类沙箱里不要相信 `screencapture` 的输出内容，即使它返回码是 0、图片本身是合法 PNG。**

---

## 附录：产物与命令索引

- 探针工程：`spike/tauri-probe/`
- 四大件真实调用：`spike/tauri-probe/src/main.ts`
- Rust 侧测量埋点（`probe_log` / `probe_write_json` command）：`spike/tauri-probe/src-tauri/src/lib.rs`
- 40 KB 样本文档：`spike/tauri-probe/public/sample-40kb.md`
- 单依赖体积隔离脚本：`spike/tauri-probe/size-probes/*.js`
- Mermaid 几何检查原始数据：`spike/mermaid-geometry.json`
- 构建命令：`cd spike/tauri-probe && npm install && npm run tauri build -- --target aarch64-apple-darwin`
