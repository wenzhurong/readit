# readit

一个**阅读优先、可被内嵌**的 Markdown 阅读/编辑组件。核心是一个宿主无关的 JS 库，
桌面端只是一层薄壳。

它想解决的问题很具体：**渲染效果对齐 GitHub 网页版，而且这个对齐是可证伪的**——
由对 GitHub 真实输出的快照回归守住，不靠肉眼。

> ⚠️ **预发布 / 内部工程状态。** 8 个包全部 `private: true` + `0.0.0`，没有任何
> GitHub Release，**现在装不了也用不了**。这份 README 描述的是仓库里已经存在并
> 被测试守住的东西，不是路线图。

---

## 目录

- [它是什么形状](#它是什么形状)
- [保真度模型：与什么一致，以及为什么不是 100%](#保真度模型与什么一致以及为什么不是-100)
- [架构：Phase A / Phase B](#架构phase-a--phase-b)
- [包](#包)
- [API](#api)
- [开发](#开发)
- [测试分层](#测试分层)
- [里程碑状态](#里程碑状态)
- [已知缺口](#已知缺口)
- [文档地图](#文档地图)
- [许可](#许可)

---

## 它是什么形状

三层，从内到外：

1. **渲染引擎**（`@readit/core`）——纯同步函数 `render(src, opts) -> string`。
   无 DOM、无网络、无 I/O、无时间、无随机。给它一段 Markdown，还你一段
   GitHub 形状的 HTML 字符串。
2. **Web Component**（`@readit/element`）——把那段字符串挂进 Shadow DOM，
   加上主题、四种模式（只读 / 源码 / 分栏 / 轻量编辑）、导航、查找、
   以及按需水合的高亮与 Mermaid。
3. **桌面壳**（`shell/`，Tauri 2.11）——文件关联、单实例、`readit://` 资源协议、
   文件监听、更新器。Rust 层**刻意保持薄**，迭代留在 JS 里。

**"可被内嵌"是承重需求，不是附赠**：第 1、2 层不依赖第 3 层，宿主可以只要引擎、
或只要组件。组件在 Shadow DOM 里，且有一条真浏览器测试证明它在**敌意宿主**
（页面加载 Tailwind Preflight + Bootstrap Reboot + 一张专门与它作对的样式表）下
渲染不变。

---

## 保真度模型：与什么一致，以及为什么不是 100%

这是这个项目最值得先读懂的一节。

**参考标准是 GitHub 的输出，衡量对象是一份钉住的快照。**
`packages/core/test/fixtures/` 里存着 69 份从 GitHub 真实抓取的 HTML，
每个抓取目标钉死 `owner/repo` + 40 位完整 commit SHA + 路径。
`npm test` **全程离线**，只对着这些存档比对。

**当前读数：171 份语料里 68 份参与逐字节比对，56 份精确匹配，12 份具名失配。**
那 12 份全部记在 `packages/core/test/known-mismatches.json`，由一道**三向棘轮**守着：

- 不在名单上的失败 → 断构建
- 名单内的条目修好了 → **也断构建**（逼你把它从名单里删掉，而不是让名单长草）
- 名单内条目的失配量级变了 → 断构建

**为什么 100% 不可达**（这不是"还没做完"，是架构边界）：GitHub 的 HTML 里编码了
一些它**通过抓取字节才知道**的事实。例如 `data-animated-image` 要检查图片实际字节
才能判定是不是动图，而 `render()` 是纯同步、不碰网络的——这是这个项目自己定的
承重约束。又例如 Mermaid：GitHub 发的是一个**指向它自家托管渲染服务的富化外壳**
（`data-src="https://viewscreen.githubusercontent.com/…"`），一个离线本地阅读器
本来就不该发那种 URL。

所以验收线写的是**「全部通过，或失配已具名入棘轮台账并附不可修的理由」**，
不是「100%」。

**不做实时跟随。** 曾经有一条每夜哨兵重抓 GitHub 并在漂移时开 PR，
2026-08-12 取消了——指标是「与钉住的快照一致」，GitHub 日后改了渲染器**不构成回归**。
机器还留着（`oracle-drift` workflow，手动触发），想主动看一眼时再跑。

---

## 架构：Phase A / Phase B

```
读字节 + 解析基准目录
  └→ prepare(src, opts)      唯一一处 await：扫 $、```math、```mermaid、围栏语言 → 按需 import
      └→ render(src, opts)   纯同步：markdown-it → GitHub 形状 hast → 消毒 → MathJax SVG → 字符串
          └→ setHtml()       注入 shadow root（三级：Sanitizer API / Trusted Types / innerHTML）
              └→ Phase B     Mermaid 水合 · 高亮升级 · 锚点桥接 · 链接拦截 · 查找索引
```

**Phase A 的纯粹性是地基，有棘轮守着。**
`packages/core/test/no-await-on-render-path.test.ts` 是一层 TypeScript AST 扫描，
逐文件断言三类：无时间/随机、无同步 I/O 能力、无直接模块状态写入；外加对公共默认
容器（`DEFAULT_OPTIONS` / `DEFAULT_LOADERS`）的运行时冻结检查。
整条渲染路径上**唯一**允许 `await` 的是 `prepare()`。

为什么较真到这个程度：同一份输入必须在任何时刻、任何进程里产出同一串字节，
否则快照比对本身就失去意义。数学渲染还有一组**顺序置换测试**——
把文档里的公式打乱顺序渲染，字节必须一致。

---

## 包

| 包 | 职责 | 备注 |
|---|---|---|
| `@readit/core` | Phase A 引擎、消毒、GitHub 形状规则 | 运行时依赖 7 个：markdown-it、js-yaml、github-slugger、三个 hast-util-*，以及懒加载的 `@readit/math` |
| `@readit/element` | Web Component、Shadow DOM、主题、四模式、导航 | |
| `@readit/editor` | 编辑器两档：CodeMirror 与纯 `<textarea>` | 共用同一张契约表 |
| `@readit/find` | 查找：自建文本模型 + CSS Custom Highlight API | 无依赖 |
| `@readit/highlight` | 语法高亮双默认：Shiki 与 starry-night | 懒加载 |
| `@readit/math` | MathJax SVG | 懒加载 |
| `@readit/mermaid` | Mermaid 离屏渲染 + 注入 | 懒加载 |
| `readit` | **发布外观包**——上面七个的统一入口 | 消费方只装这一个 |

`shell/` 是 Tauri 壳，不是包。

---

## API

以下两段都是**实际跑过**的，不是示意。

### 只要引擎

```js
import { render, prepare, scan } from 'readit'

// 纯同步，不需要任何准备
render('# Hello\n')
// → '<div class="markdown-heading" dir="auto"><h1 class="heading-element" dir="auto"
//    data-line="0">Hello</h1><a id="user-content-hello" class="anchor" …

// 想知道这份文档需要哪些能力
scan('```js\nconst a = 1\n```\n', 'github')
// → { needsMath: false, needsMermaid: false, needsHighlight: true, languages: ['js'] }

// 数学/高亮要先 prepare（唯一的 await）
const opts = await prepare('$x^2$', { inlineMath: 'github' })
render('$x^2$', opts)
// → '<p dir="auto" data-line="0"><mjx-container class="MathJax" jax="SVG" …
```

### 挂成组件

```js
import { mount } from 'readit/element'

const view = mount(document.getElementById('host'), {
  value: '# Hi\n\n- [x] done\n',
  mode: 'read',      // 'read' | 'source' | 'split' | 'plain'
  theme: 'auto',     // 'auto' | 'light' | 'dark'
})

view.setValue('# Changed\n')
view.setMode('split')
view.find('done')    // 不传 query 则打开并聚焦内置查找栏
view.destroy()
```

`mount()` 返回 `{ setValue, getValue, setMode, setTheme, find, destroy }`。
也可以走自定义元素：`defineReadit()` 注册 `<readit-view>`（`DEFAULT_TAG`）。

`MountOptions` 的完整字段见 `packages/element/src/types.ts`；
懒加载能力通过 `loadHighlighter` / `loadMermaid` 注入，默认 `null`（不加载）。

### 样式与插件

```js
import 'readit/styles.css'                             // light DOM 消费者用
import { createShikiHighlighter } from 'readit/plugins/highlight'
import { createMathRenderer } from 'readit/plugins/math'
import { createMermaidRenderer } from 'readit/plugins/mermaid'
```

公共导出面（7 个 JS 子路径、24 个运行时符号）由
`packages/readit/test/public-surface.test.ts` **逐字钉住**——增删一个公共导出
是破坏性变更，必须显式改那份清单。

---

## 开发

需要 **Node ≥ 22**。壳的 Rust 侧需要 cargo，但 JS 侧不需要。

```bash
npm install
npm test          # vitest 全套，全程离线
npm run typecheck # 会先构建（壳的前端 import 发布外观包的 .d.ts）
npm run build     # 产出 packages/readit/dist
```

浏览器层与视觉层：

```bash
npx playwright install chromium webkit
npm run test:browser    # L3b：element 的 Chromium + WebKit
npm run test:visual     # L4：只在固定 Linux 容器里有判定意义
npm run visual:baseline # 重生视觉基线，需要 docker
```

壳：

```bash
cd shell && npm run dev          # 开发
cd shell/src-tauri && cargo test # Rust 侧
```

**当前基线**：`npm test` 2844 通过 / 86 文件 / 0 失败；`cargo test` 28 通过；
浏览器五个 project 118 通过 / 6 具名跳过 / 0 失败。

---

## 测试分层

| 层 | 是什么 | 在哪跑 |
|---|---|---|
| **L1** | CommonMark 0.31.2 与 GFM 0.29 规格套件 | `npm test`，离线 |
| **L2** | 语料对 GitHub 快照的逐字节比对 + 三向棘轮 | 同上 |
| **L3** | 单元与集成（含泄漏探针、纯度扫描、导出面钉桩） | 同上 |
| **L3b** | 真浏览器：Shadow DOM、编辑器、IME、查找、Mermaid | Playwright，Chromium/WebKit/Firefox |
| **L4** | 视觉回归，7 张基线，含**敌意宿主**页 | 固定 Linux 容器，`maxDiffPixelRatio: 0.002` |
| **perf** | 重渲染防抖的 p95 与记忆化比值哨兵 | `npm run test:perf` |

两条贯穿全仓的纪律，读代码时会反复看到：

- **每张视觉基线被干净页与敌意页各断言一次**——共用同一个文件名，
  所以"敌意宿主下渲染不变"是一条逐像素的等式，不是"敌意页像它自己那张"。
- **新增断言必须验证它真的会红**。这个仓库为"写了一条测不到真东西的断言"
  栽过至少十次，`docs/plans/2026-08-08-plan2-debt.md` 末节逐条记着。

---

## 里程碑状态

| M | 内容 | 状态 |
|---|---|---|
| M0 | Tauri spike（体积 / 冷启动 / 内存 / 真机渲图） | ✅ |
| M1 | Phase A 引擎 + 规格套件 + 归一化器 + oracle 脚本 | ✅ |
| M2 | 美元护栏 + 数学 | ✅ |
| M3 | element + Shadow DOM + L3b + 高亮双默认 | ✅ |
| M4 | 编辑器 + 滚动同步 + `plain` 档 | ✅ |
| M5 | Mermaid | ✅ |
| **M6** | 壳：关联、单实例、`readit://`、导航、查找、监听、更新器 | 🟡 **macOS 自动化齐备；六项真机手工验收未执行；Windows 壳未构建** |
| M7 | 签名分发 | ⬜ |

---

## 已知缺口

**具名、有出处、可核验**——完整清单见 `docs/plans/2026-08-08-plan2-debt.md`。
挑几条读者最该知道的：

- **M6 未验收。** `docs/plans/2026-08-13-m6-manual-acceptance.md` 的六项
  （双击关联、二次启动路由、物理 Cmd+F、原子保存、真 WKWebView Mermaid、
  安装/启动/稳态内存）**全部未勾选**。自动化不能替代它们。
- **Windows 壳不存在**——不是没测，是没建。`tauri.conf.json` 只有 macOS 段。
  引擎与浏览器层在 Windows 上已实测可用（见 `docs/windows-debug-report-2026-08-14.md`），
  但真 WebView2 仍是零覆盖。
- **IME 在 WebKit 上是具名缺口**（`GAP-IME-WEBKIT`）：WKWebView 没有等价于 CDP
  `Input.imeSetComposition` 的入口，四条真机组合测试整体跳过，跳过的标题就是缺口名。
- **`npm audit` 报 2 high。** 两条都评估过、都不可达：`js-yaml` 的两条通告都依赖
  merge key，而解析走的 `CORE_SCHEMA` 根本没注册 merge 类型（有守卫测试钉着）；
  `nanoid` 走 `vite → postcss`，是 devDependency，不进出货代码。详见台账 D2-26。
- **组合期外部 `setValue()` 会丢弃刚提交的输入法文本**——这是**刻意的语义**
  （`setValue()` 是权威性整体替换），已在 SPEC §9.4 写明，不是缺陷。

---

## 文档地图

| 文件 | 是什么 |
|---|---|
| `SPEC.md` | **上位契约。** 产品级规格，7 个里程碑，每条决策带理由与实测出处 |
| `docs/plans/2026-08-08-plan2-debt.md` | **债务台账。** 每条具名、带出处、可核验 |
| `docs/plans/2026-08-13-m6-manual-acceptance.md` | M6 的六项真机手工清单 |
| `docs/windows-test-plan.md` | Windows 侧验证方案 |
| `docs/windows-debug-report-2026-08-14.md` | Windows 真机验证报告 |
| `docs/releasing-macos.md` | macOS 签名与发布 |
| `docs/plans/` 其余 | 三份实施计划与它们的执行报告 |

SPEC 里的每条修订都带 ⚠️ 标注与日期，说明**原文是什么、为什么改**。
这不是洁癖——这个项目栽过的最贵的一次，就是一条验收线在两跳转录里丢了限定词，
变成一个从来没人打算设的不可达标准，一路带进执行。

---

## 许可

**MIT**，见 [`LICENSE`](LICENSE)。

选它是因为这个项目的定位是**可被别人内嵌**——MIT 是下游法务最不可能拦下来的那一档。

第三方成分：对抗性语料 vendor 的是 `karlcow/markdown-testsuite`（**MIT**，只取输入），
其原始许可证随语料一并保留在
[`packages/core/test/corpus/adversarial/karlcow/LICENSE.txt`](packages/core/test/corpus/adversarial/karlcow/LICENSE.txt)。
`michelf/mdtest` 是 **GPL-2.0，刻意没有 vendor**——
对一个准备被别人内嵌的库，那正是下游法务会真的拦下来的东西。
