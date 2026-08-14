# readit 计划三（第一段）：M5 Mermaid + M6 的 macOS 部分

**日期**：2026-08-13
**基线提交**：`186343a`（`main`），`npm test` 2794 通过 / 77 文件 / 0 失败
**范围**：M5 全部 + M6 的 macOS 部分。**M7 不在内**（见 §1.3）。Windows 不在内（用户已推迟）。

---

## 0. 先读（Codex 没有此前的上下文）

### 0.1 项目是什么，已经做到哪

readit 是一个 Markdown 阅读/编辑组件，目标是**产出与 GitHub 的 Markdown 阅读器
高度相似的输出**，既能给人用、也能被别的项目嵌入。GitHub 的输出是最高参考标准，
保真度对着 `packages/core/test/fixtures/` 这份**钉住的快照**衡量（不是实时 GitHub）。

已交付 M0–M4：Phase A 渲染引擎（纯同步）、美元护栏与数学、Web Component
（Shadow DOM / 主题 / 四模式）、编辑器（CodeMirror 与 plain 双档）与滚动同步。
六个包：`core` / `element` / `editor` / `highlight` / `math` / `readit`（发布外观包）。

**这一段要加的是 Phase B 的最后两块（mermaid、查找）和第一个真正的桌面壳。**

### 0.2 两条承重约束（违反了就是拆地基）

**Phase A 纯粹同步、纯粹确定。** `render(src, opts) -> string`：无 DOM、无网络、无 I/O、
**无时间、无随机**。整条渲染路径上唯一允许 `await` 的是 `prepare()`。
守卫是 `packages/core/test/no-await-on-render-path.test.ts`——它现在是
TypeScript AST 扫描（三类：时间/随机、同步 I/O、模块状态写入）+ 公共默认容器的
运行时冻结检查。**这条对 M5 直接有后果**：Phase A 不能生成 UUID、不能调 mermaid。

**保真度由三向棘轮守着。** `packages/core/test/known-mismatches.json` 记 12 条具名失配，
三个方向都断构建：不在名单上的失败 / 名单内修好了 / 名单内失配量级变了。
**看到台账相关的红先判断方向，不要改名单让它变绿。**

### 0.3 ⚠️ 这个项目最常见的失效模式

**「声明的广度由做声明的人自己选定」，而它倾向于错。** 这条代码库为它栽过**至少十次**：

- `imageStyle` 的三声明形式源自 **1 个**实例，实测七种形态里错了四种，全部产出非法 CSS。
- 第 1 级消毒器审计声称「逐元素逐属性 diff 到**零差异**」，漏了 `<g-emoji>`。
- 一条测试标题写「覆盖的元素**一个不少**」，而它查的是内容不是标签本身，
  浏览器对未知元素是 unwrap，**那条断言在结构上就测不出来**。
- 一条泄漏护栏跑 50 次挂载/销毁断言「监听器归零」，而循环里 `setMode()` 没 await，
  **CodeMirror 从未被构造出来**——护栏是空的。
- 上一份 spec 写「Phase A 纯度的另一半**性质今天成立**」——实测推翻，有三处真的不纯。
  **那句话出现在一份专门警告这个模式的文档里。**
- **本文档写作时又发作一次**：债务台账声称「M5 落地后那四条 D-MERMAID 会自动清偿」，
  实测 GitHub 的 mermaid 输出是指向它自家托管服务的富化外壳，**清不掉**（见 §2.1）。

**所以对你的要求：**

1. 写「完整 / 全部 / 一个不少 / 零差异」前，先问**广度是谁定的**、
   **验证它的东西和被验证的东西是不是同源**。
2. 能枚举就不要抽样。
3. **新增或修改任何断言后，必须验证它真的会红**——临时把被测行为改坏，看它红，
   再改回来看它绿。没做这一步的断言等于没写。
4. 报告写**实际跑过的命令与输出**，不写「应该没问题」「预期通过」。

### 0.4 会咬人的具体陷阱

| 陷阱 | 说明 |
|---|---|
| `packages/element/src/styles/base-css.ts` 的反引号 | `BASE_CSS` 是模板字面量，CSS 注释在它**内部**。注释里用反引号引代码会提前闭合字面量。已有断言钉住「全文件只许两个反引号」。**注释里引代码用双引号。** |
| 裸子串守卫 | `test/ci-wiring.test.ts` 断言 `test.yml` 里不出现 advisory-job 那个 key；`test/browser-wiring.test.ts` 断言它在 `browser.yml` 里**只出现一次**。注释里提到那个词也会被计数。 |
| 公共导出面已被钉住 | `packages/readit/test/public-surface.test.ts` 逐字钉住 7 个子路径与每个子路径的运行时符号集。**新增公共导出必须显式改那份清单并在提交信息里说明为什么。** |
| 测试文件归属 | `*.test.ts` = vitest；`*.spec.ts` = Playwright。放错不会被跑。 |
| `npm test` 全程离线 | `test/setup/no-network.ts` 拦截 fetch/socket/dns。**测试里不要发网络请求。** |
| happy-dom 的 URL 缺陷 | 全局 `URL` 对「相对路径 + file: base」解析有 bug。测试里取路径用 `dirname(fileURLToPath(import.meta.url))` + `node:path`。 |
| 提交身份 | 已配置为 `mmy420`，直接 `git commit`，**不要改 git 配置**。 |
| 暂存 | **显式列路径，绝不 `git add -A`**。 |
| L4 视觉基线 | 只能在 `mcr.microsoft.com/playwright:v1.62.1-noble` 里生成（`npm run visual:baseline`，需要 docker），**本机跑视觉比对必然与 CI 不同**（macOS 字体栈不同）。新增基线要走那条路。 |

### 0.5 四条不变量——任何一条变了都是回归

```bash
npm test          # 期望 77 文件 / 2794 通过 / 0 跳过 / 0 失败
npm run typecheck # 6 包 + 根 + browser/ 零错误
npm run test:perf # 5 通过 / 1 跳过（校准专用那条按需跑）
```

| 不变量 | 当前值 |
|---|---|
| 语料精确匹配 | **56/68** |
| 棘轮台账条目 | **12** |
| CommonMark | **649 + 3 白名单** |
| GFM | **658 + 14 白名单** |
| `TEMPORARY` | **0** |

**任何一条动了，停下来上报，不要自己重钉。**（M5 可能合法地改动台账——见 §2.1，
但那必须是裁决过的、写在提交信息里的动作。）

### 0.6 卡住了就停下来上报

**阻塞上报是正确做法，不是失败。** 若发现本文档的前提与实测不符——某个文件不是它
说的那样、某条 SPEC 描述与代码矛盾——**停下来说**，不要按错误前提硬做。
本文档写作时已实测过所有引用的文件行号与 SPEC 条款，但仍以你的实测为准。

---

## 1. 现状与范围

### 1.1 mermaid 的现状（实测）

- **Phase A**：``` ```mermaid ``` 围栏渲染成普通高亮代码块：
  `<div class="highlight highlight-source-mermaid …" data-snippet-clipboard-copy-content="…"><pre>…</pre></div>`
- **`scan()`** 已经返回 `needsMermaid`（`packages/core/src/prepare.ts:33`），
  但**全仓没有任何消费者**——有生产者无消费者。
- **element 侧零接线**：`PendingCapability = 'math' | 'highlight'`
  （`packages/element/src/rerender.ts:64`），mermaid 不在其中。
- **台账里 4 条 D-MERMAID**：`frontend/mermaid-{large,syntax-error,valid}`、`real-world/mermaid`，
  分类是 `deviation`，说明写的是「wrapper shape」差异。

### 1.2 查找的现状

`@readit/find` 是 SPEC §5 包表里的一个包（「查找（Phase B）—— M6，无依赖」），
**尚不存在**。`mount()` 的返回对象目前是
`{setValue, getValue, setMode, setTheme, destroy}`——**不含 `find`**，这是 M6 之前
SPEC 明确要求的状态，且有 `test/spec-sync.test.ts` 钉着。

### 1.3 为什么 M7 不在这一段

M7（签名分发）不是工程问题：Apple Developer Program $99/年是硬前提；Windows 侧
**Azure Trusted Signing 对 EU/UK 个人不开放、只对组织**，若维护者在该辖区预算要
从 ~$120/年 重估到几百刀/年。**不要买 EV 证书**——微软 2024 年起取消了 EV 的即时
SmartScreen 信任。这些是预算与辖区决定，做完 M5/M6 再谈。

---

## 2. ⚠️ 三条要先裁决的（Codex 不要自己定）

**这三条在动手前必须拿到用户答复。** 三条均已于 2026-08-13 裁决：§2.1 选分支 A；
§2.2 产品下限定为 macOS 14 + Safari ≥ 17.2（真 WKWebView Mermaid 矩阵仍保留为
手工验收，若测出更高下限则上调）；§2.3 能自动化的自动化，六项真机行为写入具名手工
清单，未实际勾选前不得记为通过。

### 2.1 【最重要】mermaid 的 Phase A 输出形状

**事实（2026-08-13 实测）**：GitHub 对 mermaid 围栏发的是

```html
<section class="js-render-needs-enrichment render-needs-enrichment position-relative"
         data-identity="054e6583-aded-42eb-b265-dfbc606a9743"
         data-host="https://viewscreen.githubusercontent.com"
         data-src="https://viewscreen.githubusercontent.com/markdown/mermaid?docs_host=…"
         data-type="mermaid" aria-label="mermaid rendered output container">
```

这是**指向 GitHub 自家托管渲染服务的富化外壳**。归一化器
（`packages/core/test/normalize.ts:36`）会丢掉 `data-identity`
（它在 `NONDETERMINISTIC_ATTRS` 里），但**不丢** `data-host` / `data-src` /
`js-render-needs-enrichment` 类。

**因此债务台账里那句「M5 落地时这四条是债务清偿」是错的**，或至少远不是自动的。
两个分支：

| 分支 | 做法 | 代价 |
|---|---|---|
| **A（推荐）保持现状形状** | Phase A 继续发 `highlight-source-mermaid` 代码块，Phase B 把图渲进去。四条 D-MERMAID **改判为永久架构性偏离**，与 `data-animated-image` 同类，台账仍 12 条但那四条的 `explanation` 要改写 | 台账不减少；但诚实——一个离线阅读器本来就不该发指向 `viewscreen.githubusercontent.com` 的 URL |
| **B 追 GitHub 的形状** | Phase A 改发 `<section data-type="mermaid">`，并**扩展归一化器**把 `data-host`/`data-src`/enrichment 类也当作 GitHub 托管特有的噪音丢掉（与既有的 `restoreCamo`、`undoGithubUrlRewrites` 同类） | 台账可能 12 → 8；但要论证「把宿主特有外壳归一化掉」是否掩盖了真实结构分歧，且 Phase A **不能生成 UUID**（纯度约束），只能靠归一化器丢掉它 |

**我的推荐是 A**，理由：分支 B 让 readit 的输出里出现指向 GitHub 服务的地址，
对一个离线本地阅读器是错的；而「归一化掉它」等于用测量仪器抹平一个真实差异。
但这是产品判断，**用户定**。

### 2.2 macOS 版本下限

SPEC §10.2 明确：**不要写「最低 macOS 14 即得现代 WebKit」**——macOS 14 出厂是
Safari 17.0，Safari 26 是可选独立更新。文档里要写 **「macOS 14 + Safari ≥ N」**。

`N` 由能力决定，本段至少要求：**CSS Custom Highlight API**（查找的主路径，
SPEC §11.3 第 6 点说 Safari < 17.2 要降级到 `<mark>`）。所以 `N` 的下界是 **17.2**，
再往上取决于 mermaid 实测。**Codex 负责测出能力下界并报告，最终写进文档的
下限由用户定。**

**裁决（2026-08-13）**：产品下限先定为 **macOS 14 + Safari ≥ 17.2**；Mermaid 的
真 WKWebView 矩阵不是已完成证据，而是具名手工验收。若矩阵测出更高能力下界，发布门槛
随之上调，不把当前裁决误写成已经实测完毕。

### 2.3 Tauri 壳怎么验收

**这是本段与前四个里程碑最大的不同：很多东西 Codex 验不了。**
双击 `.md` 文件、第二次启动路由进已开窗口、Cmd+F、原子保存的 rename——
这些需要一台真机上的人。

SPEC §14 给 M6 的验收线是「双平台**真引擎**冒烟」，而 D2-21 记着这条从未满足过。

**要用户定的**：哪些做成自动化（哪怕只在 macOS 上），哪些做成一份
**具名的手工验收清单**（写进仓库、每条有明确的操作与期望，用户自己跑一遍打勾）。
**不许把手工项写成自动化测试然后让它恒绿**——那正是本项目栽过多次的形状。

**另有一条 SPEC 自挂的前置**（§17 spike 记录）：常驻内存 514 MB 是**四个大件同时渲染
的压力场景**读数，不是稳态。SPEC 原话「值得在定 M6 内存预算前**单独再测一次稳态**」。
这需要真机，归用户。

**裁决（2026-08-13）**：可在仓库与本机非交互环境中可靠验证的路径全部自动化；双击
关联、二次启动路由、Cmd+F、原子保存、真 WKWebView Mermaid、安装/启动/稳态资源六项
保留为 `docs/plans/2026-08-13-m6-manual-acceptance.md`。清单未勾选即表示 M6 真机验收
未达成，不用恒绿或恒跳过的自动化测试替代。

---

## 3. 阶段 A：M5 Mermaid

**前置**：§2.1 已裁决。

### A1 — `@readit/mermaid` 包与离屏渲染路径

新建 `packages/mermaid`，形状照 `packages/math` 与 `packages/highlight`
（看它们的 `package.json`、`tsconfig.json`、`vitest.config.ts`；依赖**钉死版本**，
不许 `^` 也不许 `@latest`）。

**SPEC §10.3 已经把这条路径的每一步定死了，逐条照做，不要自己发明：**

1. `mermaid.render(id, code)`（**不传第三参**）渲染到离屏但**真实布局**的容器：
   `position: absolute; left: -99999px`。
   **不能用 `display: none`** ——那在 Chrome/Edge 上也坏（mermaid#6652）。
2. 渲染前 `await document.fonts.ready`。
3. 临时容器的 `font-family` / `font-size` 必须与 shadow root 一致，或显式把 mermaid 的
   `fontFamily`/`fontSize` 配成 shadow 样式表里的同一组值。**否则每个标签盒都是照着
   错误字体量的**——这是「mermaid 看起来坏了」的头号来源。
4. 拿回 SVG 字符串 → **自己过一遍 DOMPurify** → 注入 shadow root → `bindFunctions(el)`。
5. 对用户 `classDef` / `style` 指令里落到 `node.labelStyle` 上的
   `opacity` / `transform` / `filter` 加护栏——**那是唯一引爆 WebKit bug 23113 的路径**。

**绝对不要做的两件事：**

- **绝不**调用 `mermaid.run({nodes: shadowRoot.querySelectorAll(...)})`。mermaid 通过
  `document.getElementById` 解析元素，**看不进 shadow root**（mermaid#6306，维护者已确认）。
  离屏渲染再注入是碰巧唯一可行的路径。
- **绝不**退到 `htmlLabels: false`。那条路更差：#7016 在部分修复合并当天被重开
  （2026-03-03），#7015 自 2025-09 未动，#4390 自 2022 年未决，
  而失败模式是**静默删除 `<` 和 `>` 之间的文本**。对文档阅读器，静默丢内容比布局抖动严重得多。

**注意数学**：mermaid 11.16.1 硬依赖 `katex ^0.16.45`。含公式的 mermaid 图会由
**第二个、不同的数学引擎**渲染，与散文数学的 MathJax 产出不同结果，且两个引擎的体积都要付。
SPEC §17 已把这条登记为**已知不一致**——不要试图统一，也不要关掉 mermaid 的数学支持
（那会让这类图直接坏掉）。在包的文档注释里指回 SPEC 那条。

**体积**：实测 `mermaid.min.js` 是 **3.4 MB**（调研里那个 1.2 MB 低估了 3 倍）。
它必须是**懒加载**的，与 math/highlight 一样走 `prepare()` 的动态 import。
参照 `packages/readit/test/build-output.test.ts` 里对 CodeMirror 的做法：
**加一条断言，钉住 mermaid 不出现在任何入口的静态闭包里，且落在独立的懒加载 chunk**。

### A2 — element 侧接线

- `PendingCapability` 加 `'mermaid'`（`packages/element/src/rerender.ts:64`）。
- `MountOptions` 加 `loadMermaid`（照 `loadHighlighter` 的形状；默认 `null`）。
- `scan().needsMermaid` 接上消费者——**它现在有生产者无消费者**。
- 降级可见：mermaid 未到货时 `data-readit-pending` 要包含 `mermaid`
  （角标样式已在 `BASE_CSS` 里，属性由 `kernel.ts` 设）。
- **公共导出面变了就要改 `public-surface.test.ts` 的清单**，并在提交信息里说明。

### A3 — 测试：结构断言 + 视觉，**不入字节快照**

SPEC §10.4 定死了这条边界，理由是 mermaid **不是确定性的**：

- `deterministicIds: true` 只稳定节点 id，**不是完整确定性**；
- `Math.random()` 仍活在 `blockDB.ts`，更要命的是 `scoreLayout.ts`——**它扰动的是几何**；
- `deterministicIDSeed` 的实现只用种子字符串的**长度**（源码内 TODO），等长即碰撞。

**因此**：Phase A 只快照它发出的占位符（这是既有行为，别动）；
mermaid 本身用 **L3b 结构断言**（真浏览器里断言 SVG 存在、节点数、
`bindFunctions` 接上了、shadow root 内可见）+ **L4 视觉截图**。

**必须做的三条负向验证**（否则断言可能是空的）：

1. 让 mermaid 加载失败（`page.route` 掐断 chunk），断言降级**可见**且组件仍可用
   ——照 `browser/element/panes` 那条编辑器加载失败的做法。
2. 喂一张**语法错误**的图（语料里已有 `frontend/mermaid-syntax-error`），
   断言错误态可见、不是空白、不抛未捕获异常。
3. 临时把离屏容器改成 `display: none`，确认结构断言**变红**——
   这一条直接验证 SPEC §10.3 第 1 点那个坑真的被测着了。

### A4 — 台账与 SPEC 的记账

按 §2.1 的裁决更新四条 D-MERMAID 的 `explanation`（分支 A）或触发棘轮方向二
（分支 B）。**无论哪个分支，SPEC §14 的 M5 行与债务台账都要同步**——
不要留下一条与实现不符的描述。（本项目刚为这类陈旧声明修过三次。）

---

## 4. 阶段 B：`@readit/find`

**这一段不需要 Tauri，完全在现有 L3b 基础设施里可验。建议先于阶段 C 做。**

### B1 — 文本模型与匹配

SPEC §11.3 把坑写死了：

1. **绝不**建在 `window.find()` 或 `execCommand('FindString')` 上——WebKit **刻意**让
   这两个 API 看不见 shadow tree（`FindOption::DoNotTraverseFlatTree`，bug 158503）。
   **这是最容易踩的坑，因为它看起来像捷径。**
2. 自建文本模型：遍历 shadow root 构建扁平文本缓冲 + `index → (textNode, offset)` 映射，
   匹配后为每个命中物化 `Range`。
3. **源码模式必须查文档模型而非 DOM**——CodeMirror 6 的视口虚拟化会让任何基于 DOM
   的查找**静默漏掉屏幕外的行**。这条要有专门的测试：文档足够长、命中在视口外、
   断言仍能找到。

**预算**：SPEC 给的是 3–6 KB 手写 + 2–3 KB 降级，**无依赖**。加依赖前先问。

### B2 — 高亮与滚动

4. 高亮用 **CSS Custom Highlight API**（`CSS.highlights.set(...)`）——**零 DOM 改动**，
   所以 Phase A 的输出字节不变、快照不变量不受影响，且能在 CodeMirror 与 mermaid
   水合之后存活。**加一条断言钉住「查找期间 shadow root 的 innerHTML 不变」。**
5. `::highlight(readit-find)` 规则**必须写在 shadow root 内部**——Safari 与 Firefox
   不跨 shadow 边界继承高亮样式（csswg#12497）。
6. 滚动到命中需**手写**（`range.getBoundingClientRect()`），API 不提供当前项与滚动语义。
7. Safari < 17.2 降级到 `<mark data-readit-find>` 包裹，用 `if (!('highlights' in CSS))`
   把它关在常规路径之外。**降级路径也要有测试**——用 `page.addInitScript` 删掉
   `CSS.highlights` 来逼出它，别只测主路径。

### B3 — `mount()` 的返回对象加 `find`

SPEC §9.4 现在明确写着「`find` 不在返回对象里，它属 M6」，且
`test/spec-sync.test.ts` 有一条断言钉着这句话。**M6 落地时这条断言与 SPEC 要一起改**
——这是设计好的（「加方法是向后兼容的，留空壳不是」）。

同时 `packages/readit/test/public-surface.test.ts` 与
`packages/element/test/mount.test.ts:67`（`Object.keys(handle).sort()`）都会红，
**这三处红是预期的**，逐一显式更新并在提交信息里说明。

---

## 5. 阶段 C：Tauri 壳（macOS）

**前置**：§2.2 与 §2.3 已裁决。**这一段的验证能力与前面两段有断层，见 §6。**

Rust 层**刻意保持薄**：文件 IO、协议处理、窗口/导航、文件关联、文件监听。
几乎所有迭代留在 JS 核心里（有热重载）。**不要把渲染逻辑往 Rust 里搬。**

### C1 — `readit://` 资源协议

SPEC §10.1：自注册 `readit://` **异步** URI scheme
（`register_asynchronous_uri_scheme_protocol`），在 Rust 侧把作用域限定到
**当前文档所在目录**。

- **不用**内置 asset 协议 + 持久化 scope——静态 glob 作用域对「用户双击任意文件」
  这个形态是错的。
- ⚠️ **CSP 里 `readit:` 和 `http://readit.localhost` 都要加**——两个引擎的 scheme
  形态不同，**一边对另一边就静默坏图**。

### C2 — 文件关联与打开事件

- `bundle.fileAssociations`，`ext: ["md","markdown"]` + `LSHandlerRank`。
- **macOS 打开事件**：`RunEvent::Opened` 的路径存进 `AppState`，前端挂载后来取。
  ⚠️ **事件在任何 JS 监听器存在之前就触发**（顺序 Opened → Ready → Window），
  不这么做会**间歇性开出空窗口，且随机器速度复现不稳**——这类 bug 最难事后定位，
  照 SPEC 做，不要「先跑通再说」。

### C3 — 单实例

`tauri-plugin-single-instance` **2.4.3**，**第一个注册**，早于其他所有插件。
第二次调用的 argv 路由进已开窗口的导航历史。

（导航历史栈**已经在 element 里实现了**——`./other.md` 走元素内部历史、
`onNavigate(path)` 交宿主取内容。壳只负责读盘并把内容喂回来，
**前进/后退是元素的能力，不是壳的**，见 SPEC §11.2。不要在壳里重造一套。）

### C4 — 文件监听

`notify`。⚠️ **原子保存的 rename 语义会骗过朴素 watcher**——大量编辑器保存时
是「写临时文件 + rename」，只监听 write 事件会漏掉。

### C5 — 更新器

官方 updater + minisign 密钥对 + GitHub Releases 上的静态 `latest.json`。
**不依赖 OS 代码签名**——证书没到位也能发更新。这一条与 M7 解耦，可以先做。

### C6 — 外部链接

`http(s)` 交系统浏览器（SPEC §11.2）。**注意**：element 侧的 `onNavigate` 只处理
`./other.md`；`#slug` 由元素自己搭桥；外部链接的处置在壳里。

### C7 — Cmd+F

SPEC §11.3 点名的**实际阻塞项**：**Tauri/WKWebView 在 macOS 上压根没有查找 UI**
（tauri#9385，2024-04 开至今 needs-triage）。按 Cmd+F 什么都不会发生，**没人会替我们修**。
所以阶段 B 的 `@readit/find` 必须自带 UI，并由壳把 Cmd+F 绑上去。

---

## 6. 验证能力的断层——这一节要如实写进报告

**阶段 A 与 B 在现有基础设施里完全可验**：vitest + L3b（Chromium/WebKit/Firefox 真浏览器）
+ L4 视觉。按前面几批的标准做即可。

**阶段 C 不是。** 以下这些 Codex **验不了**，必须落成具名的手工清单：

- 双击 `.md` 文件是否打开、是否路由正确
- 第二次启动是否路由进已开窗口（单实例）
- Cmd+F 是否唤起查找 UI
- 原子保存后文件监听是否触发
- 真 WKWebView 里 mermaid 图是否正常（这同时是 D2-21 的偿还点）
- 装机体积、冷启动、**稳态**常驻内存（§2.3 的前置）

**要求**：把这些写成 `docs/plans/2026-08-13-m6-manual-acceptance.md`，
每条含**操作步骤 + 明确的期望 + 一个打勾位**。

**不许**把它们写成自动化测试再让它恒绿或恒跳过。上一段里
`GAP-IME-WEBKIT` 是正确做法的范例：测不到就具名记录成缺口，
`test.skip` 的标题就是缺口名、每次跑都打印，**并且验收线记「未达成」而不是「通过」**。

---

## 7. 执行方式、报告与提交

**分批**：阶段 A（A1–A4）一批；阶段 B（B1–B3）一批；阶段 C 按 C1–C7 拆 2–3 批。
每批做完自审并报告，等确认再进下一批。**§2 的三条裁决没拿到答复前不要开工。**

**报告**写到 `docs/plans/2026-08-13-plan3-report.md`（追加，不覆盖）：

- 每个任务：改了什么、**先红后绿的命令与实际输出**
- **每条新增/修改的断言，「验证它会红」那一步的证据**
- 四条不变量的实测值（§0.5 的表逐行对照）
- 与本文档前提不符的地方（有就写，没有写「无」）
- 自审：**哪些地方你的验证广度是你自己选的**，边界在哪
- 阶段 C 额外：**哪些结论来自你实际运行、哪些来自阅读文档**——这两者不许混

**提交**：每任务一个提交；`git commit` 直接用（身份已配好 `mmy420`）；
**显式列暂存路径，绝不 `git add -A`**；提交信息写**为什么**；**不要推送**。
