# readit · 跨平台轻量 Markdown 阅读/编辑器 · 设计规格（SPEC v1）

> 一个 **阅读优先、跨平台（macOS + Windows）、可被内嵌** 的 Markdown 阅读/编辑器。核心是一个宿主无关的 JS 库，桌面端只是一层薄壳；渲染效果对齐 GitHub 网页版，且**这个对齐是可证伪的**——由对 GitHub 真实输出的快照回归测试守住，而不是靠肉眼。
>
> **状态**：设计共识已达成（经 brainstorming 逐点确认），技术事实经两轮多智能体调研 + 对抗式复核（16 个 agent、121 万 token、744 次工具调用）核实。计划一已编写（`docs/plans/2026-08-06-plan1-engine.md`，32 个任务），**待落地**。
>
> ⚠️ **先读 §17。** 编写计划一时七个起草组真的装了依赖、真的跑了代码、真的调了 GitHub API，实测推翻了本文档正文的若干条（§6 的 emoji 码点来源与代码块形态、§7.3 的 MathDocument 粒度、§7.5 的 `skipAttributes`、§4.1 的 D-LINK/D-CAMO、§13.1 的 mermaid 结构等）。正文保持原样不改写，是为了让"当初怎么想的"与"实际是什么"都留在记录里；**冲突时以 §17 为准**。
>
> **日期**：2026-08-06。本文档中所有版本号与字节数均为该日实测，非记忆。
>
> **核心洞见**：「像 GitHub」这句话里，有一部分能做到字节级对齐并自动验证，有一部分**永远做不到**（数学、图表、20 种主流语言的代码 token）。本设计的全部结构，都建立在把这两部分**切开**之上——切口恰好落在 Phase A / Phase B 的架构边界上。见 §1.2。

---

## 目录

1. [概述、目标与核心洞见](#s1)
2. [锁定决策清单](#s2)
3. [总体架构：Phase A / Phase B](#s3)
4. [保真度三档与验收方式](#s4)
5. [组件划分与定版](#s5)
6. [Phase A 引擎：GitHub 形状的渲染规则](#s6)
7. [数学：MathJax 4 · SVG · 确定性](#s7)
8. [美元护栏：行内数学的确定性规则集](#s8)
9. [嵌入模型：Shadow DOM、主题、包布局](#s9)
10. [桌面壳：Tauri 2.11](#s10)
11. [数据流、导航与查找](#s11)
12. [错误处理与安全](#s12)
13. [测试架构](#s13)
14. [落地顺序与验收线](#s14)
15. [诚实的局限](#s15)
16. [决策台账](#s16)
17. [实测修订台账（计划一起草期间）](#s17)

---

<a id="s1"></a>

## 1. 概述、目标与核心洞见

### 1.1 项目定性（一句话）

**readit** 是一个 **阅读优先、跨平台、可内嵌** 的 Markdown 阅读/编辑器：默认呈现与 GitHub 网页版一致的渲染视图，可切换到源码编辑；它同时以两种形态交付——一个供真人双击使用的桌面应用，和一个供其他项目 `import` 的框架无关 JS 库。

两种形态共享**同一份核心**。桌面壳不是"另一个实现"，它是核心的一个消费者。

### 1.2 核心洞见：把"能证伪的保真"与"证伪不了的保真"切开

项目最关键的设计判断是：**「渲染效果至少类似 GitHub」这句话，覆盖了两类性质完全不同的东西。**

一类能做到字节级对齐并自动验证：块级 DOM、class 名、标题锚点、alerts、表格、任务列表、frontmatter 表、代码块外壳与语言识别、脚注、emoji、自动链接。GitHub 有一个稳定的 API 端点会返回它博客视图的真实 HTML，可以作为黄金样本源。

另一类**永远做不到**，且原因是结构性的，不是努力不够：

| 项 | 为什么做不到 |
|---|---|
| 数学 | GitHub **服务端不渲染数学**，只吐 `<math-renderer>` 裹原始 TeX，客户端用 MathJax 渲。API 里根本没有渲染结果可对 |
| Mermaid | GitHub 在闭源 iframe（`viewscreen.githubusercontent.com`）里渲，版本不公开 |
| 代码 token | GitHub 对 20 种最常见语言（JS/TS/Python/Go/Rust/Java/C/C#/PHP/Ruby/CSS/HTML…）已改用 tree-sitter 的 TreeLights。JS 生态里没有任何实现能复现。实测：同一段 JS，GitHub 出 `pl-kos`、`pl-s1`，最接近的 starry-night 缺这两个、多一个 `pl-pds`。且该名单五年从 10 涨到 20，只会继续扩大 |

**如果 spec 只写「匹配 GitHub」而不切开这两类，v1 就无法通过自己的验收测试。** 团队会在若干次红灯后开始放宽标准，最终退回肉眼判断——正是验收标准存在的意义所要防止的那个失败模式。

所以本设计把保真度显式切成三档（§4），每档有各自的验收方式，其中第三档**明确承认没有基准**并把它写死在 spec 里，作为已知偏离而非缺陷。

### 1.3 目标与非目标

**目标**

1. 打开单个 `.md` 文件，渲染效果与 GitHub 网页版一致（按 §4 三档定义）
2. 可切换到源码编辑并保存
3. 文中的 `./other.md` 相对链接在同窗口打开，支持前进/后退
4. 核心可被任意技术栈的项目 `import` 内嵌
5. 完全离线自包含，任何运行时路径都不访问网络

**非目标（v1 明确不做）**

- 文件树、多标签页、全局搜索、笔记库/vault 概念
- WYSIWYG 实时渲染编辑
- 导出 PDF / 打印优化（见 §15，这是最可能在 v1.1 反过来推翻壳选型的需求）
- 服务端渲染 Mermaid
- 协作、同步、插件市场

---

<a id="s2"></a>

## 2. 锁定决策清单

| # | 决策点 | 结论 | 定于 |
|---|--------|------|------|
| 1 | 集成形态 | 核心库 + 薄壳 | brainstorming |
| 2 | 编辑形态 | 阅读优先，快捷键切源码编辑，可选并排预览 | brainstorming |
| 3 | 渲染范围 | GFM 全套 + 代码高亮 + Mermaid + GitHub Alerts/frontmatter + 数学 | brainstorming |
| 4 | 应用范围 | 单文件打开 + 相对链接同窗跳转 + 前进/后退 | brainstorming |
| 5 | 宿主兼容 | 框架无关：Web Component + 命令式 `mount()`，不绑任何框架 | brainstorming |
| 6 | v1 验收 | 引擎先行，快照回归证明保真度 | brainstorming |
| 7 | 总体方案 | **方案 A：分层保真 + 声明式偏离** | 一轮调研后 |
| 8 | 数学引擎 | **MathJax**（与 GitHub 同源），非 KaTeX | 一轮调研后 |
| 9 | 行内 `$…$` | **默认开 + 确定性护栏** | 一轮调研后 |
| 10 | 解析器 | markdown-it 15.0.0 | 调研 |
| 11 | 桌面壳 | Tauri 2.11.5 | 调研 |
| 12 | 编辑器 | CodeMirror 6，动态 import | 调研 |
| 13 | 高亮器 | 按消费方分档：桌面 starry-night / 嵌入 Shiki，同一 adapter | 调研 + 复核 |
| 14 | 隔离模型 | Shadow DOM `open` 默认 + `shadow:false` 逃生舱 | 调研 |
| 15 | 数学输出格式 | SVG + `fontCache:'none'`，字体用 `mathjax-tex-font` | 调研 + 复核 |

---

<a id="s3"></a>

## 3. 总体架构：Phase A / Phase B

系统只有一条硬边界。

```
┌─────────────────────────────────────────────────────────────┐
│ Phase A      (src, resolvedOpts) -> HTML string              │
│                                                              │
│  纯函数 · 同步 · 无 DOM · Node 与浏览器同构 · 字节确定        │
│                                                              │
│  markdown-it 15                                              │
│    → GitHub 形状的渲染规则（§6）                              │
│    → hast 卫生化                                             │
│    → MathJax SVG 内联（§7）                                   │
│    → 序列化为字符串                                          │
│                                                              │
│  ★ 快照测试只对着它跑。零网络、零 DOM、跨进程字节可重现。      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase B      浏览器专属 · 异步 · 只做"渲染不出来的事"          │
│                                                              │
│  Mermaid 渲染注入 · 高亮升级 · CodeMirror 源码模式            │
│  复制按钮 · 锚点桥接 · 相对链接拦截 · 查找索引构建             │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 唯一的异步缝

数学在 Phase A，但 MathJax 是个 ~677 KB gzip 的大件，不能静态打进核心。**所有异步收敛到唯一一道缝**：

```js
const opts = await prepare(src, baseOpts)
//   ↑ 唯一的 await。扫描 $ / ```math / ```mermaid / 围栏语言，
//     按需 dynamic import，返回已解析好的渲染器集合。

const html = render(src, opts)
//   ↑ 纯同步，函数体内永不出现 await。
//     测试时把渲染器静态 import 后直接调它 —— 密闭、确定、零网络。
```

这道缝是**把数学放进 Phase A 的最重要 API 形状后果**。没有它，要么 MathJax 被静态打进核心（每个无数学文档都付 677 KB），要么数学被迫退回 Phase B（丧失确定性快照）。

### 3.2 数学缺席时的降级 = GitHub 的服务端行为

未传入 math 渲染器时，Phase A 输出 `<math-renderer class="js-inline-math">$x^2$</math-renderer>` 裹原始 TeX——**这正是 github.com 服务端吐出的东西**（实测确认）。

于是：

- 零数学文档零成本
- 嵌入方按需 `math: true` 开启，桌面壳默认开
- **"不装数学"这个配置，恰好就是与 oracle 字节对齐的那一档**——它不是残缺形态，而是①档保真的测试模式

### 3.3 为什么这条边界值得如此严格

1. **确定性**：Phase A 无 DOM、无网络、无随机、无时间。跨进程字节可重现（MathJax SVG 部分已实测 5 次独立进程 SHA-256 全等）
2. **可嵌入**：Phase A 在 Node 里就能跑，宿主想要 HTML 字符串（SSR、静态站点、测试）直接调
3. **可测试**：快照套件不需要浏览器、不需要网络、不会 flake
4. **可审计**：符合"确定性、静态、人为可控"的工程取向——渲染结果是输入的纯函数

---

<a id="s4"></a>

## 4. 保真度三档与验收方式

| 档 | 覆盖 | 验收方式 | 对应阶段 |
|---|---|---|---|
| **① 结构档** | 块级 DOM、class、标题锚点、alerts、表格（含 `<markdown-accessiblity-table>`）、任务列表、frontmatter 表、代码块 wrapper 与语言识别、脚注、emoji、自动链接、tagfilter、**数学的定界判定与占位符**、Mermaid 占位符 | 归一化后对 GitHub blob HTML **100% diff 通过**（带具名白名单） | Phase A，`math: null` |
| **② 视觉档** | github-markdown-css 原样 + Primer 配色变量 | 肉眼一致 + ≤12 张视觉回归截图；**不 diff token** | 样式层 |
| **③ 声明偏离档** | MathJax SVG 输出、Mermaid SVG 输出、20 种 TreeLights 语言的 token 划分 | 对**自己的**冻结黄金文件快照（锁死依赖版本）。**没有 GitHub 基准，本文档写死** | Phase A（math）+ Phase B（mermaid） |

**快照套件对 Phase A 跑两遍**：

- `math: null` 那遍 → 撞 GitHub oracle（①档）
- `math: on` 那遍 → 撞自家黄金文件（③档）

### 4.1 ③档偏离清单（本清单即契约，不是缺陷列表）

| 偏离 | 内容 | 原因 |
|---|---|---|
| **D-MATH** | readit 用 MathJax 4.1.3 + `mathjax-tex-font` + SVG 输出渲染数学；GitHub 用未公开版本的 MathJax 在客户端渲染。视觉可能有差异，DOM 结构必然不同 | GitHub 服务端无渲染结果可对 |
| **D-MERMAID** | readit 用本地 mermaid 11.16.1；GitHub 用闭源 iframe 服务、版本不公开 | 无法获取基准 |
| **D-TOKEN** | 20 种 TreeLights 语言（C, C#, CSS, CodeQL, EJS, Elixir, ERB, Gleam, Go, HTML, Java, JS, Nix, PHP, Python, RegEx, Ruby, Rust, TLA, TS）的代码 token 划分与 GitHub 不同 | GitHub 用私有 tree-sitter 语法，JS 生态无实现 |
| **D-CAMO** | readit 不做 camo 图片代理，不做 `/blob/` → `/raw/` 的图片 URL 重写 | 本地阅读器无代理需求 |
| **D-LINK** | readit 不把相对链接改写成绝对 github.com URL | 与"同窗跳转"需求直接冲突 |
| **D-$1…D-$5** | 美元护栏的 5 条有意偏离，见 §8.5 | 安全性 / 对称性优先于 bug 兼容 |

**每条偏离都是一个具名的"已知偏离"快照测试**——断言它与 GitHub **不同**。这样一旦 readit 这一侧发生变化，测试会响，而不是静默漂移。

> ⚠️ 2026-08-12 订正措辞。原文写的是「一旦 readit **或 GitHub** 任一侧发生变化，测试会响」。
> 前半句一直成立（棘轮盯着我们自己：改坏了、改好了、失配量级变了，三个方向都断构建）。
> 后半句依赖每夜重抓 oracle，而那条哨兵已按 §13.4 取消——fixture 现在是一份**钉住的快照**，
> GitHub 那一侧的变化不再会让测试响，**这是有意的**：指标是「与快照一致」，不是「跟随 GitHub」。
> 想主动看 GitHub 变没变，手动跑 `oracle-drift` workflow。

### 4.2 黄金样本源

**`GET /repos/{owner}/{repo}/contents/{path}`，`Accept: application/vnd.github.html`，`?ref=<sha>`**

这是唯一同时给出 alerts + 标题锚点 + frontmatter 表格的端点。已实测：

- `?ref=<sha>` 被该 Accept 头支持，且重复拉取字节一致
- frontmatter 转表格是通用渲染行为（在 `gohugoio/hugoDocs` 上复现，不是 `github/docs` 特例）
- `/contents/{path}` 与 `/readme` 除外层 `<div id="file">` vs `<div id="readme">` 外字节一致

**明确拒绝的方案**：

- `POST /markdown` `mode=gfm`：有 alerts 但无锚点，且带每次请求变化的 `data-run-id` 随机盐（实测三次同样请求得到三个不同值）
- `POST /markdown` `mode=markdown`：有锚点但 alerts 退化成普通引用块、任务列表退化成字面 `[x]`
- 抓取 github.com 页面：React 渲染，标记埋在 JSON 载荷里，CSS 包每周变

---

<a id="s5"></a>

## 5. 组件划分与定版

所有版本为 2026-08-06 实测，所有字节数为本地 `esbuild --bundle --minify` + `gzip -9` 实测。

| 包 | 职责 | 关键依赖（精确版本） |
|---|---|---|
| `@readit/core` | Phase A 引擎 | markdown-it **15.0.0**、hast-util-sanitize **5.0.2**、github-slugger **2.0.0** |
| `@readit/math` | MathJax 渲染器（Phase A，懒加载） | @mathjax/src **4.1.3**、@mathjax/mathjax-tex-font **4.1.3** |
| `@readit/element` | Web Component + `mount()` | github-markdown-css **5.9.0**（用其中的单主题文件，见 §9.2） |
| `@readit/highlight` | 高亮 adapter + 两个实现 | @wooorm/starry-night **3.10.0** / shiki **4.4.2** |
| `@readit/editor` | CodeMirror 源码模式（懒加载） | @codemirror/view **6.43.8**、state **6.7.1**、language **6.12.4**、commands **6.10.4**、lang-markdown **6.5.2**、**style-mod >=4.1.2** |
| `@readit/mermaid` | 图表（Phase B，懒加载） | mermaid **11.16.1**、dompurify **3.4.13** |
| `@readit/find` | 查找（Phase B）—— M6 | 无依赖 |
| `shell` | Tauri 桌面壳 | tauri **2.11.5**、tauri-plugin-single-instance **2.4.3** |

### 5.1 体积预算（实测）

| 场景 | gzip |
|---|---|
| 嵌入方，只读，无高亮无数学（`highlighter: null`, `math: null`） | ~60–70 KB（引擎）+ 5.4 KB（github-markdown.css） |
| 嵌入方，只读 + Shiki 高亮 | + ~54 KB（core，零 WASM）+ 每语言 0.08–194 KB 按需（2026-08-10 实测 361 个语言包：中位 1.4 KB、p90 8.0 KB、p99 30.4 KB、最大 emacs-lisp 194.2 KB。原写「0.8–16 KB」是估算，尾部低估 12 倍。表在 packages/highlight/data/lang-pack-sizes.json） |
| 桌面壳，只读 + starry-night 高亮 | + ~64 KB JS + 151 KB WASM（本地磁盘，非网络） |
| **含数学的文档**（首次遇到 `$`） | **+ ~677 KB**（引擎 117 KB + tex-font 561 KB） |
| **含图表的文档**（首次遇到 ```mermaid） | + 约 1.0–1.5 MB minified（ESM 分块，非全量 3.4 MB） |
| 编辑模式（首次切换） | + 176,654 B，一次性 |

**"轻量"这个词在本项目里的准确含义是"懒式轻量"**：无数学无图表的文档确实轻；一旦遇到，就是几百 KB 到 1 MB 级别。这不是妥协，是这些能力的物理成本。四个大件（数学、Mermaid、编辑器、语法包）**必须是四个互相独立的动态 import**——包布局（§9.3）就是为此设计的。

### 5.2 高亮器双默认的理由

| | 桌面壳 | 嵌入库 |
|---|---|---|
| 默认 | starry-night 3.10.0 | Shiki 4.4.2 + JS 正则引擎 |
| 体积 | ~215 KB gzip（本地磁盘，成本≈0） | ~54 KB gzip，零 WASM |
| 保真 | 发 GitHub 真实的 `pl-*` class + Primer CSS 变量 | 内联 hex 色值，用 GitHub 的 VS Code 主题 |

桌面端保真是免费的（磁盘读取），所以取最接近的；嵌入方没要求过高保真，不该替他们付 4 倍载荷。**同一个 adapter 接口 `{highlight(code, lang), supports(lang)}`**，两个默认值，宿主可传 `highlighter: null` 得到朴素 `<pre>`。

**必做项**：starry-night 的默认浏览器路径硬编码 `fetch('https://esm.sh/vscode-oniguruma@2/release/onig.wasm')`。必须覆写 `getOnigurumaUrlFetch` 指向本地文件。**不改就直接违反离线约束，且在联网开发机上永远测不出来**——所以离线测试（§13）必须是一道真能失败的门。

---

<a id="s6"></a>

## 6. Phase A 引擎：GitHub 形状的渲染规则

markdown-it 的默认输出与 GitHub 差在若干处。以下每一条都来自实测差异，是引擎工作量的实质。

| # | 规则 | 说明 |
|---|---|---|
| 1 | **GFM 扩展自动链接移植** | **必做，不封顶项。** linkify-it 6.0.0（markdown-it 15 的依赖）把 `fuzzyLink` 默认关了：`www.x`、裸域名、带认证部分的 URL 现在**一个都不链接**。做法：`linkify: false` + 移植 `micromark-extension-gfm-autolink-literal` 的算法为一条 inline rule。⚠️ 「回退 markdown-it 14.3.0」**不是行为中立的**——14.3.0 依赖 linkify-it 5.0.2，`fuzzyLink` 默认为真，回退会静默改变自动链接输出并作废基线 |
| 2 | tagfilter | 9 个标签（title/textarea/style/xmp/iframe/noembed/noframes/script/plaintext）的前导 `<` 转义为 `&lt;` |
| 3 | 表格 | `style="text-align:center"` → `align="center"`；外套 `<markdown-accessiblity-table>` |
| 4 | 删除线 | `<s>` → `<del>` |
| 5 | 任务列表 | 属性顺序 `type, id, disabled, class, aria-label, checked` + `aria-label="Completed task"/"Incomplete task"`。注：`markdown-it-task-lists` 在**默认配置**下输出是良好的（含 `disabled`），传 `enabled:true` 反而会破坏它并偏离 GitHub；但字节级对齐仍需自写规则 |
| 6 | `dir="auto"` | 铺到每个块级元素 |
| 7 | 标题锚点 | `<div class="markdown-heading" dir="auto"><h2 class="heading-element" dir="auto">…</h2><a id="user-content-slug" class="anchor" aria-label="Permalink: …" href="#slug"><svg class="octicon octicon-link"…></svg></a></div>` |
| 8 | Alerts | `markdown-it-github-alerts 1.0.1` 的 octicon path 已验证与 `@primer/octicons` 字节一致（好结果）。缺两个属性需补：外层 `dir="auto"`、svg 上的 `data-component="Octicon"`。图标映射：note→info, tip→light-bulb, important→report, warning→alert, caution→stop。标记必须独占引用块首行；类型名大小写不敏感；嵌套引用块内不生效 |
| 9 | frontmatter → 表格 | 数组/对象嵌套为内层表，标量单元格套 `<div dir="auto">` |
| 10 | emoji | 1936 个 shortcode。⚠️ `/emojis` 端点对标准 emoji 也返回 PNG URL，码点须从 `unicode/<hex>.png` 文件名解析；自定义 emoji（`:shipit:` 等，路径无 `/unicode/` 段）**必须本地内置**，否则打开一个带 `:shipit:` 的 README 就违反离线约束 |
| 11 | 代码块 wrapper | `<div class="highlight highlight-source-LANG notranslate position-relative overflow-auto" dir="auto" data-snippet-clipboard-copy-content="…"><pre class="notranslate">`。⚠️ 完整形态**只在 blob 视图出现**，`POST /markdown` 只给简化版——别照着错的那个对 |
| 12 | `data-line` | 从 `token.map` 生成，滚动同步的锚。markdown-it 只在块级 token 上有 `map`（行内全无），块级粒度的滚动同步是可接受的；若日后要字符级光标同步，markdown-it 无法提供 |
| 13 | 美元护栏 | core rule，见 §8 |
| 14 | `user-content-` 前缀 | 对用户手写 HTML 里的 `id`/`name` 也要加（GitHub 的防碰撞过滤器） |

### 6.1 卫生化的边界（关键陷阱）

GitHub 的白名单里 `class` 和 `style` 出现次数为**零**——它把用户写的这两个属性全剥掉。但 readit 自己生成的标记**重度依赖** class（`.markdown-alert`、`.pl-*`、`mjx-container`、`.markdown-body`）。

**一遍扫全树会把自家标记全铲掉。**

规则：**卫生化只对用户提供的原始 HTML 跑，且必须在注入自家标记之前。** 用 `hast-util-sanitize` 的 `defaultSchema`（它显式镜像 GitHub 的 html-pipeline 白名单）+ `clobberPrefix: 'user-content-'`。

`defaultSchema` 已经自带的、不需要重复实现的：`data:` 协议在 `src`/`cite`/`longDesc` 上已被拒（相对 URL 已放行）；GFM 构造的值级 class 白名单（`code: language-*`、`li: task-list-item`、`ol/ul: contains-task-list`、`section: footnotes`、`a: data-footnote-backref`）已存在。

需要额外加的只有：readit 自身前缀的值级白名单，以及"透传子树保持无 class"这条不变量。

---

<a id="s7"></a>

## 7. 数学：MathJax 4 · SVG · 确定性

### 7.1 包与配置

```js
// ⚠️ 不是 mathjax-full —— 那个包冻结在 3.2.2（2022-06），
//    写 mathjax-full/js/... 就是在写 MathJax 3。
//    v4 的源码包是 @mathjax/src。
import { mathjax } from '@mathjax/src/js/mathjax.js'
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js'
import { SVG } from '@mathjax/src/js/output/svg.js'
```

| 配置 | 值 | 理由 |
|---|---|---|
| 输出格式 | **SVG** | CHTML 的自适应样式表是文档级、顺序依赖、单调增长的副作用（实测五次转换 11,458 → 19,037 字节），且其确定性模式在 Node 里根本无法同步构建，还需内置 ~1.8 MB woff2 |
| 字体 | **`@mathjax/mathjax-tex-font`** | 默认字体 newcm 把字形拆成 40 个懒加载块，`\mathbb{R}`、`\mathcal{O}` 等常见构造在同步渲染时**抛错**（33 条真实语料中 2 条）。tex-font **零动态块**，8/8 全同步通过。且 GitHub 2022 年上线数学时 MathJax 4 尚未发布，它几乎肯定跑 MathJax 3，默认字体正是 MJX-TeX |
| `fontCache` | **`'none'`** | 默认的 `'local'` 发出带自增计数器的 id（`MJX-1-…` vs `MJX-3-…`），同一份公式渲染两次字节不同。`'global'` 需要共享 `<defs>`，破坏片段自包含。`'none'` 内联字形几何，零 id，字节稳定 |
| `tags` | **`'none'`** | `tags:'ams'` 会从另一个旋钮把计数器带回来（`id="mjx-eqn:1"` 逐次自增），`\label{}` 还会发出跨文档碰撞的全局 id |
| TeX 包 | base, ams, newcommand, noundefined, noerrors | 见下 |
| `displayOverflow` | `'scroll'` | 见 §7.4 |
| MathDocument 生命周期 | **每份文档一个全新实例** | 见 §7.3 |

### 7.2 安全：包白名单，不是 SafeHandler

**不装 `html` / `unicode` / `mhchem` 包。**

- `\unicode[...]` 的 CSS 注入在 v4 已修（issue #3129，2025-08-13 关闭），实测 4.1.3 上载荷被剥离
- **活的向量是 `html` 包**：`\href{javascript:alert(1)}{x}` 实测原样输出到属性；`\style{color:red}{x}`、`\cssId{evil}{x}` 同理
- 正确的缓解是**包白名单**（readit 本来就有），`ui/safe` 作为纵深防御的可选项而非必需品

### 7.3 确定性的三个前提

已实测：SVG + `fontCache:'none'` 下，5 次独立 Node 进程输出 SHA-256 全等。但这个保证有前提：

1. **`fontCache: 'none'`**
2. **`tags: 'none'`**
3. **每份文档一个全新 MathDocument**

第 3 条不是性能建议，是正确性要求。实测：先转 `\newcommand{\zz}{\alpha}\zz`，再转裸 `\zz`，**它渲染出来了**——TeX 宏状态跨 `convert()` 泄漏。后果有二：

- 第 N 个公式的渲染依赖前 N-1 个 → 逐公式黄金快照不可组合，一份 README 能改变自己后面的数学
- 不可信第三方 README 的宏炸弹面

因此**快照套件必须包含顺序置换测试，而不只是重复测试**——重复跑测不出这一类。

### 7.4 两个必须内置的东西

**① 5,884 字节的 SVG 样式表，作为冻结常量。**

实测五次转换恒定不变（与 CHTML 的自适应表相反），所以可以 vendor 成常量字符串并 `adoptedStyleSheets` 进每个 shadow root。它不是装饰性的：

- `mjx-container` 是未知元素，无样式表时默认 `display: inline` → **行间公式变成行内且不居中、无边距**
- SVG 根元素保持 UA 默认的 `overflow: hidden` → **字形被裁**
- `overflow="scroll"/"truncate"` 显示模式 100% 由 CSS 驱动，无表即死

**② `displayOverflow: 'scroll'`。**

Phase A 预渲染时没有视口，`linebreaks.width: '100%'` 在 Node 里无意义。实测一条 20 项的方程得到单个 `width="105.038ex"` 的 SVG，零换行。**预渲染把布局按"无容器"算死，永远不会随窗口 reflow**——这对可缩放的桌面阅读器是相对 GitHub 客户端渲染的真实退步，只能靠 CSS 横向滚动兜。

### 7.5 原始 TeX 的保留

把源 TeX 存进 `data-tex` 属性。一举三得，且零成本：

- **复制粘贴得到源码**——与 GitHub 行为一致（它的 `<math-renderer>` 元素文本内容就是原始 TeX）
- **编辑器往返**的源
- **无障碍**——绕开 `assistive-mml` + `speech-rule-engine`（后者当前是 `5.0.0-rc.4`，一个 RC 版传递依赖）

⚠️ 注意 MathJax 会把用户原始 TeX 回显进遍布各节点的 `data-latex` 属性（实测 `\text{a"b<c>}` → `data-latex="\text{a&quot;b<c>}"`，引号转义、尖括号原样）。属性值内合法，但这是嵌在 Phase A 输出字符串各处的不可信内容——**任何对该字符串的下游正则/字符串后处理都是隐患**。考虑用 `skipAttributes` 丢掉它（同时也能削减 §5.1 里 SVG 相对 CHTML 4–5 倍的体积）。

---

<a id="s8"></a>

## 8. 美元护栏：行内数学的确定性规则集

### 8.1 位置选择（做了大半的工作）

实现为 markdown-it 的 **core rule**，不是 inline rule：

```js
md.core.ruler.before('text_join', 'readit_math_inline', fn)
```

在 `inline` 之后（强调/链接/代码 token 已存在）、`text_join` 之前（反斜杠转义仍是可辨认的 `text_special` token，`markup` 为 `'\$'`）。

只有 `text` 与 `text_special` 是候选；其他 token 类型（`code_inline`、`link_open/close`、`em/strong`、`image`、`html_inline`、`softbreak`、`hardbreak`）一律是**不透明边界**。

这一个位置选择白送了：代码段里的 `$` 永不是数学、围栏里永不是、链接 href/title 里永不是、图片 alt 里永不是、数学永不跨行、`**$a$**` 正常工作、`$a*b*c$` 正确地**不**成为数学。

### 8.2 展平

每一段相邻的 text/text_special 兄弟节点合并为：
- `s` = 各 `.content` 的拼接
- `mask` = 平行 Uint8Array，`mask[i] = 1` 当且仅当该字符来自 `markup` 以 `\` 开头的 `text_special` token

被遮罩的字符**永远不能是定界符**。这让 readit 拿到 Pandoc 式的 `\$` 正确行为——GitHub 自己反而没有。

### 8.3 规则 R0–R10

| 规则 | 内容 |
|---|---|
| **R0** | 优先尝试 `$$…$$`（§8.4） |
| **R1** | 触发条件：`s[i] === '$'` 且 `mask[i] === 0` |
| **R2** | **开启符左侧**：前一字符为 `null`（run 起始，即紧跟 token 边界——这就是 `**$a$**` 能工作的原因）、四个 ASCII 空白之一、或 `'('`。其余一律拒绝（字母、数字、`_`、其他标点、所有非 ASCII 含 CJK） |
| **R3** | **开启符右侧**：不得为 undefined；不得为空白；不得为未遮罩的 `$`。**数字不拒绝**——GitHub 把 `$5+y$`、`$5$` 渲染为数学 |
| **R4** | **闭合搜索**：向右走，遇 `\n`/`\r` 立即失败（行内数学不跨行），跳过被遮罩的 `$`。**第一个未遮罩的 `$` 是唯一候选** |
| **R5** | **闭合符左侧**：前一字符不得为空白 |
| **R6** | **闭合符右侧**：不得匹配 `/[0-9A-Za-z_]/`；不得为未遮罩的 `$`。为 `null`（run 末尾/行尾）或任意标点或任意非 ASCII 则接受。**这一条独自杀掉 `$5 or $10`、`$100-$200`、`$PATH/$HOME`** |
| **R7** | **平局裁决**：首个候选若不合格，**整个放弃该开启符**，不再贪心右找。`i` 前进一位重新从 R1 开始——失败的候选自己获得成为新开启符的机会 |
| **R8** | 内容非空 |
| **R9** | 发射 `math_inline`。被遮罩的 `$` 在交给 MathJax 前重编码回 `\$` |
| **R10** | 数学内容不透明，永不作为 markdown 二次解析 |

**R7 是整套规则里最重要的一条**，它复现了 GitHub 的真实行为：

```
"$a $b$"                      → 只有 $b$ 是数学
"costs $5, and $x$ holds."    → 只有 $x$ 是数学
"$a$b$c$d$"                   → 全都不是数学
"a line with $5 and one $ left over" → 全都不是数学
```

贪心式"继续右找合法闭合符"（`markdown-it-katex` 实际的做法）会产出 `$5 then code `$`——它会吃掉代码段。同一批语料下贪心实现得分 104/159，本规则集 154/159。

### 8.4 `$$…$$` 行内展示

同样的左右上下文测试，作用于两字符序列。差异：**闭合的 `$$` 允许前置空白**（GitHub 接受 `$$a+b $$`），保留以对齐。块级 `$$`（独占行）与 ```math 围栏是独立的块规则，必须在任何行内 pass 之前尝试。

### 8.5 五条有意偏离（D-$1 … D-$5）

| 编号 | 内容 | 理由 |
|---|---|---|
| D-$1 | `\$` 抑制数学。GitHub：`\$x+y\$` 仍渲染为数学（其转义在数学 pass 之前解析）。readit：字面量 | 更安全，与 Pandoc 一致，与 GitHub 自己文档的暗示一致 |
| D-$2 | 闭合 `$` 前紧邻 Tab 被拒。GitHub 接受 | 没人这么写；对称性优于 bug 兼容 |
| D-$3 | `$\$4 + \$5$` 渲染为一个数学段、内容 `\$4 + \$5`。GitHub 把它搅成 `$$4 + <math>$5$</math>` | — |
| D-$4 | `$a\$ b$` 渲染为数学、内容 `a\$ b`。GitHub 渲染 `$a$` | — |
| D-$5 | 原始行内 HTML 不产生文档级污染。GitHub 有个 bug：一个游离的 `<b>` 会压制后续所有段落的数学 | 这是 readit 占优的偏离 |

这 5 条是 159 条 oracle 语料上的**全部**偏离集。每条编码为具名的"已知偏离"fixture，从而任何**其他**用例的变化都会响亮失败。

### 8.6 开关与可检查性

```
inlineMath: 'github' | 'strict' | 'off'      // 默认 'github'
```

- `'github'` = 上述规则
- `'strict'` = 额外两道闸：R2 去掉 `'('` 允许、R3 拒绝紧跟数字。使 `$5+5$`、`($x$)`、`f($x$)` 不成为数学。**代价：159 条里降到 147**。这是"我写钱不写数学"模式，是显式的保真度牺牲
- `'off'` = 不注册该规则。`$$…$$` 块与 ```math 围栏仍工作

优先级（首个匹配胜出，完全确定性）：**显式 API > 文档 frontmatter 键 `readit-inline-math` > 应用设置 > 内置默认**。

frontmatter 键必须**扁平且带命名空间**——扁平因为 GitHub 把 frontmatter 渲染成可见表格且嵌套 YAML 渲染成嵌套表；带命名空间以免与 Jekyll/Hugo/Obsidian 的键碰撞。

⚠️ **纯度约束**：Phase A **不得**自己读 frontmatter。单独提供纯函数 `readFrontmatterOptions(src) -> {inlineMath?}`，由宿主/壳调用后作为选项传入。这是承重的而非风格问题——一旦泄漏进渲染函数，同构纯度保证就没了。同时：读取某个键**不得**把它从输出里移除，frontmatter 仍照常渲染成表格。

**`explain: true`**：对每个 `$` 输出 `{offset, verdict: 'opened'|'closed'|'rejected', ruleId}` 判定日志。UI 能回答"这段为什么没变成公式"，单元测试能断言规则号而非仅结果，R2–R8 各自成为一个具名测试组。

---

<a id="s9"></a>

## 9. 嵌入模型：Shadow DOM、主题、包布局

### 9.1 Shadow DOM `open` 为默认

理由直接系于验收标准：**在未知宿主的 light DOM 里，宿主一旦上了 Tailwind Preflight 或 Bootstrap Reboot，隔离下通过的快照就证明不了真实嵌入的样子。** Shadow DOM 是唯一能让渲染结果成为「自家 CSS 的函数」的机制。

四个曾被担心的阻碍已逐一核实：

| 担心 | 实况 |
|---|---|
| github-markdown-css 在 shadow root 里坏 | 无 `:root`、无 `@font-face`，逐字可用 |
| KaTeX 的 `@font-face` 在 shadow root 里不生效 | **不适用了**——改用 MathJax SVG，零字体依赖 |
| Mermaid 在 shadow root 里坏 | 真的坏（它 shadow-unaware）→ 架构上绕开：离屏渲染后注入字符串（§10.3） |
| CodeMirror 6 在 shadow root 里坏 | 官方支持 `root: ShadowRoot`，且 `new EditorView({parent})` 会自行推断 |

`shadow: false` 逃生舱保留给需要宿主自行改样式、或对 find-in-page / ARIA 有特殊要求的场景。

### 9.2 主题

用 github-markdown-css 的**单主题文件**（`github-markdown-light.css` / `github-markdown-dark.css`，各 22,219 B，dark 那份零 `@media`），scope 在 `:host([data-theme=…])` 下。

⚠️ 合并版 `github-markdown.css` 的 `[data-theme="dark"]` 规则**嵌在 `@media (prefers-color-scheme: dark)` 里**——在浅色系统上无论放哪都不生效。这不是 Shadow DOM 缺陷，那个文件本来就这样。曾流传的"改写成 `:host([data-theme="dark"])` 就能修"是错的，它没有把规则移出媒体查询。

`theme: 'auto'` 读 `getComputedStyle(host).colorScheme`——`color-scheme` 是继承属性，跨 shadow 边界，所以无论宿主设在 `:root`、`.dark` 包装器还是没设（回落 `prefers-color-scheme`）都工作。

对外只开两个覆写通道：`--readit-*` 自定义属性（映射到 GitHub 的 `--fgColor-*` / `--bgColor-*` / `--color-prettylights-syntax-*`，自定义属性会继承进 shadow 树），以及 `::part()`。**`::part()` 名字是永久公开 API**——先只开 `root` / `content` / `code-block`，加容易删是破坏性变更。**`mermaid` 推迟到 M5**：那个容器在 M5 之前根本不存在，现在钉一个名字，等 M5 真做时结构若不同就被自己锁死了。⚠️ 本条于 2026-08-09 修订，原文的名单含 `mermaid`，是设计计划二时对着一个还不存在的结构提前钉了名字。

**永不写 `document.documentElement` 或 `document.body`。**

### 9.3 包布局

```
readit/
  package.json:
    "type": "module", "sideEffects": ["*.css"],
    "exports": {
      ".":                   { "types": "./dist/core.d.ts",
                               "module-sync": "./dist/core.js",
                               "import": "./dist/core.js",
                               "require": "./dist/core.cjs" },
      "./element":           "./dist/element.js",
      "./editor":            "./dist/editor.js",
      "./plugins/math":      "./dist/plugins/math.js",
      "./plugins/mermaid":   "./dist/plugins/mermaid.js",
      "./plugins/highlight": "./dist/plugins/highlight.js",
      "./styles.css":        "./dist/readit.css",
      "./package.json":      "./package.json"
    }
  dist/readit.iife.js        // 全局 Readit，全量急加载，给 <script> 用户
```

- `.` 是同构引擎，**不得 import 任何浏览器专属内容**——Node 测试或 SSR 宿主 `import { render } from 'readit'` 直接拿 HTML 字符串
- **不在 import 时 `customElements.define`**。导出 `defineReadit(tag = 'readit-view')`，内部 `customElements.get(tag)` 守卫。自动注册会让同页两个版本抛不可恢复的 `NotSupportedError`
- CSS 双形态发布：作为 JS 字符串内联进 `./element`（走 `adoptedStyleSheets`，不要求宿主的打包器配 CSS）**和** `./styles.css`（给 light DOM 消费者）。**不用** CSS module scripts（`import s from './x.css' with {type:'css'}`）——那会强迫每个消费者的打包器支持 CSS import 属性，正是"未知宿主"必须避免的耦合
- CJS 仅为遗留打包器保留在 `require` 条件下，下个大版本移除
- 发布前门禁：`publint` + `@arethetypeswrong/cli`

### 9.4 命令式 API

```ts
mount(el, {
  value, mode: 'read'|'source'|'split'|'plain', shadow: true, theme: 'auto',
  baseUrl, inlineMath: 'github', math: null, highlighter, emojiBase, onNavigate,
  loadHighlighter,
}) -> { setValue, getValue, setMode, setTheme, destroy }
```

**四个模式。** `read` 只读渲染；`source` 用 CodeMirror 编辑源码；`split` 左源码右预览；**`'plain'` 是轻量编辑档——纯 textarea，不加载 CodeMirror**，给「想能改字但不想付 176,654 B」的嵌入方。

⚠️ 本条于 2026-08-09 修订。原文的 `mode` 联合类型只有三个取值，而 §14 的 M4 里程碑行写着交付「`mode:'plain'` 档」——**`'plain'` 从未被定义过，也不在联合类型里**。这是一处真矛盾，且正是计划一栽过两次的那类：实现者对着一个含义不明的词自己猜。

**`find` 不在返回对象里，它属 M6**（`@readit/find`，见 §11.3）。计划一有过一个 `readFrontmatterOptions` 长期是「公共 API 里的永久 no-op」，宿主读了签名接进管线、静默拿不到任何东西。加方法是向后兼容的，留空壳不是。

**`setValue()` 在 CodeMirror 组合期间的语义（`source`/`split` 档；`plain` 档是原生 `<textarea>`，不受影响）。** 若宿主在用户正处于输入法组合过程中调用 `setValue()`，写入被推迟到 `compositionend` 才落地，落地时是**整体替换文档**——不是把新值拼接在组合结果之后，也不会保留用户刚提交的那段输入法文本。也就是说：若外部 `setValue()` 恰好在用户提交组合文本的同一时刻落地，那段刚提交的文字会被静默覆盖。

这是刻意选择的语义，不是疏漏：推迟写入只是为了不打断 CodeMirror 自身的组合状态机（组合期间提前落笔会打断 `view.composing`），不是为了保留用户输入——`setValue()` 在任何时刻都是权威性的整体替换，普通打字过程中被外部 `setValue()` 覆盖同样会丢字，输入法只是让这件事更容易被注意到。**协同编辑同步、外部内容轮询等场景下，中日韩用户首当其冲。** 若某个宿主真的需要"组合期间的输入不能丢"这条更强的保证，这不是一个可以在 `setValue()` 内部悄悄加的修复：外部写入与用户正在输入的内容如何合并（谁的光标位置优先、新文本插在哪）本身就是一个需要产品裁决的问题，而不是把推迟窗口拉长或做一次自动拼接就能回答的。⚠️ **2026-08-11 裁决：维持这一语义**（见 `docs/plans/2026-08-08-plan2-debt.md` 的 D2-18）。这不是「暂未处理」，是一次明确的选择：改成「保留用户已提交部分」需要先定出外部写入与用户正在输入的内容如何合并，那是产品语义变更而非缺陷修复。⚠️ 本条于批次 8（SPEC 同步）补充记录——这是 SPEC 第一次为这个行为写下明确措辞，此前它只活在一条测试断言与代码注释里（`packages/editor/src/codemirror.ts` 的 `applyDeferred()`；断言见 `browser/editor/ime.spec.ts`）。

**`destroy()` 是强制的**，必须拆掉 CodeMirror view、所有 ResizeObserver/MutationObserver、matchMedia 监听。在长生命周期的宿主 SPA 里漏掉这些是可嵌入组件的经典 bug。

---

<a id="s10"></a>

## 10. 桌面壳：Tauri 2.11

Rust 层刻意保持薄：文件 IO、协议处理、窗口/导航、文件关联、文件监听。几乎所有迭代留在 JS 核心里（有热重载）。

### 10.1 配置要点

| 项 | 做法 |
|---|---|
| 资源协议 | 自注册 `readit://` 异步 URI scheme（`register_asynchronous_uri_scheme_protocol`），在 Rust 侧把作用域限定到当前文档所在目录。**不用**内置 asset 协议 + 持久化 scope——静态 glob 作用域对"用户双击任意文件"这个形态是错的。⚠️ CSP 里 `readit:` 和 `http://readit.localhost` **都要加**，两个引擎的 scheme 形态不同，一边对另一边就静默坏图 |
| 文件关联 | `bundle.fileAssociations`，`ext: ["md","markdown"]` + `LSHandlerRank` |
| macOS 打开事件 | `RunEvent::Opened` 的路径存进 `AppState`，前端挂载后来取。**事件在任何 JS 监听器存在之前就触发**（顺序 Opened → Ready → Window），不这么做会间歇性开出空窗口，且随机器速度复现不稳 |
| Windows argv | 直接读裸 argv，**不要当 URL 解析**——Tauri 官方的文件关联示例就是这么错的，会丢掉 `C:\Users\…\file.md` |
| 单实例 | `tauri-plugin-single-instance` 2.4.3，**第一个注册**，早于其他所有插件。第二次调用的 argv 路由进已开窗口的导航历史 |
| 文件监听 | `notify`。⚠️ 原子保存的 rename 语义会骗过朴素 watcher |
| 更新 | 官方 updater + minisign 密钥对 + GitHub Releases 上的静态 `latest.json`。**不依赖 OS 代码签名**，证书没到位也能发更新 |

### 10.2 macOS 的 WebKit 版本

⚠️ **不要写"最低 macOS 14 即得现代 WebKit"**。macOS 14 出厂是 Safari 17.0；Safari 26 是可选的独立更新，不是 OS 版本下限能保证的。要么把下限提到 macOS 15/26，要么运行时从 UA 检测 WebKit 构建号并显式降级/告警。文档里写 **"macOS 14 + Safari ≥ N"**，不写 "macOS 14"。

### 10.3 Mermaid 在 WKWebView 上：真实风险与真实缓解

**WebKit bug 23113（foreignObject + RenderLayer 错位，2009 年开、2026-06 仍确认）是真的，但很窄**：需要 foreignObject 之上有 SVG transform **且**其 HTML 子元素上有诱发图层的属性（opacity/transform）。Mermaid 默认标签两者都不满足。

**不要退到 `htmlLabels: false`。** 那条路更差：#7016 在部分修复合并当天被维护者重开（2026-03-03），#7015（实体码）自 2025-09 未动，#4390 自 2022 年陈旧未决，而失败模式是**静默删除 `<` 和 `>` 之间的文本**。对文档阅读器而言，静默丢内容比偶发布局抖动严重得多。

**真正的缺陷源是测量路径**，这也是"mermaid 看起来坏了"的头号来源：

1. `mermaid.render(id, code)`（**不传第三参**）渲染到离屏但**真实布局**的容器：`position: absolute; left: -99999px`。**不能用 `display: none`**——那在 Chrome/Edge 上也坏（#6652）
2. 渲染前 `await document.fonts.ready`
3. 临时容器的 `font-family`/`font-size` 必须与 shadow root 一致，或显式把 mermaid 的 `fontFamily`/`fontSize` 配成 shadow 样式表里的同一组值。否则每个标签盒都是照着错误字体量的
4. 拿回 SVG 字符串 → 自己过一遍 DOMPurify → 注入 shadow root → `bindFunctions(el)`
5. 对用户 `classDef`/`style` 指令里落到 `node.labelStyle` 上的 `opacity`/`transform`/`filter` 加护栏——那是唯一引爆 WebKit 23113 的路径

**绝不**调用 `mermaid.run({nodes: shadowRoot.querySelectorAll(...)})`——mermaid 通过 `document.getElementById` 解析元素，看不进 shadow root（#6306，维护者已确认）。离屏渲染再注入这个选择是**碰巧唯一可行的路径**。

### 10.4 Mermaid 不进字节级快照

设 `deterministicIds: true` 得到稳定的节点 id，但**这不是完整确定性**：

- `Math.random()` 仍活在 `blockDB.ts`，更要命的是 `scoreLayout.ts` 里——它扰动的是**几何**而不只是标识符
- `deterministicIDSeed` 的实现只用种子字符串的**长度**（源码内 TODO），不同种子等长即碰撞，按文档播种并不能真正区分文档

因此：**Phase A 只快照它发出的占位符**（`<pre class="mermaid">` / 代码块），Phase B 的 mermaid 用结构断言与视觉截图覆盖。这干净地保住了"Phase A 是快照对象"这条边界。

---

<a id="s11"></a>

## 11. 数据流、导航与查找

### 11.1 数据流

```
双击 / readit x.md / 点击 ./other.md
  └→ shell 读字节 + 解析基准目录
      └→ prepare(src)          [唯一 await：扫 $、```math、```mermaid、围栏语言 → 按需 import]
          └→ render(src, opts)  [纯同步：markdown-it → GitHub 形状 hast → 卫生化 → MathJax SVG → 字符串]
              └→ setHtml() 注入 shadow root
                  └→ Phase B：mermaid 渲染注入 · 高亮升级 · 复制按钮 ·
                              锚点桥接 · 链接拦截 · 查找索引构建
```

### 11.2 导航三类

| 类型 | 行为 |
|---|---|
| `./other.md` | 拦截，走元素内部的历史栈；`onNavigate(path)` 回调交宿主决定如何取内容（桌面壳读盘；嵌入方可能走 API）。**前进/后退是元素的能力，不是壳的** |
| `#slug` | **必须拦截。** GitHub 把 `id` 放在兄弟 `<a id="user-content-slug">` 上、`href` 却是不带前缀的 `#slug`，靠前端 JS 搭桥；而在 Shadow DOM 里 fragment 本来就不跨边界。所以：**照抄 GitHub 的 DOM（保①档）+ 自己写桥接（保可用）**，两者不冲突 |
| 外部 `http(s)` | 交系统浏览器 |

### 11.3 查找

**归属：M6。** 查找的实现（`@readit/find`、CSS Custom Highlight API、shadow root 内的 `::highlight` 规则）不在计划二范围内；`mount()` 的返回对象在 M6 之前不含 `find`。

**Shadow DOM 不是问题**——三个引擎的原生 find-in-page 都会遍历 open（乃至 closed）shadow root，WebKit 自 2017 年起如此。

**真问题是 Tauri/WKWebView 在 macOS 上压根没有查找 UI**（tauri#9385，2024-04 开至今 needs-triage）。按 Cmd+F 什么都不会发生。**这是 v1 的实际阻塞项，且没人会替我们修。**

实现：

1. **绝不**建在 `window.find()` 或 `execCommand('FindString')` 上——WebKit 刻意让这两个 API 看不见 shadow tree（`FindOption::DoNotTraverseFlatTree`，bug 158503）。这是最容易踩的坑，因为它看起来像捷径
2. 走自己的文本模型：遍历 shadow root 构建扁平文本缓冲 + `index → (textNode, offset)` 映射，匹配后为每个命中物化 `Range`
3. 高亮用 **CSS Custom Highlight API**（`CSS.highlights.set(...)`）——**零 DOM 改动**，所以 Phase A 的输出字节不变，快照不变量不受影响，且能在 CodeMirror 与 Mermaid 水合之后存活
4. `::highlight(readit-find)` 规则**必须写在 shadow root 内部**——Safari 与 Firefox 不跨 shadow 边界继承高亮样式（csswg#12497）
5. 滚动到命中需手写（`range.getBoundingClientRect()`），API 不提供当前项与滚动语义
6. Safari < 17.2 降级到 `<mark data-readit-find>` 包裹，用 `if (!('highlights' in CSS))` 把它关在常规路径之外
7. **源码模式必须查文档模型而非 DOM**——CodeMirror 6 的视口虚拟化会让任何基于 DOM 的查找静默漏掉屏幕外的行
8. Windows 上 Ctrl+F 被 WebView2 内置查找栏吃掉（那个栏是好用的，含 shadow DOM）。要么在 Windows 让原生栏赢，要么让壳禁用浏览器加速键——注意 Tauri 未再导出 wry 的 `browser_accelerator_keys`，后者需要 wry 层补丁或上游 PR

预算：3–6 KB 手写代码 + 2–3 KB 降级路径，无依赖。

---

<a id="s12"></a>

## 12. 错误处理与安全

**原则：降级必须可见。护栏的误判要变成难看，不能变成静默的数据丢失。**

| 情形 | 行为 |
|---|---|
| LaTeX 非法 | `noerrors`/`noundefined` → 显示原始源码文本。**不能**是空元素，不能抛 |
| Mermaid 语法错 | 显示源码 + 错误提示框（GitHub 也是这样） |
| 围栏语言未知 | 朴素 `<pre>`，不高亮，不报错 |
| 语法包超体积上限 | **已评估，决定不实现**，见设计文档 §5.4.1。最坏语法包（shiki `emacs-lisp`，194.2 KB gzip）比本项目已无条件接受、同样没有闸门的数学包懒加载（~677 KB gzip）还小 3.5 倍，只给三个懒加载大件里最小的那个建闸不自洽；备用的 p90 阈值方案会误伤 `cpp`/`php`/`jsx`/`tsx` 等常用语言。文案仍照原计划定死（`这个代码块的语言包较大（<N> KB），已跳过高亮。[仍要加载]`），逐字记在 `packages/highlight/data/lang-pack-sizes.json` 的 `gate.copyIfEverBuilt`，由 `packages/highlight/test/lang-pack-sizes.test.ts` 盯住，但闸门未建，不导出为 API 符号 |
| 相对跳转文件不存在 | 窗口内错误态，显示解析后的完整路径，后退键仍可用 |
| 原始 HTML | 唯一逃生舱 `allowDangerousHtml: true`（名字在调用处与代码评审中都该读起来像危险品）。**没有 `sanitize: false`** |
| 卫生化边界 | 见 §6.1 |
| oracle 刷新 | 写黄金文件前**必须**断言 HTTP 状态与 Content-Type。否则某天会把一段 277 字节的限流 JSON 当期望输出提交进去 |

**注入路径唯一化**：所有 HTML 入 DOM 走一个内部 `setHtml(el, str)`：

1. `'setHTML' in Element.prototype` → 用 `Element.setHTML()`
2. 否则 `window.trustedTypes` 存在 → 走单一 Trusted Types 策略（`DOMPurify.sanitize(s, {RETURN_TRUSTED_TYPE: true})`）
3. 否则对已消毒内容用 `innerHTML`

**没有第 2 步，任何下发 `require-trusted-types-for 'script'` 的企业宿主里组件直接硬抛**——而且本地开发永远不会暴露。

**两道 sanitizer 的分工**：`hast-util-sanitize`（无 DOM、Node 与浏览器同构，所以快照有意义）是主力，处理 Markdown 管线里的一切；`DOMPurify` 作为浏览器侧第二遍，只处理**运行时由第三方生成、没走过 hast 管线的东西**——具体就是 Mermaid 的 SVG 输出。

---

<a id="s13"></a>

## 13. 测试架构

| 层 | 内容 | 何时 |
|---|---|---|
| **L1 规格一致性** | CommonMark 0.31.2（652 例，140,487 B）+ GFM 0.29（672 例）。`known-failures.json` 白名单，默认全绿，**新增失败即断构建**。⚠️ spec.json 必须从 `spec.commonmark.org/0.31.2/` 直取——npm 的 `commonmark-spec` 包提取器漏了 U+2192→Tab 替换，会静默测错每条 Tab 用例；且 master 分支已有 655 例而发布版 652，只能锁版本化 URL | 本地 <1s |
| **L2 黄金文件** | 对 §4.2 的 oracle。~120 行归一化器（下）。**刷新脚本永不在常规测试路径里跑** | 本地断言 |
| **L2b 数学黄金文件** | 自家冻结黄金文件，锁死 `@mathjax/src` 与字体包版本。**必须是顺序置换测试**，不只是重复测试（§7.3） | 本地 |
| **L3 DOM 断言** | linkedom。oracle 够不着的：数学输出、mermaid 容器、相对路径解析、锚点桥接、卫生化、高亮语言映射 | 本地 |
| **L3b Shadow DOM 挂载** | **真浏览器里挂进 open shadow root 跑同一批断言。** 没有这层，"可嵌入"是唯一一条零覆盖的锁定需求。必测：同页两个实例（style-mod 的 bug 只在这现形）、CodeMirror 里的中日韩输入法组合 | CI |
| **L4 视觉回归** | Playwright 1.62.1，**≤12 张**，只在 `mcr.microsoft.com/playwright:v1.62.1-noble` 里生成基线，自托管 woff2，`animations:'disabled'`，`maxDiffPixelRatio: 0.002`，`deviceScaleFactor: 1`。**外加敌意宿主 fixture**（页面加载 Tailwind Preflight + Bootstrap Reboot）证明隔离是真的 | CI |

### 13.1 归一化器（9 步，与刷新脚本共用）

用 `hast-util-from-html` 解析、遍历、`hast-util-to-html` 序列化：

1. 脱掉 `<div id="file|readme" class="md">` / `<article class="markdown-body …">` 外壳
2. 删非确定性属性：`data-run-id`、`data-identity`；剥掉脚注 id/href 上的 `-<32hex>` 后缀
3. camo 还原：`<img>` 有 `data-canonical-src` 则回写 `src` 并删该属性。⚠️ github.com 与 raw.githubusercontent.com 上的绝对图片**不走 camo、没有该属性**，规则要留它们不动
4. `<svg class="octicon octicon-X">…</svg>` 清空内部 `<path d="…">`（那些 blob 巨大且随 GitHub 更新图标集而变）
5. `<div class="highlight highlight-source-*">` 清到只剩文本——保留 wrapper class（**那才是保真主张：语言识别正确 + 外壳正确**），丢弃 `pl-*` token span
6. mermaid `<section class="js-render-needs-enrichment">` 清到 `<section data-type="mermaid">` + 解码后的源文本
7. 丢 hovercard/mention 噪声：`data-hovercard-*`、`data-octo-*`、`data-error-text`、`data-permission-text`、`data-id`、`issue-link js-issue-link`、`user-mention notranslate`
8. 每节点属性键按字典序排（`diffable-html` **不**做这件事，且它会重排 `<pre>` 内文本从而毁掉代码块比较）
9. 折叠元素间空白，但 `<pre>`/`<code>` 内文本保持字节精确

**额外两条永久预期差异**（不是 bug，是 §4.1 的 D-CAMO / D-LINK）：GitHub 把相对链接改写成绝对 github.com URL，以及把图片 URL 里的 `/blob/` 改写成 `/raw/`。这两类必须在归一化器里显式登记为白名单，否则每个相对链接、每张外链图都是永久 diff。

### 13.2 三条横向要求

- **跨平台矩阵**：路径解析必须在 windows-latest 上也跑——反斜杠、盘符、UNC、`file://` 里空格的百分号编码、大小写不敏感文件系统。纯 Node 逻辑，很便宜。不跑就会让 Windows 路径 bug 一路绿灯发出去
- **离线测试要真能失败**：整套跑在阻断出网的环境里。任何依赖伸手够 CDN 就断构建。starry-night 默认从 esm.sh 拉 WASM 这种事，在联网开发机上**永远测不出来**
- **真引擎才算验收**：Playwright 的 WebKit 是打过补丁的 main 分支构建，**跑在已发布 Safari 前面**——它可能因为一个还没到任何用户手上的修复而通过，也可能因为永不发布的 ToT 回归而失败。它只能当廉价预筛；验收门必须包含真 WKWebView（macOS runner）与真 WebView2（Windows runner）里的一次运行

### 13.3 语料

45–70 个文件，每个小而单一，失败时能自己指出原因。

> **上限于 2026-08-09 由 60 上修至 70**（计划二 D2-1 的测量所迫，实测后修订）。原文的 45–60 是计划一起草时对语料**广度**的估算；真正承重的是后半句「每个小而单一」，那条**未放宽**。
>
> 起因：`imageStyle` 的三声明形式（`max-width: 100%; height: auto; max-height: <N>px;`）此前只有 **1 个**实例支撑（`real-world/mermaid` 的 `<img height="150">`）对 46 个朴素实例，却往**每一个含图片的原生 HTML 文档**里发字节。把它测实需要 8 个各含一个 `<img>` 形态的单目的文件（数值 / 百分比 / CSS 单位 / width+height / 0 / 非数值 / 无 height / markdown 语法），而语料当时正卡在 60 这个上限上（§17.5 已记录「只剩 2 个余量」）。
>
> 把 8 个形态塞进一个文件可以不动上限，但会废掉台账的**逐文件粒度**：任一形态失配就得把整份文件挂上棘轮，其余七个形态的回归检测随之消失。上修上限是两者中代价较小的一个。

- `corpus/gfm/`：每个 GFM 特性一文件——表格（对齐、转义竖线、参差行、含竖线的行内代码）、任务列表、删除线、自动链接、脚注、emoji、tagfilter
- `corpus/github-only/`：alerts（5 类 + 嵌套 + 多段 + 畸形）、frontmatter（标量/列表/多行/畸形/TOML 围栏）、标题锚点（重复 → `-1`/`-2`、标点、emoji、CJK、数字开头）、相对图片与链接（**裸图 / 已被链接包裹的图 / 原始 HTML 图 三种分开**——GitHub 只给"尚未在链接内"的图加 `target="_blank" rel="noopener noreferrer"` 包裹，已链接的图保留作者 href 并加 `rel="nofollow"`）
- `corpus/frontend/`：数学（行内 `$`、块 `$$`、代码段里的 `$` 必须**不**是数学、货币误判）、mermaid（正确/语法错/巨大）、高亮（js/ts/py/rust/diff/未知语言/无语言）
- `corpus/real-world/`：6–10 个真实 README，记录上游 commit SHA
- `corpus/adversarial/`：`karlcow/markdown-testsuite`（**MIT**，103 对，只取输入）。⚠️ **`michelf/mdtest` 是 GPL-2.0，不要 vendor 进一个准备被别人内嵌的库**——这是下游法务会真的拦的东西。另加 cmark 的 `pathological_tests` 输入做**带硬超时的计时测试**：轻量阅读器不能被嵌套括号炸弹卡死
- `corpus/inline-math/`：§8 的 159 条护栏语料 + 5 条具名偏离

### 13.4 跑法

- `npm test`（本地，目标 <10s，**零网络**）：L1 + L2 对已提交 fixture 的断言 + L3。这就是完整的可证伪主张，且完全离线
- CI 每 PR：以上 + L3b + L4（固定容器内）
- **按需**（不再有定时）：`oracle:refresh` → `detect-drift`。在 Actions 页面手动触发
  `oracle-drift` workflow，它刷新 fixture、掩掉三个每次请求都变的随机量
  （`data-run-id` / `data-identity` / 脚注 salt——不掩就每次都报，见
  `packages/core/scripts/salt-mask.ts`）、只在真 drift 上开 PR 并附诊断产物

> ⚠️ **本条于 2026-08-12 修订：夜间哨兵取消，指标随之改写。**
>
> 原文是「CI 夜间/每周，允许响亮失败……对一个验收标准就是『匹配 GitHub』的项目，
> 这正是想要的东西」。那句话把目标读成了**持续跟随 GitHub**，而项目实际要的是
> **产出与 GitHub 的 Markdown 阅读器高度相似**——GitHub 的输出被选作最高参考标准，
> 因为它是这个领域事实上的基准，**不是因为要与它保持实时同步**。
>
> **修订后的指标：保真度对着 `packages/core/test/fixtures/` 这份「钉住的快照」衡量，
> 而不是对着实时的 GitHub。** 快照仍然来自真 oracle（每个目标钉死
> `owner/repo` + 40 位完整 commit SHA + 路径），只是不再每天重抓。
> 「当前一致」就够了；GitHub 日后改了渲染器**不构成回归**。
>
> 三条随之明确：
>
> 1. **语料测试的含义没变**，仍然是逐字节比对 + `known-mismatches.json` 的三向棘轮。
>    棘轮守的是**我们这一侧**的变化（改坏了 / 改好了 / 失配量级变了），
>    那件事与 GitHub 是否漂移无关，**保留**。
> 2. **快照过期是被接受的状态，不是待办。** 只有在主动决定重钉时才刷新，
>    刷新之后要重新判读语料结果——那是一次有意的动作，不是每天的背景噪音。
> 3. **已知的一次上游漂移不追**：2026-08-11 起 GitHub 把 mermaid enrichment 里
>    `<section data-json="…">` 的实体从双重转义（`--&amp;gt;`）改成单重（`--&gt;`）。
>    受影响的 4 个文件本就在 `known-mismatches.json` 里记为 D-MERMAID 全量不匹配
>    （M5 之前 readit 不还原 GitHub 的 mermaid 包装），所以两侧测试都不红。
>    快照保持旧值。
>
> 机器整套留着（`oracle:refresh`、`detect-drift.ts`、`salt-mask.ts`、workflow 本身），
> 只是从「每天叫人」变成「你想看的时候看」。
- **PAT 强制**：未认证 60 次/小时（调研中两个 agent 一天就烧光并吃到 403 锁 42 分钟）。`GITHUB_TOKEN` 在 Actions 里只有 1000/小时/仓库

---

<a id="s14"></a>

## 14. 落地顺序与验收线

### 第 0 步（先于任何技术承诺）

**一天的 spike。** Tauri hello-world 打包上 mermaid + MathJax + CodeMirror + 高亮，在两台真机上：量装机体积、量冷启动与常驻内存、在真 WKWebView 里渲一张非平凡流程图、按一次 Cmd+F。

理由：调研里所有装机体积都是从别人的 app 反推的，那个「12–18 MB」是低置信度自评且 mermaid 一项低估了 3 倍（实测 mermaid.min.js 3.4 MB 而非 1.2 MB）。**这一天把整个壳决策从推测变成事实，是全项目性价比最高的一天。**

### 里程碑

| M | 内容 | 验收 |
|---|---|---|
| **M1** | Phase A 引擎 + L1 + 归一化器 + L2 + oracle 刷新脚本 | 672/672 GFM 减白名单；语料**全部通过，或失配已具名入棘轮台账并附不可修的理由**（见 §15 第 10 条） |
| **M2** | 美元护栏 + 数学 | 159 条护栏语料 154 对、5 条具名偏离；数学黄金文件 + **顺序置换测试**过 |
| **M3** | element + Shadow DOM + L3b + 高亮双默认 | 敌意宿主 fixture 下渲染不变（**达成**，2026-08-12 修复后，见下）；同页两实例测试过（达成） |
| **M4** | 编辑器 + 滚动同步 + `mode:'plain'` 档 | IME 组合测试过（**若 Playwright 无法复现真实输入法行为，降级为手工验证并具名记录为覆盖缺口**——见计划二设计 §4.4） |
| **M5** | Mermaid | 结构断言 + 截图；**不入字节快照** |
| **M6** | 壳：文件关联、单实例、`readit://`、导航、查找、文件监听、更新器 | 双平台**真引擎**冒烟 |
| **M7** | 签名分发 | 见下 |

⚠️ **M3 的「敌意宿主 fixture 下渲染不变」验收线：曾未达成，2026-08-12 已修复并达成（D2-20）。**

这条线一度**被它自己的测试证明为假**——`browser/element/hostile-isolation.spec.ts`
对应的用例带着 `test.fail()`，Chromium 与 WebKit 上都按预期失败。`test.fail()` 现已移除，
两个引擎真绿；L4 的逐像素比对同期从零基线走到全绿，是同一件事的第二个独立证据。

成因是继承属性缺边界重置——**继承穿过 shadow 边界，挡它的从来不是 Shadow DOM，
是一次显式重置**。修复过程本身推翻了两处原始判断，值得留档：

1. **原记为「五项」，实际九项里要重置八项。** 那五项抄自 `browser/support/visual.ts`
   的 `PROPS` 采样表，而那张表漏了 `font-variant-numeric`（探针看不见，截图看得见）；
   `tab-size` 与 `text-size-adjust` 也不在敌意表里——它们来自 Tailwind Preflight
   （敌意页加载、干净页不加载），是 L4 的逐像素比对逼出来的。
2. **重置落点不是 `:host` 而是 `.readit-root`。** 按 CSS Scoping 的跨树层叠，
   宿主的 `* { … !important }` 会压过 shadow 树里 `:host` 的普通声明，挂 `:host`
   就得跟着写 `!important`，等于跟宿主打军备竞赛；`.readit-root` 在 shadow 树内部，
   宿主的 `*` 够不到它。这与 github-markdown-css 挡住 color/font-family/line-height
   的机理一致（它把那三项设在 `.markdown-body` 自己身上）。

**一条具名豁免**：`font-family` **故意不重置**。在根上写死族栈会跟 L4 的字体钉法打架
（`visual-fonts.css` 靠 `::part(root)`/`::part(content)` 钉 `'Noto Sans'` + 文档级
`@font-face` 接管族名），实测会让基线生不出来。残留缺口：真实宿主用
`* { font-family: … !important }` 时，界面外壳（错误面板标题等）的字体会跟宿主走；
正文不受影响。守卫 `packages/element/test/base-css.test.ts` 从 `hostile-extra.css`
**反推**重置清单，豁免表的长度本身也被一条断言钉住。

详见 `docs/plans/2026-08-08-plan2-debt.md` 的 D2-20（已还清）与 D2-22（残留 2px，未还）。

⚠️ **M3 / M4 共同的一条缺口：§13.2 自己定的「真引擎才算验收」从未满足（本条 2026-08-11 补记）。**
§13.2 原文要求「验收门必须包含真 WKWebView（macOS runner）与真 WebView2（Windows runner）
里的一次运行」，理由是 Playwright 的 WebKit 是打过补丁的 main 分支构建、跑在已发布 Safari 前面，
**只能当廉价预筛**。而计划二交付的全部 L3b/L4 job 都只在 `ubuntu-latest` 的
`mcr.microsoft.com/playwright:v1.62.1-noble` 容器里跑 Playwright 自带的引擎。
`test.yml` 的 `unit` job 虽然覆盖 macos/windows，但它跑的是 vitest，从不包含 `browser/*.spec.ts`。

这比「全部 Windows 实测被用户推迟」更宽——**macOS 侧的真 WKWebView 同样从未跑过**，
而且 `docs/windows-test-plan.md` 写于计划二开工前、此后未更新，
所以目前连「以后怎么做真机验证」的计划都不存在。**记为 D2-21。**

⚠️ **M4 的 IME 验收线实际落地情况（2026-08-09 批次 7 实测，本条 2026-08-10 补记）：Chromium 可自动化验证，WebKit 是具名覆盖缺口，且缺口的边界比"4 条用例跳过"更宽。** Chromium 走 CDP `Input.imeSetComposition` + `Input.insertText` 真实驱动组合，不是 `dispatchEvent()` 自我肯定。WebKit 侧：

1. WKWebView 没有等价于 CDP `Input.imeSetComposition` 的入口，四条真机组合测试在 WebKit 上整体 `test.skip`（`GAP-IME-WEBKIT`）。
2. **更宽的那一层**：CodeMirror 与"组合期间的 `setValue()` 被推迟"这条契约用例，在共享契约表（`packages/editor/test/contract.ts`）里就已经按 `kind === 'plain'`（`browser/fixtures/entry.ts`）把 CodeMirror **整条排除**——这与浏览器无关，Chromium 上也一样：CodeMirror 6 的 `view.composing` 只在真的观察到一次组合期间的文本变更时才置真，`dispatchEvent()` 派发的合成事件驱动不了它。

两条排除叠加的净效果：**CodeMirror + WebKit 这个组合下，"组合期间的 `setValue()` 被推迟"这条契约行为没有任何自动化通道验证**，不只是"4 条 CDP 用例跳过"这一层。补偿手段是手工验证，目前尚未有人执行并记录结果——这是一处已知的、具名的覆盖缺口，不是已经完成的验证。

### 实施计划的切分

本文档是**产品级 spec**，覆盖 7 个里程碑，超出单份实施计划的合理体量。切法：

- **计划一：M0 + M1 + M2**（spike + Phase A 引擎 + 快照套件 + 护栏 + 数学）。这是自成一体的一块——交付物是一个可 `import`、可测、可证伪的渲染引擎，且正好是你选定的"引擎先行"验收线
- **计划二：M3 + M4**（element/Shadow DOM + 编辑器）
- **计划三：M5 + M6 + M7**（Mermaid + 壳 + 分发）

每份计划各自走一遍 spec → plan → 实施的循环，本文档是三者共同的上位契约。

**M7 的预算警告**：Apple Developer Program $99/年是硬前提（Sequoia 移除了 Ctrl-click 绕过 Gatekeeper 的路径，未签名意味着要引导用户进系统设置并输管理员密码）。Windows 侧 **Azure Trusted Signing（现名 Artifact Signing）对 EU/UK 个人不开放，只对组织**；若维护者在该辖区，Windows 签名预算要从 ~$120/年 重估到 OV 证书 + 硬件令牌的几百刀/年。不要买 EV 证书——微软 2024 年起取消了 EV 的即时 SmartScreen 信任，OV/EV 现在同样地积累声誉。

---

<a id="s15"></a>

## 15. 诚实的局限

按可能造成困扰的顺序：

1. **数学、Mermaid、20 种主流语言的代码 token 与 GitHub 不同，且永远会不同。** 这不是待办事项，是 §4.1 里的契约。任何把"匹配 GitHub"读作包含这三项的人都会认为 v1 没达标
2. **GitHub 今天用什么解析器无人知晓。** cmark-gfm 已休眠（三年两次提交，135 个未决 issue），commonmarker（由 GitHub 工程师维护）已转向 comrak，但没有任何公开声明说 github.com 换了。若它仍跑 cmark-gfm（CommonMark 0.29 语义）而我们建在 0.31.2 语义上，会有一条长尾的边界差异。**快照套件会抓住它，但要预留一个差异分诊的待办池，别假设为零**
3. **GFM 规格冻结在 0.29（2019-04-06），而所有现代解析器实现 0.31.2。** 约 9 条 emphasis 边界用例是任何 JS 解析器都不可能匹配的。`known-failures.json` 必须从第一天就存在且有据可查，否则"可证伪的保真"会变成不可能通过的标准
4. **Phase A 预渲染的数学不会随窗口 reflow。** 这是相对 GitHub 客户端渲染的真实退步（§7.4）
5. **Mermaid 里的数学走 KaTeX，散文数学走 MathJax。** mermaid 11.16.1 硬依赖 `katex ^0.16.45`。含公式的图会由第二个、不同的数学引擎渲染，产出不同结果，且两个引擎的体积都要付。关掉 mermaid 的数学支持会让这类图直接坏掉，所以选择保留并在此登记为已知不一致
6. **`$…$` 护栏是逆向工程的结果。** GitHub 从未公开其规则。R2 里那条"`(` 是唯一被接受的前置标点"尤其像实现产物，随时可能消失。缓解：把这批规则的来源与逆向过程逐条记在 §8，使它在需要重判时可复核；**并保留按需重抓 oracle 的整套机器**（`oracle:refresh` + `detect-drift`，手动触发）。⚠️ 2026-08-12 修订：原文写的是「CI 里定期重生成语料，把 oracle 漂移当一等信号」——定时哨兵已按 §13.4 取消。指标是「与钉住的快照一致」，GitHub 日后改了这批护栏规则**不构成回归**；真要跟进时手动跑一次即可
7. **视觉与 GitHub 逐像素一致是不可达的**，因为 GitHub 的字体栈在不同 OS 上解析不同。②档只承诺"肉眼一致"
8. **打印 / 导出 PDF 未在范围内**，而 `window.print()` 的行为、分页 CSS 支持与页眉页脚控制在 WKWebView 与 WebView2 之间差异显著——这是 Electron 捆绑 Chromium 的少数实质优势之一。**它是最可能在 v1.1 反过来推翻壳选型的需求**
9. **Windows 上把 `.md` 变成默认打开程序**远比注册文件关联难。`.md` 被 VS Code、Notepad、Typora、浏览器激烈争夺，预计需要自定义 NSIS 注册表工作，且用户仍可能要手动"打开方式 → 始终"。这大概率是"它不工作"类报障的头号来源

10. **语料 100% diff 通过是不可达的，这条验收线原本写错了。**（M1 实测后于 2026-08-08 修订。原文：「语料 100% diff 通过」。）

    计划一实测语料 45/60，修完四个用户可见缺陷后 48/60。剩余失配里有三类**结构性**不可达，不是待办：

    - **Mermaid（4 个文件）** —— GitHub 发 `<section data-type="mermaid">` 由闭源 iframe 渲染。属 M5，设计上就不在 M1 范围。
    - **`data-animated-image`（1 个文件）** —— GitHub 靠**检查图片实际字节**判定动图。Phase A 是纯同步、不碰网络、不读字节的（§3 的承重约束）。要修就得违反核心约束，或在 Phase A 之外新增一道读字节的异步缝。
    - **YAML 诊断文字（1 个文件）** —— GitHub 用 Psych/libyaml，readit 用 js-yaml。对同一段坏 YAML，两者**诊断结论不同**（不只是措辞：libyaml 怪罪开启流序列的 `[`，js-yaml 怪罪流耗尽的位置）。复现它需要内嵌一个 libyaml 兼容解析器，或手写一张 libyaml 错误字符串表。

    更一般的原因：**GitHub 的 HTML 里编码了一些它通过抓取字节才知道的事实。** 一个纯离线渲染器在原理上无法与之 100% 一致。

    **修订后的形态**，与 §14 里 GFM 那条验收线同构：语料**全部通过，或失配已具名入棘轮台账**（`packages/core/test/known-mismatches.json`）**并附不可修的理由**。台账由**三向棘轮**守着——不在名单上的失配断构建；名单内已修好的条目不删除**也**断构建；名单内失配的**量级**（`{hunks, edits}`）变了同样断构建。第二、三向是关键：它们让台账只能缩、不能悄悄烂成静音开关，也让"已失败文件里的新 bug"无处藏身。

    ⚠️ 这条修订**不放宽标准**，它换掉的是一个不可达的标准。判据仍然可证伪，只是从"零失配"变成"零**未具名**失配"。

    **附带发现：这本来是一次有损转录，不是原始设计。** §4 的保真度三档表对①档写的一直是「归一化后对 GitHub blob HTML **100% diff 通过（带具名白名单）**」——限定词从第一天就在。是 §14 的 M1 行把它丢了，计划一的验收线又是从 M1 行抄的。于是一个从来没人打算设的不可达标准，靠两跳转录进入了执行。**跨文档转录一条判据时，把限定词一起带上，或者干脆引用而不复制。**

---

<a id="s16"></a>

## 16. 决策台账

记录每个岔路口选了什么、以及**被否决的替代方案与否决理由**。

| # | 岔路 | 选定 | 否决的替代 | 否决理由 |
|---|---|---|---|---|
| 1 | 黄金样本源 | `/contents` + `vnd.github.html` + `?ref=<sha>` | `POST /markdown` (gfm) | 有 alerts 无锚点，且 `data-run-id` 每次请求随机 |
| | | | `POST /markdown` (markdown) | 有锚点但 alerts 退化成引用块、任务列表退化成字面 `[x]` |
| | | | 抓 github.com 页面 | React 渲染、标记埋在 JSON 里、CSS 包每周变 |
| | | | 把 GFM 0.29 规格当契约 | 7 年未修订，只定义 5 个扩展，不含脚注/alerts/数学/frontmatter/emoji |
| 2 | 解析器 | markdown-it 15.0.0 | comrak-wasm（运行时） | 381 KB gzip 换 672 条里的 10 条；返回整块 HTML 字符串故无法增量重渲；npm 包是单人维护的 pre-release，落后 crate 8 个月 |
| | | | marked 18.0.9 | 最小最快，但在字节级快照下光松散列表的空白就丢 ~70 例 |
| | | | remark/micromark | 41 KB 文档 80 ms（markdown-it 6.6 ms），超帧预算 5–7 倍；`rehype-raw` 会把表格压成一行毁掉快照；`rehype-github-alerts` 为 5 个图标拖进 3.9 MB 的 @primer/octicons |
| | | | cmark-gfm 编译 WASM | **不存在**可用构建。npm `cmark-gfm` 是 node-gyp 原生绑定；`cmark-gfm-js` 8 年陈旧 |
| 3 | 桌面壳 | Tauri 2.11.5 | Electron 43 | 运行时本身 116–140 MiB，三个同类应用实测 105–235 MiB。保留为兜底 |
| | | | Wails v3 | 仍 beta；用**同样**的系统 webview 故承担同样的保真风险，还多一套 Go 工具链 |
| | | | Neutralino 6.9.0 | 同为系统 webview；文件关联/签名/更新是社区配方而非一等支持 |
| | | | Tauri + CEF / Verso | alpha / 实验；捆绑 Chromium 就抹掉了选 Tauri 的理由 |
| | | | 等 Tauri 3 | 里程碑 31%、无期限，内容是 Linux GTK4 迁移，不改变 macOS/Windows 渲染 |
| 4 | 数学引擎 | MathJax 4.1.3 | KaTeX | 与 GitHub 不同源；后期用户改选 MathJax |
| 5 | 数学输出 | SVG + `fontCache:'none'` | CHTML | 自适应样式表是文档级、顺序依赖、单调增长（11,458→19,037）；确定性模式在 Node 无法同步构建；另需内置 ~1.8 MB woff2 |
| | | | `fontCache:'local'` | 发出自增 id，同公式两次渲染字节不同 |
| | | | `fontCache:'local' + localID` | 字节稳定且小 14%，但固定前缀让全页容器共用同一批 id，`<use href="#…">` 会解析到文档中第一个匹配——删掉一个容器会静默弄坏其余 |
| 6 | 数学字体 | `mathjax-tex-font` | `mathjax-newcm-font`（v4 默认） | 40 个懒加载块，`\mathbb`/`\mathcal`/`\mathsf`/`\mathtt`/非 ASCII `\text{}` 同步渲染直接抛错；要覆盖等价范围需 base + 全部 40 块 ≈ 3.5 MB gzip，约 6 倍差 |
| 7 | 高亮器 | 双默认（starry-night / Shiki） | 全场景 starry-night | 嵌入常驻从 ~110 KB 涨到 ~430 KB gzip，而实测在 JS 上 class 依然对不齐 |
| | | | 全场景 Shiki | 桌面端白白放弃免费的保真度（本地磁盘，WASM 成本≈0） |
| | | | highlight.js | token 词汇与 GitHub 分歧且无成员访问 token；且有一个 2026-07-31 的 ReDoS 修复卡在未发布的 main 里 |
| | | | Prism | 语法最弱；v2 三年未发布 |
| 8 | 隔离 | Shadow DOM `open` | light DOM + 类名前缀 | 宿主的 Tailwind Preflight / Bootstrap Reboot 会级联进来，隔离下通过的快照证明不了真实嵌入 |
| | | | iframe | 破坏高度自适应、页内查找、跨界选择、复制粘贴、链接导航、无障碍树连续性 |
| 9 | 卫生化 | hast-util-sanitize 主 + DOMPurify 辅 | 只用 DOMPurify | 需要 DOM → Node 侧要 jsdom（7.1 MB），测试与运行时两套代码路径，破坏可证伪性 |
| | | | 一遍扫全树 | 会把自家的 alert / 高亮 / 数学标记全铲掉（GitHub 白名单里 `class` 和 `style` 出现次数为零） |
| 10 | Mermaid 标签 | `htmlLabels: true`（默认） | `htmlLabels: false` | 用一个布局抖动换三个开着的**静默删除 `<`…`>` 之间文本**的 bug（#7016 修复当天被重开、#7015、#4390） |
| 11 | Mermaid 渲染路径 | 离屏 `mermaid.render()` 再注入字符串 | `mermaid.run({nodes: shadowRoot…})` | mermaid 用 `document.getElementById` 解析元素，看不进 shadow root（#6306） |
| | | | 传 shadow 内元素作第三参 | mermaid 全代码库 0 处 `shadowRoot`、0 处 `adoptedStyleSheets`，任何可行的 shadow 安排都是"碰巧不坏"，上游重构不会当回归处理 |
| | | | `display:none` 的离屏容器 | 在 Chrome/Edge 上也坏（#6652） |
| 12 | 查找 | 自建文本模型 + Custom Highlight API | `window.find()` / `execCommand` | WebKit 刻意让这两个 API 看不见 shadow tree（bug 158503） |
| | | | 依赖原生查找 | Tauri/WKWebView 在 macOS 上根本没有查找 UI（tauri#9385） |
| 13 | 护栏位置 | markdown-it **core** rule | inline rule | core rule 的位置白送了代码段/围栏/href/alt 免疫与不跨行，inline rule 每一条都要单独处理 |
| 14 | 护栏平局裁决 | R7 放弃开启符 | 贪心右找合法闭合符 | 贪心会吃掉代码段；同语料 104/159 vs 154/159 |
| 15 | 对抗语料 | 只取 karlcow（MIT） | vendor michelf/mdtest | **GPL-2.0**。对一个要被别的项目内嵌的库，下游法务会拦 |
| 16 | 元素注册 | `defineReadit(tag)` | import 时自动 `define` | 同页两个版本抛不可恢复的 `NotSupportedError` |
| 17 | CSS 分发 | JS 字符串 + `adoptedStyleSheets`，另供 `.css` | CSS module scripts | 强迫每个消费者的打包器支持 CSS import 属性，正是"未知宿主"要避免的耦合 |

---

<a id="s17"></a>

## 17. 实测修订台账（计划一起草期间）

本节记录在编写计划一（`docs/plans/2026-08-06-plan1-engine.md`）过程中，**通过真实运行代码与真实调用 GitHub API 发现的、与本文档正文冲突的事实**。七个起草组各自在临时目录里装了锁定版本的依赖并真的跑通了代码，下列每一条都有实测依据。

**与正文冲突时，以本节为准。** 正文保持原样不改写，是为了让"当初怎么想的"与"实际是什么"都留在记录里。

### 17.1 §6 渲染规则表的修订

| 条目 | 正文说法 | 实测 |
|---|---|---|
| #6 `dir="auto"` | "铺到每个块级元素" | **覆盖面窄得多。** 跨 3 份真实 README 全量统计：`p` 32/32 有、`h1`–`h6` 20/20 有、`ul`+`ol` 6/6 有；而 `blockquote` 0/3、`li` 0/37、`table` 0/1、`pre` 0/4、`hr` 0/2、`td` 0/4、`tr` 0/2、`thead`/`tbody` 0/1 **全都没有**。另有一条真实例外：带 `contains-task-list` 的 `ul` 上**没有** `dir`（10/10） |
| #7 标题锚点 | 示例里的 svg 只有 `class` | svg 上有 `data-component="Octicon"`，且**排在 `class` 之前**。正文在 #8（alerts）提到要补这个属性，#7 漏了 |
| #9 frontmatter | "标量单元格套 `<div dir="auto">`" | **只对嵌套层成立，顶层 `<td>` 不套**（hugoDocs 两份 blob 逐字节确认） |
| #10 emoji | "码点须从 `unicode/<hex>.png` 文件名解析" | **不成立。** 全量 1913 个跑下来只对 1690 个——文件名吞掉了 U+200D 与 U+FE0F。字符必须取自 oracle 返回值。另有 29 个带 `<g-emoji class="g-emoji" alias="…">` 包裹，blob 视图里**真的存在**（实测 `GET /repos/yt-dlp/yt-dlp/readme`） |
| #11 代码块 | 给了单一形态 `<pre class="notranslate">` | **blob 视图有三种形态。** 可识别语言那种的 `<pre>` **没有** `class="notranslate"`、**没有** `<code>`；非高亮的两种**没有** `dir="auto"`。正文写的那个是 `POST /markdown` 的形态 |

**§6 表格需要新增两条规则**（正文的 14 条不完整）：

| 新 # | 规则 | 实测依据 |
|---|---|---|
| 15 | 外部 **http(s)** 链接加 `rel="nofollow"`；指向 `github.com` / `www.github.com` / `gist.github.com` 的不加；**协议相对**外链（`//example.com/x`）**加**；**`mailto:` 三种形式全部不加** | ⚠️ **本行经 2026-08-07 实测修订。** 原文写的「外部链接与**全部自动链接**」是从 http(s) 自动链接的实测**过度推广**——`mailto:` 从未被直接测过。执行 Task 33 时用一次 `POST /markdown`（mode: gfm）直接采样定案：显式 `[a](mailto:…)`、裸邮箱扩展自动链接、尖括号 `<mailto:…>` 自动链接，**三种形式在真实 GitHub 上全都不带 `rel`**。照原散文实现会**引入**一个与 GitHub 的偏离，而非消除。同批采样另外确认：协议相对外链确实加 `nofollow`（原实现因正则要求显式 scheme 而漏掉，已修）；`www.github.com` 与 `gist.github.com` 的豁免此前是推断，现为直测 |
| 16 | 每个 `<img>` 加 `style="max-width: 100%;"` | 确定性行为，所以**不能靠归一化器抹掉**——readit 必须自己发，否则每张图都是永久 diff。注意这与 §6.1「GitHub 白名单里 `style` 出现零次」不矛盾：那说的是**用户写的** `style` 被剥掉，GitHub 自己会注入这一条 |

### 17.2 §4.1 偏离清单的修订

- **D-LINK 与 D-CAMO 的相对 URL 改写在 oracle 端点上不发生。** 实测：github/docs README 里 `[LICENSE](LICENSE)` 在 `contents` + `Accept: application/vnd.github.html` 的返回里仍是 `<a href="LICENSE">`；tauri 的 `<img src=".github/splash.png">` 也没有 `/blob/`→`/raw/` 改写。相对 URL 重写是 **github.com 那个 React blob 页面**的行为，不是这个 API 的。归一化器里那两条白名单仍然实现（幂等、当前是 no-op、将来 GitHub 真改了也不会炸），但**不能再把它们当作"每个相对链接都是永久 diff"的理由**
- **camo 确实发生**：外链图片在 oracle 里是 `src="https://camo.githubusercontent.com/<64hex>/<hex>"` + `data-canonical-src="<原 URL>"`
- **新增偏离 D-AUTOLINK-EM。** GitHub 有一个下划线强调与自动链接交互的怪异行为，实测（同一次请求的不同段落）：`x _www.b.com_ y` **不**链接、`x _www.b.com a_ y` 链接、`x __www.b.com__ y` 不链接、`x **www.a.com** y` 链接、`x _http://b.com_ y` 不链接但 `x _foo@bar.baz_ y` 链接。用 cmark-gfm 的 postprocess-text-node 模型、raw-source 模型、Rinku-over-HTML 模型都推不出这个组合，它更像 GitHub 现役解析器的一个 off-by-node 缺陷。**readit 一律链接（与 GFM 规格一致），并把这条登记为具名偏离；语料里 autolink 那几个文件避免出现 `_…_` 包裹的 www/url**

### 17.3 §7 数学的修订

- **§7.3 第 3 条"每份文档一个全新 MathDocument"不够，必须是"每条公式一个全新 MathDocument"。** 实测证据：同一个 MathDocument 里先 `convert('\newcommand{\zz}{\alpha}\zz')` 再 `convert('\zz')`，第二条渲染出的是 α 字形（`data-c="1D6FC"`，宽 1.448ex），而隔离渲染得到的是 `noundefined` 画的红色字面 `\zz`（宽 3.14ex）。按正文字面实现，顺序置换测试必红。代价实测约 1 ms/公式（100 次二次公式 display 渲染 97.1 ms），换来逐公式黄金快照可组合 + 第三方 README 的宏炸弹面归零
- **§7.5 的 `skipAttributes` 建议行不通。** 实测 `new SVG({ skipAttributes: { 'data-latex': true } })` 直接打印 `MathJax: Invalid option "data-latex" (no default value).` 并被忽略；`grep -rn "options.skipAttributes" node_modules/@mathjax/src/mjs/` 零命中——SVG wrapper 只读类静态 `SvgWrapper.skipAttributes`，那是个全局，改它会污染同进程所有 MathJax 实例。改用一个纯的、每次渲染都跑的 lite-DOM 遍历把 `data-latex` / `data-latex-item` 递归摘掉，效果与原意图相同
- **§3.2 写的降级标记少了一个属性。** GitHub 真实吐出的是 `<math-renderer class="js-inline-math" style="display: inline-block" data-run-id="…">$x^2$</math-renderer>`。归一化器第 2 步已列 `data-run-id`，但**没列 `style`**——要么进归一化器，要么 readit 照发，否则每条行内数学都是永久 diff
- **SVG 样式表恰好 5,884 字节且五次转换恒定，与 §7.4 完全一致。** 但它内部有一处 `content: "\A";`，**用模板字符串 vendor 会静默丢掉那个反斜杠变成 5,883 字节**。生成脚本必须走"每行 `JSON.stringify` 后 `join('\n')`"

### 17.4 §8 美元护栏的修订

- **R3 需要一处收窄，否则 R8 不可达。** 照 R3 字面"开启符右侧不得为未遮罩的 `$`"，`$$$$` 会在 R3 就被拒，R8 永远走不到，`ruleId` 联合类型里的 `'R8'` 成为死枝。修正：R3 的"不得为未遮罩 `$`"**只作用于单字符 `$` 开启符**，`$$` 开启符的右侧允许是 `$`，交给 R8 判空。语料上零影响
- **§8.6 的 `'off'` 是运行期 no-op，不是"不注册该规则"。** 因为规则契约 `applyXxx(md)` 没有 options 形参，配置只能在运行期从 `env.readit` 读。行为等价，但这样同一个 md 实例才能服务不同选项，对 `render(src, opts)` 这个纯函数签名是必要的
- **一个未决边界：HTML 实体形式的美元号会当定界符。** `pre &dollar;x+y&dollar; end.` 目前产出一个数学段。原因是 §8.2 的 mask 定义严格限定为"markup 以 `\` 开头的 text_special"，而实体的 markup 是 `&dollar;`。起草时**照字面实现、没有擅自扩大 mask**。不在 159 条语料里，GitHub 真实行为未知。**列为待决条目而非悄悄改**
- **`$$…$$` 行内展示缺少 oracle 佐证。** 159 条里只有 2 条含 `$$`，且 GitHub 两条都判为"不是数学"。正向行为 `$$a+b$$ → 一个 display span` 只有按 §8.4 写的单测撑着。值得再抓一批 `$$` 的 GitHub 输出补进语料

### 17.5 §13 测试架构的修订

- **§13.1 第 6 步的 mermaid 描述是错的。** 真实形态是：一个 `<div class="highlight highlight-source-mermaid …">` 装源码，**紧跟着**一个 `<section class="js-render-needs-enrichment …" data-identity="<uuid>" data-type="mermaid">`；而**源码在内层 `<div class="js-render-enrichment-target">` 的 `data-plain` 属性上，不在 `<section>` 上**。第 2 步删 `data-identity` 是对的
- **§13.1 需补一步：删 `data-line`**（readit 自有产物，GitHub 没有）
- **§13.1 第 4 步的选择器要注意**：GitHub 的 octicon svg 首个属性是 `data-component` 而非 `class`，写选择器时按 class 属性**匹配**而不是按"以 class 开头"匹配，否则会漏掉全部 octicon
- **§13.4 的限流描述不完整**：`POST /markdown` 与 `GET /repos/...` 走**不同的**限额桶。实测 7 次 POST 跑完后 `GET /rate_limit` 显示 core 桶仍是 `used: 7`。"未认证 60 次/小时"只约束 core 那一桶
- **§13.3 的语料规模只剩 2 个余量**：实测 58 个（gfm 12 / github-only 25 / frontend 15 / real-world 6），上限是 60。§8 的 159 条护栏语料是独立一类，**必须排除在快照发现范围之外**，否则直接冲破上限
- **L1 规格套件需要且只需要一条归一化**：规格文件发 XHTML 自闭合 `<br />`，readit 用 `xhtmlOut: false`（GitHub 发 `<br>`）。不归一化的话 CommonMark 只有 591/652，其中 58 条纯粹是这个配置差异。加一条只对 13 个空元素名（HTML5 现行空元素集；param 已从规范移除）生效的归一化，其余保持字节级比较。**这条要写死，别让后来的人以为可以随手往里加更多归一化**——那会把保真度测试悄悄稀释掉

### 17.6 §5 定版表的补充

**新增运行时依赖**：`js-yaml@4.1.0` + `@types/js-yaml@4.0.9`（frontmatter 解析）、`@types/hast@3.0.5`（类型）。

**新增 devDependency**：`@wooorm/starry-night@3.10.0` —— 只给 `scripts/build-lang-scopes.ts` 用，**运行时零引用**（计划一里还没有高亮器）。

**明确不进依赖**：`markdown-it-github-alerts@1.0.1`。读完它 4,785 字节的 dist 后确认与 GitHub 有五处行为分歧（同行标题当 title、穿透嵌套引用块、不检查层级、空 alert、`\[!NOTE]` 也命中），补两个属性解决不了任何一处。有价值的只有 5 个 octicon path 字符串，已比对为字节相同并抄成冻结常量。

**§5.1 体积预算需上修**：`data/emoji.json` 44,795 B + 23 个自定义 emoji PNG 共 106,492 B + `data/lang-scopes.json` 30,318 B。其中 JSON 会静态进 core bundle（gzip 后小得多），PNG 在打包时拷到 `dist/emoji/` 而**不内联成 data URI**——23 个 PNG base64 后约 142 KB，会直接撑爆 §5.1 的 60–70 KB 引擎预算。

### 17.7 M0 Spike 实测：壳体积（替换 §5.1 与 §14 的反推估算）

2026-08-07 在 macOS 26 / arm64 上实测（Windows 部分按项目所有者要求推后）。Tauri 2.11.5 + Rust 1.97.1，四个大件**真实渲染**（不是仅 import——已用主 chunk 内的依赖指纹排除 tree-shake）。

| 项 | 实测 | 计划原投影 |
|---|---|---|
| `.dmg`（arm64，非 universal） | **5,270,073 字节 = 5.27 MB** | 12–18 MB（且自评低置信度） |
| `.app` 总计 | 12,502,515 字节 | — |
| 主可执行文件 | 12,403,088 字节 | — |
| 前端 `dist/` 总计 | 8,572,855 字节 | 4–7 MB |

`dist/` 归因：主 chunk 5,258,289 + `onig.wasm` 473,151 + 约 60 个 mermaid 图表类型懒加载块 2,797,272 + CSS 1,739 + 其他 42,404。

单依赖体积（raw / gzip -9）：mermaid 3,454,019 / 945,054 · MathJax 2,753,833 / 1,021,319 · starry-night JS+wasm 1,839,848 · CodeMirror 507,485 / 174,449 · 空基线 1,773。

**结论：Tauri 决策成立。** 实测比最乐观投影还小一半以上，远低于计划设定的 25 MB 重估阈值。

⚠️ **这个数字是悲观上界而非最好情况**：探针在顶层 import mermaid，因而打包了全部约 60 个图表类型块（2.8 MB），而测试只渲染了流程图一种。SPEC §5.1 要求的按需懒加载落地后会更小。

**其余实测**：

- **Mermaid 在真实 WKWebView 里正常**。12 节点 + 长标签 + 子图 + 一条 `classDef` 的流程图，用应用内 `getBoundingClientRect()` 读几何数据，**无标签溢出、无裁切**——WebKit bug 23113 未在默认标签上触发，与 §10.3 的判断一致。（截图路径未采用：`screencapture` 返回的是无关的其他会话画面，已立即删除且未重试。）
- **Cmd+F 确认无任何反应**，与 §11.3 的判断一致。除交互验证外另有结构佐证：`wry` 的 `NSTextFinderClient` 实现只存在于 iOS 路径，`muda` 无任何 find 菜单逻辑。**这坐实了「readit 必须自建查找」是 v1 必做项而非可选优化。**
- **常驻内存约 514 MB**（主进程 + WebKit 的 GPU/Networking/WebContent XPC 辅助进程，非单 PID 读数），测于四个大件**同时渲染**的压力场景。这是天花板不是稳态——§5.1 要求它们全部懒加载。⚠️ 但该数字与「轻量」的距离值得在定 M6 内存预算前**单独再测一次稳态**。这是本次 spike 唯一没有被体积结论覆盖的风险。

### 17.8 一条独立的交叉验证

L1 规格套件实测：CommonMark 0.31.2 **649/652**（白名单 3 条，全为 markdown-it 空引用块少一个换行）；GFM 0.29 **644/672**（白名单 28 条 = 14 PERMANENT + 14 TEMPORARY，TEMPORARY 全部由计划一的 Task 10–13 消化）。

其中 **9 条 emphasis 失败**与 §15 局限第 3 条"约 9 条 emphasis 边界用例是任何 JS 解析器都不可能匹配的"**独立吻合**。那条局限当初是从规格版本差（GFM 冻结在 CommonMark 0.29、现代解析器实现 0.31.2）推理出来的，现在被真实运行的数字确认了。

---

## 附录 A：本文档如何产生

先经 brainstorming 逐点锁定 6 个需求决策与 3 个方案决策；再由两轮多智能体工作流并行调研 9 个技术方向（GitHub 渲染管线、解析器选型、桌面壳、编辑器与高亮、嵌入工程、保真测试、MathJax、美元护栏、平台风险），每个方向配一名对抗式复核 agent 独立复验其承重论断。合计 16 个 agent、约 121 万 token、744 次工具调用。

复核推翻了首轮 30 余条论断，其中改变设计的包括：数学字体从 newcm 换成 tex-font（消解了"最大的坑"）、SVG 样式表并非可省（首轮称 SVG "完全绕开 Shadow DOM 问题"是错的）、`\unicode` 注入在 v4 已修而真正的活向量是 `html` 包、starry-night 的常驻成本被低估 6–8 倍、Playwright WebKit 不是可用的验收引擎、macOS 14 并不保证现代 WebKit、`htmlLabels:false` 比它要规避的 bug 更危险、mermaid 尺寸被低估 3 倍。

所有被否决的替代方案与理由见 §16。
