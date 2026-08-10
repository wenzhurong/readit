# 计划二实施计划：element + Shadow DOM + 编辑器（M3 + M4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 readit 从「一个能在 Node 里跑的渲染引擎」变成「一个别的项目能装进去用的可嵌入组件」——Web Component + Shadow DOM 隔离 + 语法高亮 + 源码编辑，并用 `npm pack` 装进隔离宿主证明这件事是真的。

**Architecture:** 三个新工作区包（`@readit/element` / `@readit/highlight` / `@readit/editor`）加上已有的 `@readit/core` 与 `@readit/math`，构建成**一个**发布产物 `readit`，按 SPEC §9.3 的 exports 映射暴露子路径。**动态 import 边界就是包边界**——四个大件（高亮 / 数学 / 编辑器 / Mermaid）各自成包，「必须独立懒加载」由结构保证而非纪律保证。`.` 入口保持同构纯净，不得触及任何浏览器全局。

**Tech Stack:** TypeScript · ESM · Node 22+ · vitest 4.1.10（离线单测）· Playwright 1.62.1（真浏览器 L3b + L4）· vite 8.2.1（浏览器 fixture）· happy-dom 20.11.2 · shiki 4.4.2 · @wooorm/starry-night 3.10.0 · CodeMirror 6 · github-markdown-css 5.9.0 · dompurify 3.4.13

**上位契约：** `readit/SPEC.md`
**设计文档：** `docs/superpowers/specs/2026-08-09-plan2-element-editor-design.md`
**遗留债务：** `docs/plans/2026-08-08-plan2-debt.md`（本计划只处理 D2-9）

---

## Global Constraints

以下是项目级要求，**每个任务的要求都隐含包含本节**。数值逐字取自设计文档与 SPEC。

**运行时与语言**
- Node 22+，ESM（`"type": "module"`），TypeScript **strict** + **`noUncheckedIndexedAccess: true`**
- npm workspaces，包在 `packages/` 下
- 注释与说明用中文，代码与标识符用英文

**精确锁定的依赖版本**（不要用 `latest`，不要自行升级，不要 `npm i -E` 不带版本）
- `vitest@4.1.10` · `playwright@1.62.1` · `vite@8.2.1` · `happy-dom@20.11.2`
- `shiki@4.4.2` · `@wooorm/starry-night@3.10.0` · `github-markdown-css@5.9.0` · `dompurify@3.4.13`
- `hast-util-to-html@9.0.5`
- CodeMirror：`@codemirror/view@6.43.8` · `state@6.7.1` · `language@6.12.4` · `commands@6.10.4` · `lang-markdown@6.5.2` · `style-mod@>=4.1.2`

**Phase A 纯度（承重，违反即破坏整个验收体系）**
- `render()` 纯同步、无 DOM、无 I/O、无 `Date.now()` / `Math.random()`
- **`.` 入口不得 import 任何浏览器专属内容。** 有一条会失败的测试守它
- `Highlighter.highlight()` 必须纯同步（工厂可以是 async）

**离线**
- `npm test` 零网络。计划一建的离线门覆盖 `fetch` + `net.Socket.connect` + dns 四个面 64 个入口 + `dgram`，CI 另有 `unshare --net` 无出网命名空间
- starry-night 的 `onigWasmUrl` **无默认值、必填**——它的默认路径硬编码 `fetch('https://esm.sh/...onig.wasm')`，必填参数是防它被忘记的结构手段

**不得回退的既有数字**（计划一交付，本计划结束时必须一字不变；若变化那是回归，须上报而非重钉）
- **2318** 条既有测试全绿
- 语料 **56/68**，台账 **12** 条，三向棘轮生效
- CommonMark **649** 精确 + **3** PERMANENT
- GFM **658** 精确 + **14** PERMANENT
- TEMPORARY 计数 **0**

**两个 test runner 的文件归属**（不得互相捡文件）
- **vitest**：`packages/*/test/**/*.test.ts` 与根 `test/**/*.test.ts`，离线、无浏览器
- **Playwright**：根 `browser/**/*.spec.ts`，配置在根 `playwright.config.ts`，CI

**分期：M3 先行**（见设计文档 §9.5）
- **第一段 M3 = Task 1–12 + 18**：结束时 `readit` 是可被外部宿主安装使用的只读渲染器，六条验收线里五条可判
- **第二段 M4 = Task 13–17，收尾 Task 19**：编辑器、`plain` 档、滚动同步、IME
- 若需在第一段结束时停下，停在那里得到的是一个完整的东西

---
## §0 编排裁决（A1–A12）

> **这一节压过任何单个任务的正文。** 六组并行起草时，共享契约 P1–P6 只覆盖了公共接口，
> 没覆盖文件所有权、依赖版本、包内模块命名、浏览器 fixture 装置与 CI job 名——
> 起草者在空白处各自发明，产生了下列冲突。本节是补上的那层契约，逐条裁决。
>
> 实施者若发现任务正文与本节冲突，**以本节为准**，并在报告里指出该处正文需要改。

---

### A1 文件所有权：谁 Create，谁 Modify

**Task 1 一次性建齐全部五个包的 manifest / tsconfig / vitest.config，写全依赖，不留后补。**
后续任何任务碰这些文件一律 `Modify`，且**按字符串定位，不用行号锚点**——
前一处改动会让后一处行号全部漂移。

Task 1 要写全的 element manifest：

```json
"dependencies": {
  "@readit/core": "0.0.0",
  "@readit/editor": "0.0.0",
  "dompurify": "3.4.13",
  "github-markdown-css": "5.9.0"
},
"devDependencies": { "happy-dom": "20.11.2", "@types/node": "24.10.1", "typescript": "5.9.3", "vitest": "4.1.10" }
```

`packages/element/package.json` 的 `exports` 预留 `"./styles": "./src/styles.ts"`（见 A6）。

highlight manifest 一次写全 `hast-util-to-html@9.0.5`、`shiki@4.4.2`、`@wooorm/starry-night@3.10.0`
与 `refresh:shiki-golden` script；tsconfig 的 `include` 取 `["src/**/*.ts","test/**/*.ts","scripts/**/*.ts"]`
（与 `packages/core/tsconfig.json` 逐字同构）。

`packages/highlight/src/index.ts` 的最终形态是三行，Task 1 先写第一行，
Task 7 与 Task 8 各**追加一行**（追加，不是替换，不用行号）：

```ts
export type { Highlighter } from '@readit/core/types'
export { createShikiHighlighter, type ShikiOptions } from './shiki.js'
export { createStarryNightHighlighter, type StarryNightOptions } from './starry-night.js'
```

### A2 vitest environment

| 包 | environment | 理由 |
|---|---|---|
| `packages/element` | `happy-dom`（钉 **20.11.2**） | 泄漏检测、shadow root、主题都要 DOM |
| `packages/editor` | `happy-dom`（钉 **20.11.2**） | 同上 |
| `packages/highlight` | `node` | **P1 的纯函数承诺的结构化形式**，不得改 |
| `packages/core`、`packages/math` | 保持现状 | |

Task 1 一次写对。**删掉草稿里那段「element 的 environment 是 node」的注释**——
它会作为「已裁定的理由」误导后续任务。

### A3 依赖版本一律钉死

`dompurify` **3.4.13** · `happy-dom` **20.11.2** · `vite` **8.2.1** · `playwright` **1.62.1**
· `github-markdown-css` **5.9.0** · `shiki` **4.4.2** · `@wooorm/starry-night` **3.10.0**

不许 `npm i -E <pkg>` 不带版本，不许 `@latest`。

### A4 D2-9 只修一次

归 **Task 1**（`packages/math/package.json` 的 `@readit/core` 从 `dependencies` 移进
`devDependencies`）。Task 9 删掉这条 Modify，**保留** `test/build-output.test.ts` 里那条
D2-9 断言——那是有价值的第二道锁。

### A5 `test/ci-wiring.test.ts` 归 Task 1

Task 1 整块改 `:74-82` 并新增「覆盖 packages/ 下每个工作区」的断言。
Task 7 删掉它那条 Modify。Task 12 保留对 `typecheck` 脚本的修改，
但**按字符串定位**（Task 1 已让行号漂移）。

### A6 `packages/element/src/styles.ts` 归 Task 3

Task 3 在做主题与 github-markdown-css 接线，由它 Produces：

```ts
export const ELEMENT_CSS: string      // 内联进 ./element，走 adoptedStyleSheets
export const LIGHT_DOM_CSS: string    // 输出为 ./styles.css，给 light DOM 消费者
```

高亮那段 CSS 规则**并进 `ELEMENT_CSS`**，不单独建 `styles/highlight.css`。
Task 9 的 `build.ts` 消费这两个常量——**Task 9 之前它们必须存在**，否则 Task 9 第一步就崩。

### A7 import 方向表放宽一处，并预留第六个包

`ALLOWED['@readit/element']['@readit/editor']` 从 `['dynamic']` 改为 **`['type', 'dynamic']`**。

P1 原文「element → editor 仅动态 import」明确为「**运行时仅动态 import；`import type` 允许**」。
理由：禁掉 `import type` 的唯一替代是在 element 里重抄一遍 P2 的类型，
那正是这份契约要防的漂移。

Task 1 的 `PACKAGES` / `DIRECTORY` / `ALLOWED` **预留第六项 `readit`**（Task 9 建的发布外观包），
且 `packageOf()` 要能匹配裸包名 `readit`（无斜杠）。否则 Task 9 一落地，
Task 1 的「第六个包溜不过这张表」断言必红。

### A8 element 内核架构归 Task 3–6，命名定一套

`kernel.ts` 拥有 root 与 pane 的**创建与命名**。Task 17 的 `createPanes()` **接收** kernel
已创建的节点，不自己 `createElement`。统一命名：

| 角色 | 变量名 | class | `::part` |
|---|---|---|---|
| shadow root 容器 | `root` | `.readit-root` | `root` |
| 预览 pane | `content` | `.markdown-body` | `content` |
| 源码 pane | `sourcePane` | `.readit-source` | —— |
| 每个代码块 | —— | —— | `code-block` 挂在 `<pre>` **本体**上 |

`code-block` 挂 `<pre>` 本体而非 `.highlight` wrapper：github-markdown-css 自己给
`.markdown-body pre` 设了 `font-family`，挂 wrapper 上会被内层规则顶掉，L4 的等宽字体断言会红。

Task 17 草稿里的 `shell` 变量**无定义**，删掉；改用 kernel 的 `content`。

### A9 浏览器 fixture 统一 vite，Playwright project 必须带 testDir

取 **vite 8.2.1** 一套（`?raw` 导入与工作区 `.ts` 软链解析都靠它），端口 **5183**。
esbuild 那套装置弃用。页面全局统一 `window.readitFixture`，把 `mount(id, opts)` 并进去。

**五个 project，每个必须有 `testDir`**——否则 `npx playwright test` 会让 element 的 project
把 `browser/editor` 也跑一遍：

| project | testDir |
|---|---|
| `element-chromium` / `element-webkit` | `browser/element` |
| `editor-chromium` / `editor-webkit` | `browser/editor` |
| `visual-chromium` | `browser/visual` |

Firefox 尽力而为、失败不阻塞（单独的 advisory job）。

### A10 CI job 必须拆两个，不只是目录拆两个

设计 §7.1 要的是「两个文件、**两个 CI job 名**」。`.github/workflows/browser.yml` 里
明确两个 job：**`l3b-element`** 与 **`l3b-editor`**。这是决策 1 那条保留意见的兑现——
套件变红时必须自己说清是 M3 侧还是 M4 侧坏的，只拆目录做不到这件事。

### A11 判据不写全局测试总数

一律写「**2318 条既有测试全绿 + 本任务新增 N 条**」，不写 `Tests 2334 passed` 这种全局数。
总数会随 Task 1→17 逐个变化，写死会让每个后续任务都要回头改前一个任务的判据。
草稿里所有「预期 Tests <N> passed」的写法按此改。

### A12 `scan()` 的签名

实际签名是 `scan(src: string, inlineMath: InlineMathMode): ScanResult`，两个参数。
草稿里所有 `scan(src).languages` / `scan().languages` 改成 **`scan(src, opts.inlineMath).languages`**。

`ScanResult` 有**四个**字段：`needsMath` / `needsMermaid` / `needsHighlight` / `languages`。
Task 10 的类型注解漏了 `needsMermaid`，补上。

---

## §0.1 补五条无人认领的缺口

一致性核查发现这五条设计要求**没有任何任务实现**。它们不是新范围，是漏派。

| # | 缺口 | 归属 |
|---|---|---|
| **G1** | **设计 §9 的四条 SPEC 修订全部无人认领**：§9.4 `mode` 补 `'plain'` 并定义；`find` 标注属 M6；`::part()` 名单只开三个、`mermaid` 推迟 M5；§5 包表 `@readit/find` 标 M6 | **新增 Task 19「SPEC 同步」**，收尾时一次改完，连同各组提案的 §9 修订 5–9 一并落地 |
| **G2** | **`--readit-*` 自定义属性通道未实现。** SPEC §9.2 说对外只开两个覆写通道（`--readit-*` 与 `::part()`），现在只有后者。它比看上去贵：github-markdown-css 把变量声明在 `.markdown-body` **自己身上**，宿主在 `:host` 上设同名变量会被盖掉 | **新增 Task 18**。原本裁决「并进 Task 3」，但自审发现 Task 3 的正文里没有对应步骤——那等于「加上适当的 X」，正是 writing-plans 明令禁止的占位符。且它够独立：评审员可以否掉这个通道而批准 Task 3 的主题实现 |
| **G3** | **Trusted Types 的 Playwright 场景两组互相指望，谁都没做。** 设计 §7 把它列在 L3b-element | **加进 Task 11**：用 `page.route` 注入 `Content-Security-Policy: require-trusted-types-for 'script'` 响应头的 fixture 页，断言组件仍能渲染。单元层那两份桩测保留，但它们证明不了真 CSP 下的行为 |
| **G4** | **降级可见性只有一半。** `data-readit-pending` 属性由 Task 15 定义，但它的可见样式（角标）属主题任务，而 Task 3 的产出里没有 | 属性归 Task 15，**样式并进 Task 3 的 `ELEMENT_CSS`**。两半必须同一批落地，否则「降级必须可见」是空话 |
| **G5** | **防抖 p95 断言在交付文本里看不到。** 设计 §4.2 特意写了「把这次测量提交成一条会随代码变慢而失败的断言」 | **Task 15 必须有它**。实施者若在 Task 15 的正文里找不到，那是漏了，补上——设计文档专门为它写了「这个项目已因猜数字栽过两次」 |

## §0.2 一条排序修正

**Task 9–10 的构建门在 Task 17 之前是「假绿」。** Task 9 的 `tsconfig.build.json` 会
`export * from '@readit/editor'`，而那时 `packages/editor/src/index.ts` 只有类型再导出——
`dist/editor.js` 是空壳，但 `publint` 与 `attw` 仍会绿。Task 10 的 `globalSetup` 每次
`npm test` 还会重建一次这个不完整的 dist。

处置：Task 9 的 `./editor` 子路径与相关断言**标注为「Task 17 后需重跑 Task 10 的三条门」**，
并把这次重跑写进 Task 17 的收尾步骤。不改任务顺序——M3 段先行是决策 1 的分期要求。

---

### Task 1: 三个工作区包的骨架 + import 方向守卫 + 修 D2-9 循环依赖

**Files:**
- Create: `/Users/mac08/Desktop/robot/readit/packages/element/package.json`
- Create: `/Users/mac08/Desktop/robot/readit/packages/element/tsconfig.json`
- Create: `/Users/mac08/Desktop/robot/readit/packages/element/vitest.config.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/element/src/types.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/element/src/index.ts`
> ⚠️ **§0 A1：这三个文件由 Task 1 建，本任务一律 Modify，且按字符串定位不用行号。**
> Task 1 已写全 `shiki@4.4.2` / `@wooorm/starry-night@3.10.0` / `hast-util-to-html@9.0.5`
> 与 `refresh:shiki-golden` script，tsconfig 的 `include` 已与 `packages/core/tsconfig.json`
> 逐字同构。**不要重建，会覆盖掉更全的版本。**

- Modify: `/Users/mac08/Desktop/robot/readit/packages/highlight/package.json`（按需追加，Task 1 已写全依赖）
- Modify: `/Users/mac08/Desktop/robot/readit/packages/highlight/tsconfig.json`（Task 1 已写对，通常无需改）
- Modify: `/Users/mac08/Desktop/robot/readit/packages/highlight/vitest.config.ts`（Task 1 已设 `environment: 'node'`，§0 A2 要求保持）
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/src/index.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/editor/package.json`
- Create: `/Users/mac08/Desktop/robot/readit/packages/editor/tsconfig.json`
- Create: `/Users/mac08/Desktop/robot/readit/packages/editor/vitest.config.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/editor/src/types.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/editor/src/index.ts`
- Modify: `/Users/mac08/Desktop/robot/readit/packages/math/package.json:17-26`（`@readit/core` 从 `dependencies` 移进 `devDependencies` —— D2-9）
- Modify: `/Users/mac08/Desktop/robot/readit/test/ci-wiring.test.ts:1` 与 `:74-82`（tsconfig 名单从磁盘读，覆盖五个包而非手写的两个）
- Modify: `/Users/mac08/Desktop/robot/readit/package-lock.json`（`npm install` 重新链接工作区后产生）
- Test: `/Users/mac08/Desktop/robot/readit/test/import-direction.test.ts`

**Interfaces:**
- Consumes: 无前序任务。只消费仓库既有物：`@readit/core` 的 `"./types"` 子路径导出（`packages/core/package.json` 已有，指向 `./src/types.ts`），其中的 `Highlighter` 与 `MathRenderer`（P3 明确「不得改动」）；根 `vitest.config.ts` 的 `projects: ['.', 'packages/*']`；根 `package.json` 的 `workspaces: ["packages/*"]` 与 `typecheck: "tsc --noEmit && npm run typecheck --workspaces --if-present"`。
- Produces:
  - 三个可解析的工作区包名：`@readit/element`、`@readit/highlight`、`@readit/editor`，各带 `"exports": { "." : "./src/index.ts", … }`，版本一律 `0.0.0`、`"private": true`。
  - `packages/element/src/types.ts` 导出 P4 的 `Mode`、`Theme`、`MountOptions`、`MountHandle`（**类型**）。`packages/element/src/index.ts` 目前只把这四个类型再导出一遍；`mount()` 与 `defineReadit()` 由后续任务在**同一个文件里追加**（是 Modify，不是 Create）。
  - `packages/editor/src/types.ts` 导出 P2 的 `EditorKind`、`EditorOptions`、`Editor`。`packages/editor/src/index.ts` 目前只再导出这三个类型；`createEditor()` 由后续任务追加。
  - `packages/highlight/src/index.ts` 目前只有 `export type { Highlighter } from '@readit/core/types'`；`createShikiHighlighter()` / `createStarryNightHighlighter()` 由后续任务追加。
  - `packages/element/tsconfig.json` 与 `packages/editor/tsconfig.json` 的 `lib` 含 `DOM`、`DOM.Iterable`（这两个包是浏览器专属）；`packages/highlight/tsconfig.json` **不含 DOM** —— P1 说 highlight 是纯函数，编译面里没有 DOM 是这句话的结构化形式。
  - `test/import-direction.test.ts` 里的 `ALLOWED` 表是 P1 方向的唯一真源，**源码扫描与 package.json 依赖归位两处都从它派生**。后续任务若需要一条新边，改的是这张表，且改动会在 diff 里显形。

---

- [ ] **Step 1: 写会失败的测试**

新建 `/Users/mac08/Desktop/robot/readit/test/import-direction.test.ts`：

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * P1 的 import 方向守卫。
 *
 * 为什么用 TypeScript 的 AST 而不是正则：方向的判定完全取决于「值 / 仅类型 / 仅动态」
 * 这三分，而这三分在语法上分散在 `import type`、`import { type X }`、`export type … from`、
 * `import()` 五六种形态里。正则要么漏判（`import { type A, B }` 里有值导入）、要么误判
 * （字符串里出现 "import"）。ts 已经是本仓库的 devDependency，用它零新增依赖。
 *
 * 扫描面是 packages/star/src —— 会被打进发布产物的那部分。测试与脚本不进这张图，
 * 因为它们不发布；边界是关于「装进宿主的模块图」的。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const PACKAGES = [
  '@readit/core',
  '@readit/math',
  '@readit/element',
  '@readit/highlight',
  '@readit/editor',
] as const
type PackageName = (typeof PACKAGES)[number]

const DIRECTORY: Record<PackageName, string> = {
  '@readit/core': 'packages/core',
  '@readit/math': 'packages/math',
  '@readit/element': 'packages/element',
  '@readit/highlight': 'packages/highlight',
  '@readit/editor': 'packages/editor',
}

type ImportKind = 'value' | 'type' | 'dynamic'

/**
 * P1 的方向表，唯一真源。没列出的组合 = 完全禁止。
 *
 * core -> math 是既有的运行时动态 import（prepare.ts 的 DEFAULT_LOADERS），真实且允许。
 * math -> core 只允许 type：这就是 D2-9。它今天在源码层面已经成立（`import type`），
 * 错的是 package.json 把它声明成了运行时依赖 —— 见下面的 manifest 断言。
 */
const ALLOWED: Record<PackageName, Partial<Record<PackageName, readonly ImportKind[]>>> = {
  '@readit/core': { '@readit/math': ['dynamic'] },
  '@readit/math': { '@readit/core': ['type'] },
  '@readit/highlight': { '@readit/core': ['type'] },
  '@readit/editor': { '@readit/core': ['type'] },
  '@readit/element': {
    '@readit/core': ['value', 'type', 'dynamic'],
    '@readit/highlight': ['type'],
    '@readit/editor': ['dynamic'],
  },
}

interface ImportRef {
  specifier: string
  kind: ImportKind
  line: number
}

function allSpecifiersTypeOnly(clause: ts.ImportClause | ts.NamedExportBindings | undefined): boolean {
  if (clause === undefined) return false
  if (ts.isImportClause(clause)) {
    // 有默认导入名 = 有值导入，无论 named 部分怎么写。
    if (clause.name !== undefined) return false
    const bindings = clause.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) return false
    return bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly)
  }
  if (ts.isNamedExports(clause)) {
    return clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly)
  }
  return false
}

export function collectImports(source: string, fileName: string): ImportRef[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const refs: ImportRef[] = []
  const push = (specifier: ts.Expression, kind: ImportKind): void => {
    if (!ts.isStringLiteralLike(specifier)) return
    const line = sourceFile.getLineAndCharacterOfPosition(specifier.getStart(sourceFile)).line + 1
    refs.push({ specifier: specifier.text, kind, line })
  }
  const walk = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const typeOnly = node.importClause?.isTypeOnly === true || allSpecifiersTypeOnly(node.importClause)
      push(node.moduleSpecifier, typeOnly ? 'type' : 'value')
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      const typeOnly = node.isTypeOnly || allSpecifiersTypeOnly(node.exportClause)
      push(node.moduleSpecifier, typeOnly ? 'type' : 'value')
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      push(node.moduleReference.expression, node.isTypeOnly ? 'type' : 'value')
    } else if (ts.isCallExpression(node)) {
      const arg0 = node.arguments[0]
      if (arg0 !== undefined) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) push(arg0, 'dynamic')
        // 本仓库是 ESM，但 require() 若混进来它同样是运行时边，按 value 记。
        else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') push(arg0, 'value')
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(sourceFile)
  return refs
}

function packageOf(specifier: string): PackageName | null {
  const parts = specifier.split('/')
  const name = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier
  return (PACKAGES as readonly string[]).includes(name) ? (name as PackageName) : null
}

interface FileReport {
  violations: string[]
  crossEdges: number
}

export function inspect(from: PackageName, fileRelPath: string, source: string): FileReport {
  const violations: string[] = []
  let crossEdges = 0
  const ownDir = join(ROOT, DIRECTORY[from]) + sep
  for (const ref of collectImports(source, fileRelPath)) {
    const where = `${fileRelPath}:${ref.line}`
    if (ref.specifier.startsWith('.')) {
      // 相对路径是绕开包名守卫最省事的办法，所以它也要被守。
      const target = resolve(join(ROOT, fileRelPath), '..', ref.specifier)
      if (!target.startsWith(ownDir)) {
        violations.push(`${where} 相对路径 ${ref.specifier} 越出了 ${from} 的包目录——绕开包名等于绕开 P1`)
      }
      continue
    }
    const to = packageOf(ref.specifier)
    if (to === null || to === from) continue
    crossEdges += 1
    const kinds = ALLOWED[from][to] ?? []
    if (!kinds.includes(ref.kind)) {
      const allowed = kinds.length === 0 ? '完全禁止' : kinds.join(' / ')
      violations.push(`${where} ${from} -> ${to} 是 ${ref.kind} 导入，P1 允许的是：${allowed}`)
    }
  }
  return { violations, crossEdges }
}

function tsFilesUnder(dir: string): string[] {
  let out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out = out.concat(tsFilesUnder(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

interface ScanSummary {
  violations: string[]
  fileCount: number
  crossEdges: number
}

function scanAll(): ScanSummary {
  const summary: ScanSummary = { violations: [], fileCount: 0, crossEdges: 0 }
  for (const from of PACKAGES) {
    const srcDir = join(ROOT, DIRECTORY[from], 'src')
    for (const file of tsFilesUnder(srcDir)) {
      summary.fileCount += 1
      const rel = file.slice(ROOT.length)
      const report = inspect(from, rel, readFileSync(file, 'utf8'))
      summary.violations.push(...report.violations)
      summary.crossEdges += report.crossEdges
    }
  }
  return summary
}

describe('the scanner can tell the three import kinds apart', () => {
  // 守卫的全部力量都压在这个分类上。它错了，上面那张表就是装饰。
  it('classifies every import form the language offers', () => {
    const source = [
      "import type { A } from 'a'",
      "import { type B, type C } from 'b'",
      "import { type D, E } from 'c'",
      "import F, { type G } from 'd'",
      "import 'e'",
      "import * as H from 'f'",
      "export type { I } from 'g'",
      "export { type J } from 'h'",
      "export { K } from 'i'",
      "export * from 'j'",
      "const p = import('k')",
      "const q = require('l')",
    ].join('\n')
    expect(collectImports(source, 'probe.ts').map((ref) => `${ref.specifier}:${ref.kind}`)).toEqual([
      'a:type',
      'b:type',
      'c:value',
      'd:value',
      'e:value',
      'f:value',
      'g:type',
      'h:type',
      'i:value',
      'j:value',
      'k:dynamic',
      'l:value',
    ])
  })

  it('flags a value import where P1 allows only types', () => {
    const report = inspect(
      '@readit/highlight',
      'packages/highlight/src/probe.ts',
      "import { render } from '@readit/core'\n",
    )
    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toContain('@readit/highlight -> @readit/core 是 value 导入')
  })

  it('flags a static import where P1 allows only a dynamic one', () => {
    const report = inspect(
      '@readit/element',
      'packages/element/src/probe.ts',
      "import { createEditor } from '@readit/editor'\n",
    )
    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toContain('P1 允许的是：dynamic')
  })

  it('flags an edge P1 forbids outright, dynamic or not', () => {
    const report = inspect(
      '@readit/editor',
      'packages/editor/src/probe.ts',
      "const m = import('@readit/element')\n",
    )
    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toContain('完全禁止')
  })

  it('flags a relative import that climbs out of its own package', () => {
    const report = inspect(
      '@readit/editor',
      'packages/editor/src/probe.ts',
      "import { mount } from '../../element/src/index.js'\n",
    )
    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toContain('越出了 @readit/editor 的包目录')
  })

  it('passes the three edges P1 actually permits', () => {
    const source = [
      "import type { Highlighter } from '@readit/highlight'",
      "import { render } from '@readit/core'",
      "const editor = import('@readit/editor')",
      "import { helper } from './helper.js'",
    ].join('\n')
    const report = inspect('@readit/element', 'packages/element/src/probe.ts', source)
    expect(report.violations).toEqual([])
    expect(report.crossEdges).toBe(3)
  })
})

describe('P1 import directions hold across packages/*/src', () => {
  it('covers every workspace under packages/ — a sixth package cannot slip past the table', () => {
    const dirs = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/${entry.name}`)
      .sort()
    expect(dirs).toEqual(Object.values(DIRECTORY).sort())
  })

  it.each(PACKAGES)('%s has a src/ directory to scan', (name) => {
    expect(statSync(join(ROOT, DIRECTORY[name], 'src')).isDirectory()).toBe(true)
  })

  it('finds no violation', () => {
    expect(scanAll().violations).toEqual([])
  })

  // 一条永远绿的守卫和没有守卫是一回事。这条钉住扫描面确实非空。
  it('actually read the source it claims to guard', () => {
    const summary = scanAll()
    expect(summary.fileCount).toBeGreaterThanOrEqual(30)
    expect(summary.crossEdges).toBeGreaterThanOrEqual(4)
  })
})

interface Manifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function manifestOf(name: PackageName): Manifest {
  return JSON.parse(readFileSync(join(ROOT, DIRECTORY[name], 'package.json'), 'utf8')) as Manifest
}

describe('P1 directions hold in the manifests too', () => {
  /**
   * 源码守卫看不见 package.json，而打包器看的正是 package.json。一条仅类型的边被声明成
   * dependencies，源码层面全绿，装进宿主时却是一条真实的环 —— 这就是 D2-9 的形状。
   */
  it('puts every @readit/* dependency on the side the direction table implies', () => {
    const problems: string[] = []
    for (const from of PACKAGES) {
      const manifest = manifestOf(from)
      for (const dep of Object.keys(manifest.dependencies ?? {})) {
        const to = packageOf(dep)
        if (to === null || to === from) continue
        const kinds = ALLOWED[from][to] ?? []
        if (!kinds.includes('value') && !kinds.includes('dynamic')) {
          problems.push(`${DIRECTORY[from]}/package.json: "${dep}" 在 dependencies 里，但 P1 只允许类型导入——类型依赖属 devDependencies`)
        }
      }
      for (const dep of Object.keys(manifest.devDependencies ?? {})) {
        const to = packageOf(dep)
        if (to === null || to === from) continue
        if (ALLOWED[from][to] === undefined) {
          problems.push(`${DIRECTORY[from]}/package.json: "${dep}" 在 devDependencies 里，但 P1 完全禁止 ${from} -> ${to}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('D2-9: math needs core only for a type, so core is not a runtime dependency of it', () => {
    const math = manifestOf('@readit/math')
    expect(Object.keys(math.dependencies ?? {})).not.toContain('@readit/core')
    expect(Object.keys(math.devDependencies ?? {})).toContain('@readit/core')
    // 另一半的方向是真的运行时边（prepare.ts 的 import('@readit/math')），必须留在 dependencies。
    expect(Object.keys(manifestOf('@readit/core').dependencies ?? {})).toContain('@readit/math')
  })
})
```

同一步里加固 `/Users/mac08/Desktop/robot/readit/test/ci-wiring.test.ts`。第 1 行：

```ts
import { readFileSync } from 'node:fs'
```

改成：

```ts
import { readdirSync, readFileSync } from 'node:fs'
```

第 74–82 行整块：

```ts
  it.each(['strict', 'noUncheckedIndexedAccess', 'verbatimModuleSyntax'])(
    'enables %s everywhere, root and both packages alike',
    (flag) => {
      for (const path of ['tsconfig.json', 'packages/core/tsconfig.json', 'packages/math/tsconfig.json']) {
        const cfg = JSON.parse(read(path)) as { compilerOptions: Record<string, unknown> }
        expect(cfg.compilerOptions[flag], `${path} · ${flag}`).toBe(true)
      }
    },
  )
```

替换为：

```ts
  // 名单从磁盘读，不手写。手写的那份在计划二加进三个工作区包时会静默继续通过 ——
  // 三个新包一个都不检查，而测试名还写着 "everywhere"。
  const packageTsconfigs = readdirSync(new URL('../packages', import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}/tsconfig.json`)
    .sort()

  it('sees every workspace under packages/', () => {
    expect(packageTsconfigs.length).toBeGreaterThanOrEqual(5)
  })

  it.each(['strict', 'noUncheckedIndexedAccess', 'verbatimModuleSyntax'])(
    'enables %s everywhere, root and every package alike',
    (flag) => {
      for (const path of ['tsconfig.json', ...packageTsconfigs]) {
        const cfg = JSON.parse(read(path)) as { compilerOptions: Record<string, unknown> }
        expect(cfg.compilerOptions[flag], `${path} · ${flag}`).toBe(true)
      }
    },
  )
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd /Users/mac08/Desktop/robot/readit
npx vitest run test/import-direction.test.ts test/ci-wiring.test.ts
```

三处红，各自都是真的：

```
 FAIL  test/import-direction.test.ts > P1 import directions hold across packages/*/src > covers every workspace under packages/
AssertionError: expected [ 'packages/core', 'packages/math' ] to deeply equal [ 'packages/core', 'packages/editor', …

 FAIL  test/import-direction.test.ts > P1 import directions hold across packages/*/src > @readit/element has a src/ directory to scan
Error: ENOENT: no such file or directory, stat '…/packages/element/src'

 FAIL  test/import-direction.test.ts > P1 directions hold in the manifests too > D2-9: math needs core only for a type, …
AssertionError: expected [ '@mathjax/mathjax-tex-font', '@mathjax/src', '@readit/core' ] not to contain '@readit/core'

 FAIL  test/ci-wiring.test.ts > typecheck actually covers the whole repo > sees every workspace under packages/
AssertionError: expected 2 to be greater than or equal to 5
```

`the scanner can tell the three import kinds apart` 那一组这一步就应当**全绿** —— 它只吃合成字符串，不依赖仓库状态。若它这时是红的，先修分类器再往下走。

- [ ] **Step 3: 写最小实现**

`/Users/mac08/Desktop/robot/readit/packages/element/package.json`：

```json
{
  "name": "@readit/element",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types.ts",
    "./package.json": "./package.json"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@readit/core": "0.0.0",
    "@readit/editor": "0.0.0"
  },
  "devDependencies": {
    "@types/node": "24.10.1",
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  },
  "engines": {
    "node": ">=22"
  }
}
```

`@readit/editor` 现在就声明，尽管本任务不 import 它：这条边是 P1 定死的，后续任务只加一行 `import()`，不必再动清单。它在 `dependencies` 而非 `devDependencies`，因为动态 import 是**真实的运行时边**。

`/Users/mac08/Desktop/robot/readit/packages/element/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`/Users/mac08/Desktop/robot/readit/packages/element/vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // 本包的浏览器行为归 Playwright（P5：browser/**/*.spec.ts）。留在 vitest 里的
    // 是能用桩在 Node 里判定的部分，所以 environment 是 node，不是 jsdom ——
    // 装一个半吊子 DOM 只会让「这条测试到底证明了什么」变模糊。
    // ⚠️ §0 A2：element 与 editor 一律 happy-dom@20.11.2，不是 node。
    // Task 1 已写对（commit 57d8993）；此处草稿文本过时，勿照抄。
    environment: 'node',
    setupFiles: ['../../test/setup/no-network.ts'],
    chaiConfig: {
      truncateThreshold: 0,
    },
  },
})
```

`/Users/mac08/Desktop/robot/readit/packages/element/src/types.ts`：

```ts
import type { Highlighter, MathRenderer } from '@readit/core/types'

export type Mode = 'read' | 'source' | 'split' | 'plain'
export type Theme = 'auto' | 'light' | 'dark'

export interface MountOptions {
  value: string
  mode: Mode
  shadow: boolean
  theme: Theme
  baseUrl: string
  // 与 @readit/core 的 InlineMathMode 结构相同。这里按 P4 逐字写出联合类型，
  // 而不是复用那个别名 —— 契约怎么写的，签名就怎么读。
  inlineMath: 'github' | 'strict' | 'off'
  math: MathRenderer | null
  highlighter: Highlighter | null
  emojiBase: string
  onNavigate: ((path: string) => void) | null
}

export interface MountHandle {
  setValue(value: string): void
  getValue(): string
  setMode(mode: Mode): void
  setTheme(theme: Theme): void
  destroy(): void
}
```

`/Users/mac08/Desktop/robot/readit/packages/element/src/index.ts`：

```ts
export type { Mode, MountHandle, MountOptions, Theme } from './types.js'
```

`/Users/mac08/Desktop/robot/readit/packages/highlight/package.json`：

```json
{
  "name": "@readit/highlight",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts",
    "./package.json": "./package.json"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@readit/core": "0.0.0",
    "@types/node": "24.10.1",
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  },
  "engines": {
    "node": ">=22"
  }
}
```

`/Users/mac08/Desktop/robot/readit/packages/highlight/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`lib` 里没有 `DOM`：P1 说 highlight 是能在 Node 里 import 的纯函数，编译面里没有 DOM 是这句承诺的结构形式 —— 谁想在这里碰 `document`，`tsc` 会先拦下。

`/Users/mac08/Desktop/robot/readit/packages/highlight/vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['../../test/setup/no-network.ts'],
    chaiConfig: {
      truncateThreshold: 0,
    },
  },
})
```

`/Users/mac08/Desktop/robot/readit/packages/highlight/src/index.ts`：

```ts
// Highlighter 由 @readit/core 拥有（P3：接口已存在，不得改动）。本包在这里把它
// 再导出一次，让「拿工厂的地方」和「拿类型的地方」是同一个 import —— 类型导出，
// 运行时不产生任何对 core 的引用。
export type { Highlighter } from '@readit/core/types'
```

`/Users/mac08/Desktop/robot/readit/packages/editor/package.json`：

```json
{
  "name": "@readit/editor",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types.ts",
    "./package.json": "./package.json"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@readit/core": "0.0.0",
    "@types/node": "24.10.1",
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  },
  "engines": {
    "node": ">=22"
  }
}
```

`/Users/mac08/Desktop/robot/readit/packages/editor/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`/Users/mac08/Desktop/robot/readit/packages/editor/vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // ⚠️ §0 A2：element 与 editor 一律 happy-dom@20.11.2，不是 node。
    // Task 1 已写对（commit 57d8993）；此处草稿文本过时，勿照抄。
    environment: 'node',
    setupFiles: ['../../test/setup/no-network.ts'],
    chaiConfig: {
      truncateThreshold: 0,
    },
  },
})
```

`/Users/mac08/Desktop/robot/readit/packages/editor/src/types.ts`（P2 逐字）：

```ts
export type EditorKind = 'codemirror' | 'plain'

export interface EditorOptions {
  parent: HTMLElement
  /** CodeMirror 需要它做样式注入；plain 档忽略。 */
  root: ShadowRoot | Document
  value: string
  onChange(value: string): void
  /** topLine 是 0 基的首个可见源码行，供滚动同步用。 */
  onScroll(topLine: number): void
}

export interface Editor {
  setValue(value: string): void
  getValue(): string
  focus(): void
  /** 0 基的首个可见源码行。 */
  topLine(): number
  scrollToLine(line: number): void
  destroy(): void
}
```

`/Users/mac08/Desktop/robot/readit/packages/editor/src/index.ts`：

```ts
export type { Editor, EditorKind, EditorOptions } from './types.js'
```

D2-9 的修法 —— `/Users/mac08/Desktop/robot/readit/packages/math/package.json` 第 17–26 行：

```json
  "dependencies": {
    "@mathjax/mathjax-tex-font": "4.1.3",
    "@mathjax/src": "4.1.3",
    "@readit/core": "0.0.0"
  },
  "devDependencies": {
    "@types/node": "24.10.1",
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  },
```

改成：

```json
  "dependencies": {
    "@mathjax/mathjax-tex-font": "4.1.3",
    "@mathjax/src": "4.1.3"
  },
  "devDependencies": {
    "@readit/core": "0.0.0",
    "@types/node": "24.10.1",
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  },
```

`packages/math/src/index.ts:14` 是 `import type { MathRenderer } from '@readit/core/types'`，`verbatimModuleSyntax` 下它编译后一个字节都不剩，所以运行时依赖本就不存在 —— 清单声明的是一条不存在的边，而那条不存在的边和 `core -> math` 的真边合起来是个环。移进 `devDependencies` 后 `core -> math` 是唯一方向，图变成无环，打包器不再有得选。**不要改 `src/index.ts`。**

然后重新链接工作区并落到 lockfile：

```bash
cd /Users/mac08/Desktop/robot/readit
npm install
```

三个新包不引入任何**外部**新依赖，`npm install` 这一步只做工作区符号链接与 `package-lock.json` 的更新。lockfile 的改动要一起提交，否则 CI 的 `npm ci` 认不出新工作区。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit
npx vitest run test/import-direction.test.ts test/ci-wiring.test.ts
npm test
npm run typecheck
```

判据：

- `import-direction.test.ts` 16 条全绿，`ci-wiring.test.ts` 由 8 条变 9 条。
- `npm test` 总数 **2318 + 17 = 2335**，零失败。P6 的承重项是那 2318 条既有测试仍然全绿；总数若不是 2335，先确认差值全部来自本任务新增的 17 条，**不得为了对上数字去改既有断言**。
- 语料 56/68、CommonMark 649 精确 + 3 PERMANENT、GFM 658 精确 + 14 PERMANENT、TEMPORARY 0 一字不变。本任务没碰 Phase A 任何一行，它们变化即是回归，按 P6 上报。
- `npm run typecheck` 五个包 + 根全部通过（此前只有两个包被检查）。

- [ ] **Step 5: 提交**

```bash
cd /Users/mac08/Desktop/robot/readit
git add packages/element packages/highlight packages/editor \
        packages/math/package.json test/import-direction.test.ts \
        test/ci-wiring.test.ts package-lock.json
git commit -m "$(cat <<'EOF'
feat(workspace): 三个新工作区包 + P1 方向守卫；修 D2-9 循环依赖

element / highlight / editor 三个包的骨架，加一条扫源码 AST 的结构性守卫：
「值 / 仅类型 / 仅动态」这三分是 P1 方向的全部内容，用正则判不了
（`import { type A, B }` 里有值导入），所以用 ts 的 AST，零新增依赖。

守卫同时覆盖 package.json：源码守卫看不见清单，而打包器看的正是清单。
一条仅类型的边被写进 dependencies，源码层面全绿，装进宿主时却是真实的环
——这正是 D2-9 的形状。math 的 @readit/core 移进 devDependencies；
它在 src 里是 `import type`，verbatimModuleSyntax 下编译后一字不剩，
清单声明的是一条不存在的边。移完之后 core -> math 是唯一方向。

守卫另外拦相对路径越界（`../../element/src/…`）——绕开包名是绕开
包名守卫最省事的办法。并有一条断言钉住扫描面非空：一条永远绿的守卫
和没有守卫是一回事。

ci-wiring 的 tsconfig 名单改为从磁盘读。手写那份在加进三个包后会继续
静默通过，三个新包一个都不检查，而测试名写着 "everywhere"。

既有数字未动：2318 条全绿（新增 17 条，共 2335）、语料 56/68、
CommonMark 649+3、GFM 658+14、TEMPORARY 0。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

---

### Task 2: setHtml() 三级注入路径 + Trusted Types CSP 测试

**Files:**
- Create: `/Users/mac08/Desktop/robot/readit/packages/element/src/set-html.ts`
- Modify: `/Users/mac08/Desktop/robot/readit/packages/element/package.json:17-20`（`dependencies` 加 `dompurify`，由 `npm i -E` 写入精确版本）
- Modify: `/Users/mac08/Desktop/robot/readit/package-lock.json`（同一次安装产生）
- Test: `/Users/mac08/Desktop/robot/readit/packages/element/test/set-html.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `packages/element` 包（`package.json` / `tsconfig.json`（`lib` 含 `DOM`）/ `vitest.config.ts`），以及 Task 1 建立的 P1 守卫 —— 本任务只新增对外部包 `dompurify` 的依赖，不新增任何跨 `@readit/*` 边，守卫应保持绿。
- Produces:（`packages/element/src/set-html.ts`，element **包内**接口，不进 `exports`）
  - `type InjectionTier = 'setHTML' | 'trusted-types' | 'innerHTML'`
  - `interface HtmlSink { setHTML?: (html: string) => void; innerHTML: string }` —— 真实 `Element` 结构上满足它
  - `interface DomPurifyLike { sanitize(dirty: string, cfg: { RETURN_TRUSTED_TYPE: true }): unknown }`
  - `interface InjectionEnv { hasSetHtml: boolean; hasTrustedTypes: boolean; purify: DomPurifyLike }`
  - `function selectTier(env: InjectionEnv): InjectionTier`
  - `function readEnv(): InjectionEnv` —— 从真实全局读一次
  - `function createSetHtml(env: InjectionEnv): (sink: HtmlSink, html: string) => void`
  - `function setHtml(sink: HtmlSink, html: string): void` —— **后续所有把 HTML 写进 DOM 的代码只准调这一个**。`mount()` 的任务 `import { setHtml } from './set-html.js'`，不得另起 `innerHTML =`。

---

- [ ] **Step 1: 写会失败的测试**

新建 `/Users/mac08/Desktop/robot/readit/packages/element/test/set-html.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  createSetHtml,
  readEnv,
  selectTier,
  setHtml,
  type DomPurifyLike,
  type HtmlSink,
  type InjectionEnv,
} from '../src/set-html.js'

const HTML = '<p data-line="0">hi &amp; bye</p>'

/**
 * TrustedHTML 的替身。Trusted Types 的实现细节这里不关心，关心的只有一件事：
 * 它不是 string —— 而这恰恰是浏览器在 CSP 下唯一在意的事。
 */
class FakeTrustedHTML {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value
  }
}

/**
 * 模拟下发了 `require-trusted-types-for 'script'` 的宿主：innerHTML 的 setter 对
 * 普通字符串抛 TypeError，只接受策略产出的 TrustedHTML。这就是浏览器的行为。
 *
 * 为什么是桩而不是 linkedom：linkedom 根本没有实现 Trusted Types 的强制，
 * 用它写这条测试会得到一个「怎么写都过」的绿灯 —— 而这一级正是靠「不写就硬抛」
 * 才有存在意义的。能证伪它的东西必须自己会抛。
 */
class CspSink implements HtmlSink {
  received: unknown = null

  get innerHTML(): string {
    return this.received === null ? '' : String(this.received)
  }

  set innerHTML(value: string) {
    // 运行时到这里的可能是 TrustedHTML；类型上它被 as string 抹平了，故用 unknown 收。
    const incoming: unknown = value
    if (!(incoming instanceof FakeTrustedHTML)) {
      throw new TypeError(
        "Failed to set the 'innerHTML' property on 'Element': This document requires 'TrustedHTML' assignment.",
      )
    }
    this.received = incoming
  }
}

class PlainSink implements HtmlSink {
  innerHTML = ''
}

class SanitizerSink implements HtmlSink {
  innerHTML = ''
  calls: string[] = []
  setHTML(html: string): void {
    this.calls.push(html)
  }
}

interface SpyPurify extends DomPurifyLike {
  calls: { dirty: string; cfg: { RETURN_TRUSTED_TYPE: true } }[]
}

function spyPurify(): SpyPurify {
  const calls: { dirty: string; cfg: { RETURN_TRUSTED_TYPE: true } }[] = []
  return {
    calls,
    sanitize(dirty, cfg) {
      calls.push({ dirty, cfg })
      return new FakeTrustedHTML(dirty)
    },
  }
}

function envOf(hasSetHtml: boolean, hasTrustedTypes: boolean, purify: DomPurifyLike): InjectionEnv {
  return { hasSetHtml, hasTrustedTypes, purify }
}

describe('selectTier', () => {
  it.each([
    // hasSetHtml, hasTrustedTypes, tier
    [true, false, 'setHTML'],
    [true, true, 'setHTML'],
    [false, true, 'trusted-types'],
    [false, false, 'innerHTML'],
  ] as const)('setHTML=%s trustedTypes=%s -> %s', (hasSetHtml, hasTrustedTypes, tier) => {
    // 第二行是顺序本身：两者都在时一级赢。Element.setHTML() 自带消毒，
    // 因此它不受 require-trusted-types-for 约束 —— 走它是对的，不是抄近路。
    expect(selectTier(envOf(hasSetHtml, hasTrustedTypes, spyPurify()))).toBe(tier)
  })
})

describe('tier 1 — Element.setHTML()', () => {
  it('hands the string to setHTML and never touches innerHTML', () => {
    const sink = new SanitizerSink()
    const purify = spyPurify()
    createSetHtml(envOf(true, true, purify))(sink, HTML)
    expect(sink.calls).toEqual([HTML])
    expect(sink.innerHTML).toBe('')
    expect(purify.calls).toEqual([])
  })
})

describe('tier 2 — a Trusted Types host', () => {
  /**
   * 反面对照，也是这一组里最重要的一条：同一个桩在三级下必须抛。没有它，
   * 上面那条「二级能过」可能只是因为桩根本没在强制什么。
   */
  it('the CSP sink really does reject a plain string, so tier 3 is fatal there', () => {
    const sink = new CspSink()
    expect(() => createSetHtml(envOf(false, false, spyPurify()))(sink, HTML)).toThrow(TypeError)
    expect(sink.received).toBeNull()
  })

  it('tier 2 gets through the very same sink', () => {
    const sink = new CspSink()
    createSetHtml(envOf(false, true, spyPurify()))(sink, HTML)
    expect(sink.received).toBeInstanceOf(FakeTrustedHTML)
    expect(sink.innerHTML).toBe(HTML)
  })

  it('mints through the sanitizer once, with RETURN_TRUSTED_TYPE', () => {
    const purify = spyPurify()
    createSetHtml(envOf(false, true, purify))(new CspSink(), HTML)
    expect(purify.calls).toEqual([{ dirty: HTML, cfg: { RETURN_TRUSTED_TYPE: true } }])
  })
})

describe('tier 3 — innerHTML on already-sanitized content', () => {
  it('assigns the exact string and leaves the sanitizer alone', () => {
    const sink = new PlainSink()
    const purify = spyPurify()
    createSetHtml(envOf(false, false, purify))(sink, HTML)
    expect(sink.innerHTML).toBe(HTML)
    expect(purify.calls).toEqual([])
  })
})

describe('the real environment', () => {
  it('readEnv() reads Node as neither tier 1 nor tier 2, without throwing', () => {
    // Node 里既没有 Element 也没有 window。探测必须用 typeof 守，不能裸读全局。
    const env = readEnv()
    expect(env.hasSetHtml).toBe(false)
    expect(env.hasTrustedTypes).toBe(false)
    expect(selectTier(env)).toBe('innerHTML')
  })

  it('the module-level setHtml() works off that environment', () => {
    const sink = new PlainSink()
    setHtml(sink, HTML)
    expect(sink.innerHTML).toBe(HTML)
  })
})
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd /Users/mac08/Desktop/robot/readit
npx vitest run packages/element/test/set-html.test.ts
```

预期：

```
 FAIL  packages/element/test/set-html.test.ts [ packages/element/test/set-html.test.ts ]
Error: Failed to load url ../src/set-html.js (resolved id: …/packages/element/src/set-html.js).
Does the file exist?
```

整个文件加载失败、零条通过。

- [ ] **Step 3: 写最小实现**

先装 DOMPurify（`-E` 写精确版本，本仓库一律不留 `^`）：

```bash
cd /Users/mac08/Desktop/robot/readit
npm i -w @readit/element -E dompurify
```

新建 `/Users/mac08/Desktop/robot/readit/packages/element/src/set-html.ts`：

```ts
import DOMPurify from 'dompurify'

/**
 * element 里**唯一**把 HTML 写进 DOM 的地方。三级：
 *
 *   1. `'setHTML' in Element.prototype`  -> Element.setHTML()
 *   2. 否则 window.trustedTypes 存在     -> 单一 Trusted Types 策略
 *   3. 否则                               -> 对已消毒内容用 innerHTML
 *
 * 二级不是可选项。任何下发 `require-trusted-types-for 'script'` 的企业宿主里，
 * 给 innerHTML 赋一个普通字符串会直接抛 TypeError，组件当场死掉；而本地开发机
 * 上没有那条 CSP，所以这个失败**永远不会在开发期出现**。它只在别人的生产环境里出现。
 *
 * 一二级的顺序不是抄近路：Element.setHTML() 自带消毒，规范上不受
 * require-trusted-types-for 约束，所以两者都在时走一级是正确的。
 *
 * 一级的内建消毒器比 Phase A 的输出更严格还是更宽松，Node 里判不了 —— 尤其是
 * 滚动同步依赖的 `data-line` 会不会被它剥掉。那条断言归 L3b-element（真浏览器）。
 * 本文件的测试只判「选了哪一级」与「那一级怎么递交」。
 */

/** setHtml 能写入的宿主节点。真实的 Element 结构上满足它。 */
export interface HtmlSink {
  /** Sanitizer API（一级）。老浏览器与 TS 5.9 的 lib.dom 里都还没有它，故可选。 */
  setHTML?: (html: string) => void
  innerHTML: string
}

/**
 * 二级需要的最小消毒器端口。形状照 DOMPurify 抄，好让生产接线就是 DOMPurify 本身、
 * 中间不夹适配器；返回值声明成 unknown 而不是 TrustedHTML，是为了不把
 * @types/trusted-types 拖进本包的编译面 —— 我们对那个值只做一件事：原样交给 innerHTML。
 */
export interface DomPurifyLike {
  sanitize(dirty: string, cfg: { RETURN_TRUSTED_TYPE: true }): unknown
}

export type InjectionTier = 'setHTML' | 'trusted-types' | 'innerHTML'

export interface InjectionEnv {
  /** `'setHTML' in Element.prototype` */
  hasSetHtml: boolean
  /** `window.trustedTypes` 是否存在 */
  hasTrustedTypes: boolean
  purify: DomPurifyLike
}

export function selectTier(env: InjectionEnv): InjectionTier {
  if (env.hasSetHtml) return 'setHTML'
  if (env.hasTrustedTypes) return 'trusted-types'
  return 'innerHTML'
}

/** 从真实全局读一次。两处都用 typeof 守，因为 Node 里这两个标识符根本不存在。 */
export function readEnv(): InjectionEnv {
  return {
    hasSetHtml: typeof Element !== 'undefined' && 'setHTML' in Element.prototype,
    hasTrustedTypes: typeof window !== 'undefined' && 'trustedTypes' in window,
    purify: DOMPurify,
  }
}

export function createSetHtml(env: InjectionEnv): (sink: HtmlSink, html: string) => void {
  // 档位在这里定一次。env 在页面生命周期内不会变，每次注入重判是白花的钱。
  const tier = selectTier(env)

  if (tier === 'setHTML') {
    return (sink, html) => {
      const setHTML = sink.setHTML
      if (setHTML === undefined) {
        throw new TypeError('setHtml: 选中了一级，但这个节点没有 setHTML()')
      }
      setHTML.call(sink, html)
    }
  }

  if (tier === 'trusted-types') {
    return (sink, html) => {
      // 单一策略：DOMPurify 自己只建一次策略并复用，所以整个组件生命周期里
      // 只有一个策略名要被宿主的 trusted-types 指令放行。
      const trusted = env.purify.sanitize(html, { RETURN_TRUSTED_TYPE: true })
      // TrustedHTML 不是 string —— 但在这条 CSP 下，innerHTML 的 setter 恰恰只接受它。
      // 这个 cast 是类型系统与运行时之间那道缝，不是偷懒。
      sink.innerHTML = trusted as string
    }
  }

  return (sink, html) => {
    // 到这里的 html 已经过 Phase A 的 hast-util-sanitize。三级不做第二遍消毒，
    // 做的是「相信上游」——这个信任由 core 的消毒测试承重，不由这里。
    sink.innerHTML = html
  }
}

let injector: ((sink: HtmlSink, html: string) => void) | null = null

/** 后续所有把 HTML 写进 DOM 的代码只准调它。别处不得再出现 `innerHTML =`。 */
export function setHtml(sink: HtmlSink, html: string): void {
  injector ??= createSetHtml(readEnv())
  injector(sink, html)
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit
npx vitest run packages/element/test/set-html.test.ts
npm test
npm run typecheck
npx vitest run test/import-direction.test.ts
```

判据：

- `set-html.test.ts` 11 条全绿。其中 `tier 3 is fatal there` 与 `tier 2 gets through the very same sink` **必须成对存在**：前者证明桩真的在强制那条 CSP，后者才有意义。谁删掉前一条，后一条立刻退化成自我肯定。
- `npm test` 总数 **2335 + 11 = 2346**，零失败；语料 56/68、CommonMark 649+3、GFM 658+14、TEMPORARY 0 一字不变（P6）。
- `npm run typecheck` 通过。若报 `Cannot find name 'TrustedHTML'`，那是 DOMPurify 的 `.d.ts` 内部引用，`skipLibCheck: true` 已覆盖；**唯一允许的修法是把端口的返回类型继续放宽，不得写 `as any`，也不得关掉 `skipLibCheck` 之外的任何严格开关。**
- P1 守卫保持绿：`dompurify` 是外部包，不产生任何 `@readit/*` 跨包边。
- **本任务不接线。** `set-html.ts` 此刻还没有调用方 —— `mount()` 的任务负责 `import { setHtml } from './set-html.js'` 并让所有 HTML 都走它。

- [ ] **Step 5: 提交**

```bash
cd /Users/mac08/Desktop/robot/readit
git add packages/element/src/set-html.ts packages/element/test/set-html.test.ts \
        packages/element/package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(element): setHtml() 三级注入路径，含 Trusted Types 那一级

element 里唯一把 HTML 写进 DOM 的入口。一级 Element.setHTML()，二级
Trusted Types（DOMPurify RETURN_TRUSTED_TYPE），三级对已消毒内容 innerHTML。

二级不是备选项：下发了 require-trusted-types-for 'script' 的企业宿主里，
给 innerHTML 赋普通字符串直接抛 TypeError，组件当场死；而本地开发机没有
那条 CSP，这个失败永远不会在开发期出现，只在别人的生产环境里出现。
所以它必须有一条模拟该 CSP 的测试，否则这一级等于没写。

测试用桩不用 linkedom：linkedom 根本没实现 Trusted Types 的强制，用它写
这条会得到一个「怎么写都过」的绿灯。桩的 innerHTML setter 对普通字符串抛
TypeError，并配一条反面对照——同一个桩在三级下必须抛。缺了那条，
「二级能过」可能只是因为桩没在强制什么。

一二级的顺序不是抄近路：setHTML() 自带消毒，规范上不受
require-trusted-types-for 约束，两者都在时走一级是正确的。

一级的内建消毒器会不会剥掉滚动同步依赖的 data-line，Node 里判不了，
那条归 L3b-element。本文件只判「选了哪一级」与「那一级怎么递交」。

新增 11 条（共 2346）。语料 56/68、649+3、658+14、TEMPORARY 0 未动。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 新增契约提案

以下是 P1–P6 里没有、但 Task 1–2 落了地的东西。**其他组若要用，按此处的签名用；若认为该改，改这里而不是各自另起一套。**

1. **`packages/element/src/set-html.ts`（element 包内，不进 `exports`）**
   ```ts
   export type InjectionTier = 'setHTML' | 'trusted-types' | 'innerHTML'
   export interface HtmlSink { setHTML?: (html: string) => void; innerHTML: string }
   export interface DomPurifyLike { sanitize(dirty: string, cfg: { RETURN_TRUSTED_TYPE: true }): unknown }
   export interface InjectionEnv { hasSetHtml: boolean; hasTrustedTypes: boolean; purify: DomPurifyLike }
   export function selectTier(env: InjectionEnv): InjectionTier
   export function readEnv(): InjectionEnv
   export function createSetHtml(env: InjectionEnv): (sink: HtmlSink, html: string) => void
   export function setHtml(sink: HtmlSink, html: string): void
   ```
   `mount()` 的任务只该用 `setHtml`。**element 里别处不得再出现 `innerHTML =` 或 `insertAdjacentHTML`** —— 建议由那个任务加一条源码级断言把这条钉住（本任务未加，因为此刻还没有第二个调用点）。

2. **Task 1 已创建、后续任务是 Modify 而非 Create 的文件**：`packages/element/src/index.ts`（现只有类型再导出，`mount` / `defineReadit` 追加进去）、`packages/editor/src/index.ts`（`createEditor` 追加）、`packages/highlight/src/index.ts`（两个工厂追加）、`packages/element/src/types.ts`、`packages/editor/src/types.ts`（P4 / P2 的类型已按契约逐字落地，不要重写）。

3. **包清单子路径导出**：`@readit/element` 与 `@readit/editor` 各有 `"./types"` 指向 `./src/types.ts`；三个包都有 `"./package.json"`。发布产物的 `exports` 映射（SPEC §9.3）归构建任务，与这三份工作区内清单是两件事。

4. **`test/import-direction.test.ts` 里的 `ALLOWED` 表是 P1 的机器可读形式**，源码扫描与 `package.json` 依赖归位两处都从它派生。**需要一条新的包间边时，改这张表；不要在测试里加豁免分支。** 表里已含 P1 未提及的两条既有边：`core -> math`（`dynamic`）与 `math -> core`（`type`，即 D2-9 的结果）。

5. **element / editor 的 tsconfig `lib` 含 `DOM` + `DOM.Iterable`；highlight 的不含。** highlight 编译面里没有 DOM 是 P1「纯函数、Node 可 import」那句话的结构化形式，请勿为了图方便加上。

6. **`@readit/element` 新增外部运行时依赖 `dompurify`**（精确版本由 `npm i -E` 写入）。它是急加载链上的成本，构建/体积任务量到的 `.` + `./element` 数字里应包含它；若超出设计 §2.1 的 ~60–70 KB 预算，那是一个需要上报的取舍，不要靠删掉二级来省。

---

### Task 3: Shadow DOM、主题与样式表冻结

**Files:**
- Create: `packages/element/package.json`
- Create: `packages/element/tsconfig.json`
- Create: `packages/element/vitest.config.ts`
- Create: `packages/element/src/types.ts`
- Create: `packages/element/src/disposers.ts`
- Create: `packages/element/src/shadow.ts`
- Create: `packages/element/src/theme.ts`
- Create: `packages/element/src/styles/base-css.ts`
- Create: `packages/element/scripts/gen-theme-css.ts`
- Create（由脚本生成后提交）: `packages/element/src/styles/theme-css.ts`
- Test: `packages/element/test/theme-css.test.ts`
- Test: `packages/element/test/theme.test.ts`
- Test: `packages/element/test/shadow.test.ts`

**Interfaces:**
- Consumes: 无前序任务的运行时接口。若 Task 1 的包脚手架已按 P1 建过 `packages/element/package.json` / `tsconfig.json` / `vitest.config.ts`，本任务不重建，只把下面给出的 `environment: 'happy-dom'`、`lib: ["ES2023","DOM","DOM.Iterable"]` 与三个依赖补进去；`src/types.ts` 必须与 P4 逐字一致，若已存在且逐字相同则跳过。
- Produces:
  - `packages/element/src/types.ts`：`Mode`、`Theme`、`MountOptions`、`MountHandle`（P4 逐字）
  - `packages/element/src/disposers.ts`：`createDisposers(): Disposers`、`addListener(d: Disposers, target: EventTarget, type: string, handler: EventListener, options?: AddEventListenerOptions): void`、`interface Disposers { add(dispose: () => void): void; readonly size: number; disposeAll(): void }`
  - `packages/element/src/shadow.ts`：`ownerView(host: HTMLElement): Window`、`createRoot(host: HTMLElement, shadow: boolean, disposers: Disposers): RootContext`，`RootContext = { host, view, container: ShadowRoot | HTMLElement, root: HTMLDivElement, adopted: boolean, setStyles(cssTexts: readonly string[]): void }`
  - `packages/element/src/theme.ts`：`type ResolvedTheme = 'light' | 'dark'`、`readColorScheme(host, view): ResolvedTheme | null`、`resolveTheme(theme: Theme, host: HTMLElement, view: Window): ResolvedTheme`、`createThemeController(host, view, initial: Theme, onResolved: (r: ResolvedTheme) => void, disposers: Disposers): ThemeController`（`ThemeController = { readonly requested: Theme; readonly resolved: ResolvedTheme; set(theme: Theme): void }`）
  - `packages/element/src/styles/theme-css.ts`：`LIGHT_CSS`、`DARK_CSS`、`LIGHT_CSS_BYTES`、`DARK_CSS_BYTES`、`THEME_CSS_VERSION`
  - `packages/element/src/styles/base-css.ts`：`BASE_CSS`

---

- [ ] **Step 1: 写会失败的测试**

先建包与工具链（这是本任务服务的脚手架，不单列成任务）。

`packages/element/package.json`：

```json
{
  "name": "@readit/element",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types.ts",
    "./package.json": "./package.json"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "gen:theme-css": "vite-node scripts/gen-theme-css.ts"
  },
  "dependencies": {
    "@readit/core": "0.0.0"
  },
  "devDependencies": {
    "@types/node": "24.10.1",
    "github-markdown-css": "5.9.0",
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  },
  "engines": {
    "node": ">=22"
  }
}
```

`packages/element/tsconfig.json`（`lib` 里加 `DOM` 是 P1 的类型级执行面：`@readit/core` 的 tsconfig 没有 `DOM`，所以引擎里误用浏览器全局在 `npm run typecheck` 就红）：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.ts", "vitest.config.ts"]
}
```

`packages/element/vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // P5：vitest 只捡 *.test.ts，Playwright 只捡根 browser/**/*.spec.ts。
    include: ['test/**/*.test.ts'],
    // happy-dom 不是浏览器，是一份离线的 DOM 实现——它守的是逻辑（模式切换、
    // 监听器拆没拆干净、#slug 桥接找不找得到元素）。真正的层叠、adoptedStyleSheets
    // 的视觉效果、IME 归 L3b/L4 的 Playwright，见设计文档 §7。
    environment: 'happy-dom',
    setupFiles: ['../../test/setup/no-network.ts'],
    chaiConfig: {
      truncateThreshold: 0,
    },
  },
})
```

> ⚠️ **§0 A1 + A3 已让这一步成为空操作。** Task 1 已经把 `happy-dom` 钉在 **20.11.2**
> 写进 `packages/element/package.json` 的 devDependencies（A1：Task 1 一次建齐全部 manifest）。
> 下面这条命令**不要执行**——`@latest` 违反 A3（全部依赖钉死版本，不许 `@latest`）。
> 保留原文只为说明当初的推理；实际依赖状态以已提交的 package.json 为准。

~~装依赖：~~

```bash
cd /Users/mac08/Desktop/robot/readit
# 不要执行：Task 1 已装 happy-dom@20.11.2（§0 A1/A3）
npm i
```

`packages/element/src/types.ts`（P4 逐字）：

```ts
import type { Highlighter, MathRenderer } from '@readit/core'

export type Mode = 'read' | 'source' | 'split' | 'plain'
export type Theme = 'auto' | 'light' | 'dark'

export interface MountOptions {
  value: string
  mode: Mode
  shadow: boolean
  theme: Theme
  baseUrl: string
  inlineMath: 'github' | 'strict' | 'off'
  math: MathRenderer | null
  highlighter: Highlighter | null
  emojiBase: string
  onNavigate: ((path: string) => void) | null
}

export interface MountHandle {
  setValue(value: string): void
  getValue(): string
  setMode(mode: Mode): void
  setTheme(theme: Theme): void
  destroy(): void
}
```

现在写三个测试文件。

`packages/element/test/theme-css.test.ts`：

```ts
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DARK_CSS,
  DARK_CSS_BYTES,
  LIGHT_CSS,
  LIGHT_CSS_BYTES,
  THEME_CSS_VERSION,
} from '../src/styles/theme-css.js'

const require = createRequire(import.meta.url)
const pkgDir = dirname(require.resolve('github-markdown-css/package.json'))
const onDisk = (file: string): string => readFileSync(join(pkgDir, file), 'utf8')

describe('github-markdown-css 冻结成 JS 字符串', () => {
  it('钉死在 SPEC §5 的 5.9.0', () => {
    expect(THEME_CSS_VERSION).toBe('5.9.0')
  })

  it('与 node_modules 里的单主题文件逐字节相同', () => {
    expect(LIGHT_CSS).toBe(onDisk('github-markdown-light.css'))
    expect(DARK_CSS).toBe(onDisk('github-markdown-dark.css'))
  })

  /**
   * 这条是「为什么用单主题文件」那句话的可执行形式。合并版 github-markdown.css
   * 的 dark 规则嵌在 @media (prefers-color-scheme: dark) 里，在浅色系统上无论
   * 放哪都不生效（SPEC §9.2）。哪天有人把生成脚本指到合并版，这里立刻红。
   */
  it('两份都没有 prefers-color-scheme 媒体查询', () => {
    expect(LIGHT_CSS).not.toContain('@media (prefers-color-scheme')
    expect(DARK_CSS).not.toContain('@media (prefers-color-scheme')
  })

  it('都是给 .markdown-body 用的，且没有 :root（shadow root 里 :root 不匹配任何东西）', () => {
    expect(LIGHT_CSS).toContain('.markdown-body')
    expect(DARK_CSS).toContain('.markdown-body')
    expect(LIGHT_CSS).not.toContain(':root')
    expect(DARK_CSS).not.toContain(':root')
  })

  it('字节数与常量自洽', () => {
    expect(LIGHT_CSS_BYTES).toBe(Buffer.byteLength(LIGHT_CSS, 'utf8'))
    expect(DARK_CSS_BYTES).toBe(Buffer.byteLength(DARK_CSS, 'utf8'))
  })

  /**
   * SPEC §9.2 记的是「各 22,219 B」。若这条红了，说明 SPEC 记录的字节数与
   * 5.9.0 的实际内容不符——按 §7.3 的规矩这属于「上报而非重钉」：先在 PR 里
   * 写明实测值与 SPEC 的差，再改这一个数字，不要顺手抹平。
   */
  it('字节数与 SPEC §9.2 记录的 22,219 B 一致', () => {
    expect([LIGHT_CSS_BYTES, DARK_CSS_BYTES]).toEqual([22219, 22219])
  })
})
```

`packages/element/test/theme.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDisposers } from '../src/disposers.js'
import { createThemeController, readColorScheme, resolveTheme } from '../src/theme.js'

/**
 * 主题解析用注入进来的 view 测，不测 happy-dom 的 getComputedStyle——
 * 被测的是「light dark / normal / 空串各该判成什么」这段逻辑，而不是某个
 * DOM 实现的 CSS 支持度。真实 computed color-scheme 归 L3b-element。
 */
class FakeMediaQueryList extends EventTarget {
  constructor(public matches: boolean) {
    super()
  }
  change(matches: boolean): void {
    this.matches = matches
    this.dispatchEvent(new Event('change'))
  }
}

function fakeView(colorScheme: string, mql: FakeMediaQueryList): Window {
  return {
    getComputedStyle: () => ({ colorScheme }) as CSSStyleDeclaration,
    matchMedia: () => mql as unknown as MediaQueryList,
  } as unknown as Window
}

let host: HTMLElement

beforeEach(() => {
  host = document.createElement('div')
})

describe('readColorScheme', () => {
  it.each([
    ['dark', 'dark'],
    ['light', 'light'],
    ['only dark', 'dark'],
    ['DARK', 'dark'],
  ])('color-scheme:%s 判成 %s', (raw, want) => {
    expect(readColorScheme(host, fakeView(raw, new FakeMediaQueryList(false)))).toBe(want)
  })

  it.each([['normal'], [''], ['light dark'], ['dark light']])(
    'color-scheme:%j 交给 prefers-color-scheme 定夺',
    (raw) => {
      expect(readColorScheme(host, fakeView(raw, new FakeMediaQueryList(false)))).toBeNull()
    },
  )
})

describe('resolveTheme', () => {
  it('显式 light/dark 压过一切', () => {
    const view = fakeView('dark', new FakeMediaQueryList(true))
    expect(resolveTheme('light', host, view)).toBe('light')
    expect(resolveTheme('dark', host, view)).toBe('dark')
  })

  it('auto 优先读 color-scheme', () => {
    expect(resolveTheme('auto', host, fakeView('dark', new FakeMediaQueryList(false)))).toBe('dark')
  })

  it('auto 在 color-scheme 未定时回落 prefers-color-scheme', () => {
    expect(resolveTheme('auto', host, fakeView('normal', new FakeMediaQueryList(true)))).toBe('dark')
    expect(resolveTheme('auto', host, fakeView('normal', new FakeMediaQueryList(false)))).toBe('light')
  })
})

describe('createThemeController', () => {
  it('把解析结果写在宿主的 data-theme 上，destroy 时撤掉', () => {
    const disposers = createDisposers()
    const controller = createThemeController(
      host,
      fakeView('normal', new FakeMediaQueryList(false)),
      'auto',
      () => {},
      disposers,
    )
    expect(controller.resolved).toBe('light')
    expect(host.getAttribute('data-theme')).toBe('light')
    disposers.disposeAll()
    expect(host.getAttribute('data-theme')).toBeNull()
  })

  it('系统主题变化时重解析，并只在结果真的变了才回调', () => {
    const mql = new FakeMediaQueryList(false)
    const onResolved = vi.fn()
    const disposers = createDisposers()
    createThemeController(host, fakeView('normal', mql), 'auto', onResolved, disposers)

    mql.change(true)
    expect(onResolved).toHaveBeenCalledExactlyOnceWith('dark')
    expect(host.getAttribute('data-theme')).toBe('dark')

    mql.change(true)
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  it('theme 不是 auto 时忽略系统主题变化', () => {
    const mql = new FakeMediaQueryList(false)
    const onResolved = vi.fn()
    const disposers = createDisposers()
    const controller = createThemeController(host, fakeView('normal', mql), 'auto', onResolved, disposers)
    controller.set('light')
    onResolved.mockClear()
    mql.change(true)
    expect(onResolved).not.toHaveBeenCalled()
    expect(controller.resolved).toBe('light')
  })

  it('disposeAll 之后不再收系统主题变化', () => {
    const mql = new FakeMediaQueryList(false)
    const onResolved = vi.fn()
    const disposers = createDisposers()
    createThemeController(host, fakeView('normal', mql), 'auto', onResolved, disposers)
    disposers.disposeAll()
    mql.change(true)
    expect(onResolved).not.toHaveBeenCalled()
    expect(disposers.size).toBe(0)
  })
})
```

`packages/element/test/shadow.test.ts`：

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { createDisposers } from '../src/disposers.js'
import { createRoot } from '../src/shadow.js'

let hosts: HTMLElement[] = []

function makeHost(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  return host
}

afterEach(() => {
  for (const host of hosts) host.remove()
  hosts = []
})

describe('createRoot', () => {
  it('shadow:true 建 open shadow root，并在里面放 part="root" 的外层元素', () => {
    const host = makeHost()
    const ctx = createRoot(host, true, createDisposers())
    expect(host.shadowRoot).not.toBeNull()
    expect(host.shadowRoot?.mode).toBe('open')
    expect(ctx.container).toBe(host.shadowRoot)
    expect(ctx.root.getAttribute('part')).toBe('root')
    expect(ctx.root.parentNode).toBe(host.shadowRoot)
  })

  it('shadow:false 逃生舱直接用宿主自己当容器', () => {
    const host = makeHost()
    const ctx = createRoot(host, false, createDisposers())
    expect(host.shadowRoot).toBeNull()
    expect(ctx.container).toBe(host)
    expect(ctx.root.parentNode).toBe(host)
  })

  it('shadow 档走 adoptedStyleSheets，替换而不是追加', () => {
    const host = makeHost()
    const ctx = createRoot(host, true, createDisposers())
    expect(ctx.adopted).toBe(true)
    const shadow = host.shadowRoot
    if (shadow === null) throw new Error('unreachable')
    ctx.setStyles(['a{color:red}', 'b{color:blue}'])
    expect(shadow.adoptedStyleSheets).toHaveLength(2)
    ctx.setStyles(['c{color:green}'])
    expect(shadow.adoptedStyleSheets).toHaveLength(1)
    expect(shadow.querySelectorAll('style')).toHaveLength(0)
  })

  it('light DOM 档回落到单个 <style>，内容按给定顺序拼接', () => {
    const host = makeHost()
    const ctx = createRoot(host, false, createDisposers())
    expect(ctx.adopted).toBe(false)
    ctx.setStyles(['a{color:red}', 'b{color:blue}'])
    const styles = host.querySelectorAll('style[data-readit="styles"]')
    expect(styles).toHaveLength(1)
    expect(styles[0]?.textContent).toBe('a{color:red}\nb{color:blue}')
    ctx.setStyles(['c{color:green}'])
    expect(host.querySelectorAll('style[data-readit="styles"]')).toHaveLength(1)
    expect(host.querySelector('style[data-readit="styles"]')?.textContent).toBe('c{color:green}')
  })

  it('同一个宿主重复挂载不因 attachShadow 抛错', () => {
    const host = makeHost()
    const first = createDisposers()
    createRoot(host, true, first)
    first.disposeAll()
    expect(() => createRoot(host, true, createDisposers())).not.toThrow()
    expect(host.shadowRoot?.querySelectorAll('.readit-root')).toHaveLength(1)
  })

  /** SPEC §9.2：永不写 document.documentElement / document.body。 */
  it('从不碰 document 的样式表、head 或 documentElement', () => {
    const headBefore = document.head.innerHTML
    const docSheetsBefore = document.adoptedStyleSheets.length
    const host = makeHost()
    const ctx = createRoot(host, true, createDisposers())
    ctx.setStyles(['a{color:red}'])
    expect(document.head.innerHTML).toBe(headBefore)
    expect(document.adoptedStyleSheets).toHaveLength(docSheetsBefore)
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
    expect(document.documentElement.getAttribute('style')).toBeNull()
  })

  it('disposeAll 把外层元素、<style> 与 adoptedStyleSheets 全撤干净', () => {
    const host = makeHost()
    const disposers = createDisposers()
    const ctx = createRoot(host, true, disposers)
    ctx.setStyles(['a{color:red}'])
    disposers.disposeAll()
    expect(host.shadowRoot?.childNodes).toHaveLength(0)
    expect(host.shadowRoot?.adoptedStyleSheets).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd /Users/mac08/Desktop/robot/readit
npm test -w @readit/element
```

预期：三个文件全部因模块不存在而失败。

```
FAIL  test/theme-css.test.ts [ test/theme-css.test.ts ]
Error: Failed to load url ../src/styles/theme-css.js
FAIL  test/theme.test.ts [ test/theme.test.ts ]
Error: Failed to load url ../src/theme.js
FAIL  test/shadow.test.ts [ test/shadow.test.ts ]
Error: Failed to load url ../src/shadow.js
Test Files  3 failed (3)
```

若 `shadow.test.ts` 里 `expect(ctx.adopted).toBe(true)` 在实现写完后仍然红：说明所选 happy-dom 版本不实现 `adoptedStyleSheets`（换 jsdom 不能解决，它同样不实现）。正确处理是把那一条改成断言 `<style>` 回落，把 adopted 分支的覆盖移进 L3b-element 的 Playwright 清单，并在 PR 里把这个覆盖缺口具名写出来——不要把断言删掉了事。

- [ ] **Step 3: 写最小实现**

`packages/element/src/disposers.ts`：

```ts
/**
 * 一个挂载实例在生命期里注册的全部「需要拆掉的东西」。
 *
 * destroy() 的完整性由 test/leak.test.ts 的探针守，不靠代码评审看（设计文档 §3.5）。
 * 那条探针同时守着一条结构约束：src/ 里除本文件外不得直接调用 addEventListener。
 */
export interface Disposers {
  add(dispose: () => void): void
  /** 尚未拆掉的登记项数量。 */
  readonly size: number
  /** 逆序执行并清空。重复调用是安全的空操作。 */
  disposeAll(): void
}

export function createDisposers(): Disposers {
  const entries: Array<() => void> = []
  return {
    add(dispose: () => void): void {
      entries.push(dispose)
    },
    get size(): number {
      return entries.length
    },
    disposeAll(): void {
      // 逆序：后注册的通常建立在先注册的之上。
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const dispose = entries[i]
        if (dispose !== undefined) dispose()
      }
      entries.length = 0
    },
  }
}

/** 唯一允许的 addEventListener 入口——绕过它注册的监听器不会被 destroy() 拆掉。 */
export function addListener(
  disposers: Disposers,
  target: EventTarget,
  type: string,
  handler: EventListener,
  options?: AddEventListenerOptions,
): void {
  target.addEventListener(type, handler, options)
  disposers.add(() => {
    target.removeEventListener(type, handler, options)
  })
}
```

`packages/element/src/shadow.ts`：

```ts
import type { Disposers } from './disposers.js'

export interface RootContext {
  readonly host: HTMLElement
  /** 宿主所属的 window。跨 iframe 时它不是 globalThis。 */
  readonly view: Window
  /** 样式与内容的容器：shadow:true 时是 ShadowRoot，false 时是宿主自身。 */
  readonly container: ShadowRoot | HTMLElement
  /** part="root" 的外层元素。 */
  readonly root: HTMLDivElement
  /** true = 走 adoptedStyleSheets；false = 回落到一个 <style> 元素。 */
  readonly adopted: boolean
  /** 按给定顺序整体替换样式表，数组顺序即层叠顺序。 */
  setStyles(cssTexts: readonly string[]): void
}

export function ownerView(host: HTMLElement): Window {
  const view = host.ownerDocument.defaultView
  if (view === null) {
    throw new Error('readit: 宿主元素不属于任何 window（游离的 document？），无法挂载')
  }
  return view
}

/**
 * Safari 16.4 之前的 WKWebView 没有 ShadowRoot.adoptedStyleSheets，
 * light DOM 逃生舱则根本没有这个属性——两条路都要有 <style> 回落。
 */
function canAdopt(container: ShadowRoot | HTMLElement, view: Window): boolean {
  if (!('adoptedStyleSheets' in container)) return false
  try {
    new view.CSSStyleSheet()
    return true
  } catch {
    return false
  }
}

export function createRoot(host: HTMLElement, shadow: boolean, disposers: Disposers): RootContext {
  const view = ownerView(host)
  const doc = host.ownerDocument
  // 同一个宿主被挂载第二次时 attachShadow 会抛 NotSupportedError，复用既有的。
  const container: ShadowRoot | HTMLElement = shadow
    ? (host.shadowRoot ?? host.attachShadow({ mode: 'open' }))
    : host
  const adopted = canAdopt(container, view)

  const root = doc.createElement('div')
  root.className = 'readit-root'
  root.setAttribute('part', 'root')
  // 导航后要能把焦点放进来（#slug 桥接、后退键），但不进 Tab 序列。
  root.setAttribute('tabindex', '-1')
  container.appendChild(root)

  let styleEl: HTMLStyleElement | null = null

  const setStyles = (cssTexts: readonly string[]): void => {
    if (adopted) {
      const sheets = cssTexts.map((text) => {
        const sheet = new view.CSSStyleSheet()
        sheet.replaceSync(text)
        return sheet
      })
      ;(container as ShadowRoot).adoptedStyleSheets = sheets
      return
    }
    if (styleEl === null) {
      styleEl = doc.createElement('style')
      styleEl.setAttribute('data-readit', 'styles')
      container.insertBefore(styleEl, container.firstChild)
    }
    styleEl.textContent = cssTexts.join('\n')
  }

  disposers.add(() => {
    if (adopted) (container as ShadowRoot).adoptedStyleSheets = []
    if (styleEl !== null) {
      styleEl.remove()
      styleEl = null
    }
    root.remove()
  })

  return { host, view, container, root, adopted, setStyles }
}
```

`packages/element/src/theme.ts`：

```ts
import { addListener, type Disposers } from './disposers.js'
import type { Theme } from './types.js'

export type ResolvedTheme = 'light' | 'dark'

/**
 * `color-scheme` 是继承属性、跨 shadow 边界，所以宿主设在 :root、设在 .dark
 * 包装器上还是压根没设都工作（SPEC §9.2）。
 *
 * 没设时它的计算值是 `normal`，`light dark` 则表示两种都支持——这两种都不构成
 * 一个判定，交给 prefers-color-scheme。返回 null 表示「没判定」，不是「light」。
 */
export function readColorScheme(host: HTMLElement, view: Window): ResolvedTheme | null {
  let raw = ''
  try {
    raw = view.getComputedStyle(host).colorScheme
  } catch {
    raw = ''
  }
  const words = (raw ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '' && word !== 'only')
  const hasLight = words.includes('light')
  const hasDark = words.includes('dark')
  if (hasDark && !hasLight) return 'dark'
  if (hasLight && !hasDark) return 'light'
  return null
}

export function prefersDark(view: Window): boolean {
  if (typeof view.matchMedia !== 'function') return false
  return view.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(theme: Theme, host: HTMLElement, view: Window): ResolvedTheme {
  if (theme === 'light' || theme === 'dark') return theme
  return readColorScheme(host, view) ?? (prefersDark(view) ? 'dark' : 'light')
}

export interface ThemeController {
  readonly requested: Theme
  readonly resolved: ResolvedTheme
  set(theme: Theme): void
}

/**
 * 已知局限，写在这里而不是留给人发现：宿主在运行时改 `color-scheme`（例如给
 * :root 加 .dark 类）是观察不到的，CSS 没有这样的事件。宿主要么用 theme:'light'
 * /'dark' 显式驱动，要么在切换后再调一次 setTheme('auto')。系统主题变化则通过
 * prefers-color-scheme 的 matchMedia 收到。
 */
export function createThemeController(
  host: HTMLElement,
  view: Window,
  initial: Theme,
  onResolved: (resolved: ResolvedTheme) => void,
  disposers: Disposers,
): ThemeController {
  let requested = initial
  let resolved = resolveTheme(requested, host, view)

  const apply = (next: ResolvedTheme): void => {
    if (next === resolved) return
    resolved = next
    host.setAttribute('data-theme', resolved)
    onResolved(resolved)
  }

  host.setAttribute('data-theme', resolved)
  disposers.add(() => {
    host.removeAttribute('data-theme')
  })

  if (typeof view.matchMedia === 'function') {
    const mql = view.matchMedia('(prefers-color-scheme: dark)')
    addListener(disposers, mql, 'change', () => {
      if (requested === 'auto') apply(resolveTheme('auto', host, view))
    })
  }

  return {
    get requested(): Theme {
      return requested
    },
    get resolved(): ResolvedTheme {
      return resolved
    },
    set(theme: Theme): void {
      requested = theme
      apply(resolveTheme(theme, host, view))
    },
  }
}
```

`packages/element/src/styles/base-css.ts`：

```ts
/**
 * 自家的版面规则。github-markdown-css 只管 .markdown-body 内部的排版，窗格布局、
 * 源码回落样式与错误态是我们自己的。
 *
 * :host 规则在 shadow:false 逃生舱下不匹配任何东西——那是逃生舱的定义（宿主自己
 * 管样式），所以布局全部挂在 .readit-root 上，:host 只留一条 display。
 */
export const BASE_CSS = `
:host { display: block; }
:host([hidden]) { display: none; }
.readit-root { position: relative; height: 100%; min-width: 0; outline: none; }
.readit-root[data-mode="split"] { display: grid; grid-template-columns: 1fr 1fr; }
.readit-pane { min-width: 0; overflow: auto; }
.readit-pane[hidden] { display: none; }
.readit-source-fallback {
  margin: 0; padding: 16px; white-space: pre-wrap; overflow-wrap: anywhere;
  font: 12px/1.45 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
.readit-error { margin: 16px; padding: 12px 16px; border: 1px solid #cf222e; border-radius: 6px; }
.readit-error[hidden] { display: none; }
.readit-error-title { margin: 0 0 4px; font-weight: 600; }
.readit-error-path {
  margin: 0; overflow-wrap: anywhere;
  font: 12px/1.45 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
.readit-error-detail { margin: 4px 0 0; font-size: 12px; }
.readit-error-detail:empty { display: none; }
`
```

`packages/element/scripts/gen-theme-css.ts`：

```ts
/**
 * 把 github-markdown-css 的两个单主题文件冻结成 JS 字符串模块。
 *
 * 为什么是单主题文件而不是合并版：合并版 github-markdown.css 的 dark 规则嵌在
 * @media (prefers-color-scheme: dark) 里，在浅色系统上无论放哪都不生效（SPEC §9.2）。
 * 下面的检查就是把这句话从注释变成会失败的东西。
 *
 * 为什么内联成 JS 字符串而不是 `import s from './x.css' with { type: 'css' }`：
 * 后者强迫每个消费者的打包器支持 CSS import 属性（SPEC §9.3、决策台账 17）。
 *
 * 跑法：npm run gen:theme-css -w @readit/element
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const pkgJsonPath = require.resolve('github-markdown-css/package.json')
const pkgDir = dirname(pkgJsonPath)
const version = (JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { version: string }).version

function readTheme(file: string): string {
  const text = readFileSync(join(pkgDir, file), 'utf8')
  if (text.includes('@media (prefers-color-scheme')) {
    throw new Error(
      `readit: ${file} 含 @media (prefers-color-scheme …)。单主题文件不该有——` +
        '取到的多半是合并版 github-markdown.css，它在浅色系统上放哪都不生效。见 SPEC §9.2。',
    )
  }
  if (!text.includes('.markdown-body')) {
    throw new Error(`readit: ${file} 里没有 .markdown-body，不像是 github-markdown-css`)
  }
  return text
}

const light = readTheme('github-markdown-light.css')
const dark = readTheme('github-markdown-dark.css')

const source = [
  '// @generated by scripts/gen-theme-css.ts —— 不要手改。',
  `// 源：github-markdown-css@${version}（github-markdown-light.css / github-markdown-dark.css）`,
  '// 重新生成：npm run gen:theme-css -w @readit/element',
  '',
  `export const THEME_CSS_VERSION = ${JSON.stringify(version)}`,
  `export const LIGHT_CSS_BYTES = ${Buffer.byteLength(light, 'utf8')}`,
  `export const DARK_CSS_BYTES = ${Buffer.byteLength(dark, 'utf8')}`,
  `export const LIGHT_CSS = ${JSON.stringify(light)}`,
  `export const DARK_CSS = ${JSON.stringify(dark)}`,
  '',
].join('\n')

writeFileSync(new URL('../src/styles/theme-css.ts', import.meta.url), source)
process.stdout.write(
  `theme-css.ts: light ${Buffer.byteLength(light, 'utf8')} B, dark ${Buffer.byteLength(dark, 'utf8')} B\n`,
)
```

跑生成器（产物要提交，见 Step 5）：

```bash
cd /Users/mac08/Desktop/robot/readit
npm run gen:theme-css -w @readit/element
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit
npm test -w @readit/element
npm run typecheck
```

- [ ] **Step 5: 提交**

```bash
cd /Users/mac08/Desktop/robot/readit
git add packages/element package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(element): Shadow DOM 容器与主题——两个单主题文件冻结成 JS 字符串

新工作区包 @readit/element 的第一层：shadow root（open 默认、shadow:false
逃生舱）、adoptedStyleSheets（无此能力时回落到单个 <style>）、主题解析。

github-markdown-css 5.9.0 的两个单主题文件由 scripts/gen-theme-css.ts 冻结成
JS 字符串并提交。用单主题文件不是偏好：合并版的 dark 规则嵌在
@media (prefers-color-scheme: dark) 里，在浅色系统上无论放哪都不生效。生成器
与测试各有一条检查把这句话变成会失败的东西，而不是留一行注释。

theme:'auto' 读 getComputedStyle(host).colorScheme；`normal` 与 `light dark`
都不算判定，回落 prefers-color-scheme 的 matchMedia。整条路径不写
document.documentElement / document.body，有断言守着。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

---

### Task 4: 注入路径、模式状态机、mount() 与 defineReadit()

**Files:**
- Create: `packages/element/src/set-html.ts`
- Create: `packages/element/src/kernel.ts`
- Create: `packages/element/src/index.ts`
- Test: `packages/element/test/set-html.test.ts`
- Test: `packages/element/test/mount.test.ts`
- Test: `packages/element/test/define.test.ts`
- Test: `packages/element/test/no-auto-define.test.ts`

**Interfaces:**
- Consumes（Task 3）：`createDisposers()`、`Disposers`、`createRoot(host, shadow, disposers): RootContext`、`ownerView(host): Window`、`createThemeController(host, view, initial, onResolved, disposers): ThemeController`、`ResolvedTheme`、`LIGHT_CSS`、`DARK_CSS`、`BASE_CSS`、`Mode`、`Theme`、`MountOptions`、`MountHandle`
- Consumes（`@readit/core`，值导入，P1 允许）：`render(src: string, opts?: Partial<RenderOptions>): string`、`GITHUB_EMOJI_BASE: string`
- Produces:
  - `packages/element/src/set-html.ts`：`setHtml(el: Element, html: string): void`
  - `packages/element/src/kernel.ts`：`createKernel(host: HTMLElement, opts: MountOptions): Kernel`、`resolveMountOptions(opts?: Partial<MountOptions>): MountOptions`、`DEFAULT_MOUNT_OPTIONS: MountOptions`、`isMode(v: string): v is Mode`、`isTheme(v: string): v is Theme`、`isInlineMath(v: string): v is MountOptions['inlineMath']`、`dedent(src: string): string`，`interface Kernel { readonly host; readonly options; readonly root: RootContext; readonly disposers: Disposers; readonly content: HTMLDivElement; readonly sourcePane: HTMLDivElement; readonly destroyed: boolean; onAfterRender(fn: () => void): void; rerender(): void; getValue(): string; setValue(v: string): void; getMode(): Mode; setMode(m: Mode): void; setTheme(t: Theme): void; destroy(): void }`
  - `packages/element/src/index.ts`：`mount(host, opts?): MountHandle`、`defineReadit(tag?: string): void`、`DEFAULT_TAG = 'readit-view'`

---

- [ ] **Step 1: 写会失败的测试**

装 dompurify（SPEC §5 已为 `@readit/mermaid` 钉死 3.4.13，同版本复用，避免同一棵树里两份 DOMPurify）：

```bash
cd /Users/mac08/Desktop/robot/readit
npm i -w @readit/element --save-exact dompurify@3.4.13
```

`packages/element/test/set-html.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setHtml } from '../src/set-html.js'

const SAMPLE =
  '<p dir="auto" data-line="2">hi <a href="./x.md">x</a></p>'

const restores: Array<() => void> = []

afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore()
})

function stubSetHTML(impl: (this: Element, input: string) => void): void {
  const proto = Element.prototype as Element & { setHTML?: (input: string) => void }
  const had = 'setHTML' in proto
  const previous = proto.setHTML
  proto.setHTML = impl
  restores.push(() => {
    if (had) proto.setHTML = previous
    else delete proto.setHTML
  })
}

function stubTrustedTypes(factory: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'trustedTypes')
  Object.defineProperty(window, 'trustedTypes', { value: factory, configurable: true, writable: true })
  restores.push(() => {
    if (descriptor === undefined) Reflect.deleteProperty(window, 'trustedTypes')
    else Object.defineProperty(window, 'trustedTypes', descriptor)
  })
}

describe('setHtml 的三级注入路径', () => {
  it('第 3 级（默认）：innerHTML，Phase A 的属性与结构原样进 DOM', () => {
    const el = document.createElement('div')
    setHtml(el, SAMPLE)
    expect(el.querySelector('p')?.getAttribute('data-line')).toBe('2')
    expect(el.querySelector('a')?.getAttribute('href')).toBe('./x.md')
  })

  it('第 1 级：有 Element.setHTML 时用它，不碰 innerHTML', () => {
    const calls: string[] = []
    stubSetHTML(function (this: Element, input: string): void {
      calls.push(input)
      this.textContent = 'via-setHTML'
    })
    const el = document.createElement('div')
    setHtml(el, SAMPLE)
    expect(calls).toEqual([SAMPLE])
    expect(el.textContent).toBe('via-setHTML')
  })

  it('第 2 级：无 setHTML 但有 trustedTypes 时走单一策略，且策略只建一次', () => {
    const created: string[] = []
    const factory = {
      createPolicy(name: string, rules: { createHTML(input: string): string }) {
        created.push(name)
        return { createHTML: (input: string) => rules.createHTML(input) }
      },
    }
    stubTrustedTypes(factory)
    const first = document.createElement('div')
    const second = document.createElement('div')
    setHtml(first, SAMPLE)
    setHtml(second, SAMPLE)
    // 'readit' 一次；'dompurify' 是 DOMPurify 自己那条，允许出现，但 'readit' 不得重复。
    expect(created.filter((name) => name === 'readit')).toHaveLength(1)
    expect(first.querySelector('a')?.getAttribute('href')).toBe('./x.md')
    expect(second.querySelector('p')).not.toBeNull()
  })

  it('第 2 级：CSP 不允许建策略时抛出点名了所需指令的错误，而不是静默失败', () => {
    stubTrustedTypes({
      createPolicy(): never {
        throw new TypeError("Refused to create a TrustedTypePolicy named 'readit'")
      },
    })
    const el = document.createElement('div')
    expect(() => setHtml(el, SAMPLE)).toThrow(/trusted-types readit dompurify/)
  })

  it('第 1 级优先于第 2 级', () => {
    const setHTML = vi.fn()
    stubSetHTML(setHTML)
    stubTrustedTypes({
      createPolicy(): never {
        throw new Error('不该走到这里')
      },
    })
    setHtml(document.createElement('div'), SAMPLE)
    expect(setHTML).toHaveBeenCalledOnce()
  })
})
```

`packages/element/test/mount.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKernel, DEFAULT_MOUNT_OPTIONS, dedent, resolveMountOptions } from '../src/kernel.js'
import { mount } from '../src/index.js'
import { DARK_CSS, LIGHT_CSS } from '../src/styles/theme-css.js'

const DOC = '# Hello World\n\ntext\n\n```js\nvar a = 1\n```\n'

let hosts: HTMLElement[] = []

function makeHost(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  return host
}

afterEach(() => {
  for (const host of hosts) host.remove()
  hosts = []
})

describe('mount 的默认值', () => {
  it('缺省是 read / shadow / auto，与 P4 的 MountOptions 一一对上', () => {
    expect(DEFAULT_MOUNT_OPTIONS).toEqual({
      value: '',
      mode: 'read',
      shadow: true,
      theme: 'auto',
      baseUrl: '',
      inlineMath: 'github',
      math: null,
      highlighter: null,
      emojiBase: 'https://github.githubassets.com/images/icons/emoji/',
      onNavigate: null,
    })
  })

  it('resolveMountOptions 只覆盖给了的键', () => {
    expect(resolveMountOptions({ mode: 'split' }).mode).toBe('split')
    expect(resolveMountOptions({ mode: 'split' }).theme).toBe('auto')
  })

  /**
   * MountHandle 上没有 find()——查找属 M6（设计文档 §9 修订 2）。留空壳挨过评审
   * 批评，所以这条把「不存在」也钉住：宿主 typeof 检查得到 undefined，而不是一个
   * 永远返回空的方法。
   */
  it('MountHandle 恰好是 P4 的五个方法，没有 find', () => {
    const handle = mount(makeHost(), { value: DOC })
    expect(Object.keys(handle).sort()).toEqual(['destroy', 'getMode', 'getValue', 'setMode', 'setTheme', 'setValue'].filter((k) => k !== 'getMode'))
    expect((handle as unknown as Record<string, unknown>)['find']).toBeUndefined()
    handle.destroy()
  })
})

describe('read 模式渲染', () => {
  it('把 Phase A 的输出注入 shadow root 的 .markdown-body', () => {
    const host = makeHost()
    mount(host, { value: DOC })
    const content = host.shadowRoot?.querySelector('.markdown-body')
    expect(content?.querySelector('h1')?.textContent).toBe('Hello World')
    expect(content?.querySelector('h1')?.getAttribute('data-line')).toBe('0')
  })

  it('只开 root / content / code-block 三个 part（设计文档 §9 修订 3）', () => {
    const host = makeHost()
    mount(host, { value: DOC })
    const shadow = host.shadowRoot
    const parts = [...(shadow?.querySelectorAll('[part]') ?? [])].map((el) => el.getAttribute('part'))
    expect(new Set(parts)).toEqual(new Set(['root', 'content', 'code-block']))
  })

  /**
   * part="code-block" 只能在注入之后补：Phase A 的输出字节是冻结的（56/68 那条
   * 基线），往 <pre> 上加属性会动它。
   */
  it('code-block 的 part 是注入后补的，Phase A 的字符串里没有', () => {
    const host = makeHost()
    mount(host, { value: DOC })
    const pre = host.shadowRoot?.querySelector('pre')
    expect(pre?.getAttribute('part')).toBe('code-block')
  })

  it('setValue 重渲，getValue 拿回源码而不是 HTML', () => {
    const host = makeHost()
    const handle = mount(host, { value: DOC })
    handle.setValue('## Second\n')
    expect(handle.getValue()).toBe('## Second\n')
    expect(host.shadowRoot?.querySelector('h2')?.textContent).toBe('Second')
    expect(host.shadowRoot?.querySelector('h1')).toBeNull()
  })

  it('shadow:false 时内容直接进宿主，不建 shadow root', () => {
    const host = makeHost()
    mount(host, { value: DOC, shadow: false })
    expect(host.shadowRoot).toBeNull()
    expect(host.querySelector('.markdown-body h1')?.textContent).toBe('Hello World')
  })
})

describe('模式状态机', () => {
  it('read 只显示预览窗格', () => {
    const kernel = createKernel(makeHost(), resolveMountOptions({ value: DOC }))
    expect(kernel.content.hidden).toBe(false)
    expect(kernel.sourcePane.hidden).toBe(true)
    expect(kernel.root.root.getAttribute('data-mode')).toBe('read')
  })

  it.each([['source'], ['plain']] as const)('%s 只显示源码窗格', (mode) => {
    const kernel = createKernel(makeHost(), resolveMountOptions({ value: DOC, mode }))
    expect(kernel.content.hidden).toBe(true)
    expect(kernel.sourcePane.hidden).toBe(false)
    expect(kernel.root.root.getAttribute('data-mode')).toBe(mode)
  })

  it('split 两个窗格都显示', () => {
    const kernel = createKernel(makeHost(), resolveMountOptions({ value: DOC, mode: 'split' }))
    expect(kernel.content.hidden).toBe(false)
    expect(kernel.sourcePane.hidden).toBe(false)
  })

  /**
   * 编辑器是 Task 13–17。在它接进来之前，源码窗格不是空白也不抛——按 §12
   * 「降级必须可见」显示只读源码，并用 data-editor="none" 把这个状态说出来。
   */
  it('编辑器未接入时源码窗格显示只读源码，并自报 data-editor="none"', () => {
    const kernel = createKernel(makeHost(), resolveMountOptions({ value: DOC, mode: 'source' }))
    const pre = kernel.sourcePane.querySelector('pre.readit-source-fallback')
    expect(pre?.getAttribute('data-editor')).toBe('none')
    expect(pre?.textContent).toBe(DOC)
  })

  it('切模式是幂等的，来回切不留残留节点', () => {
    const kernel = createKernel(makeHost(), resolveMountOptions({ value: DOC }))
    kernel.setMode('split')
    kernel.setMode('split')
    kernel.setMode('read')
    expect(kernel.sourcePane.childNodes).toHaveLength(0)
    expect(kernel.content.querySelectorAll('h1')).toHaveLength(1)
  })

  it('setValue 在 split 下同时更新两个窗格', () => {
    const kernel = createKernel(makeHost(), resolveMountOptions({ value: DOC, mode: 'split' }))
    kernel.setValue('# New\n')
    expect(kernel.content.querySelector('h1')?.textContent).toBe('New')
    expect(kernel.sourcePane.textContent).toBe('# New\n')
  })
})

describe('主题接线', () => {
  it('setTheme 换的是整张样式表，不是往上叠一张', () => {
    const host = makeHost()
    const kernel = createKernel(host, resolveMountOptions({ value: DOC, theme: 'light' }))
    const shadow = host.shadowRoot
    if (shadow === null) throw new Error('unreachable')
    expect(shadow.adoptedStyleSheets).toHaveLength(2)
    expect(host.getAttribute('data-theme')).toBe('light')
    kernel.setTheme('dark')
    expect(shadow.adoptedStyleSheets).toHaveLength(2)
    expect(host.getAttribute('data-theme')).toBe('dark')
  })

  it('light 与 dark 用的是两份不同的单主题文件', () => {
    expect(LIGHT_CSS).not.toBe(DARK_CSS)
  })

  it('永不写 document.documentElement / document.body 的样式', () => {
    const headBefore = document.head.innerHTML
    const host = makeHost()
    const handle = mount(host, { value: DOC, theme: 'dark' })
    expect(document.head.innerHTML).toBe(headBefore)
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
    expect(document.body.getAttribute('data-theme')).toBeNull()
    expect(document.adoptedStyleSheets).toHaveLength(0)
    handle.destroy()
  })
})

describe('destroy 之后', () => {
  it('再用句柄会抛出说得清的错误，而不是静默无事发生', () => {
    const handle = mount(makeHost(), { value: DOC })
    handle.destroy()
    expect(() => handle.setValue('x')).toThrow(/已经 destroy/)
    expect(() => handle.setMode('split')).toThrow(/已经 destroy/)
    expect(() => handle.setTheme('dark')).toThrow(/已经 destroy/)
  })

  it('destroy 可以重复调用', () => {
    const handle = mount(makeHost(), { value: DOC })
    handle.destroy()
    expect(() => handle.destroy()).not.toThrow()
  })
})

describe('dedent', () => {
  it('去掉公共缩进——4 个空格在 Markdown 里是代码块，不能带进去', () => {
    expect(dedent('\n      # Title\n\n      text\n    ')).toBe('# Title\n\ntext\n')
  })

  it('没有公共缩进时原样返回', () => {
    expect(dedent('# Title\n  indented\n')).toBe('# Title\n  indented\n')
  })
})

describe('未知选项值', () => {
  it('渲染选项照单全收，不猜', () => {
    const highlight = { highlight: vi.fn(() => null), supports: vi.fn(() => false) }
    createKernel(makeHost(), resolveMountOptions({ value: DOC, highlighter: highlight }))
    expect(highlight.supports).toHaveBeenCalledWith('js')
  })
})
```

`packages/element/test/define.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineReadit, DEFAULT_TAG } from '../src/index.js'

let mounted: HTMLElement[] = []

function attach(tag: string, attrs: Record<string, string>, text: string): HTMLElement {
  const el = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value)
  el.textContent = text
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

afterEach(() => {
  for (const el of mounted) el.remove()
  mounted = []
})

describe('defineReadit', () => {
  it('默认注册 readit-view', () => {
    defineReadit()
    expect(DEFAULT_TAG).toBe('readit-view')
    expect(customElements.get('readit-view')).toBeTypeOf('function')
  })

  /** 自动注册会让同页两个版本抛不可恢复的 NotSupportedError（SPEC §9.3）。 */
  it('重复调用是空操作，不抛 NotSupportedError', () => {
    defineReadit()
    expect(() => defineReadit()).not.toThrow()
  })

  it('可以用别的标签名，且两个标签名各自是独立的类', () => {
    defineReadit('readit-a')
    defineReadit('readit-b')
    expect(customElements.get('readit-a')).not.toBe(customElements.get('readit-b'))
  })

  it('连上 DOM 时用轻 DOM 里的源码当初始值，并把它清掉', () => {
    defineReadit('readit-c1')
    const el = attach('readit-c1', {}, '\n      # From light DOM\n    ')
    expect(el.shadowRoot?.querySelector('h1')?.textContent).toBe('From light DOM')
    expect(el.childNodes).toHaveLength(0)
  })

  it('mode / theme 属性是活的', () => {
    defineReadit('readit-c2')
    const el = attach('readit-c2', { mode: 'split' }, '# t\n')
    expect(el.shadowRoot?.querySelector('.readit-root')?.getAttribute('data-mode')).toBe('split')
    el.setAttribute('mode', 'read')
    expect(el.shadowRoot?.querySelector('.readit-root')?.getAttribute('data-mode')).toBe('read')
    el.setAttribute('theme', 'dark')
    expect(el.getAttribute('data-theme')).toBe('dark')
  })

  it('shadow="false" 走逃生舱', () => {
    defineReadit('readit-c3')
    const el = attach('readit-c3', { shadow: 'false' }, '# t\n')
    expect(el.shadowRoot).toBeNull()
    expect(el.querySelector('.markdown-body h1')).not.toBeNull()
  })

  it('非法的 mode 值回落并 warn，而不是静默当成 read', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    defineReadit('readit-c4')
    const el = attach('readit-c4', { mode: 'nope' }, '# t\n')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mode="nope"'))
    expect(el.shadowRoot?.querySelector('.readit-root')?.getAttribute('data-mode')).toBe('read')
    warn.mockRestore()
  })

  it('从 DOM 摘下来会 destroy，再挂回去保留当前值', () => {
    defineReadit('readit-c5')
    const el = attach('readit-c5', {}, '# t\n')
    ;(el as HTMLElement & { value: string }).value = '# changed\n'
    el.remove()
    expect(el.shadowRoot?.childNodes).toHaveLength(0)
    document.body.appendChild(el)
    expect(el.shadowRoot?.querySelector('h1')?.textContent).toBe('changed')
  })

  it('value 属性读写走内核', () => {
    defineReadit('readit-c6')
    const el = attach('readit-c6', {}, '# t\n') as HTMLElement & { value: string }
    expect(el.value).toBe('# t\n')
    el.value = '# v2\n'
    expect(el.shadowRoot?.querySelector('h1')?.textContent).toBe('v2')
  })
})
```

`packages/element/test/no-auto-define.test.ts`（单独一个文件：vitest 默认按文件隔离，只有这样才能断言「这次 import 之前注册表是空的」）：

```ts
import { describe, expect, it } from 'vitest'

describe('import 时不自动注册', () => {
  it('import @readit/element 不碰 customElements', async () => {
    expect(customElements.get('readit-view')).toBeUndefined()
    const mod = await import('../src/index.js')
    expect(customElements.get('readit-view')).toBeUndefined()
    expect(mod.defineReadit).toBeTypeOf('function')
  })
})
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd /Users/mac08/Desktop/robot/readit
npm test -w @readit/element
```

预期：`theme*.test.ts` / `shadow.test.ts` 仍绿，四个新文件全红。

```
FAIL  test/set-html.test.ts  Error: Failed to load url ../src/set-html.js
FAIL  test/mount.test.ts     Error: Failed to load url ../src/kernel.js
FAIL  test/define.test.ts    Error: Failed to load url ../src/index.js
FAIL  test/no-auto-define.test.ts  Error: Failed to load url ../src/index.js
Test Files  4 failed | 3 passed (7)
```

- [ ] **Step 3: 写最小实现**

`packages/element/src/set-html.ts`：

```ts
import DOMPurify from 'dompurify'

/**
 * 注入路径唯一化（SPEC §12 / 设计文档 §3.6）。所有 HTML 入 DOM 只走这一个函数。
 *
 * 入参约定：html 必须已经过 Phase A 的 hast-util-sanitize。第三方在运行时生成、
 * 没走过 hast 管线的东西（M5 的 Mermaid SVG）不走这里——那是 DOMPurify 作为
 * 浏览器侧第二遍的工作，分工见 SPEC §12。
 *
 * 三级：
 *  1. Element.setHTML()
 *  2. window.trustedTypes → 单一策略。没有这一级，任何下发
 *     `require-trusted-types-for 'script'` 的企业宿主里组件直接硬抛，
 *     而本地开发永远不会暴露。
 *  3. 已消毒内容用 innerHTML
 */

interface MinimalPolicy {
  createHTML(input: string): unknown
}
interface MinimalPolicyFactory {
  createPolicy(name: string, rules: { createHTML(input: string): string }): MinimalPolicy
}
type MaybeTrustedTypes = Window & { trustedTypes?: MinimalPolicyFactory }

const POLICY_NAME = 'readit'
const policies = new WeakMap<Window, MinimalPolicy>()

function getPolicy(view: Window, factory: MinimalPolicyFactory): MinimalPolicy {
  const cached = policies.get(view)
  if (cached !== undefined) return cached
  let created: MinimalPolicy
  try {
    created = factory.createPolicy(POLICY_NAME, {
      createHTML: (input: string): string =>
        DOMPurify.sanitize(input, { RETURN_TRUSTED_TYPE: true }) as unknown as string,
    })
  } catch (cause) {
    throw new Error(
      `readit: 无法创建 Trusted Types 策略 "${POLICY_NAME}"。宿主的 CSP 需要允许它——` +
        '例如 `trusted-types readit dompurify`（DOMPurify 会另建一个自己的策略）。',
      { cause },
    )
  }
  policies.set(view, created)
  return created
}

export function setHtml(el: Element, html: string): void {
  // SPEC 写的判据是 `'setHTML' in Element.prototype`；这里通过实例查同一个槽位，
  // 好处是跨 iframe 的宿主也判得对（那边的 Element 不是我们这边的 Element）。
  const candidate = el as Element & { setHTML?: (input: string) => void }
  if (typeof candidate.setHTML === 'function') {
    candidate.setHTML(html)
    return
  }
  const view = el.ownerDocument.defaultView as MaybeTrustedTypes | null
  const factory = view?.trustedTypes
  if (view !== null && factory !== undefined && factory !== null) {
    Reflect.set(el, 'innerHTML', getPolicy(view, factory).createHTML(html))
    return
  }
  el.innerHTML = html
}
```

`packages/element/src/kernel.ts`：

```ts
import { GITHUB_EMOJI_BASE, render } from '@readit/core'
import { createDisposers, type Disposers } from './disposers.js'
import { createRoot, ownerView, type RootContext } from './shadow.js'
import { setHtml } from './set-html.js'
import { BASE_CSS } from './styles/base-css.js'
import { DARK_CSS, LIGHT_CSS } from './styles/theme-css.js'
import { createThemeController, type ResolvedTheme } from './theme.js'
import type { Mode, MountOptions, Theme } from './types.js'

export const DEFAULT_MOUNT_OPTIONS: MountOptions = {
  value: '',
  mode: 'read',
  shadow: true,
  theme: 'auto',
  baseUrl: '',
  inlineMath: 'github',
  math: null,
  highlighter: null,
  emojiBase: GITHUB_EMOJI_BASE,
  onNavigate: null,
}

export function resolveMountOptions(opts?: Partial<MountOptions>): MountOptions {
  return { ...DEFAULT_MOUNT_OPTIONS, ...opts }
}

const MODES: readonly string[] = ['read', 'source', 'split', 'plain']
const THEMES: readonly string[] = ['auto', 'light', 'dark']
const INLINE_MATH: readonly string[] = ['github', 'strict', 'off']

export function isMode(value: string): value is Mode {
  return MODES.includes(value)
}
export function isTheme(value: string): value is Theme {
  return THEMES.includes(value)
}
export function isInlineMath(value: string): value is MountOptions['inlineMath'] {
  return INLINE_MATH.includes(value)
}

/**
 * 轻 DOM 里的源码带着 HTML 的缩进进来，而 4 个空格在 Markdown 里是代码块。
 * 只去公共缩进，不动相对缩进。
 */
export function dedent(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').replace(/^[ \t]*\n/, '').split('\n')
  let common = Number.POSITIVE_INFINITY
  for (const line of lines) {
    if (line.trim() === '') continue
    const indent = /^[ \t]*/.exec(line)
    common = Math.min(common, indent === null ? 0 : indent[0].length)
  }
  if (!Number.isFinite(common) || common === 0) return lines.join('\n')
  return lines.map((line) => (line.trim() === '' ? line.trimStart() : line.slice(common))).join('\n')
}

export interface Kernel {
  readonly host: HTMLElement
  readonly options: MountOptions
  readonly root: RootContext
  readonly disposers: Disposers
  /** part="content"，.markdown-body。read / split 下可见。 */
  readonly content: HTMLDivElement
  /** 源码窗格。Task 13–17 把 createEditor() 接进这里。 */
  readonly sourcePane: HTMLDivElement
  readonly destroyed: boolean
  /** 注册一个「每次预览重渲之后」的回调，按注册顺序跑。 */
  onAfterRender(fn: () => void): void
  /** 按当前 value / mode 重画。 */
  rerender(): void
  getValue(): string
  setValue(value: string): void
  getMode(): Mode
  setMode(mode: Mode): void
  setTheme(theme: Theme): void
  destroy(): void
}

export function createKernel(host: HTMLElement, opts: MountOptions): Kernel {
  const view = ownerView(host)
  const doc = host.ownerDocument
  const disposers = createDisposers()
  const root = createRoot(host, opts.shadow, disposers)

  const sourcePane = doc.createElement('div')
  sourcePane.className = 'readit-pane readit-pane-source'

  const content = doc.createElement('div')
  content.className = 'readit-pane readit-pane-content markdown-body'
  content.setAttribute('part', 'content')

  root.root.append(sourcePane, content)

  let value = opts.value
  let mode: Mode = opts.mode
  let destroyed = false

  const assertLive = (): void => {
    if (destroyed) {
      throw new Error('readit: 这个挂载实例已经 destroy()，不能再用。需要的话重新 mount()。')
    }
  }

  const applyStyles = (resolved: ResolvedTheme): void => {
    // 只 adopt 当前主题这一张。两份单主题文件互斥地上，所以不需要把 22 KB 的规则
    // 逐条改写到 :host([data-theme=…]) 下——那要么靠 CSS 嵌套（WebKit 17.2 起才有
    // 宽松嵌套解析，而 M6 的 WKWebView 可能更老），要么靠正则改写 CSS 文本。
    // data-theme 仍然写在宿主上：它是 ::part 与 --readit-* 消费者看得见的公开状态。
    root.setStyles([resolved === 'dark' ? DARK_CSS : LIGHT_CSS, BASE_CSS])
  }

  const theme = createThemeController(host, view, opts.theme, applyStyles, disposers)
  applyStyles(theme.resolved)

  const afterRender: Array<() => void> = []

  // part="code-block" 是 SPEC §9.2 的永久公开 API，但 Phase A 的输出字节是冻结的
  // （56/68 那条基线），所以属性只能在注入之后补。
  afterRender.push(() => {
    for (const pre of content.querySelectorAll('pre')) pre.setAttribute('part', 'code-block')
  })

  const renderContent = (): void => {
    setHtml(
      content,
      render(value, {
        inlineMath: opts.inlineMath,
        math: opts.math,
        highlighter: opts.highlighter,
        emojiBase: opts.emojiBase,
      }),
    )
    for (const fn of afterRender) fn()
  }

  /**
   * 接缝：Task 13–17 在这里换成 `createEditor(kind, { parent, root, value, onChange, onScroll })`
   * （P2），kind 按 mode 取 'plain' 或 'codemirror'。
   *
   * 在那之前不是空白也不抛——按 §12「降级必须可见」显示只读源码，并用
   * data-editor="none" 把「编辑器没接进来」这个状态说出来。
   */
  const renderSource = (): void => {
    sourcePane.textContent = ''
    const pre = doc.createElement('pre')
    pre.className = 'readit-source-fallback'
    pre.setAttribute('data-editor', 'none')
    pre.textContent = value
    sourcePane.appendChild(pre)
  }

  const rerender = (): void => {
    root.root.setAttribute('data-mode', mode)
    const showSource = mode !== 'read'
    const showContent = mode === 'read' || mode === 'split'
    sourcePane.hidden = !showSource
    content.hidden = !showContent
    if (showSource) renderSource()
    else sourcePane.textContent = ''
    if (showContent) renderContent()
    else content.textContent = ''
  }

  rerender()

  const kernel: Kernel = {
    host,
    options: opts,
    root,
    disposers,
    content,
    sourcePane,
    get destroyed(): boolean {
      return destroyed
    },
    onAfterRender(fn: () => void): void {
      afterRender.push(fn)
    },
    rerender,
    getValue(): string {
      return value
    },
    setValue(next: string): void {
      assertLive()
      value = next
      rerender()
    },
    getMode(): Mode {
      return mode
    },
    setMode(next: Mode): void {
      assertLive()
      mode = next
      rerender()
    },
    setTheme(next: Theme): void {
      assertLive()
      theme.set(next)
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      content.textContent = ''
      sourcePane.textContent = ''
      afterRender.length = 0
      disposers.disposeAll()
    },
  }

  return kernel
}
```

`packages/element/src/index.ts`：

```ts
import {
  createKernel,
  dedent,
  isInlineMath,
  isMode,
  isTheme,
  resolveMountOptions,
  type Kernel,
} from './kernel.js'
import { GITHUB_EMOJI_BASE } from '@readit/core'
import type { MountHandle, MountOptions } from './types.js'

export type { Mode, MountHandle, MountOptions, Theme } from './types.js'
export { DEFAULT_MOUNT_OPTIONS } from './kernel.js'

export function mount(host: HTMLElement, opts?: Partial<MountOptions>): MountHandle {
  const kernel = createKernel(host, resolveMountOptions(opts))
  // 只暴露 P4 的五个方法：内核上的 root / disposers / onAfterRender 是内部接缝，
  // 一旦从公共句柄漏出去就再也收不回来。
  return {
    setValue: (value: string): void => {
      kernel.setValue(value)
    },
    getValue: (): string => kernel.getValue(),
    setMode: (mode): void => {
      kernel.setMode(mode)
    },
    setTheme: (theme): void => {
      kernel.setTheme(theme)
    },
    destroy: (): void => {
      kernel.destroy()
    },
  }
}

export const DEFAULT_TAG = 'readit-view'

function readEnum<T extends string>(
  el: HTMLElement,
  attr: string,
  guard: (value: string) => value is T,
  fallback: T,
): T {
  const raw = el.getAttribute(attr)
  if (raw === null) return fallback
  if (guard(raw)) return raw
  // 未知取值不静默吞掉（§12 降级必须可见）。
  el.ownerDocument.defaultView?.console.warn(
    `readit: <${el.localName}> 的 ${attr}="${raw}" 不是合法取值，回落到 "${fallback}"`,
  )
  return fallback
}

/**
 * 每次调用都造一个新类：一个构造器只能注册一次，用同一个类注册第二个标签名
 * 同样抛 NotSupportedError。类体在函数里，import 时不求值 HTMLElement，
 * 所以 Node 里 import 这个模块不会 ReferenceError。
 */
function createReaditElement(): CustomElementConstructor {
  return class ReaditViewElement extends HTMLElement {
    static readonly observedAttributes: readonly string[] = ['mode', 'theme']

    #kernel: Kernel | null = null
    #value = ''

    get value(): string {
      return this.#kernel?.getValue() ?? this.#value
    }

    set value(next: string) {
      this.#value = next
      this.#kernel?.setValue(next)
    }

    connectedCallback(): void {
      if (this.#kernel !== null) return
      if (this.#value === '') this.#value = dedent(this.textContent ?? '')
      // 轻 DOM 里的源码已经取走；shadow:false 时留着它会和渲染结果并排显示。
      this.textContent = ''
      this.#kernel = createKernel(
        this,
        resolveMountOptions({
          value: this.#value,
          mode: readEnum(this, 'mode', isMode, 'read'),
          theme: readEnum(this, 'theme', isTheme, 'auto'),
          inlineMath: readEnum(this, 'inline-math', isInlineMath, 'github'),
          shadow: this.getAttribute('shadow') !== 'false',
          baseUrl: this.getAttribute('base-url') ?? '',
          emojiBase: this.getAttribute('emoji-base') ?? GITHUB_EMOJI_BASE,
        }),
      )
    }

    disconnectedCallback(): void {
      const kernel = this.#kernel
      if (kernel === null) return
      this.#value = kernel.getValue()
      this.#kernel = null
      kernel.destroy()
    }

    attributeChangedCallback(name: string): void {
      const kernel = this.#kernel
      if (kernel === null) return
      if (name === 'mode') kernel.setMode(readEnum(this, 'mode', isMode, 'read'))
      else if (name === 'theme') kernel.setTheme(readEnum(this, 'theme', isTheme, 'auto'))
    }
  }
}

export function defineReadit(tag: string = DEFAULT_TAG): void {
  const registry = globalThis.customElements as CustomElementRegistry | undefined
  if (registry === undefined) {
    throw new Error('readit: 当前环境没有 customElements，defineReadit() 无从注册')
  }
  // 自动注册会让同页两个版本抛不可恢复的 NotSupportedError（SPEC §9.3），
  // 所以这个函数存在、且守着 get()。
  if (registry.get(tag) !== undefined) return
  registry.define(tag, createReaditElement())
}
```

`mount.test.ts` 里那条断言 `MountHandle` 键集合的写法太绕，实现完成后改成直白的：

```ts
    expect(Object.keys(handle).sort()).toEqual(['destroy', 'getValue', 'setMode', 'setTheme', 'setValue'])
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit
npm test -w @readit/element
npm run typecheck
npm test
```

最后那条是 P6 的守门：2318 条既有测试必须一条不少、一条不红。

- [ ] **Step 5: 提交**

```bash
cd /Users/mac08/Desktop/robot/readit
git add packages/element package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(element): mount() / defineReadit() 共用一份内核，四模式状态机与注入路径

命令式入口与自定义元素走同一个 kernel.ts，没有第二条渲染路径。本任务只实现
read：source / split / plain 的窗格布局与状态切换都在，编辑器留一个具名接缝
（renderSource），Task 13–17 换成 createEditor()。接缝不是空壳——编辑器没接
进来时显示只读源码并自报 data-editor="none"，按 §12「降级必须可见」。

MountHandle 恰好是 P4 的五个方法，没有 find()：查找属 M6，加方法向后兼容，
留空壳不是（计划一刚因 readFrontmatterOptions 是「公共 API 里的永久 no-op」
挨过评审批评）。有一条断言钉住 find 不存在。

setHtml() 三级齐全。第 2 级（Trusted Types + DOMPurify）有测试：伪造
window.trustedTypes 断言策略只建一次，以及 CSP 拒绝建策略时抛出点名了所需
指令的错误。没有这一级，企业宿主里组件硬抛而本地开发永远测不出来。

part 只开 root / content / code-block。code-block 在注入之后补，因为 Phase A
的输出字节是冻结的——往 <pre> 上加属性会动 56/68 那条基线。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

---

### Task 5: 导航——链接拦截、历史栈、#slug 桥接与错误态

**Files:**
- Create: `packages/element/src/navigate.ts`
- Modify: `packages/element/src/kernel.ts:96-110`（`Kernel` 接口，在 `readonly sourcePane` 之后加三个成员）
- Modify: `packages/element/src/kernel.ts:126-136`（`createKernel` 里 `root.root.append(sourcePane, content)` 之前插入错误态节点）
- Modify: `packages/element/src/kernel.ts:200-232`（内核对象里加 `showError` / `clearError` / `navigation`，并在返回前接上导航）
- Test: `packages/element/test/navigate.test.ts`

**Interfaces:**
- Consumes（Task 3）：`addListener(disposers, target, type, handler, options?)`、`Disposers`
- Consumes（Task 4）：`createKernel(host, opts): Kernel`、`Kernel.onAfterRender(fn)`、`Kernel.content`、`Kernel.root`、`resolveMountOptions(opts?)`、`mount(host, opts?)`
- Produces:
  - `packages/element/src/navigate.ts`：
    - `type LinkKind = 'hash' | 'relative' | 'external' | 'ignore'`
    - `classifyHref(href: string): LinkKind`
    - `resolveRelative(baseUrl: string, href: string): { path: string; hash: string }`
    - `findAnchorTarget(scope: ParentNode, slug: string): Element | null`
    - `interface HistoryEntry { readonly path: string; readonly hash: string }`
    - `interface NavigationHooks { readonly view: Window; readonly host: HTMLElement; readonly content: HTMLElement; readonly baseUrl: string; readonly onNavigate: ((path: string) => void) | null; showError(title: string, path: string, detail: string): void; clearError(): void }`
    - `createNavigation(hooks: NavigationHooks, disposers: Disposers): NavigationController`，`NavigationController = { entries(): readonly HistoryEntry[]; index(): number; canBack(): boolean; canForward(): boolean; back(): boolean; forward(): boolean; afterRender(): void }`
  - `packages/element/src/kernel.ts`：`Kernel` 新增 `readonly navigation: NavigationController`、`showError(title: string, path: string, detail: string): void`、`clearError(): void`

---

- [ ] **Step 1: 写会失败的测试**

`packages/element/test/navigate.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKernel, resolveMountOptions, type Kernel } from '../src/kernel.js'
import { classifyHref, findAnchorTarget, resolveRelative } from '../src/navigate.js'
import { render } from '@readit/core'

const DOC = [
  '# Hello World',
  '',
  'See [rel](./other.md), [deep](sub/deep.md#part-two), [up](../up.md),',
  '[hash](#hello-world), [ext](https://example.com/a), [mail](mailto:a@b.c).',
  '',
  '## Part Two',
  '',
  'tail',
  '',
].join('\n')

let kernels: Kernel[] = []

function makeKernel(opts: { baseUrl?: string; onNavigate?: ((path: string) => void) | null } = {}): Kernel {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const kernel = createKernel(
    host,
    resolveMountOptions({
      value: DOC,
      baseUrl: opts.baseUrl ?? 'docs/README.md',
      onNavigate: opts.onNavigate === undefined ? (): void => {} : opts.onNavigate,
    }),
  )
  kernels.push(kernel)
  return kernel
}

function click(kernel: Kernel, text: string): MouseEvent {
  const anchor = [...kernel.content.querySelectorAll('a')].find((a) => a.textContent === text)
  if (anchor === undefined) throw new Error(`没有文本为 ${text} 的链接`)
  const event = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true })
  anchor.dispatchEvent(event)
  return event
}

function key(kernel: Kernel, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, composed: true, cancelable: true, ...init })
  kernel.content.dispatchEvent(event)
  return event
}

afterEach(() => {
  for (const kernel of kernels) {
    kernel.destroy()
    kernel.host.remove()
  }
  kernels = []
})

describe('classifyHref', () => {
  it.each([
    ['#slug', 'hash'],
    ['./other.md', 'relative'],
    ['sub/deep.md', 'relative'],
    ['../up.md', 'relative'],
    ['/abs/x.md', 'relative'],
    ['https://example.com', 'external'],
    ['HTTP://EXAMPLE.COM', 'external'],
    ['mailto:a@b.c', 'external'],
    ['//cdn.example.com/x', 'external'],
    ['', 'ignore'],
  ] as const)('%s → %s', (href, kind) => {
    expect(classifyHref(href)).toBe(kind)
  })

  /** 单字母 scheme 不存在，但 Windows 盘符看起来一模一样。 */
  it('C:\\docs\\a.md 不是外链', () => {
    expect(classifyHref('C:\\docs\\a.md')).toBe('relative')
  })
})

describe('resolveRelative', () => {
  it.each([
    ['docs/README.md', './other.md', 'docs/other.md', ''],
    ['docs/README.md', '../up.md', 'up.md', ''],
    ['docs/README.md', 'sub/deep.md#part-two', 'docs/sub/deep.md', '#part-two'],
    ['/docs/README.md', './other.md', '/docs/other.md', ''],
    ['', './other.md', 'other.md', ''],
    ['file:///U/docs/README.md', './other.md', 'file:///U/docs/other.md', ''],
    ['file:///U/docs/README.md', '../x.md#a', 'file:///U/x.md', '#a'],
    ['docs/README.md', 'a%20b.md', 'docs/a b.md', ''],
  ])('%s + %s → %s %s', (base, href, path, hash) => {
    expect(resolveRelative(base, href)).toEqual({ path, hash })
  })
})

describe('findAnchorTarget：GitHub 的锚点 DOM', () => {
  /**
   * GitHub 把 id 放在兄弟 <a id="user-content-<slug>"> 上、href 却是不带前缀的
   * #<slug>；而 fragment 本来就不跨 shadow 边界。这条同时守着 core 的
   * CLOBBER_PREFIX——那边一改，这里立刻红。
   */
  it('从真实的 render() 输出里按裸 slug 找到带前缀的锚点', () => {
    const scope = document.createElement('div')
    scope.innerHTML = render('# Hello World\n')
    const target = findAnchorTarget(scope, 'hello-world')
    expect(target?.id).toBe('user-content-hello-world')
  })

  it('作者手写 HTML 里的裸 id 也认', () => {
    const scope = document.createElement('div')
    scope.innerHTML = '<div id="plain-id"></div>'
    expect(findAnchorTarget(scope, 'plain-id')?.id).toBe('plain-id')
  })

  it('slug 里有 CSS 选择器元字符也不炸', () => {
    const scope = document.createElement('div')
    scope.innerHTML = '<a id="user-content-a.b:c"></a>'
    expect(findAnchorTarget(scope, 'a.b:c')).not.toBeNull()
  })

  it('找不到就是 null', () => {
    expect(findAnchorTarget(document.createElement('div'), 'nope')).toBeNull()
  })
})

describe('链接拦截', () => {
  it('相对链接被拦下，onNavigate 收到解析后的路径（不含 #）', () => {
    const onNavigate = vi.fn()
    const kernel = makeKernel({ onNavigate })
    const event = click(kernel, 'rel')
    expect(event.defaultPrevented).toBe(true)
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('docs/other.md')
  })

  it('带 #frag 的相对链接：路径给宿主，锚点留着等内容回来', () => {
    const onNavigate = vi.fn()
    const kernel = makeKernel({ onNavigate })
    click(kernel, 'deep')
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('docs/sub/deep.md')
    kernel.setValue('# Part Two\n\nbody\n')
    expect(kernel.content.querySelector('#user-content-part-two')?.getAttribute('tabindex')).toBe('-1')
  })

  it('外链不拦截，但补上 target=_blank 与 noopener，绝不让它把嵌入页面导航走', () => {
    const kernel = makeKernel()
    const anchor = [...kernel.content.querySelectorAll('a')].find((a) => a.textContent === 'ext')
    expect(anchor?.getAttribute('target')).toBe('_blank')
    expect(anchor?.getAttribute('rel')?.split(' ').sort()).toEqual(['nofollow', 'noopener', 'noreferrer'])
    expect(click(kernel, 'ext').defaultPrevented).toBe(false)
  })

  it('mailto 同样交出去', () => {
    expect(click(makeKernel(), 'mail').defaultPrevented).toBe(false)
  })

  it('带修饰键的点击不拦（宿主的「新窗口打开」照常）', () => {
    const onNavigate = vi.fn()
    const kernel = makeKernel({ onNavigate })
    const anchor = [...kernel.content.querySelectorAll('a')].find((a) => a.textContent === 'rel')
    const event = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, metaKey: true })
    anchor?.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(onNavigate).not.toHaveBeenCalled()
  })
})

describe('#slug 桥接', () => {
  it('同页锚点被拦下，跳到 user-content- 前缀的那个元素上', () => {
    const kernel = makeKernel()
    const event = click(kernel, 'hash')
    expect(event.defaultPrevented).toBe(true)
    const target = kernel.content.querySelector('#user-content-hello-world')
    expect(target?.getAttribute('tabindex')).toBe('-1')
    expect(kernel.root.container instanceof ShadowRoot ? kernel.root.container.activeElement : document.activeElement).toBe(target)
  })

  it('同页锚点不触发 onNavigate', () => {
    const onNavigate = vi.fn()
    click(makeKernel({ onNavigate }), 'hash')
    expect(onNavigate).not.toHaveBeenCalled()
  })
})

describe('历史栈是元素的能力', () => {
  it('前进后退按路径重新问宿主要内容', () => {
    const seen: string[] = []
    const kernel = makeKernel({ onNavigate: (path) => seen.push(path) })
    click(kernel, 'rel')
    kernel.setValue('# other\n\n[up](../up.md)\n')
    click(kernel, 'up')
    expect(seen).toEqual(['docs/other.md', 'up.md'])

    expect(kernel.navigation.back()).toBe(true)
    expect(seen).toEqual(['docs/other.md', 'up.md', 'docs/other.md'])
    expect(kernel.navigation.back()).toBe(true)
    expect(seen.at(-1)).toBe('docs/README.md')
    expect(kernel.navigation.back()).toBe(false)

    expect(kernel.navigation.forward()).toBe(true)
    expect(seen.at(-1)).toBe('docs/other.md')
  })

  it('新的跳转截断前进分支', () => {
    const kernel = makeKernel()
    click(kernel, 'rel')
    kernel.navigation.back()
    expect(kernel.navigation.canForward()).toBe(true)
    kernel.setValue(DOC)
    click(kernel, 'up')
    expect(kernel.navigation.canForward()).toBe(false)
  })

  it('Alt+ArrowLeft 后退，Alt+ArrowRight 前进', () => {
    const kernel = makeKernel()
    click(kernel, 'rel')
    expect(key(kernel, { key: 'ArrowLeft', altKey: true }).defaultPrevented).toBe(true)
    expect(kernel.navigation.index()).toBe(0)
    expect(key(kernel, { key: 'ArrowRight', altKey: true }).defaultPrevented).toBe(true)
    expect(kernel.navigation.index()).toBe(1)
  })

  it('没得退时不吞按键', () => {
    expect(key(makeKernel(), { key: 'ArrowLeft', altKey: true }).defaultPrevented).toBe(false)
  })
})

describe('相对跳转失败的错误态（设计文档 §8）', () => {
  it('宿主返回被拒绝的 Promise → 窗口内错误态，显示解析后的完整路径', async () => {
    const kernel = makeKernel({
      onNavigate: () => Promise.reject(new Error('ENOENT')) as unknown as void,
    })
    click(kernel, 'rel')
    await Promise.resolve()
    await Promise.resolve()
    const error = kernel.root.root.querySelector('.readit-error')
    expect(error?.hasAttribute('hidden')).toBe(false)
    expect(error?.querySelector('.readit-error-path')?.textContent).toBe('docs/other.md')
    expect(error?.querySelector('.readit-error-detail')?.textContent).toContain('ENOENT')
  })

  it('错误态下后退键仍然可用', async () => {
    const kernel = makeKernel({
      onNavigate: () => Promise.reject(new Error('ENOENT')) as unknown as void,
    })
    click(kernel, 'rel')
    await Promise.resolve()
    await Promise.resolve()
    expect(key(kernel, { key: 'ArrowLeft', altKey: true }).defaultPrevented).toBe(true)
    expect(kernel.navigation.index()).toBe(0)
  })

  it('宿主同步抛出也进错误态', () => {
    const kernel = makeKernel({
      onNavigate: () => {
        throw new Error('boom')
      },
    })
    click(kernel, 'rel')
    expect(kernel.root.root.querySelector('.readit-error-path')?.textContent).toBe('docs/other.md')
  })

  it('没有 onNavigate 时点相对链接：拦住 + 说清为什么，而不是把嵌入页面导航走', () => {
    const kernel = makeKernel({ onNavigate: null })
    expect(click(kernel, 'rel').defaultPrevented).toBe(true)
    expect(kernel.root.root.querySelector('.readit-error-path')?.textContent).toBe('docs/other.md')
    expect(kernel.root.root.querySelector('.readit-error-detail')?.textContent).toContain('onNavigate')
  })

  it('下一次成功的跳转清掉错误态', () => {
    const kernel = makeKernel({ onNavigate: null })
    click(kernel, 'rel')
    const kernel2 = makeKernel()
    click(kernel2, 'rel')
    expect(kernel2.root.root.querySelector('.readit-error')?.hasAttribute('hidden')).toBe(true)
  })
})
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd /Users/mac08/Desktop/robot/readit
npm test -w @readit/element -- test/navigate.test.ts
```

```
FAIL  test/navigate.test.ts [ test/navigate.test.ts ]
Error: Failed to load url ../src/navigate.js
Test Files  1 failed (1)
```

- [ ] **Step 3: 写最小实现**

`packages/element/src/navigate.ts`：

```ts
  const go = (entry: HistoryEntry, push: boolean): void => {
    if (push) {
      stack.length = cursor + 1
      stack.push(entry)
      cursor = stack.length - 1
    }
    if (entry.path === loadedPath) {
      // 同一个文件内部的锚点跳转，不惊动宿主。
      if (entry.hash !== '') applyHash(entry.hash)
      return
    }
    hooks.clearError()
    const onNavigate = hooks.onNavigate
    if (onNavigate === null) {
      fail2(entry.path, '挂载时没有给 onNavigate 回调，元素自己拿不到文件内容。')
      return
    }
    loadedPath = entry.path
    pendingHash = entry.hash
    let result: unknown
    try {
      // onNavigate 的契约返回类型是 void（P4），而 `=> void` 接受任何返回值。
      // 宿主返回一个 Promise 就是它告诉元素「这个文件打不开」的通道——设计文档 §8
      // 要求相对跳转失败有窗口内错误态，而回调本身没有别的出口。
      result = (onNavigate as (path: string) => unknown)(entry.path)
    } catch (error) {
      pendingHash = ''
      fail(entry.path, describeError(error))
      return
    }
    if (isPromiseLike(result)) {
      result.then(undefined, (error: unknown) => {
        pendingHash = ''
        fail(entry.path, describeError(error))
      })
    }
  }

  function fail2(path: string, detail: string): void {
    hooks.showError('这个链接需要宿主处理', path, detail)
  }

  const step = (delta: number): boolean => {
    const next = cursor + delta
    const entry = stack[next]
    if (entry === undefined) return false
    cursor = next
    go(entry, false)
    return true
  }

  const decorateLinks = (): void => {
    for (const anchor of hooks.content.querySelectorAll('a[href]')) {
      if (classifyHref(anchor.getAttribute('href') ?? '') !== 'external') continue
      // 外链交系统浏览器：不拦截，但不能让它把嵌入方的页面自己导航走。
      anchor.setAttribute('target', '_blank')
      const rel = (anchor.getAttribute('rel') ?? '').split(/\s+/).filter((token) => token !== '')
      for (const token of ['noopener', 'noreferrer']) if (!rel.includes(token)) rel.push(token)
      anchor.setAttribute('rel', rel.join(' '))
    }
  }

  const onClick = (event: Event): void => {
    const mouse = event as MouseEvent
    if (mouse.defaultPrevented) return
    if (mouse.button !== 0) return
    if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return
    const anchor = closestAnchor(event)
    if (anchor === null) return
    const href = anchor.getAttribute('href')
    if (href === null) return
    const kind = classifyHref(href)
    if (kind === 'external' || kind === 'ignore') return
    event.preventDefault()
    if (kind === 'hash') {
      go({ path: loadedPath, hash: href }, true)
      return
    }
    // 相对链接按当前显示的那个文件解析，不是按最初的 baseUrl。
    go(resolveRelative(loadedPath === '' ? hooks.baseUrl : loadedPath, href), true)
  }

  const onKeyDown = (event: Event): void => {
    const key = event as KeyboardEvent
    if (key.defaultPrevented) return
    const back = (key.altKey && key.key === 'ArrowLeft') || (key.metaKey && key.key === '[')
    const forward = (key.altKey && key.key === 'ArrowRight') || (key.metaKey && key.key === ']')
    if (!back && !forward) return
    if (step(back ? -1 : 1)) event.preventDefault()
  }

  const onMouseUp = (event: Event): void => {
    const mouse = event as MouseEvent
    if (mouse.button !== 3 && mouse.button !== 4) return
    if (step(mouse.button === 3 ? -1 : 1)) event.preventDefault()
  }

  // 三个都挂在宿主上：shadow 内部的事件是 composed 的，会冒到这里，而 composedPath()
  // 仍然给得出真正的目标。挂在宿主而不是 document 上，意味着元素只处理自己里面的
  // 按键——全局快捷键归宿主，这是嵌入式组件该有的边界。
  addListener(disposers, hooks.host, 'click', onClick)
  addListener(disposers, hooks.host, 'keydown', onKeyDown)
  addListener(disposers, hooks.host, 'mouseup', onMouseUp)

  return {
    entries: () => stack,
    index: () => cursor,
    canBack: () => cursor > 0,
    canForward: () => cursor < stack.length - 1,
    back: () => step(-1),
    forward: () => step(1),
    afterRender(): void {
      decorateLinks()
      if (pendingHash === '') return
      const hash = pendingHash
      pendingHash = ''
      applyHash(hash)
    },
  }
}
```

`packages/element/src/kernel.ts` 的三处改动。

改动 1 —— 顶部 import（`kernel.ts:1-11`，在 `import { createThemeController … }` 之后加一行）：

```ts
import { createNavigation, type NavigationController } from './navigate.js'
```

改动 2 —— `Kernel` 接口（`kernel.ts:96-110`，在 `readonly sourcePane: HTMLDivElement` 这一行之后插入）：

```ts
  readonly navigation: NavigationController
  /** 窗口内错误态。path 显示的是解析后的完整路径（设计文档 §8）。 */
  showError(title: string, path: string, detail: string): void
  clearError(): void
```

改动 3 —— `createKernel` 里建 DOM 的那段（`kernel.ts:126-136`，把 `root.root.append(sourcePane, content)` 这一行整体替换）：

```ts
  const errorPane = doc.createElement('div')
  errorPane.className = 'readit-error'
  errorPane.setAttribute('role', 'alert')
  errorPane.hidden = true
  const errorTitle = doc.createElement('p')
  errorTitle.className = 'readit-error-title'
  const errorPath = doc.createElement('p')
  errorPath.className = 'readit-error-path'
  const errorDetail = doc.createElement('p')
  errorDetail.className = 'readit-error-detail'
  errorPane.append(errorTitle, errorPath, errorDetail)

  root.root.append(errorPane, sourcePane, content)

  const showError = (title: string, path: string, detail: string): void => {
    errorTitle.textContent = title
    errorPath.textContent = path
    errorDetail.textContent = detail
    errorPane.hidden = false
  }
  const clearError = (): void => {
    errorPane.hidden = true
    errorTitle.textContent = ''
    errorPath.textContent = ''
    errorDetail.textContent = ''
  }
```

改动 4 —— 内核对象（`kernel.ts:200-232`）。在 `rerender()` 那一行首次调用之前建导航，之后把三个成员加进返回的对象里：

```ts
  const navigation = createNavigation(
    {
      view,
      host,
      content,
      baseUrl: opts.baseUrl,
      onNavigate: opts.onNavigate,
      showError,
      clearError,
    },
    disposers,
  )
  // 装饰外链与应用挂起的 #hash 都要等 HTML 进了 DOM 才有意义。
  afterRender.push(() => {
    navigation.afterRender()
  })

  rerender()
```

以及返回对象里紧跟 `sourcePane,` 之后：

```ts
    navigation,
    showError,
    clearError,
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit
npm test -w @readit/element
npm run typecheck
npm test
```

- [ ] **Step 5: 提交**

```bash
cd /Users/mac08/Desktop/robot/readit
git add packages/element
git commit -m "$(cat <<'EOF'
feat(element): 导航——链接拦截、内部历史栈、#slug 桥接与失败的错误态

前进/后退是元素的能力，不是壳的（SPEC §11.2）。历史栈在元素内部，后退时按
路径重新问宿主要内容；Alt+←/→ 与 Cmd+[/] 与鼠标侧键都接了，监听器挂在宿主
而不是 document 上——全局快捷键归宿主，这是嵌入式组件该有的边界。

#slug 自己搭桥：GitHub 把 id 放在兄弟 <a id="user-content-<slug>"> 上、href
却是不带前缀的 #slug，而 fragment 本来就不跨 shadow 边界。查找用遍历比较而不是
querySelector('#'+slug)，因为 slug 里可以有点号冒号 emoji，而 CSS.escape 的
转义规则不等于 id 的合法字符集。有一条测试直接拿 render() 的真实输出去找，
所以 core 那边改了 CLOBBER_PREFIX 这里会红。

相对跳转失败进窗口内错误态，显示解析后的完整路径，后退键仍可用（设计文档 §8）。
宿主告诉元素「文件不存在」的通道是 onNavigate 返回一个被拒绝的 Promise——
`(path: string) => void` 接受任何返回值，所以这条在 P4 的契约之内。更干净的做法
是给 MountHandle 加一个显式方法，已列进契约提案，没有先斩后奏。

外链不拦截，但补 target=_blank + noopener/noreferrer：交系统浏览器不等于
允许它把嵌入方的页面导航走。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

---

### Task 6: destroy() 的完整性与泄漏检测探针

**Files:**
- Create: `packages/element/test/helpers/leak-probe.ts`
- Test: `packages/element/test/leak.test.ts`
- Modify: `packages/element/src/kernel.ts:236-246`（`destroy()`，见 Step 3）

**Interfaces:**
- Consumes（Task 3–5）：`mount(host, opts?): MountHandle`、`defineReadit(tag?)`、`createKernel(host, opts): Kernel`、`Kernel.disposers.size`、`resolveMountOptions(opts?)`
- Produces:
  - `packages/element/test/helpers/leak-probe.ts`：`installLeakProbe(view: Window & typeof globalThis): LeakProbe`，`LeakProbe = { counts(): { listeners: number; resizeObservers: number; mutationObservers: number }; describe(): string[]; uninstall(): void }`
  - 无生产接口新增；`destroy()` 的语义收紧为「幂等 + 容器清空 + 登记项归零」

---

- [ ] **Step 1: 写会失败的测试**

`packages/element/test/helpers/leak-probe.ts`：

```ts
/**
 * 泄漏探针。挂载/销毁循环之后监听器与观察器的净增量必须是 0。
 *
 * 为什么是探针而不是代码评审：设计文档 §3.5 明写「用一条泄漏检测测试守住，
 * 不靠代码评审看」。ResizeObserver 与 MutationObserver 现在还没人用（read 模式
 * 不需要），探针照样把它们计上——Task 13–17 的编辑器一旦漏掉一个 disconnect()，
 * 红的是这条，而不是三个月后某个宿主 SPA 的内存曲线。
 */
export interface LeakCounts {
  listeners: number
  resizeObservers: number
  mutationObservers: number
}

export interface LeakProbe {
  /** 相对安装时刻的净增量。 */
  counts(): LeakCounts
  /** 没拆掉的监听器，形如 "HTMLDivElement#click"，给断言失败时的人看。 */
  describe(): string[]
  uninstall(): void
}

interface Disconnectable {
  disconnect(): void
}

export function installLeakProbe(view: Window & typeof globalThis): LeakProbe {
  const live = new Map<string, string>()
  const ids = new WeakMap<object, number>()
  let seq = 0
  const idOf = (value: object): number => {
    const existing = ids.get(value)
    if (existing !== undefined) return existing
    seq += 1
    ids.set(value, seq)
    return seq
  }
  const captureOf = (options?: boolean | AddEventListenerOptions | EventListenerOptions): boolean =>
    typeof options === 'boolean' ? options : options?.capture === true
  const keyOf = (target: EventTarget, type: string, listener: object, capture: boolean): string =>
    `${idOf(target)}|${type}|${idOf(listener)}|${capture ? 1 : 0}`

  const proto = view.EventTarget.prototype
  const realAdd = proto.addEventListener
  const realRemove = proto.removeEventListener

  proto.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (listener !== null && listener !== undefined) {
      live.set(
        keyOf(this, type, listener as object, captureOf(options)),
        `${this.constructor.name}#${type}`,
      )
    }
    realAdd.call(this, type, listener, options)
  }

  proto.removeEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    if (listener !== null && listener !== undefined) {
      live.delete(keyOf(this, type, listener as object, captureOf(options)))
    }
    realRemove.call(this, type, listener, options)
  }

  let resizeObservers = 0
  let mutationObservers = 0

  function wrap(realCtor: unknown, onOpen: () => void, onClose: () => void): unknown {
    return class Counting {
      #inner: Disconnectable | null
      #closed = false
      constructor(callback: unknown) {
        onOpen()
        this.#inner =
          typeof realCtor === 'function'
            ? (new (realCtor as new (cb: unknown) => Disconnectable)(callback) as Disconnectable)
            : null
      }
      observe(...args: unknown[]): void {
        ;(this.#inner as unknown as { observe?: (...a: unknown[]) => void } | null)?.observe?.(...args)
      }
      unobserve(...args: unknown[]): void {
        ;(this.#inner as unknown as { unobserve?: (...a: unknown[]) => void } | null)?.unobserve?.(...args)
      }
      takeRecords(): unknown[] {
        return (
          (this.#inner as unknown as { takeRecords?: () => unknown[] } | null)?.takeRecords?.() ?? []
        )
      }
      disconnect(): void {
        this.#inner?.disconnect()
        if (this.#closed) return
        this.#closed = true
        onClose()
      }
    }
  }

  const realResize = (view as unknown as Record<string, unknown>)['ResizeObserver']
  const realMutation = (view as unknown as Record<string, unknown>)['MutationObserver']
  Reflect.set(
    view,
    'ResizeObserver',
    wrap(realResize, () => (resizeObservers += 1), () => (resizeObservers -= 1)),
  )
  Reflect.set(
    view,
    'MutationObserver',
    wrap(realMutation, () => (mutationObservers += 1), () => (mutationObservers -= 1)),
  )

  return {
    counts: (): LeakCounts => ({ listeners: live.size, resizeObservers, mutationObservers }),
    describe: (): string[] => [...live.values()].sort(),
    uninstall(): void {
      proto.addEventListener = realAdd
      proto.removeEventListener = realRemove
      Reflect.set(view, 'ResizeObserver', realResize)
      Reflect.set(view, 'MutationObserver', realMutation)
    },
  }
}
```

`packages/element/test/leak.test.ts`：

```ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { installLeakProbe, type LeakProbe } from './helpers/leak-probe.js'
import { defineReadit, mount } from '../src/index.js'
import { createKernel, resolveMountOptions } from '../src/kernel.js'

const DOC = '# T\n\n[rel](./b.md) [hash](#t) [ext](https://example.com)\n\n```js\nvar a = 1\n```\n'
const ZERO = { listeners: 0, resizeObservers: 0, mutationObservers: 0 }

let probe: LeakProbe | null = null

afterEach(() => {
  probe?.uninstall()
  probe = null
})

/**
 * 探针的自检。没有这一条，「50 次之后计数是 0」可能只是因为探针什么都没数到——
 * 一条测不到真东西的断言比没有断言更糟。
 */
describe('探针自检', () => {
  it('抓得到没拆的监听器', () => {
    probe = installLeakProbe(window)
    const el = document.createElement('div')
    const handler = (): void => {}
    el.addEventListener('click', handler)
    expect(probe.counts().listeners).toBe(1)
    expect(probe.describe()).toEqual(['HTMLDivElement#click'])
    el.removeEventListener('click', handler)
    expect(probe.counts()).toEqual(ZERO)
  })

  it('区分 capture 与 bubble 两次注册', () => {
    probe = installLeakProbe(window)
    const el = document.createElement('div')
    const handler = (): void => {}
    el.addEventListener('click', handler)
    el.addEventListener('click', handler, { capture: true })
    expect(probe.counts().listeners).toBe(2)
    el.removeEventListener('click', handler, { capture: true })
    expect(probe.counts().listeners).toBe(1)
  })

  it('抓得到没 disconnect 的 ResizeObserver 与 MutationObserver', () => {
    probe = installLeakProbe(window)
    const ro = new window.ResizeObserver(() => {})
    const mo = new window.MutationObserver(() => {})
    expect(probe.counts()).toEqual({ listeners: 0, resizeObservers: 1, mutationObservers: 1 })
    ro.disconnect()
    mo.disconnect()
    ro.disconnect()
    expect(probe.counts()).toEqual(ZERO)
  })
})

describe('挂载/销毁 50 次', () => {
  it('监听器与观察器计数归零', () => {
    probe = installLeakProbe(window)
    const host = document.createElement('div')
    document.body.appendChild(host)
    for (let i = 0; i < 50; i += 1) {
      const handle = mount(host, {
        value: DOC,
        baseUrl: 'docs/a.md',
        theme: 'auto',
        onNavigate: (): void => {},
      })
      handle.setMode('split')
      handle.setTheme('dark')
      handle.setValue(`# ${i}\n`)
      handle.setMode('read')
      handle.destroy()
    }
    expect(probe.describe()).toEqual([])
    expect(probe.counts()).toEqual(ZERO)
    host.remove()
  })

  it('自定义元素连上/摘下 50 次同样归零', () => {
    probe = installLeakProbe(window)
    defineReadit('readit-leak')
    const el = document.createElement('readit-leak')
    el.textContent = DOC
    for (let i = 0; i < 50; i += 1) {
      document.body.appendChild(el)
      el.setAttribute('theme', i % 2 === 0 ? 'dark' : 'light')
      el.remove()
    }
    expect(probe.describe()).toEqual([])
    expect(probe.counts()).toEqual(ZERO)
  })

  it('销毁后容器空、宿主属性还原、登记项归零', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const kernel = createKernel(host, resolveMountOptions({ value: DOC }))
    expect(kernel.disposers.size).toBeGreaterThan(0)
    kernel.destroy()
    expect(kernel.disposers.size).toBe(0)
    expect(kernel.destroyed).toBe(true)
    expect(host.shadowRoot?.childNodes).toHaveLength(0)
    expect(host.shadowRoot?.adoptedStyleSheets).toHaveLength(0)
    expect(host.getAttribute('data-theme')).toBeNull()
    host.remove()
  })

  it('shadow:false 逃生舱销毁后不留自己的节点', () => {
    const host = document.createElement('div')
    host.appendChild(document.createTextNode('宿主原有的内容'))
    document.body.appendChild(host)
    const kernel = createKernel(host, resolveMountOptions({ value: DOC, shadow: false }))
    kernel.destroy()
    expect(host.querySelectorAll('.readit-root')).toHaveLength(0)
    expect(host.querySelectorAll('style[data-readit]')).toHaveLength(0)
    expect(host.textContent).toBe('宿主原有的内容')
    host.remove()
  })

  it('50 次循环没有把节点落在 document 上', () => {
    const before = document.body.childNodes.length
    for (let i = 0; i < 50; i += 1) {
      const host = document.createElement('div')
      document.body.appendChild(host)
      mount(host, { value: DOC }).destroy()
      host.remove()
    }
    expect(document.body.childNodes).toHaveLength(before)
    expect(document.head.querySelectorAll('style')).toHaveLength(0)
  })
})

/**
 * 结构约束：绕过 addListener 注册的监听器不会被 destroy() 拆掉，而上面那些循环
 * 只在漏掉的那条路径真的被走到时才红。这一条让「绕过」本身就红。
 */
describe('注册点唯一', () => {
  it('src/ 里除 disposers.ts 外没有直接调用 addEventListener', () => {
    const src = fileURLToPath(new URL('../src', import.meta.url))
    const offenders: string[] = []
    for (const entry of readdirSync(src, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
      if (entry.name === 'disposers.ts') continue
      const file = join(entry.parentPath, entry.name)
      if (readFileSync(file, 'utf8').includes('.addEventListener(')) offenders.push(entry.name)
    }
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd /Users/mac08/Desktop/robot/readit
npm test -w @readit/element -- test/leak.test.ts
```

```
FAIL  test/leak.test.ts [ test/leak.test.ts ]
Error: Failed to load url ./helpers/leak-probe.js
Test Files  1 failed (1)
```

探针写完后再跑，预期还会红两条：

```
FAIL  test/leak.test.ts > 挂载/销毁 50 次 > 销毁后容器空、宿主属性还原、登记项归零
AssertionError: expected 50 to be 0
  - kernel.disposers.size
FAIL  test/leak.test.ts > 挂载/销毁 50 次 > shadow:false 逃生舱销毁后不留自己的节点
AssertionError: expected '宿主原有的内容' to be ''
```

（第一条是因为 Task 4 的 `destroy()` 调了 `disposers.disposeAll()`，但 `Disposers.size` 在 Task 3 的实现里已经清零——若这一条一上来就绿，**不要就此放行**：先把 `kernel.ts` 的 `destroy()` 里那行 `disposers.disposeAll()` 注释掉，重跑，确认 `describe()` 会列出 `HTMLDivElement#click`、`Window#change` 之类的残留，再恢复。一条抓不到已知漏洞的探针等于没写。）

- [ ] **Step 3: 写最小实现**

`packages/element/src/kernel.ts:236-246`，把 `destroy()` 整体替换：

```ts
    destroy(): void {
      if (destroyed) return
      destroyed = true
      // 先断内容再拆监听：反过来的话最后一次事件可能打到半拆的状态上。
      content.textContent = ''
      sourcePane.textContent = ''
      clearError()
      afterRender.length = 0
      disposers.disposeAll()
    },
```

Task 3 的 `createRoot` 已经在 disposer 里 `root.remove()` + 清 `adoptedStyleSheets` + 移除 `<style>`；`createThemeController` 已经在 disposer 里 `host.removeAttribute('data-theme')`。shadow:false 时宿主原有的子节点因此不受影响——被移除的只有我们自己 append 的 `.readit-root` 与 `<style data-readit>`。

若 Step 2 的第二条（逃生舱）红了，原因会是 `content.textContent = ''` 之外还有人清了宿主：核对 `createRoot` 的 disposer 里只有 `root.remove()`，没有 `container.textContent = ''`。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit
npm test -w @readit/element
npm run typecheck
npm test
```

最后一条要看到 P6 的五个数字一字未变：2318 条全绿、语料 56/68、CommonMark 649+3 PERMANENT、GFM 658+14 PERMANENT、TEMPORARY 0。任何一个变了都是回归，上报而不是重钉。

- [ ] **Step 5: 提交**

```bash
cd /Users/mac08/Desktop/robot/readit
git add packages/element
git commit -m "$(cat <<'EOF'
test(element): 泄漏探针——挂载/销毁 50 次后监听器与观察器计数归零

设计文档 §3.5 要求这一条用测试守而不是靠代码评审看，所以探针替换掉
EventTarget.prototype 的 add/removeEventListener 与 ResizeObserver /
MutationObserver 构造器，数的是净增量，不是「我记得都拆了」。

探针自己有自检：先证明它抓得到一个没拆的监听器、一个没 disconnect 的观察器，
再去数那 50 次循环。没有自检，「计数是 0」可能只是因为探针什么都没数到——
一条测不到真东西的断言比没有断言更糟，这是从 IME 那条验收线学到的同一件事。

ResizeObserver 与 MutationObserver 现在还没人用（read 模式不需要），探针照样
把它们计上：Task 13–17 的编辑器一旦漏掉一个 disconnect()，红的是这条，而不是
三个月后某个宿主 SPA 的内存曲线。

另加一条结构约束：src/ 里除 disposers.ts 外不得直接调用 addEventListener。
绕过登记的监听器只在那条路径真被走到时才会让循环变红，这一条让绕过本身就红。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 新增契约提案

以下都是 Task 3–6 需要、但 P1–P6 没写的东西。**没有在上面的任务体里直接当成既定契约用**（除了标 (a) 的两处所有权声明，那两个是我这组实际创建的文件），列在这里等编排者裁决。

1. **`MountHandle` 加 `navigationError(resolvedPath: string, detail?: string): void`。**
   设计文档 §8 要求「相对跳转文件不存在 → 窗口内错误态，显示解析后的完整路径」，但只有宿主知道文件不存在，而 P4 的 `onNavigate: (path: string) => void` 没有回程。Task 5 用的是契约内的权宜通道——`=> void` 接受任何返回值，所以宿主可以返回一个被拒绝的 Promise，元素据此进错误态。这条能用且有测试，但它是隐式约定：一个只读了 P4 类型签名的宿主不会知道。显式方法更好，加方法向后兼容（与 §9 修订 2 对 `find` 的判断同一条理由）。**未获批准前 Task 5 按 Promise 通道实现，不擅自加公共方法。**

2. **`MountHandle` 加 `back(): boolean` / `forward(): boolean` / `canBack(): boolean` / `canForward(): boolean`。**
   SPEC §11.2 与设计文档 §3.4 都写「前进/后退是元素的能力」，但 P4 的 MountHandle 上没有出口。Task 5 只做了键盘（Alt+←/→、Cmd+[/]）与鼠标侧键，宿主想画自己的前进后退按钮就没有 API。内核上有 `Kernel.navigation`，但那不从 `mount()` 漏出去。

3. **`packages/element/src/set-html.ts` 的归属（a）。**
   设计文档 §3.6 是一个独立小节，我这组的四条任务描述里没有它，但 Task 4 的 `mount()` 必须有它才能把 HTML 放进 DOM。**Task 4 建了这个文件并实现了三级完整路径**（含 Trusted Types + DOMPurify 3.4.13）。若另一组也起草了 §3.6：删掉那一份，保留他们的 CSP Playwright 场景测试（我这边只有 happy-dom 里伪造 `window.trustedTypes` 的单元测试，覆盖不到真实 CSP）。

4. **`packages/element/src/types.ts` 与包脚手架的归属（a）。**
   Task 3 建了 `packages/element/` 的 package.json / tsconfig.json / vitest.config.ts / src/types.ts。若 Task 1 的包边界任务已经建过，Task 3 只补 `environment: 'happy-dom'`、`lib` 里的 `DOM`、以及 happy-dom / github-markdown-css / dompurify 三个依赖；`types.ts` 必须与 P4 逐字一致。

5. **`--readit-*` 自定义属性通道无人认领。**
   SPEC §9.2 要求对外开 `--readit-*`（映射到 GitHub 的 `--fgColor-*` / `--bgColor-*` / `--color-prettylights-syntax-*`）。Task 3 只实现了 `::part()` 与 `data-theme`，**没有实现 `--readit-*`**。原因不是遗漏而是它比看上去贵：github-markdown-css 把那些变量声明在 `.markdown-body` 自己身上，所以从 `:host` 继承下来的覆写会被同元素上的声明压掉；正确做法要给每个主题各生成一份「`--fgColor-x: var(--readit-fg-x, <该主题的默认值>)`」的桥接表，约 60 个变量，且它是永久公开 API。**建议单列一个任务**，不要塞进 Task 3。

6. **`part="code-block"` 的选择器口径。**
   Task 4 取的是 `content.querySelectorAll('pre')`——每个代码块都有一个 `<pre>`，无论外面有没有 `.highlight` 包装。若高亮组（Task 7–12）打算给 `.highlight` 那层加 part，两边要统一到一个口径，否则同一个代码块会有两个 part 名。

7. **Trusted Types 那一级把 dompurify 拉进急加载包。**
   `set-html.ts` 静态 import dompurify 3.4.13，约 22 KB min，进的是设计文档 §2.1 那条「~60–70 KB 急加载」。SPEC §12 自己说 DOMPurify 的分工是「只处理运行时由第三方生成、没走过 hast 管线的东西」，而 Phase A 的输出恰恰走过了——所以这一级理论上可以是一条只为满足 CSP 的透传策略，省下那 22 KB。**没有擅自这么改**：这是安全控制上的偏离，该由设计文档的主人裁决，不该由实施计划的起草者顺手决定。请构建组（§6）在量体积时把这条一并回答。

8. **`Element.setHTML()`（第 1 级）可能悄悄改动 Phase A 的输出。**
   Sanitizer API 会按它自己的默认允许表再削一遍，而我们注入的 HTML 里有 `data-line`、`data-snippet-clipboard-copy-content`、Octicon 的内联 `<svg>`。happy-dom 没有 `setHTML`，所以离线层测不到这一级——**L4 视觉回归必须覆盖 `setHTML` 已经生效的浏览器**，否则第 1 级是一条对语料与快照完全不可见的保真度回归通道（与 §5.3 说「语料看不见高亮」是同一类盲区）。

9. **自定义元素拿不到 `math` / `highlighter`。**
   这两个是对象，属性不能从 HTML 属性传。`<readit-view>` 的宿主目前只能拿到 `highlighter: null` / `math: null`，要用得走 `mount()`。可选的补法是给元素加同名 JS 属性并在设值时重建内核，但那会引入一次可见的重渲。先记下来，不在 Task 3–6 内。

10. **`packages/element` 的 devDependency `happy-dom` 没有钉版本号。**
    Task 3 的装依赖命令用的是 `happy-dom@latest --save-exact`，让 npm 把解析到的确切版本写回 package.json。不在计划里写死一个版本号，是因为我核实不到 2026-08 时点上存在哪个版本，而编一个是这份计划最不该有的东西。若编排者要求全部依赖在计划文本里就定版，请补上实测版本号。

---

### Task 7: `@readit/highlight` 包骨架 + Shiki 实现（嵌入默认，JS 正则引擎，零 WASM）

**Files:**
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/package.json`
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/tsconfig.json`
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/vitest.config.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/src/serialize.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/src/shiki.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/src/index.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/scripts/refresh-shiki-golden.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/test/snippets.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/test/shiki.test.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/test/fixtures/shiki/{js,ts,python,rust,diff}.html`（Step 4 由脚本生成后提交）
- Modify: `/Users/mac08/Desktop/robot/readit/packages/core/src/rules/codeblock.ts:53`
- Modify: `/Users/mac08/Desktop/robot/readit/packages/core/test/rules/codeblock.test.ts:87-97`
> ⚠️ **§0 A5：`test/ci-wiring.test.ts` 归 Task 1，本任务删掉这条 Modify。**
> Task 1 已整块改过 `:74-82` 并新增「覆盖 packages/ 下每个工作区」的断言，行号已漂移。
- Test: `/Users/mac08/Desktop/robot/readit/packages/highlight/test/shiki.test.ts`

**Interfaces:**
- Consumes:
  - `interface Highlighter { highlight(code: string, lang: string): string | null; supports(lang: string): boolean }`，**仅类型**，从 `@readit/core/types`（`packages/core/src/types.ts:1-5`，P3 规定不得改动）
  - `applyCodeBlock(md: MarkdownIt, highlighter: Highlighter | null): void`（`packages/core/src/rules/codeblock.ts:69`）—— 本任务修正它交给 `highlight()` 的正文
  - 根 `vitest.config.ts` 的 `projects: ['.', 'packages/*']` 已是 glob，新包自动被收编，**不需要改根配置**
- Produces:
  - `createShikiHighlighter(opts?: { langs?: readonly string[] }): Promise<Highlighter>`，从 `@readit/highlight` 导出（P3 逐字）
  - `serializeFragment(children: readonly RootContent[]): string` 与 `unwrapPreCode(root: Root): readonly RootContent[]`，从 `packages/highlight/src/serialize.ts` 导出，**Task 8 直接复用**
  - 给 `@readit/element`（Task 9+）的 CSS 契约（P1 禁止 element 从 highlight 取值，所以这是一条写在文档里、由两边各自实现的约定）：Shiki 输出的每个 token 是 `<span style="color:#RRGGBB;--readit-shiki-dark:#RRGGBB">`，行包在 `<span class="line">` 里；element 的 dark 样式表须含
    ```css
    :host([data-theme='dark']) .highlight pre span { color: var(--readit-shiki-dark, inherit); }
    ```
  - `packages/highlight/test/snippets.ts` 的 `SNIPPETS` / `LANGS`，**Task 8 直接复用**（两个实现盯同一批输入，这是「两个实现才算验证过一个抽象」在测试输入上的兑现）

---

- [ ] **Step 1: 写会失败的测试**

先落包骨架（测试连收集都做不到就无所谓失败），再落测试。

`packages/highlight/package.json`：
```json
{
  "name": "@readit/highlight",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts",
    "./package.json": "./package.json"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "refresh:shiki-golden": "tsx scripts/refresh-shiki-golden.ts"
  },
  "dependencies": {
    "hast-util-to-html": "9.0.5",
    "shiki": "4.4.2"
  },
  "devDependencies": {
    "@readit/core": "0.0.0",
    "@types/hast": "3.0.5",
    "@types/node": "24.10.1",
    "hast-util-from-html": "2.0.3",
    "tsx": "4.20.6",
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  },
  "engines": {
    "node": ">=22"
  }
}
```

`@readit/core` 放在 **devDependencies** 而不是 dependencies，是 P1「@readit/highlight → @readit/core 仅类型」的**结构性**执行：`verbatimModuleSyntax` 下 `import type` 不产出运行时 import，所以 devDependency 是正确声明；哪天有人写成值导入，`publint` / `@arethetypeswrong/cli`（构建任务那道门）会当场报「运行时依赖了 devDependency」，而不是等到某个宿主把 markdown-it 意外打进 54 KB 的嵌入包里才发现。

`packages/highlight/tsconfig.json`（与 `packages/core/tsconfig.json` 逐字同构，只是 `include` 多了 `scripts`）：
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.ts"]
}
```

`packages/highlight/vitest.config.ts`：
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // 离线门：从包内跑 `npm test` 的那条路径也必须被守住，不只是根上的 `npm test`。
    // Task 8 的 onig.wasm 地雷完全依赖它，见 ../../test/setup/no-network.ts。
    setupFiles: ['../../test/setup/no-network.ts'],
    chaiConfig: {
      truncateThreshold: 0,
    },
  },
})
```

`packages/highlight/test/snippets.ts`：
```ts
export interface Snippet {
  readonly slug: string
  readonly lang: string
  readonly code: string
}

/**
 * 与 packages/core/test/corpus/frontend/highlight-*.md 的围栏正文逐字相同。
 * 这样 ①档（语料只验 wrapper class）与 ③档（本包的冻结黄金文件验 token 划分）
 * 盯的是同一批输入，两档的结论可以互相对齐。
 *
 * 正文末尾不带换行：core 的 renderBlock 交给 highlight() 的就是去掉尾换行的正文
 * （见本任务对 packages/core/src/rules/codeblock.ts 的修改）。
 */
export const SNIPPETS: readonly Snippet[] = [
  { slug: 'js', lang: 'js', code: 'const greet = (name) => `hi ${name}`\nexport default greet' },
  { slug: 'ts', lang: 'ts', code: 'interface P { id: number }\nexport const f = (p: P): string => String(p.id)' },
  { slug: 'python', lang: 'python', code: 'def f(x: int) -> int:\n    return x * 2' },
  { slug: 'rust', lang: 'rust', code: 'fn main() {\n    println!("hi");\n}' },
  { slug: 'diff', lang: 'diff', code: '- old line\n+ new line' },
]

/** 五个片段的语言名，直接当作 createShikiHighlighter 的 langs 传入。 */
export const LANGS: readonly string[] = SNIPPETS.map((s) => s.lang)
```

`packages/highlight/test/shiki.test.ts`：
```ts
import { readFileSync } from 'node:fs'
import { fromHtml } from 'hast-util-from-html'
import type { Nodes } from 'hast'
import { describe, expect, it } from 'vitest'
import { createShikiHighlighter } from '../src/index.js'
import { LANGS, SNIPPETS } from './snippets.js'

const dir = new URL('./fixtures/shiki/', import.meta.url)

/** 解析后拼接全部文本节点——比对文本时不受转义写法（`&gt;` vs `>`）影响。 */
function textOf(html: string): string {
  const walk = (node: Nodes): string =>
    node.type === 'text' ? node.value : 'children' in node ? node.children.map(walk).join('') : ''
  return walk(fromHtml(html, { fragment: true }))
}

describe('createShikiHighlighter', () => {
  it('只预载 langs 里点名的语言，其余一律不 supports', async () => {
    const hl = await createShikiHighlighter({ langs: ['js', 'python'] })
    expect(hl.supports('js')).toBe(true)
    expect(hl.supports('python')).toBe(true)
    expect(hl.supports('rust')).toBe(false)
  })

  it('langs 省略时是一个什么都不支持的高亮器，而不是偷偷预载一堆语法包', async () => {
    // 契约的意图是 langs 由 scan(src, inlineMath).languages 驱动。省略时给任何「常用集」默认值
    // 都是替嵌入方猜字节：实测 45 个「常用」语言包合计 255.4 KB gzip，是嵌入侧
    // 引擎本身（~54 KB）的 4.7 倍。所以省略 = 空集，降级路径是 core 的朴素 <pre>。
    const hl = await createShikiHighlighter()
    expect(hl.supports('js')).toBe(false)
    expect(hl.highlight('const a = 1', 'js')).toBeNull()
  })

  it('跳过 langs 里的未知语言而不抛——scan() 有意过报', async () => {
    // packages/core/src/prepare.ts 的 scan() 文档写死「may over-report；must never
    // under-report」，它会把 ```zzzznotalanguage 也报上来。在这里抛异常等于让一篇
    // 正常文档整体渲染失败。
    const hl = await createShikiHighlighter({ langs: ['js', 'zzzznotalanguage'] })
    expect(hl.supports('js')).toBe(true)
    expect(hl.supports('zzzznotalanguage')).toBe(false)
    expect(hl.highlight('x', 'zzzznotalanguage')).toBeNull()
  })

  it('highlight() 是纯同步的：工厂 resolve 之后不再有任何 await', async () => {
    // P3 的 Phase A 纯度。用 Promise 探测：若 highlight() 内部还有微任务，
    // 它就不可能在同一个同步 tick 里返回字符串。
    const hl = await createShikiHighlighter({ langs: ['js'] })
    let out: string | null = null
    out = hl.highlight('const a = 1', 'js')
    expect(typeof out).toBe('string')
  })

  it('输出的文本内容与输入逐字相同（不吞字、不加尾换行）', async () => {
    // 这是唯一一条能替语料把关的断言：归一化器的 flattenHighlight 会把
    // div.highlight-source-* 里的 span 全展平成文本，所以只要文本一致，
    // 打开高亮后语料 56/68 就不会动。
    const hl = await createShikiHighlighter({ langs: [...LANGS] })
    for (const s of SNIPPETS) {
      const html = hl.highlight(s.code, s.lang)
      expect(html, s.slug).not.toBeNull()
      expect(textOf(html as string), s.slug).toBe(s.code)
    }
  })

  it('不产出 <pre> / <code> 外壳——外壳是 core 的 renderBlock 的活', async () => {
    const hl = await createShikiHighlighter({ langs: ['js'] })
    const html = hl.highlight('const a = 1', 'js') as string
    expect(html).not.toContain('<pre')
    expect(html).not.toContain('<code')
    expect(html.startsWith('<span class="line">')).toBe(true)
  })

  it('双主题：默认色内联为 hex，dark 走 --readit-shiki-dark 自定义属性', async () => {
    // element 侧只开 --readit-* 自定义属性（设计 §3.3），所以前缀必须改掉 shiki
    // 的默认 --shiki-。
    const hl = await createShikiHighlighter({ langs: ['js'] })
    const html = hl.highlight('const a = 1', 'js') as string
    expect(html).toMatch(/style="color:#[0-9a-fA-F]{6}/)
    expect(html).toContain('--readit-shiki-dark:#')
    expect(html).not.toContain('--shiki-dark')
  })

  it('确定性：两个独立工厂对同一输入产出同一字节', async () => {
    const a = await createShikiHighlighter({ langs: ['ts'] })
    const b = await createShikiHighlighter({ langs: ['ts'] })
    const snippet = SNIPPETS.find((s) => s.slug === 'ts')!
    expect(a.highlight(snippet.code, snippet.lang)).toBe(b.highlight(snippet.code, snippet.lang))
  })

  describe('③档 D-TOKEN 冻结黄金文件', () => {
    for (const s of SNIPPETS) {
      it(`${s.slug} 与自家黄金文件逐字相同`, async () => {
        const hl = await createShikiHighlighter({ langs: [s.lang] })
        const golden = readFileSync(new URL(`${s.slug}.html`, dir), 'utf8')
        expect(hl.highlight(s.code, s.lang)).toBe(golden)
      })
    }
  })
})
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd /Users/mac08/Desktop/robot/readit
npm install
npm test --workspace @readit/highlight
```

预期输出（`src/index.ts` 还不存在）：
```
 FAIL  test/shiki.test.ts [ test/shiki.test.ts ]
Error: Failed to load url ../src/index.js (resolved id: /Users/mac08/Desktop/robot/readit/packages/highlight/src/index.js). Does the file exist?

 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] **Step 3: 写最小实现**

`packages/highlight/src/serialize.ts`：
```ts
import type { Element, Root, RootContent } from 'hast'
import { toHtml } from 'hast-util-to-html'

/**
 * 把一串 hast 节点序列化成 <pre> 的内容。
 *
 * 注意 hast-util-to-html 在文本位置不转义 `>`（GitHub 转义成 `&gt;`）。这只影响
 * 本包自己的 ③档黄金文件：语料以 highlighter: null 跑，看不见任何高亮标记；
 * 而归一化器两侧都要过一遍 parse → toHtml，转义写法在那里被抹平。
 */
export function serializeFragment(children: readonly RootContent[]): string {
  return toHtml({ type: 'root', children: [...children] })
}

function firstElement(children: readonly RootContent[], tagName: string): Element | undefined {
  for (const child of children) {
    if (child.type === 'element' && child.tagName === tagName) return child
  }
  return undefined
}

/**
 * 剥掉 `<pre><code>` 外壳，只留下 token 节点。
 *
 * core 的 renderBlock 自己发 GitHub 形状的
 * `<div class="highlight highlight-source-js …"><pre>{body}</pre></div>`，
 * highlight() 只负责 body。找不到外壳时原样返回，绝不吞内容。
 */
export function unwrapPreCode(root: Root): readonly RootContent[] {
  const pre = firstElement(root.children, 'pre')
  if (pre === undefined) return root.children
  const code = firstElement(pre.children, 'code')
  return code === undefined ? pre.children : code.children
}
```

`packages/highlight/src/shiki.ts`：
```ts
import type { Highlighter } from '@readit/core/types'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { bundledLanguages } from 'shiki/langs'
import githubDark from 'shiki/themes/github-dark.mjs'
import githubLight from 'shiki/themes/github-light.mjs'
import { serializeFragment, unwrapPreCode } from './serialize.js'

export interface ShikiOptions {
  /**
   * 要预载的围栏语言名，通常直接传 `scan(src, inlineMath).languages`。
   *
   * 省略即空集：得到的 Highlighter 对任何语言都 supports() === false，core 回落到
   * 朴素 <pre>（SPEC §12「围栏语言未知 → 朴素 <pre>，不高亮，不报错」）。这里不给
   * 「常用集」默认值，是因为 highlight() 必须纯同步（P3），语言集只能在工厂期定死，
   * 而任何猜出来的默认集都是替嵌入方付字节：实测 shiki 与 starry-night 的公共语言
   * 交集（45 个名字）合计 255.4 KB gzip，是嵌入侧引擎本身的 4.7 倍。
   *
   * 名单里的未知名字会被跳过而不抛：scan() 按契约是过报的（`packages/core/src/
   * prepare.ts` 里写死「may over-report」），抛异常会让一篇含 ```zzzznotalanguage
   * 的正常文档整体渲染失败。
   */
  langs?: readonly string[]
}

type LangLoader = (typeof bundledLanguages)[keyof typeof bundledLanguages]

const REGISTRY = bundledLanguages as Record<string, LangLoader | undefined>

/**
 * 嵌入默认：Shiki 4.4.2 + JS 正则引擎，零 WASM。
 *
 * 工厂是 async（语法包按需动态 import），产出的 highlight() 纯同步。
 * `forgiving: true`：JS 正则引擎复现不了少数 Oniguruma 专有构造，宽容模式跳过
 * 那几条 pattern 而不是整条语法崩掉——这是 ③档 D-TOKEN 已声明偏离的一个来源，
 * 由冻结黄金文件而不是 GitHub oracle 盯住。
 */
export async function createShikiHighlighter(opts: ShikiOptions = {}): Promise<Highlighter> {
  const loaders: LangLoader[] = []
  for (const name of opts.langs ?? []) {
    const loader = REGISTRY[name.toLowerCase()]
    if (loader !== undefined) loaders.push(loader)
  }

  const core = await createHighlighterCore({
    engine: createJavaScriptRegexEngine({ forgiving: true }),
    themes: [githubLight, githubDark],
    langs: loaders,
  })

  const loaded = new Set(core.getLoadedLanguages())

  return {
    supports(lang: string): boolean {
      return loaded.has(lang.toLowerCase())
    },
    highlight(code: string, lang: string): string | null {
      const key = lang.toLowerCase()
      if (!loaded.has(key)) return null
      const hast = core.codeToHast(code, {
        lang: key,
        themes: { light: 'github-light', dark: 'github-dark' },
        defaultColor: 'light',
        cssVariablePrefix: '--readit-shiki-',
        structure: 'classic',
      })
      return serializeFragment(unwrapPreCode(hast))
    },
  }
}
```

`packages/highlight/src/index.ts`：
```ts
export { createShikiHighlighter, type ShikiOptions } from './shiki.js'
```

`packages/highlight/scripts/refresh-shiki-golden.ts`：
```ts
/**
 * 重写 packages/highlight/test/fixtures/shiki/*.html（③档 D-TOKEN 冻结黄金文件）。
 * 只在**有意**接受 shiki 4.4.2 → 新版本的 token 划分变化时跑，跑完必须逐字看 diff。
 *
 *   npm run refresh:shiki-golden --workspace @readit/highlight
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createShikiHighlighter } from '../src/index.js'
import { LANGS, SNIPPETS } from '../test/snippets.js'

const dir = new URL('../test/fixtures/shiki/', import.meta.url)
mkdirSync(dir, { recursive: true })

const hl = await createShikiHighlighter({ langs: [...LANGS] })
for (const s of SNIPPETS) {
  const html = hl.highlight(s.code, s.lang)
  if (html === null) throw new Error(`shiki 没有认出语言 ${s.lang}（片段 ${s.slug}）`)
  writeFileSync(new URL(`${s.slug}.html`, dir), html, 'utf8')
}
console.log('refreshed', SNIPPETS.length, 'shiki golden files')
```

core 的尾换行修正 —— `packages/core/src/rules/codeblock.ts:53`：
```ts
    const body = highlighter?.highlight(trimmed, lang) ?? escapeText(trimmed)
```
（原为 `highlighter?.highlight(code, lang)`。`code` 带围栏正文的尾换行，`trimmed` 不带；同一函数里 `data-snippet-clipboard-copy-content` 与无高亮回落路径用的都是 `trimmed`，而无高亮那条路径正是语料 56/68 已经逐字验过的那条。让高亮路径收到不同的字节，等于给每个 Highlighter 实现留一个「输出比 GitHub 多一个换行」的坑，两个实现都得各自记得踩掉。）

同文件把 `code` 这个现在只剩一处用途的局部变量收掉，`packages/core/src/rules/codeblock.ts:44-45`：
```ts
  const trimmed = token.content.replace(/\n$/, '')
```
并把 `packages/core/src/rules/codeblock.ts:65` 里的 `escapeText(code)` 改为 `escapeText(token.content)`（缩进代码块那条分支要的就是原始正文，含尾换行——它有语料背书，不能跟着动）。

`packages/core/test/rules/codeblock.test.ts:87-97` 相应更新：
```ts
  it('uses the highlighter output verbatim inside the bare pre when one is supplied', () => {
    const hl: Highlighter = {
      supports: (lang) => lang === 'js',
      highlight: (code, lang) => (lang === 'js' ? `<span class="pl-k">${code}</span>` : null),
    }
    // 交给 highlight() 的正文不带尾换行，与 data-snippet-clipboard-copy-content
    // 以及无高亮回落路径用的是同一个字符串。
    expect(md(hl).render('```js\nconst\n```\n')).toBe(
      '<div class="highlight highlight-source-js notranslate position-relative overflow-auto"' +
        ' dir="auto" data-snippet-clipboard-copy-content="const">' +
        '<pre><span class="pl-k">const</span></pre></div>\n',
    )
  })
```

`test/ci-wiring.test.ts:77` 改成从工作区推导，省得每加一个包就要记得回来补一行（计划二一共要加三个）：
```ts
      const packages = readdirSync(new URL('../packages/', import.meta.url), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => `packages/${e.name}/tsconfig.json`)
      for (const path of ['tsconfig.json', ...packages]) {
```
并在该文件顶部把 import 补成：
```ts
import { readFileSync, readdirSync } from 'node:fs'
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit
npm test --workspace @readit/highlight
```
第一次仍红，且只红在黄金文件那五条上：
```
 FAIL  test/shiki.test.ts > createShikiHighlighter > ③档 D-TOKEN 冻结黄金文件 > js 与自家黄金文件逐字相同
Error: ENOENT: no such file or directory, open '.../test/fixtures/shiki/js.html'
 Test Files  1 failed (1)
      Tests  5 failed | 8 passed (13)
```
八条结构性断言（纯同步、文本逐字、无外壳、双主题变量、确定性、未知语言跳过、空集默认）先绿，说明实现不是靠黄金文件自证的。然后生成并**逐字审阅**黄金文件：

```bash
npm run refresh:shiki-golden --workspace @readit/highlight
git diff --stat packages/highlight/test/fixtures/shiki/
cat packages/highlight/test/fixtures/shiki/js.html
npm test --workspace @readit/highlight
```
预期 `Tests  13 passed (13)`。

全量回归（P6：这些数字一个都不许动）：
```bash
npm run typecheck
npm test
```
预期：**2318 条既有测试全绿 + 本任务新增 13 条**，0 失败（§0 A11：判据不写全局总数，总数会随任务逐个变化）。不变量逐条核：语料仍 56/68，CommonMark 649 + 3 PERMANENT，GFM 658 + 14 PERMANENT，TEMPORARY 0。**若这四个不变量里任何一个变了，那是回归——上报，不要重钉数字。**

- [ ] **Step 5: 提交**

```bash
cd /Users/mac08/Desktop/robot/readit
git add packages/highlight packages/core/src/rules/codeblock.ts \
        packages/core/test/rules/codeblock.test.ts test/ci-wiring.test.ts \
        package-lock.json
git commit -m "$(cat <<'EOF'
feat(highlight): @readit/highlight 包 + Shiki 4.4.2 实现（JS 正则引擎，零 WASM）

- createShikiHighlighter：async 工厂，产出的 highlight() 纯同步（P3）
- langs 省略 = 空集：默认集会替嵌入方付 255.4 KB gzip，实测过
- 双主题 github-light/dark，dark 走 --readit-shiki-* 自定义属性
- ③档 D-TOKEN 五个冻结黄金文件 + 八条不依赖黄金文件的结构性断言
- core：交给 highlight() 的正文改为去掉尾换行的 trimmed，与已有语料背书的
  无高亮回落路径对齐，省得两个实现各踩一次
- ci-wiring 的 tsconfig 名单改为从 packages/ 推导

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

---

### Task 8: starry-night 实现 + onig.wasm 本地化（离线门要抓的地雷）+ 语言包体积实测与闸门决策

**Files:**
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/src/starry-night.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/scripts/refresh-starry-night-golden.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/scripts/measure-lang-packs.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/data/lang-pack-sizes.json`
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/test/starry-night.test.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/test/onig-wasm-offline.test.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/test/lang-pack-sizes.test.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/highlight/test/fixtures/starry-night/{js,ts,python,rust,diff}.html`（Step 4 由脚本生成后提交）
- Modify: `/Users/mac08/Desktop/robot/readit/packages/highlight/src/index.ts:1`
- Modify: `/Users/mac08/Desktop/robot/readit/packages/highlight/package.json`（加依赖与一条 script）
- Modify: `/Users/mac08/Desktop/robot/readit/SPEC.md:241`
- Modify: `/Users/mac08/Desktop/robot/readit/docs/superpowers/specs/2026-08-09-plan2-element-editor-design.md:260`（§5.4 末尾追加实测结论）
- Modify: `/Users/mac08/Desktop/robot/readit/docs/superpowers/specs/2026-08-09-plan2-element-editor-design.md:347`（§9 修订表补第 5 行）
- Test: `/Users/mac08/Desktop/robot/readit/packages/highlight/test/onig-wasm-offline.test.ts`

**Interfaces:**
- Consumes:
  - `serializeFragment(children: readonly RootContent[]): string`（Task 7，`packages/highlight/src/serialize.ts`）
  - `SNIPPETS: readonly Snippet[]`、`Snippet { slug, lang, code }`（Task 7，`packages/highlight/test/snippets.ts`）
  - `interface Highlighter`（`@readit/core/types`，仅类型）
  - `OfflineViolationError`（`test/setup/no-network.ts:68`），已由 `packages/highlight/vitest.config.ts` 的 `setupFiles` 装载
- Produces:
  - `createStarryNightHighlighter(opts: { onigWasmUrl: string }): Promise<Highlighter>`，从 `@readit/highlight` 导出（P3 逐字）
  - `onigurumaOptions(onigWasmUrl: string): OnigurumaOptions`，**不进 index.ts**（内部接缝，测试用深路径 import）
  - `packages/highlight/data/lang-pack-sizes.json`：两个实现全部语言包的实测体积表 + 闸门决策，构建任务（体积预算）与 M6 桌面壳的语言集选型都读它
  - 给 element（Task 9+）的 CSS 契约：starry-night 发 GitHub 真实的 `pl-*` class，需要 `@wooorm/starry-night/style/*.css` 里的 Primer 变量；element 侧引哪一份 light/dark 由 element 任务定，本包不导出 CSS（P1：element 只能从 highlight 取类型）

---

- [ ] **Step 1: 写会失败的测试**

`packages/highlight/test/onig-wasm-offline.test.ts` —— 这是整组里最重要的一条，它同时证明三件事：地雷在 3.10.0 里还活着、计划一的离线门确实抓得住它、我们的覆写是它真正消费的那个形状。

```ts
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { onigurumaOptions } from '../src/starry-night.js'

const require_ = createRequire(import.meta.url)

/** vscode-oniguruma 2.0.1 的 onig.wasm 绝对路径（starry-night 3.10.0 期望的正是这一版）。 */
const WASM_PATH = require_.resolve('vscode-oniguruma/release/onig.wasm')

/**
 * starry-night 的浏览器档 WASM 加载器。
 *
 * 它进不了包的 exports map（"./*" 映射到 "./lang/*.js"），所以只能按文件路径 import。
 * 必须按文件路径拿到它：Node 条件下 `#get-oniguruma` 解析到 get-oniguruma.fs.js，
 * 从磁盘读 wasm，**永远不会** fetch——这正是「在联网开发机上永远测不出来」的机制层
 * 解释，也是为什么单跑 createStarryNightHighlighter 证明不了任何事。
 */
async function loadBrowserLoader(): Promise<{
  getOniguruma: (options?: { getOnigurumaUrlFetch?: () => URL | Promise<URL> }) => Promise<Response>
}> {
  const root = path.dirname(require_.resolve('@wooorm/starry-night'))
  const href = pathToFileURL(path.join(root, 'lib', 'get-oniguruma.default.js')).href
  return (await import(/* @vite-ignore */ href)) as Awaited<ReturnType<typeof loadBrowserLoader>>
}

describe('starry-night 的 onig.wasm 默认浏览器路径', () => {
  it('不覆写就伸手去 esm.sh，且离线门当场把它按住', async () => {
    const { getOniguruma } = await loadBrowserLoader()
    await expect(getOniguruma()).rejects.toThrowError(
      /offline gate: fetch tried to reach https:\/\/esm\.sh\/vscode-oniguruma@2\/release\/onig\.wasm/,
    )
  })

  it('覆写后走本地地址，拿回的就是本地那份 onig.wasm 的字节', async () => {
    // 用 data: URL 而不是起本地服务器：hostname 为空串，离线门放行（isLocal('')），
    // 在 CI 的 `unshare --net` 空网络命名空间里也一样能跑。
    const bytes = readFileSync(WASM_PATH)
    const dataUrl = `data:application/wasm;base64,${bytes.toString('base64')}`
    const { getOniguruma } = await loadBrowserLoader()
    const res = await getOniguruma(onigurumaOptions(dataUrl))
    expect(res.ok).toBe(true)
    expect(new Uint8Array(await res.arrayBuffer()).byteLength).toBe(bytes.byteLength)
  })
})

describe('onigurumaOptions', () => {
  it('永远设 getOnigurumaUrlFetch', () => {
    const opts = onigurumaOptions('https://cdn.example.test/onig.wasm')
    expect(opts.getOnigurumaUrlFetch().href).toBe('https://cdn.example.test/onig.wasm')
  })

  it('只有 file: 才顺带设 getOnigurumaUrlFs', () => {
    // Node 档的 fs.readFile(url) 只吃 file:。给它一个 https: 会炸，而 starry-night
    // 自带的 fs 默认值（resolve('vscode-oniguruma') 旁边那份）本来就是本地且离线的，
    // 所以非 file: 时让它落回默认值，比强塞一个读不了的 URL 正确。
    expect(onigurumaOptions('https://cdn.example.test/onig.wasm').getOnigurumaUrlFs).toBeUndefined()
    const fileUrl = pathToFileURL(WASM_PATH).href
    expect(onigurumaOptions(fileUrl).getOnigurumaUrlFs?.().href).toBe(fileUrl)
  })

  it('相对路径当场报错，而不是等到运行时拿不到 WASM', () => {
    expect(() => onigurumaOptions('/onig.wasm')).toThrowError(/must be an absolute URL/)
  })
})
```

`packages/highlight/test/starry-night.test.ts`：
```ts
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { fromHtml } from 'hast-util-from-html'
import type { Nodes } from 'hast'
import { describe, expect, it } from 'vitest'
import { createStarryNightHighlighter } from '../src/index.js'
import { SNIPPETS } from './snippets.js'

const require_ = createRequire(import.meta.url)
const ONIG_WASM_URL = pathToFileURL(require_.resolve('vscode-oniguruma/release/onig.wasm')).href
const dir = new URL('./fixtures/starry-night/', import.meta.url)

function textOf(html: string): string {
  const walk = (node: Nodes): string =>
    node.type === 'text' ? node.value : 'children' in node ? node.children.map(walk).join('') : ''
  return walk(fromHtml(html, { fragment: true }))
}

describe('createStarryNightHighlighter', () => {
  it('发 GitHub 真实的 pl-* class', async () => {
    const hl = await createStarryNightHighlighter({ onigWasmUrl: ONIG_WASM_URL })
    const html = hl.highlight('const a = 1', 'js') as string
    expect(html).toContain('class="pl-k"')
    expect(html).not.toContain('style="color:')
  })

  it('supports() 覆盖 common 的 34 条语法，不覆盖之外的', async () => {
    const hl = await createStarryNightHighlighter({ onigWasmUrl: ONIG_WASM_URL })
    for (const lang of ['js', 'ts', 'python', 'rust', 'diff']) expect(hl.supports(lang), lang).toBe(true)
    // emacs-lisp 不在 common 里（也正是实测里最大的那个语法包，203.1 KB gzip）
    expect(hl.supports('emacs-lisp')).toBe(false)
    expect(hl.highlight('(car x)', 'emacs-lisp')).toBeNull()
  })

  it('highlight() 是纯同步的', async () => {
    const hl = await createStarryNightHighlighter({ onigWasmUrl: ONIG_WASM_URL })
    expect(typeof hl.highlight('const a = 1', 'js')).toBe('string')
  })

  it('输出的文本内容与输入逐字相同', async () => {
    const hl = await createStarryNightHighlighter({ onigWasmUrl: ONIG_WASM_URL })
    for (const s of SNIPPETS) {
      expect(textOf(hl.highlight(s.code, s.lang) as string), s.slug).toBe(s.code)
    }
  })

  it('不产出 <pre> / <code> 外壳', async () => {
    const hl = await createStarryNightHighlighter({ onigWasmUrl: ONIG_WASM_URL })
    const html = hl.highlight('const a = 1', 'js') as string
    expect(html).not.toContain('<pre')
    expect(html).not.toContain('<code')
  })

  describe('③档 D-TOKEN 冻结黄金文件', () => {
    for (const s of SNIPPETS) {
      it(`${s.slug} 与自家黄金文件逐字相同`, async () => {
        const hl = await createStarryNightHighlighter({ onigWasmUrl: ONIG_WASM_URL })
        expect(hl.highlight(s.code, s.lang)).toBe(readFileSync(new URL(`${s.slug}.html`, dir), 'utf8'))
      })
    }
  })
})

describe('两个实现共用同一个 adapter 接口', () => {
  it('对同一批输入产出相同的文本，只有 token 标记不同', async () => {
    // 「只有一个实现的适配器接口等于没有被验证过」（设计 §5.1）。这条是那句话唯一
    // 能被机器检查的形式：两个实现必须在同一个契约下对同一批输入给出同样的文本。
    const { createShikiHighlighter } = await import('../src/index.js')
    const sn = await createStarryNightHighlighter({ onigWasmUrl: ONIG_WASM_URL })
    const shiki = await createShikiHighlighter({ langs: SNIPPETS.map((s) => s.lang) })
    for (const s of SNIPPETS) {
      const a = sn.highlight(s.code, s.lang) as string
      const b = shiki.highlight(s.code, s.lang) as string
      expect(textOf(a), s.slug).toBe(textOf(b))
      expect(a, s.slug).not.toBe(b)
    }
  })
})
```

`packages/highlight/test/lang-pack-sizes.test.ts`：
```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { measureAll, type Report } from '../scripts/measure-lang-packs.js'

const committed = JSON.parse(
  readFileSync(new URL('../data/lang-pack-sizes.json', import.meta.url), 'utf8'),
) as Report

/** SPEC §5.1：首次遇到 `$` 时无条件加载的数学包，~677 KB gzip，没有任何闸门。 */
const MATH_PAYLOAD_GZIP = 677 * 1024

describe('语言包体积台账', () => {
  const fresh = measureAll()

  it('提交进仓库的表还是当前依赖版本的实测值', () => {
    for (const key of ['shiki', 'starryNight'] as const) {
      expect(fresh[key].version, key).toBe(committed[key].version)
      expect(fresh[key].count, key).toBe(committed[key].count)
      // raw 是文件字节数，跨平台完全确定；gzip 随 Node 自带的 zlib 版本有微小浮动，
      // 所以 raw 逐字比，gzip 留 5% 余量。
      expect(fresh[key].top.map((p) => [p.name, p.raw]), key).toEqual(
        committed[key].top.map((p) => [p.name, p.raw]),
      )
      expect(fresh[key].gzip.max, key).toBeGreaterThan(committed[key].gzip.max * 0.95)
      expect(fresh[key].gzip.max, key).toBeLessThan(committed[key].gzip.max * 1.05)
    }
  })

  it('记录的结论是「不建闸」，并逐字记着万一要建时的文案', () => {
    expect(committed.gate.built).toBe(false)
    expect(committed.gate.copyIfEverBuilt).toBe(
      '这个代码块的语言包较大（<N> KB），已跳过高亮。[仍要加载]',
    )
  })

  it('支撑「不建闸」的那条实测事实仍然成立：最大的语法包仍小于无闸门的数学包', () => {
    // 这条断言就是决策本身。哪天 shiki 出了一个比数学包还大的语法包，它先红，
    // 决策就必须重新做一次——而不是靠谁记得回来看这张表。
    expect(fresh.shiki.gzip.max).toBeLessThan(MATH_PAYLOAD_GZIP)
    expect(fresh.starryNight.gzip.max).toBeLessThan(MATH_PAYLOAD_GZIP)
  })

  it('分布仍然是极度右偏的：中位数是个位数 KB，超 50 KB 的是个位数个', () => {
    expect(fresh.shiki.gzip.p50).toBeLessThan(4 * 1024)
    expect(fresh.shiki.over['50KB']).toBeLessThanOrEqual(4)
    expect(fresh.starryNight.gzip.p50).toBeLessThan(4 * 1024)
    expect(fresh.starryNight.over['50KB']).toBeLessThanOrEqual(4)
  })
})
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd /Users/mac08/Desktop/robot/readit
npm test --workspace @readit/highlight
```
预期输出：
```
 FAIL  test/onig-wasm-offline.test.ts [ test/onig-wasm-offline.test.ts ]
Error: Failed to load url ../src/starry-night.js (resolved id: .../packages/highlight/src/starry-night.js). Does the file exist?

 FAIL  test/starry-night.test.ts [ test/starry-night.test.ts ]
SyntaxError: The requested module '../src/index.js' does not provide an export named 'createStarryNightHighlighter'

 FAIL  test/lang-pack-sizes.test.ts [ test/lang-pack-sizes.test.ts ]
Error: Failed to load url ../scripts/measure-lang-packs.js

 Test Files  3 failed | 1 passed (4)
```

- [ ] **Step 3: 写最小实现**

先加依赖到 `packages/highlight/package.json`（`dependencies` 补 `@wooorm/starry-night`，`devDependencies` 补 `@shikijs/langs` 与 `vscode-oniguruma`，`scripts` 补两条）：
```json
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "refresh:shiki-golden": "tsx scripts/refresh-shiki-golden.ts",
    "refresh:starry-night-golden": "tsx scripts/refresh-starry-night-golden.ts",
    "measure:lang-packs": "tsx scripts/measure-lang-packs.ts"
  },
  "dependencies": {
    "@wooorm/starry-night": "3.10.0",
    "hast-util-to-html": "9.0.5",
    "shiki": "4.4.2"
  },
  "devDependencies": {
    "@readit/core": "0.0.0",
    "@shikijs/langs": "4.4.2",
    "@types/hast": "3.0.5",
    "@types/node": "24.10.1",
    "hast-util-from-html": "2.0.3",
    "tsx": "4.20.6",
    "typescript": "5.9.3",
    "vitest": "4.1.10",
    "vscode-oniguruma": "2.0.1"
  },
```
`vscode-oniguruma` 明确钉在 2.0.1 而不是靠 starry-night 的传递依赖被提升上来：starry-night 自己的文档就警告「你手动加载的 WASM 必须是内部 vscode-oniguruma 期望的那一版，否则重装依赖时随时会坏」。写成显式 devDependency 是把这条警告变成一个版本号。`@shikijs/langs` 同理——只有体积测量脚本用它，靠提升拿到就等于测量脚本随时会因为提升布局变化而找不到目录。

`packages/highlight/src/starry-night.ts`：
```ts
import type { Highlighter } from '@readit/core/types'
import { common, createStarryNight } from '@wooorm/starry-night'
import { serializeFragment } from './serialize.js'

export interface OnigurumaOptions {
  getOnigurumaUrlFetch: () => URL
  getOnigurumaUrlFs?: () => URL
}

/**
 * 把一个 onig.wasm 地址翻成 starry-night 的 Options。
 *
 * starry-night 的默认浏览器路径**硬编码** fetch('https://esm.sh/vscode-oniguruma@2
 * /release/onig.wasm')。不覆写就直接违反离线约束，而 Node 档走的是文件系统加载器，
 * 所以在联网开发机上、甚至在纯 Node 测试里都永远测不出来。P3 把 onigWasmUrl 设成
 * 必填就是防它被忘记的结构手段；test/onig-wasm-offline.test.ts 是防它被写错的那层。
 *
 * 单独导出（不进 index.ts）是为了让那条测试能把这个对象喂给 starry-night 自己的
 * 浏览器加载器，验证的是它真正消费的形状，而不是我们对键名的猜测。
 */
export function onigurumaOptions(onigWasmUrl: string): OnigurumaOptions {
  let url: URL
  try {
    url = new URL(onigWasmUrl)
  } catch {
    throw new TypeError(
      `createStarryNightHighlighter: onigWasmUrl must be an absolute URL, got ${JSON.stringify(onigWasmUrl)}. ` +
        "In a bundler: new URL('onig.wasm', import.meta.url).href. In Node: pathToFileURL(...).href.",
    )
  }
  const options: OnigurumaOptions = { getOnigurumaUrlFetch: () => url }
  // Node 档的加载器走 fs.readFile(url)，只吃 file:。非 file: 时留空，让它落回
  // starry-night 自带的默认值（node_modules 里那份），那条路径本来就是本地且离线的。
  if (url.protocol === 'file:') options.getOnigurumaUrlFs = () => url
  return options
}

/**
 * 桌面壳默认：starry-night 3.10.0，发 GitHub 真实的 pl-* class + Primer 变量。
 *
 * 语法集固定为 `common`（34 条，实测 269.1 KB gzip，桌面壳从本地磁盘读，带宽成本≈0）。
 * 不做按需注册：register() 是 async，而 P3 要求 highlight() 纯同步，所以语法集只能
 * 在工厂期定死。要更大的集合是 M6 的事，见「新增契约提案」。
 */
export async function createStarryNightHighlighter(opts: { onigWasmUrl: string }): Promise<Highlighter> {
  const starryNight = await createStarryNight(common, onigurumaOptions(opts.onigWasmUrl))
  return {
    supports(lang: string): boolean {
      return starryNight.flagToScope(lang) !== undefined
    },
    highlight(code: string, lang: string): string | null {
      const scope = starryNight.flagToScope(lang)
      if (scope === undefined) return null
      return serializeFragment(starryNight.highlight(code, scope).children)
    },
  }
}
```

`packages/highlight/src/index.ts:1` 变成两行：
```ts
export { createShikiHighlighter, type ShikiOptions } from './shiki.js'
export { createStarryNightHighlighter } from './starry-night.js'
```

`packages/highlight/scripts/measure-lang-packs.ts`：
```ts
/**
 * 量两个实现全部语言包的实际体积（设计 §5.4 第 1 步），写进
 * packages/highlight/data/lang-pack-sizes.json。
 *
 * 纯本地文件读取 + zlib，无网络。
 *
 *   npm run measure:lang-packs --workspace @readit/highlight
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const require_ = createRequire(import.meta.url)

export interface Pack {
  name: string
  raw: number
  gzip: number
}

export interface Impl {
  package: string
  version: string
  count: number
  gzip: { min: number; p50: number; p90: number; p95: number; p99: number; max: number; sum: number }
  /** 超过 N KB gzip 的语言包个数。 */
  over: Record<string, number>
  /** 最大的十个。 */
  top: Pack[]
}

export interface Report {
  measuredAt: string
  shiki: Impl
  starryNight: Impl
  gate: { built: false; copyIfEverBuilt: string; rationale: string }
}

const THRESHOLDS_KB = [16, 32, 50, 64, 100] as const

function measureDir(dir: string, ext: string): Pack[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => {
      const bytes = readFileSync(path.join(dir, f))
      return { name: f.slice(0, -ext.length), raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length }
    })
    .sort((a, b) => b.gzip - a.gzip || a.name.localeCompare(b.name))
}

function quantile(ascending: readonly number[], p: number): number {
  const i = Math.min(ascending.length - 1, Math.max(0, Math.ceil(p * ascending.length) - 1))
  return ascending[i] ?? 0
}

function summarize(packs: readonly Pack[], pkg: string, version: string): Impl {
  const asc = packs.map((x) => x.gzip).sort((a, b) => a - b)
  const over: Record<string, number> = {}
  for (const kb of THRESHOLDS_KB) over[`${kb}KB`] = packs.filter((x) => x.gzip > kb * 1024).length
  return {
    package: pkg,
    version,
    count: packs.length,
    gzip: {
      min: asc[0] ?? 0,
      p50: quantile(asc, 0.5),
      p90: quantile(asc, 0.9),
      p95: quantile(asc, 0.95),
      p99: quantile(asc, 0.99),
      max: asc[asc.length - 1] ?? 0,
      sum: asc.reduce((a, b) => a + b, 0),
    },
    over,
    top: packs.slice(0, 10),
  }
}

function versionOf(pkgJsonPath: string): string {
  return (JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { version: string }).version
}

export function measureAll(): Pick<Report, 'shiki' | 'starryNight'> {
  // shiki 的 dist/langs/*.mjs 只是 re-export 存根（52 字节），真正的语法体在
  // @shikijs/langs 里，打包器跟过去内联的也是它。
  const shikiDir = path.dirname(require_.resolve('@shikijs/langs/javascript'))
  const shikiPkg = path.join(shikiDir, '..', 'package.json')
  const snRoot = path.dirname(require_.resolve('@wooorm/starry-night'))
  return {
    shiki: summarize(measureDir(shikiDir, '.mjs'), '@shikijs/langs', versionOf(shikiPkg)),
    starryNight: summarize(
      measureDir(path.join(snRoot, 'lang'), '.js'),
      '@wooorm/starry-night',
      versionOf(path.join(snRoot, 'package.json')),
    ),
  }
}

const report: Report = {
  measuredAt: '2026-08-09',
  ...measureAll(),
  gate: {
    built: false,
    copyIfEverBuilt: '这个代码块的语言包较大（<N> KB），已跳过高亮。[仍要加载]',
    rationale:
      '本项目对懒加载载荷的既定容忍度是数学包 ~677 KB gzip 与 mermaid 1–1.5 MB，两者都没有闸门。' +
      '最坏的单个语法包（shiki emacs-lisp 194.2 KB gzip）比其中较小的那个还小 3.5 倍。' +
      '只给三个懒加载大件里最小的那个建闸不自洽。完整论证见设计文档 §5.4.1。',
  },
}

const out = new URL('../data/lang-pack-sizes.json', import.meta.url)
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
console.error(
  `shiki: ${report.shiki.count} packs, max ${(report.shiki.gzip.max / 1024).toFixed(1)} KB gzip; ` +
    `starry-night: ${report.starryNight.count} packs, max ${(report.starryNight.gzip.max / 1024).toFixed(1)} KB gzip`,
)
```

`packages/highlight/scripts/refresh-starry-night-golden.ts`：
```ts
/**
 * 重写 packages/highlight/test/fixtures/starry-night/*.html（③档 D-TOKEN）。
 * 只在**有意**接受 starry-night 3.10.0 → 新版本的 token 划分变化时跑，跑完逐字看 diff。
 *
 *   npm run refresh:starry-night-golden --workspace @readit/highlight
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createStarryNightHighlighter } from '../src/index.js'
import { SNIPPETS } from '../test/snippets.js'

const require_ = createRequire(import.meta.url)
const onigWasmUrl = pathToFileURL(require_.resolve('vscode-oniguruma/release/onig.wasm')).href

const dir = new URL('../test/fixtures/starry-night/', import.meta.url)
mkdirSync(dir, { recursive: true })

const hl = await createStarryNightHighlighter({ onigWasmUrl })
for (const s of SNIPPETS) {
  const html = hl.highlight(s.code, s.lang)
  if (html === null) throw new Error(`starry-night 的 common 里没有语言 ${s.lang}（片段 ${s.slug}）`)
  writeFileSync(new URL(`${s.slug}.html`, dir), html, 'utf8')
}
console.log('refreshed', SNIPPETS.length, 'starry-night golden files')
```

`SPEC.md:241` 的估算换成实测：
```
| 嵌入方，只读 + Shiki 高亮 | + ~54 KB（core，零 WASM）+ 每语言 0.08–194 KB 按需（2026-08-09 实测 361 个语言包：中位 1.4 KB、p90 8.0 KB、p99 30.4 KB、最大 emacs-lisp 194.2 KB。原写「0.8–16 KB」是估算，尾部低估 12 倍。表在 packages/highlight/data/lang-pack-sizes.json） |
```

设计文档 §5.4 末尾（第 260 行「而 SPEC 写这条时手上只有估算。）」之后）追加：

```markdown

### 5.4.1 实测结果与结论（2026-08-09，闸门：不建）

`packages/highlight/data/lang-pack-sizes.json` 是机器可读的完整表，由
`npm run measure:lang-packs --workspace @readit/highlight` 生成，
`packages/highlight/test/lang-pack-sizes.test.ts` 每次跑套件都重算一遍比对。

| | Shiki 4.4.2（`@shikijs/langs`） | starry-night 3.10.0（`lang/`） |
|---|---|---|
| 语言包个数 | 361 | 719 |
| gzip 最小 | 0.08 KB | 0.10 KB |
| gzip 中位（p50） | 1.4 KB | 1.8 KB |
| gzip p90 | 8.0 KB | 5.9 KB |
| gzip p95 | 14.5 KB | 9.4 KB |
| gzip p99 | 30.4 KB | 27.9 KB |
| gzip 最大 | **194.2 KB**（`emacs-lisp`） | **203.1 KB**（`source.emacs.lisp`） |
| > 32 KB 的个数 | 3 | 3 |
| > 50 KB 的个数 | 2 | 2 |
| > 100 KB 的个数 | 1 | 1 |
| 全部合计 | 1.30 MB | 2.32 MB |

最大的八个（gzip / raw，KB）——
Shiki：`emacs-lisp` 194.2/773.9 · `wolfram` 75.4/260.7 · `cpp` 32.4/521.4 ·
`objective-cpp` 30.4/180.1 · `php` 28.0/117.5 · `blade` 27.6/109.5 ·
`hack` 25.8/83.8 · `mdx` 23.0/142.9。
starry-night：`source.emacs.lisp` 203.1/826.1 · `source.objc.platform` 50.5/163.5 ·
`source.c.platform` 43.6/139.6 · `source.actionscript.3` 30.0/95.0 ·
`text.html.php.blade` 30.0/131.5 · `source.maxscript` 29.7/97.7 ·
`source.tsx` 28.2/236.1 · `text.html.php` 27.9/101.7。

**只有 Shiki 侧的表与闸门有关。** starry-night 的语法集在工厂期就定死（`common`，
34 条，269.1 KB gzip），因为 `register()` 是 async 而 `highlight()` 必须纯同步；
桌面壳又是从本地磁盘读。它那 719 行只是「一个宿主最多可能挑到多大」的参考。

**结论：不建这道闸。** 三条理由，按分量排：

1. **与本项目自己已经接受的懒加载载荷不自洽。** 数学包首次遇到 `$` 就无条件加载
   ~677 KB gzip，mermaid 1–1.5 MB，两者都没有任何闸门。最坏的单个语法包 194.2 KB
   比其中较小的那个还小 3.5 倍。给三个懒加载大件里最小的那个建闸、放过更大的两个，
   这不是谨慎，是不一致。
2. **§5.4 第 3 步写的备用阈值被自己的实测输出否掉了。** p90 = 8.0 KB 会拦下 361 个
   语言里的 36 个，其中包括 `cpp`、`php`、`jsx`、`tsx`、`mdx`。一条会让 C++ 和 PHP
   不再高亮的规则，是被它自己的结果取消资格的，不是被偏好取消的。
3. **闸门的真实成本不在那次字节判断上。** P3 下语言集在工厂期由 `scan()` 定死，
   所以「仍要加载」意味着重建 highlighter 并整篇重渲——一套只为这个按钮存在的
   `@readit/element` 机器。这正是 §5.4 第 2 步预见的 YAGNI。

**推翻它是廉价的，而且推翻的触发器已经在跑：**
`createShikiHighlighter({ langs })` 本来就在筛 `langs`，加一道体积判断是几行；
而 `lang-pack-sizes.test.ts` 里有一条断言写死「最大的语法包仍小于无闸门的数学包」，
哪天某个语言包越过那条线，它先红，决策就必须重做一次——不靠谁记得回来看这张表。

**文案照 SPEC 要求现在定死**（记在 `data/lang-pack-sizes.json` 的
`gate.copyIfEverBuilt` 字段里，由测试逐字盯住；**不**作为导出的 API 符号存在，
因为闸门没建，导出它就成了「公共 API 里的永久 no-op」——计划一刚为
`readFrontmatterOptions` 挨过这一条）：

> 这个代码块的语言包较大（`<N>` KB），已跳过高亮。[仍要加载]
```

设计文档 §9 修订表在第 347 行后补一行：
```markdown
| 5 | §5.1 体积预算表 | 「每语言 0.8–16 KB 按需」是估算，实测为 0.08–194 KB（中位 1.4 KB、p99 30.4 KB），尾部低估 12 倍。已按实测改写，并在 §5.4.1 记下体积上限闸门**不建**的完整论证 |
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit
npm install
npm run measure:lang-packs --workspace @readit/highlight
```
预期 stderr：
```
shiki: 361 packs, max 194.2 KB gzip; starry-night: 719 packs, max 203.1 KB gzip
```

```bash
npm test --workspace @readit/highlight
```
此时只剩 starry-night 的五条黄金文件红（ENOENT），其余全绿——尤其
`onig-wasm-offline.test.ts` 的三条必须已经绿了，那是这个任务的核心。生成并审阅：

```bash
npm run refresh:starry-night-golden --workspace @readit/highlight
cat packages/highlight/test/fixtures/starry-night/js.html
npm test --workspace @readit/highlight
```
`js.html` 应逐字为（GitHub 真实的 `pl-*`）：
```
<span class="pl-k">const</span> <span class="pl-c1">greet</span> <span class="pl-k">=</span> (<span class="pl-smi">name</span>) <span class="pl-k">=></span> <span class="pl-s"><span class="pl-pds">`</span>hi <span class="pl-pse"><span class="pl-s1">${</span></span><span class="pl-s1">name</span><span class="pl-pse"><span class="pl-s1">}</span></span><span class="pl-pds">`</span></span>
<span class="pl-k">export</span> <span class="pl-c1">default</span> <span class="pl-smi">greet</span>
```

全量与离线双跑（离线门是这条地雷的唯一裁判，必须在真正无出网的命名空间里也过一遍）：
```bash
npm run typecheck
npm test
sudo unshare --net -- sh -c 'ip link set lo up; exec npm test'
```
三条都要绿，且 `npm test` 仍是 `2318 + 本任务新增` 的形态：语料 56/68、CommonMark
649 + 3 PERMANENT、GFM 658 + 14 PERMANENT、TEMPORARY 0 一字不变。若既有数字动了，
**上报，不要重钉**（P6）。

- [ ] **Step 5: 提交**

```bash
cd /Users/mac08/Desktop/robot/readit
git add packages/highlight SPEC.md \
        docs/superpowers/specs/2026-08-09-plan2-element-editor-design.md \
        package-lock.json
git commit -m "$(cat <<'EOF'
feat(highlight): starry-night 实现 + onig.wasm 本地化 + 语言包体积实测

- createStarryNightHighlighter：common 34 条语法，发 GitHub 真实的 pl-* class
- onigurumaOptions()：覆写 getOnigurumaUrlFetch（file: 时顺带 getOnigurumaUrlFs）；
  onigWasmUrl 必填且必须是绝对 URL，相对路径当场抛
- onig-wasm-offline.test.ts 按文件路径加载 starry-night 自己的浏览器档 WASM
  加载器：不覆写时离线门逐字抓到 esm.sh；覆写后走 data: URL 拿回本地字节。
  Node 档走文件系统，所以单跑工厂证明不了任何事——这条测的是真东西
- ③档 D-TOKEN 五个冻结黄金文件；一条跨实现断言：两个实现文本相同、标记不同
- 语言包体积实测（shiki 361 个 / starry-night 719 个），闸门**不建**：
  最坏 194.2 KB gzip 比无闸门的数学包（~677 KB）还小 3.5 倍；§5.4 备用阈值
  p90 = 8.0 KB 会拦下 cpp/php/jsx/tsx。论证记进设计文档 §5.4.1，
  推翻触发器写成一条会红的断言
- SPEC §5.1「每语言 0.8–16 KB」按实测改写（尾部原低估 12 倍）

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 新增契约提案

以下四条是本组起草期间发现的、**契约里没有而实现或后续里程碑需要**的接口。都没有在上面的任务里直接使用（除第 2 条只作为内部符号、不进 `index.ts`），列出来等统一裁决。

1. **`createStarryNightHighlighter` 增加可选的 `grammars`**
   ```ts
   export function createStarryNightHighlighter(opts: {
     onigWasmUrl: string
     /** 默认 starry-night 的 `common`（34 条，实测 269.1 KB gzip）。 */
     grammars?: readonly Grammar[]
   }): Promise<Highlighter>
   ```
   理由：P3 的签名没有语言集入口，而 `register()` 是 async、`highlight()` 必须纯同步，
   所以语法集只能在工厂期定死。`common` 34 条覆盖不了 M6 桌面壳想要的范围，`all` 694 条
   是 2.27 MB gzip 的解析成本。这是**加可选参数**，向后兼容。本组按 P3 原样实现，未使用。

2. **`onigurumaOptions(onigWasmUrl: string): OnigurumaOptions`**（`src/starry-night.ts` 导出，
   **不进** `src/index.ts`）。纯内部接缝，只为让离线测试能把这个对象喂给 starry-night 自己的
   浏览器加载器，验证的是它真正消费的键名而不是我们的猜测。若评审认为连内部导出也算表面积，
   替代方案是把断言退化成「读加载器源码断言它含 esm.sh 硬编码」，但那就只剩一个漂移探测器，
   证明不了我们的覆写是对的。

3. **`packages/core/src/prepare.ts` 的 `Loaders.highlighter` 与 P3 的两个工厂签名对不上。**
   现状是 `() => Promise<{ createHighlighter(): Highlighter }>`（同步 `createHighlighter`，
   无参），而 P3 是 `createShikiHighlighter(opts?): Promise<Highlighter>` /
   `createStarryNightHighlighter(opts): Promise<Highlighter>`。**本组不动它**：
   `DEFAULT_LOADERS.highlighter` 保持 `null`，高亮器由 P4 的 `MountOptions.highlighter`
   显式注入，M3 不需要 `prepare()` 自动加载高亮器。提请拥有 element 的那组确认这条分工；
   若确定要让 `prepare()` 自动加载，`Loaders` 的类型要改，且要连带决定 `langs` 从哪来
   （`scan().languages` 已经有了，是现成的）。

4. **element 侧的高亮 CSS 契约需要一个落点。**
   P1 禁止 `@readit/element` 从 `@readit/highlight` 取值，所以两个实现所需的样式只能长在
   element 自己的样式表里：Shiki 侧是 `:host([data-theme='dark']) .highlight pre span
   { color: var(--readit-shiki-dark, inherit); }`，starry-night 侧是
   `@wooorm/starry-night/style/*.css` 的 Primer 变量。提案：由 element 那组在
   `packages/element` 里建一个 `styles/highlight.css`，并加一条测试断言它含
   `--readit-shiki-dark`——否则这条约定只活在两份文档的注释里，正是设计文档说的
   「纪律会烂、结构不会」那类东西。

---

### Task 9: `readit` 发布外观包 —— dist 构建、SPEC §9.3 exports 映射、CSS 双形态、`.d.ts`

**Files:**
- Create: `/Users/mac08/Desktop/robot/readit/packages/readit/package.json`
- Create: `/Users/mac08/Desktop/robot/readit/packages/readit/tsconfig.json`
- Create: `/Users/mac08/Desktop/robot/readit/packages/readit/tsconfig.build.json`
- Create: `/Users/mac08/Desktop/robot/readit/packages/readit/vitest.config.ts`（Step 1 建，Step 3 加 `globalSetup`）
- Create: `/Users/mac08/Desktop/robot/readit/packages/readit/build.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/readit/src/core.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/readit/src/element.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/readit/src/editor.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/readit/src/plugins/math.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/readit/src/plugins/highlight.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/readit/test/global-setup.ts`
- Modify: `/Users/mac08/Desktop/robot/readit/package.json:7-20`（加 `build` 脚本）
> ⚠️ **§0 A4：D2-9 归 Task 1，已于 commit `57d8993` 落地，本任务删掉这条 Modify。**
> **保留** `test/build-output.test.ts` 里那条 D2-9 断言——那是有价值的第二道锁。
- Test: `/Users/mac08/Desktop/robot/readit/packages/readit/test/build-output.test.ts`

**Interfaces:**
- Consumes:
  - `@readit/core`（P1）：`render(src: string, opts?: Partial<RenderOptions>): string`、`scan(src: string, inlineMath: InlineMathMode): ScanResult`（计划一已存在）
  - `@readit/element`（P4）：`mount(host: HTMLElement, opts?: Partial<MountOptions>): MountHandle`、`defineReadit(tag?: string): void`
  - `@readit/highlight`（P3）：`createShikiHighlighter(opts?: { langs?: readonly string[] }): Promise<Highlighter>`、`createStarryNightHighlighter(opts: { onigWasmUrl: string }): Promise<Highlighter>`
  - `@readit/editor`（P2）：`createEditor(kind: EditorKind, opts: EditorOptions): Promise<Editor>`
  - `@readit/math`：`createMathRenderer(): MathRenderer`（计划一已存在）
  - **契约外，见末尾提案 N1**：`@readit/element/styles` 的 `export const ELEMENT_CSS: string` 与 `export const LIGHT_DOM_CSS: string`
- Produces:
  - `packages/readit/build.ts` → `export async function buildDist(): Promise<void>`
  - 产物布局（Task 10 三条门全部依赖它）：`packages/readit/dist/{core.js,core.cjs,core.d.ts,element.js,element.d.ts,editor.js,editor.d.ts,plugins/math.js,plugins/math.d.ts,plugins/highlight.js,plugins/highlight.d.ts,readit.css,types/**,cjs/{package.json,core.d.ts,types/**}}`
  - `packages/readit/test/global-setup.ts` → `export default function setup(project: TestProject): Promise<void>`（Task 10 在此挂 tarball 的 `provide`）
  - 根脚本 `npm run build`

---

- [ ] **Step 1: 写会失败的测试**

`packages/readit/package.json`（**完整**，exports 映射即 SPEC §9.3 的兑现）：

```json
{
  "name": "readit",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "description": "GitHub-shaped Markdown renderer and embeddable viewer",
  "sideEffects": ["*.css"],
  "engines": { "node": ">=22" },
  "files": ["dist"],
  "exports": {
    ".": {
      "types": "./dist/core.d.ts",
      "module-sync": "./dist/core.js",
      "import": "./dist/core.js",
      "require": { "types": "./dist/cjs/core.d.ts", "default": "./dist/core.cjs" }
    },
    "./element": { "types": "./dist/element.d.ts", "import": "./dist/element.js" },
    "./editor": { "types": "./dist/editor.d.ts", "import": "./dist/editor.js" },
    "./plugins/math": { "types": "./dist/plugins/math.d.ts", "import": "./dist/plugins/math.js" },
    "./plugins/highlight": { "types": "./dist/plugins/highlight.d.ts", "import": "./dist/plugins/highlight.js" },
    "./styles.css": "./dist/readit.css",
    "./package.json": "./package.json"
  },
  "scripts": {
    "build": "vite-node build.ts",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@readit/core": "0.0.0",
    "@readit/editor": "0.0.0",
    "@readit/element": "0.0.0",
    "@readit/highlight": "0.0.0",
    "@readit/math": "0.0.0",
    "@types/node": "24.10.1",
    "esbuild": "0.25.12",
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  }
}
```

三处偏离 SPEC §9.3 的字面写法，理由写在提案 N2/N3/N4，都是「照抄会让 Task 10 的门必红」的地方：
子路径带 `types` 条件（SPEC 写的是裸字符串）；`require` 用嵌套对象自带 CJS 味的类型；
不列 `./plugins/mermaid`（M5 前文件不存在，publint 的 `FILE_DOES_NOT_EXIST` 会直接红）。
`private: true` 是决策 2「只构建不发布」的结构性保证——`npm pack` 照常工作，`npm publish` 被 npm 自己拒绝。
五个 `@readit/*` 进 `devDependencies` 而非 `dependencies`：esbuild 把它们全部内联，发布出去的包**运行时零依赖**，
隔离宿主 fixture 才能在 `unshare --net` 里 `npm install --offline` 装上。

`packages/readit/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "build.ts", "vitest.config.ts"]
}
```

`packages/readit/vitest.config.ts`（Step 1 版，尚无 `globalSetup`）：

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // 与 packages/core 同：包内直接跑 vitest 时离线门也在。
    setupFiles: ['../../test/setup/no-network.ts'],
    // 这个 project 会 npm pack + npm install 一个 tarball（Task 10），比其它 project 慢一个量级。
    testTimeout: 180_000,
    hookTimeout: 180_000,
    chaiConfig: { truncateThreshold: 0 },
  },
})
```

`packages/readit/test/build-output.test.ts`：

```ts
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ELEMENT_CSS, LIGHT_DOM_CSS } from '@readit/element/styles'

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(PKG_DIR, 'dist')
const read = (rel: string): string => readFileSync(join(DIST, rel), 'utf8')

interface Manifest {
  exports: Record<string, unknown>
  dependencies?: Record<string, string>
  files: string[]
  sideEffects: string[]
  type: string
}
const manifest = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as Manifest

/** 从 exports 映射里收集所有 "./..." 形态的目标路径。 */
function exportTargets(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    if (node.startsWith('./')) out.push(node)
    return out
  }
  if (node !== null && typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) exportTargets(v, out)
  }
  return out
}

/** 顺着相对 import 把一个入口的产物闭包全读出来。 */
function bundleClosure(entryRel: string): string {
  const seen = new Set<string>()
  const queue = [entryRel]
  let text = ''
  while (queue.length > 0) {
    const rel = queue.pop()!
    if (seen.has(rel)) continue
    seen.add(rel)
    const body = read(rel)
    text += body
    for (const m of body.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']*)["']/g)) {
      const dir = dirname(rel)
      queue.push(dir === '.' ? m[1]!.replace(/^\.\//, '') : `${dir}/${m[1]!.replace(/^\.\//, '')}`)
    }
  }
  return text
}

describe('exports 映射就是 SPEC §9.3 的那张表', () => {
  it('逐字段等于契约形状', () => {
    expect(manifest.exports).toEqual({
      '.': {
        types: './dist/core.d.ts',
        'module-sync': './dist/core.js',
        import: './dist/core.js',
        require: { types: './dist/cjs/core.d.ts', default: './dist/core.cjs' },
      },
      './element': { types: './dist/element.d.ts', import: './dist/element.js' },
      './editor': { types: './dist/editor.d.ts', import: './dist/editor.js' },
      './plugins/math': { types: './dist/plugins/math.d.ts', import: './dist/plugins/math.js' },
      './plugins/highlight': { types: './dist/plugins/highlight.d.ts', import: './dist/plugins/highlight.js' },
      './styles.css': './dist/readit.css',
      './package.json': './package.json',
    })
    expect(manifest.type).toBe('module')
    expect(manifest.sideEffects).toEqual(['*.css'])
    expect(manifest.files).toEqual(['dist'])
  })

  it('每一条目标路径都真的在磁盘上', () => {
    for (const target of exportTargets(manifest.exports)) {
      expect(existsSync(join(PKG_DIR, target)), target).toBe(true)
    }
  })

  it('发布产物运行时零依赖——宿主 fixture 要能在无出网环境里装上它', () => {
    expect(manifest.dependencies ?? {}).toEqual({})
  })
})

describe('CSS 双形态：一个源，两种交付', () => {
  it('./styles.css 与 LIGHT_DOM_CSS 逐字节相同', () => {
    expect(read('readit.css')).toBe(LIGHT_DOM_CSS)
  })

  it('shadow 那一份被内联成 JS 字符串，不是外部文件', () => {
    const element = bundleClosure('element.js')
    // 类字符串在字符串字面量里不会被 minify 改写，也不需要转义，是稳定的探针。
    const selectors = [...new Set([...ELEMENT_CSS.matchAll(/\.([a-zA-Z][\w-]{2,})/g)].map((m) => m[1]!))].slice(0, 20)
    expect(selectors.length, 'ELEMENT_CSS 里一个类选择器都没有，探针失效').toBeGreaterThan(0)
    for (const sel of selectors) expect(element, `.${sel} 不在 dist/element.js 里`).toContain(`.${sel}`)
  })

  it('全 dist 不出现 CSS module script —— 那会把 CSS import 属性的支持强加给每个宿主打包器', () => {
    for (const rel of ['core.js', 'element.js', 'editor.js', 'plugins/math.js', 'plugins/highlight.js']) {
      const text = read(rel)
      expect(text, rel).not.toMatch(/with\s*\{\s*type\s*:\s*["']css["']\s*\}/)
      expect(text, rel).not.toMatch(/(?<![@\w])(?:from|import)\s*\(?\s*["'][^"']*\.css["']/)
    }
  })
})

describe("'.' 入口不含任何浏览器专属内容（结构面；行为面见 Task 10 第三条门）", () => {
  it.each(['customElements', 'HTMLElement', 'adoptedStyleSheets', 'attachShadow'])(
    'core.js 的产物闭包里不出现 %s',
    (ident) => {
      expect(bundleClosure('core.js')).not.toContain(ident)
    },
  )
})

describe('CJS 只在 require 条件下存在，且带自己那一味的类型', () => {
  it('dist/cjs 用嵌套 package.json 声明 commonjs，而不是靠改扩展名', () => {
    expect(JSON.parse(read('cjs/package.json'))).toEqual({ type: 'commonjs' })
    expect(existsSync(join(DIST, 'cjs/core.d.ts'))).toBe(true)
  })

  it('CJS 产物带 esbuild 的具名导出注解，cjs-module-lexer 才看得见它们', () => {
    // platform:'node' 才会发这段注解；漏掉它，宿主的 `import { render } from 'readit'`
    // 在走 require 条件的打包器里只能拿到 default。
    expect(read('core.cjs')).toContain('0 && (module.exports =')
  })
})

describe('D2-9：@readit/core ↔ @readit/math 的循环工作区依赖', () => {
  it('math 对 core 是纯类型依赖，声明在 devDependencies 里', () => {
    const math = JSON.parse(
      readFileSync(join(PKG_DIR, '../math/package.json'), 'utf8'),
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }
    expect(math.dependencies['@readit/core']).toBeUndefined()
    expect(math.devDependencies['@readit/core']).toBe('0.0.0')
  })
})
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd /Users/mac08/Desktop/robot/readit
npm install --save-dev --save-exact -w packages/readit \
  esbuild@0.25.12 typescript@5.9.3 vitest@4.1.10 @types/node@24.10.1
npm test -- --project readit
```

预期：`exports 映射就是 SPEC §9.3 的那张表 › 逐字段等于契约形状` 与 D2-9 之外的用例全红，
失败信息都是 `ENOENT: no such file or directory, open '.../packages/readit/dist/core.js'`；
D2-9 那条红在 `expected undefined to be '0.0.0'`；
`每一条目标路径都真的在磁盘上` 红在 `./dist/core.d.ts: expected false to be true`。

- [ ] **Step 3: 写最小实现**

`packages/readit/src/core.ts`：

```ts
// 发布产物 '.' 入口。P1：它必须等于 @readit/core，不得触及任何浏览器全局。
export * from '@readit/core'
```

`packages/readit/src/element.ts`：

```ts
export * from '@readit/element'
```

`packages/readit/src/editor.ts`：

```ts
export * from '@readit/editor'
```

`packages/readit/src/plugins/math.ts`：

```ts
export * from '@readit/math'
```

`packages/readit/src/plugins/highlight.ts`：

```ts
export * from '@readit/highlight'
```

`packages/readit/tsconfig.build.json`（只发声明；`rootDir` 取仓库根，产物落在 `dist/types/packages/<pkg>/src/**`）：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "emitDeclarationOnly": true,
    "rootDir": "../..",
    "outDir": "./dist/types",
    "types": []
  },
  "include": [
    "src/**/*.ts",
    "../core/src/**/*.ts",
    "../math/src/**/*.ts",
    "../element/src/**/*.ts",
    "../highlight/src/**/*.ts",
    "../editor/src/**/*.ts"
  ]
}
```

`packages/readit/build.ts`：

```ts
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { LIGHT_DOM_CSS } from '@readit/element/styles'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, 'dist')
const req = createRequire(import.meta.url)

const ESM_ENTRIES = [
  { out: 'core', in: join(HERE, 'src/core.ts') },
  { out: 'element', in: join(HERE, 'src/element.ts') },
  { out: 'editor', in: join(HERE, 'src/editor.ts') },
  { out: 'plugins/math', in: join(HERE, 'src/plugins/math.ts') },
  { out: 'plugins/highlight', in: join(HERE, 'src/plugins/highlight.ts') },
] as const

/**
 * tsc 发出来的 .d.ts 里仍然写着 `@readit/core` 这类工作区说明符，而装包方那边不存在
 * 这些包（一切都被 esbuild 内联了）。这张表把它们改写成 dist/types 内的相对路径。
 * 表是封闭的：出现表外的说明符就抛错，因为「静默留一个解析不了的类型 import」
 * 恰好是 @arethetypeswrong 存在的理由。
 */
const WORKSPACE_TYPE_TARGETS: Readonly<Record<string, string>> = {
  '@readit/core': 'packages/core/src/index.js',
  '@readit/core/types': 'packages/core/src/types.js',
  '@readit/math': 'packages/math/src/index.js',
  '@readit/math/stylesheet': 'packages/math/src/svg-stylesheet.js',
  '@readit/math/introspect': 'packages/math/src/introspect.js',
  '@readit/element': 'packages/element/src/index.js',
  '@readit/element/styles': 'packages/element/src/styles.js',
  '@readit/highlight': 'packages/highlight/src/index.js',
  '@readit/editor': 'packages/editor/src/index.js',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

function upTo(out: string): string {
  const depth = out.split('/').length - 1
  return depth === 0 ? '.' : new Array(depth).fill('..').join('/')
}

function rewriteWorkspaceSpecifiers(typesRoot: string): void {
  const unknown = new Set<string>()
  for (const file of walk(typesRoot)) {
    if (!file.endsWith('.d.ts')) continue
    const before = readFileSync(file, 'utf8')
    const after = before.replace(/(["'])(@readit\/[^"']+)\1/g, (whole, quote: string, spec: string) => {
      const target = WORKSPACE_TYPE_TARGETS[spec]
      if (target === undefined) {
        unknown.add(spec)
        return whole
      }
      const rel = relative(dirname(file), join(typesRoot, ...target.split('/'))).split(sep).join('/')
      return `${quote}${rel.startsWith('.') ? rel : `./${rel}`}${quote}`
    })
    if (after !== before) writeFileSync(file, after, 'utf8')
  }
  if (unknown.size > 0) {
    throw new Error(
      `未登记的工作区说明符出现在 .d.ts 里：${[...unknown].join(', ')}。` +
        '把它加进 build.ts 的 WORKSPACE_TYPE_TARGETS——否则装包方拿到的类型解析不了。',
    )
  }
}

function assertSelfContained(): void {
  const offenders: string[] = []
  for (const file of walk(DIST)) {
    if (!/\.(?:js|cjs|d\.ts)$/.test(file)) continue
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/(?<![@\w])(?:from|import|require)\s*\(?\s*["']([^"'.][^"']*)["']/g)) {
      offenders.push(`${relative(DIST, file)} → ${m[1]!}`)
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      '发布产物里残留了裸模块说明符，装包方解析不了（它的 dependencies 是空的）：\n' +
        offenders.join('\n'),
    )
  }
}

export async function buildDist(): Promise<void> {
  rmSync(DIST, { recursive: true, force: true })
  mkdirSync(DIST, { recursive: true })

  // 1. ESM 五入口 + 代码分割。splitting 让 element → editor 的动态 import 落在包内相对
  //    路径上，宿主不需要解析任何裸说明符，四个大件仍是四个互相独立的动态 import（§2.1）。
  await esbuild.build({
    entryPoints: [...ESM_ENTRIES],
    outdir: DIST,
    bundle: true,
    splitting: true,
    format: 'esm',
    // platform:'neutral' 不注入 'browser' 条件：starry-night 因此拿到同构入口，
    // onig.wasm 的位置由 createStarryNightHighlighter 的必填 onigWasmUrl 决定，
    // 而不是由打包条件偷偷决定（SPEC §5.2 的必做项）。
    platform: 'neutral',
    // neutral 会把 mainFields 清空，js-yaml 这类只有 main/module 的包会解析不到。
    mainFields: ['module', 'main'],
    conditions: ['import'],
    target: ['es2022'],
    minify: true,
    legalComments: 'none',
    sourcemap: false,
  })

  // 2. CJS 只有 '.'。platform:'node' 是必须的——只有 node 平台下 esbuild 才追加
  //    `0 && (module.exports = {...})` 注解，cjs-module-lexer 靠它才看得见具名导出。
  await esbuild.build({
    entryPoints: [{ out: 'core', in: join(HERE, 'src/core.ts') }],
    outdir: DIST,
    outExtension: { '.js': '.cjs' },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: ['node22'],
    minify: true,
    legalComments: 'none',
    sourcemap: false,
  })

  // 3. CSS 的第二形态。第一形态（JS 字符串）已随 src/element.ts 被内联进 dist/element.js。
  writeFileSync(join(DIST, 'readit.css'), LIGHT_DOM_CSS, 'utf8')

  // 4. 声明。用 typescript/lib/tsc.js 而不是 .bin/tsc：Windows 上 spawn .cmd 需要 shell。
  execFileSync(
    process.execPath,
    [req.resolve('typescript/lib/tsc.js'), '-p', join(HERE, 'tsconfig.build.json')],
    { stdio: 'inherit' },
  )
  rewriteWorkspaceSpecifiers(join(DIST, 'types'))

  // 5. 入口 .d.ts 指向 facade 自己那份声明，而不是各包的 index——JS 入口与类型入口
  //    因此永远源自同一个文件，不可能分叉。
  for (const { out } of ESM_ENTRIES) {
    writeFileSync(
      join(DIST, `${out}.d.ts`),
      `export * from '${upTo(out)}/types/packages/readit/src/${out}.js'\n`,
      'utf8',
    )
  }

  // 6. CJS 味的声明树。用嵌套 package.json 标记模块格式，而不是把整棵树改名成 .d.cts +
  //    重写每一个相对说明符的扩展名：改写点越多越容易漏一个。TypeScript、publint、
  //    @arethetypeswrong 三者都按「最近的 package.json」判定格式，这个标记对三者同时生效。
  cpSync(join(DIST, 'types'), join(DIST, 'cjs/types'), { recursive: true })
  writeFileSync(join(DIST, 'cjs/package.json'), '{\n  "type": "commonjs"\n}\n', 'utf8')
  writeFileSync(join(DIST, 'cjs/core.d.ts'), "export * from './types/packages/readit/src/core.js'\n", 'utf8')

  assertSelfContained()
}
```

`packages/readit/test/global-setup.ts`：

```ts
import type { TestProject } from 'vitest/node'
import { buildDist } from '../build.js'

/**
 * dist/ 是 gitignore 的，而这个 project 的每一条断言都读它。构建放在 globalSetup 里，
 * 而不是让测试自己 skip-if-missing：一条能被「忘了构建」静默跳过的门等于没有门。
 * 副作用是 npm test 会连带构建一次——这正是想要的，构建坏掉必须让主套件变红。
 */
export default async function setup(_project: TestProject): Promise<void> {
  await buildDist()
}
```

`packages/readit/vitest.config.ts` 补一行（Step 1 建的文件里，`setupFiles` 之后）：

```ts
    globalSetup: ['./test/global-setup.ts'],
```

根 `package.json` 的 `scripts` 加一行（现第 13 行 `gen:svg-stylesheet` 之前）：

```json
    "build": "vite-node packages/readit/build.ts",
```

`packages/math/package.json:17-26` 改成（D2-9；math→core 是纯类型导入，`import type { MathRenderer } from '@readit/core/types'` 一处而已）：

```json
  "dependencies": {
    "@mathjax/mathjax-tex-font": "4.1.3",
    "@mathjax/src": "4.1.3"
  },
  "devDependencies": {
    "@readit/core": "0.0.0",
    "@types/node": "24.10.1",
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  },
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit
npm install                       # 让 D2-9 的依赖搬家落进 package-lock.json
npm run build
npm test -- --project readit
npm test                          # 既有数字不得动：语料 56/68、CommonMark 649+3、GFM 658+14、TEMPORARY 0
npm run typecheck
```

- [ ] **Step 5: 提交**

```bash
cd /Users/mac08/Desktop/robot/readit
git add packages/readit packages/math/package.json package.json package-lock.json
git commit -m "build(readit): 发布外观包——dist、SPEC §9.3 exports、CSS 双形态、.d.ts，并还清 D2-9

三个包 + core + math 打成一个发布产物 readit，运行时零依赖：装包方只解析包内相对路径，
四个大件仍是四个互相独立的动态 import。CSS 双形态同源——shadow 那份内联成 JS 字符串走
adoptedStyleSheets，light DOM 那份落成 ./styles.css，不用 CSS module scripts。
CJS 的类型用嵌套 package.json 标 commonjs，而不是改写整棵树的扩展名。
D2-9 顺带还清：math→core 是纯类型导入，移进 devDependencies；不修它，一打包就咬。"
```

---

---

### Task 10: 三条会失败的分发门 —— publint/attw、tarball 装进隔离宿主、Node 里 `.` 不碰浏览器全局

**Files:**
- Create: `/Users/mac08/Desktop/robot/readit/packages/readit/test/pack.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/readit/test/fixtures/host-app/package.json`
- Create: `/Users/mac08/Desktop/robot/readit/packages/readit/test/fixtures/host-app/run.mjs`
- Create: `/Users/mac08/Desktop/robot/readit/packages/readit/test/fixtures/node-purity-probe.mjs`
- Modify: `/Users/mac08/Desktop/robot/readit/packages/readit/test/global-setup.ts:1-14`（加 tarball 的 `provide`）
- Modify: `/Users/mac08/Desktop/robot/readit/packages/readit/package.json:29-39`（加 publint / attw 两个 devDependencies）
- Test: `/Users/mac08/Desktop/robot/readit/packages/readit/test/dist-lint.test.ts`
- Test: `/Users/mac08/Desktop/robot/readit/packages/readit/test/tarball-host.test.ts`
- Test: `/Users/mac08/Desktop/robot/readit/packages/readit/test/node-purity.test.ts`

**Interfaces:**
- Consumes:
  - Task 9 的 `buildDist(): Promise<void>` 与 `packages/readit/dist/**` 布局
  - Task 9 的 `packages/readit/test/global-setup.ts` 默认导出 `setup(project: TestProject): Promise<void>`
  - `@readit/core` 的 `render(src: string, opts?: Partial<RenderOptions>): string`（宿主 fixture 与纯度探针都调它）
- Produces:
  - `packages/readit/test/pack.ts` → `export function packTarball(outDir: string): string`（返回 tarball 绝对路径）
  - vitest 的 provided context 键 `readitTarball: string`
  - 无新的运行时接口

---

- [ ] **Step 1: 写会失败的测试**

`packages/readit/test/pack.ts`：

```ts
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const IS_WIN = process.platform === 'win32'
const NPM = IS_WIN ? 'npm.cmd' : 'npm'

/**
 * npm pack packages/readit 到 outDir，返回 tarball 的绝对路径。
 * Windows 上 Node 22 拒绝在 shell:false 下 spawn .cmd，所以那边走 shell 并给路径加引号。
 */
export function packTarball(outDir: string): string {
  const dest = IS_WIN ? `"${outDir}"` : outDir
  const r = spawnSync(NPM, ['pack', '--pack-destination', dest, '--loglevel=error'], {
    cwd: PKG_DIR,
    encoding: 'utf8',
    shell: IS_WIN,
  })
  if (r.status !== 0) {
    throw new Error(`npm pack 失败 (${String(r.status)}):\n${r.stdout ?? ''}\n${r.stderr ?? ''}`)
  }
  const found = readdirSync(outDir).filter((f) => f.endsWith('.tgz'))
  if (found.length !== 1) {
    throw new Error(`期望 ${outDir} 里恰好一个 tarball，实得：${found.join(', ') || '（空）'}`)
  }
  return join(outDir, found[0]!)
}
```

`packages/readit/test/global-setup.ts` 全文替换：

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'
import { buildDist } from '../build.js'
import { packTarball } from './pack.js'

declare module 'vitest' {
  interface ProvidedContext {
    /** npm pack 出来的 tarball 绝对路径，三条分发门共用一份。 */
    readitTarball: string
  }
}

/**
 * dist/ 是 gitignore 的，而这个 project 的每一条断言都读它。构建放在 globalSetup 里，
 * 而不是让测试自己 skip-if-missing：一条能被「忘了构建」静默跳过的门等于没有门。
 * tarball 也在这里打一次——三条门共用，且落在 os.tmpdir() 里，不进仓库、不进下一次 pack。
 */
export default async function setup(project: TestProject): Promise<void> {
  await buildDist()
  const dir = mkdtempSync(join(tmpdir(), 'readit-pack-'))
  project.provide('readitTarball', packTarball(dir))
}
```

`packages/readit/test/dist-lint.test.ts`（第一条门）：

```ts
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publint } from 'publint'
import { formatMessage } from 'publint/utils'
import { describe, expect, inject, it } from 'vitest'

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const req = createRequire(import.meta.url)

function attw(args: readonly string[]): { status: number; output: string } {
  const cliPkgPath = req.resolve('@arethetypeswrong/cli/package.json')
  const bin = (JSON.parse(readFileSync(cliPkgPath, 'utf8')) as { bin: Record<string, string> }).bin.attw
  if (bin === undefined) throw new Error('@arethetypeswrong/cli 没有 attw 这个 bin')
  const r = spawnSync(process.execPath, [resolve(dirname(cliPkgPath), bin), ...args], {
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
  })
  return { status: r.status ?? 1, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` }
}

describe('publint', () => {
  it('打包后的 readit 没有任何 error 级问题（strict：warning 也算 error）', async () => {
    // pack:'npm' 让 publint 看到 files 字段过滤后的真实文件集，FILE_NOT_PUBLISHED 这类
    // 规则只有这样才可能触发。npm pack 不需要出网，unshare --net 里照样跑。
    const { messages, pkg } = await publint({ pkgDir: PKG_DIR, strict: true, pack: 'npm' })
    const errors = messages.filter((m) => m.type === 'error')
    expect(errors.map((m) => formatMessage(m, pkg) ?? m.code)).toEqual([])
  })
})

describe('@arethetypeswrong', () => {
  it("'.' 在 node16 的 ESM 与 CJS 两侧都解析到正确味道的类型", () => {
    // node10 被排除：它根本不支持子路径 exports，而这个包要求 Node 22+。
    const { status, output } = attw([inject('readitTarball'), '--profile', 'node16', '--entrypoints', '.', '--format', 'ascii', '--no-emoji', '--no-color'])
    expect(status, output).toBe(0)
  })

  it('四个浏览器子路径是 ESM-only，在 bundler 与 node16-esm 下类型正确', () => {
    // 它们没有 require 条件，这是有意的：把 element/editor 也双发一份，等于让宿主
    // 白白多下一整份浏览器代码。所以这一跑用 esm-only profile，并把「哪些入口是双模的」
    // 这件事写成两次调用，而不是一次调用加一条 ignore-rules。
    const { status, output } = attw([
      inject('readitTarball'),
      '--profile', 'esm-only',
      '--entrypoints', './element', './editor', './plugins/math', './plugins/highlight',
      '--format', 'ascii', '--no-emoji', '--no-color',
    ])
    expect(status, output).toBe(0)
  })
})

describe('这两条门确实在 CI 里跑', () => {
  it('本 project 被根 vitest.config.ts 的 projects 收进默认 npm test', () => {
    const rootConfig = readFileSync(join(PKG_DIR, '../../vitest.config.ts'), 'utf8')
    expect(rootConfig).toContain("projects: ['.', 'packages/*']")
  })
})
```

`packages/readit/test/fixtures/host-app/package.json`：

```json
{
  "name": "readit-host-fixture",
  "private": true,
  "version": "0.0.0",
  "type": "module"
}
```

`packages/readit/test/fixtures/host-app/run.mjs`：

```js
// 一个不知道 readit 是 monorepo 的宿主。它只知道自己 npm install 了一个包。
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { render, scan } from 'readit'

const SRC = 'hello **world**\n'

const esmHtml = render(SRC)
const scanned = scan(SRC, 'github')

const require = createRequire(import.meta.url)
const cjs = require('readit')
const cjsHtml = cjs.render(SRC)

const stylesUrl = import.meta.resolve('readit/styles.css')
const stylesBytes = readFileSync(fileURLToPath(stylesUrl), 'utf8').length

const subpaths = ['readit/element', 'readit/editor', 'readit/plugins/math', 'readit/plugins/highlight']
  .map((s) => {
    // 只解析不执行：这四条是浏览器专属的，在 Node 里执行没有意义，能解析到就证明映射对。
    try {
      return { subpath: s, resolved: import.meta.resolve(s).startsWith('file:') }
    } catch (err) {
      return { subpath: s, resolved: false, error: String(err) }
    }
  })

process.stdout.write(JSON.stringify({ esmHtml, cjsHtml, scanned, stylesBytes, subpaths }))
```

`packages/readit/test/tarball-host.test.ts`（第二条门）：

```ts
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, inject, it } from 'vitest'

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/host-app')
const IS_WIN = process.platform === 'win32'
const NPM = IS_WIN ? 'npm.cmd' : 'npm'

describe('npm pack 出的 tarball 能装进一个隔离宿主并跑起来（决策 2 的兑现）', () => {
  it('宿主真的 npm install 那个 tarball，然后 render 出正确的 HTML', () => {
    // 装到 os.tmpdir() 而不是仓库内：仓库内任何位置都可能被 npm 的 workspace 发现，
    // 那样测的就不是「隔离宿主」而是「同一个 monorepo 的另一个角落」，软链一路生效，
    // 这条门就变成自我肯定了。
    const host = mkdtempSync(join(tmpdir(), 'readit-host-'))
    cpSync(FIXTURE, host, { recursive: true })

    const install = spawnSync(
      NPM,
      [
        'install',
        IS_WIN ? `"${inject('readitTarball')}"` : inject('readitTarball'),
        // 发布产物运行时零依赖，所以 --offline 必须成立：这条门同时也在
        // offline.yml 的 unshare --net 命名空间里跑。
        '--offline', '--no-audit', '--no-fund', '--ignore-scripts',
        '--cache', IS_WIN ? `"${join(host, '.npm-cache')}"` : join(host, '.npm-cache'),
        '--loglevel=error',
      ],
      { cwd: host, encoding: 'utf8', shell: IS_WIN },
    )
    expect(install.status, `${install.stdout ?? ''}\n${install.stderr ?? ''}`).toBe(0)

    const run = spawnSync(process.execPath, ['run.mjs'], { cwd: host, encoding: 'utf8' })
    expect(run.status, `${run.stdout ?? ''}\n${run.stderr ?? ''}`).toBe(0)

    const out = JSON.parse(run.stdout) as {
      esmHtml: string
      cjsHtml: string
      scanned: { needsMath: boolean; needsHighlight: boolean; languages: string[] }
      stylesBytes: number
      subpaths: { subpath: string; resolved: boolean }[]
    }

    expect(out.esmHtml).toBe('<p dir="auto" data-line="0">hello <strong>world</strong></p>\n')
    expect(out.cjsHtml).toBe(out.esmHtml)
    expect(out.scanned).toEqual({ needsMath: false, needsMermaid: false, needsHighlight: false, languages: [] })
    expect(out.stylesBytes).toBeGreaterThan(0)
    expect(out.subpaths).toEqual([
      { subpath: 'readit/element', resolved: true },
      { subpath: 'readit/editor', resolved: true },
      { subpath: 'readit/plugins/math', resolved: true },
      { subpath: 'readit/plugins/highlight', resolved: true },
    ])
  })
})
```

`packages/readit/test/fixtures/node-purity-probe.mjs`：

```js
// 在一个干净的 Node realm 里跑：没有 vitest 的 transform，没有 setupFiles，
// 就是一个 SSR 宿主 import 'readit' 时会得到的东西。
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const touched = []
for (const name of ['document', 'window', 'navigator']) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      touched.push({ name, stack: new Error(`read ${name}`).stack ?? '' })
      return undefined
    },
    set() {
      touched.push({ name: `${name} (write)`, stack: new Error(`write ${name}`).stack ?? '' })
    },
  })
}

const [, , esmPath, cjsPath] = process.argv

const SRC = [
  '# Title',
  '',
  'hello **world** :shipit: and <span>raw html</span>',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '```js',
  'const x = 1',
  '```',
  '',
  'Inline $x^2$ math, degraded because math is null.',
  '',
  '<div align="center"><img src="a.png" height="150"></div>',
  '',
].join('\n')

const esm = await import(pathToFileURL(esmPath).href)
// 只调 render/scan，不调 prepare：prepare 会动态 import 数学包，那不是 '.' 的急加载图，
// 把它算进来测的就不是这条边界了。
const esmHtml = esm.render(SRC)
const scanned = esm.scan(SRC, 'github')

const require = createRequire(pathToFileURL(cjsPath).href)
const cjsHtml = require(cjsPath).render(SRC)

process.stdout.write(JSON.stringify({ touched, esmHtml, cjsHtml, scanned }))
```

`packages/readit/test/node-purity.test.ts`（第三条门）：

```ts
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../dist')
const PROBE = join(HERE, 'fixtures/node-purity-probe.mjs')

describe("Node 里 import '.' 不触及任何浏览器全局（SPEC §9.3 / 设计 §2.2）", () => {
  it('import + render + scan 全程没有读或写 document / window / navigator', () => {
    const r = spawnSync(process.execPath, [PROBE, join(DIST, 'core.js'), join(DIST, 'core.cjs')], {
      encoding: 'utf8',
    })
    expect(r.status, `${r.stdout ?? ''}\n${r.stderr ?? ''}`).toBe(0)

    const out = JSON.parse(r.stdout) as {
      touched: { name: string; stack: string }[]
      esmHtml: string
      cjsHtml: string
      scanned: { needsMath: boolean; needsHighlight: boolean }
    }

    // 若这条红了、而肇事者是某个被内联的第三方依赖的 `typeof window` 探测：
    // 按 §7.3 与 P6 的纪律**上报**，不要在这里加豁免名单。一个「无害的特征探测」
    // 与一个「真的会在 SSR 里炸的浏览器分支」在这一层长得一模一样，
    // 而分辨它们的成本远低于宿主在生产环境里发现它的成本。
    expect(out.touched.map((t) => `${t.name}\n${t.stack}`)).toEqual([])

    // 顺带证明探针不是在空转：'.' 真的渲染了东西，而且 ESM 与 CJS 两条路一致。
    expect(out.esmHtml).toContain('markdown-heading')
    expect(out.esmHtml).toContain('markdown-accessiblity-table')
    expect(out.cjsHtml).toBe(out.esmHtml)
    expect(out.scanned).toMatchObject({ needsMath: true, needsHighlight: true })
  })
})
```

`packages/readit/package.json` 的 `devDependencies` 加两项：

```json
    "@arethetypeswrong/cli": "0.18.5",
    "publint": "0.3.23",
```

- [ ] **Step 2: 跑它确认失败**

三条门装在一个已经构建正确的产物上，天然可能一次就绿；**一条从没红过的门不算门**。
所以这一步用三次定向破坏证明它们不空转——与 `offline.yml` 里那个「先证明命名空间真的没出网」
的步骤是同一件事。

```bash
cd /Users/mac08/Desktop/robot/readit
npm install --save-dev --save-exact -w packages/readit publint@0.3.23 @arethetypeswrong/cli@0.18.5
npm test -- --project readit
```

先看基线（应当三条全绿）。然后逐条破坏：

**门 1** —— 把 `packages/readit/package.json` 里 `"."` 的 `require` 从
`{ "types": "./dist/cjs/core.d.ts", "default": "./dist/core.cjs" }` 改回 SPEC 的裸字符串 `"./dist/core.cjs"`：

```bash
npm test -- --project readit -t '@arethetypeswrong'
```

预期红：`'.' 在 node16 的 ESM 与 CJS 两侧都解析到正确味道的类型` 失败，
attw 输出里出现 `node16 (from CJS)` 一行标 `Masquerading as ESM` 或 `Fallback types`。改回来。

**门 2** —— 把 `packages/readit/package.json` 的 `"files": ["dist"]` 改成 `"files": []`：

```bash
npm test -- --project readit -t 'npm pack'
```

预期红：`npm install` 退出码 0，但 `node run.mjs` 非 0，stderr 里是
`ERR_MODULE_NOT_FOUND` / `Cannot find module` 指向 `dist/core.js`。改回来。

**门 3** —— 在 `packages/readit/src/core.ts` 顶部临时加一行 `void navigator`：

```bash
npm test -- --project readit -t 'Node 里 import'
```

预期红：`expected [ 'navigator\nError: read navigator\n    at …core.js:1:…' ] to deeply equal []`。删掉那行。

- [ ] **Step 3: 写最小实现**

三条门本身就是实现；这一步是把它们从「本机能过」变成「无出网也能过」。
唯一需要的实际改动是宿主 fixture 的安装参数已经在 Step 1 里写死为 `--offline`，
现在验证它在真的没有出网的命名空间里成立。若 `npm install --offline` 在空 cache 下失败，
按下面这条最小改动补：把 `--offline` 换成 `--prefer-offline`，并在测试里加一行断言
证明安装过程没有触达 registry：

```ts
    // --offline 在某些 npm 版本上会因为要写 _cacache 索引而失败；--prefer-offline
    // 等价于「有 cache 用 cache，没有才出网」。这里不允许它出网，所以再钉一条：
    // 安装日志里不得出现 registry 主机名。零运行时依赖是这条断言成立的前提。
    expect(`${install.stdout ?? ''}${install.stderr ?? ''}`).not.toContain('registry.npmjs.org')
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit
npm test -- --project readit
npm test
npm run typecheck
# 无出网复跑（Linux；这是三条门里最有价值的一次运行——它同时证明了
# 「发布产物运行时零依赖」与「隔离宿主能离线装上它」）
sudo unshare --net -- sh -c 'ip link set lo up; exec npm test'
```

`npm test` 之后核对既有数字未变：语料 56/68（台账 12 条）、CommonMark 649 精确 + 3 PERMANENT、
GFM 658 精确 + 14 PERMANENT、TEMPORARY 0，计划一的 2318 条无一转红。**若有变化，上报，不要重钉。**

- [ ] **Step 5: 提交**

```bash
cd /Users/mac08/Desktop/robot/readit
git add packages/readit package-lock.json
git commit -m "test(dist): 三条分发门——publint/attw、tarball 装进隔离宿主、Node 里 '.' 不碰浏览器全局

不是三个手工步骤，是三条跑在 npm test 里的断言，且都在 offline.yml 的无出网命名空间里复跑。
第二条把宿主 fixture 复制到 os.tmpdir() 后真的 npm install 那个 tarball——留在仓库里
npm 会发现 workspace，软链一路生效，测的就不是隔离宿主了。
三条门各自用一次定向破坏证明过不空转（记录见提交说明下方的 Step 2）。"
```

---

## 新增契约提案

以下五条是共享契约 P1–P6 里没有、而 Task 9/10 必须依赖的东西。**未经确认前，其它组不要各自另起名字。**

**N1 · `@readit/element` 增开 `./styles` 子路径，导出两个 CSS 字符串（跨组，影响 element 组）**

```ts
// packages/element/src/styles.ts
/** shadow DOM 形态：:host([data-theme=…]) scope，交给 adoptedStyleSheets。 */
export const ELEMENT_CSS: string
/** light DOM 形态：同一份规则，scope 换成宿主可见的类选择器，落成 dist/readit.css。 */
export const LIGHT_DOM_CSS: string
```

`packages/element/package.json` 的 `exports` 需含 `"./styles": "./src/styles.ts"`。
两条约束：(1) 这个模块必须是 **Node 可 import 的纯字符串模块**，不得在模块层引用任何
浏览器全局——Task 9 的构建脚本在 Node 里 import 它；(2) 两个常量必须由**同一个生成器**
从 github-markdown-css 5.9.0 的单主题文件派生，否则「CSS 双形态」会退化成两份会漂移的 CSS。
之所以要两个常量而不是一个：`:host(...)` 在 light DOM 里根本不匹配，把同一份字节同时发给
两种消费者，其中一种拿到的是无效样式表。

**N2 · SPEC §9.3 修订：子路径必须带 `types` 条件**

SPEC 写的是 `"./element": "./dist/element.js"`。裸字符串在 node16 解析下没有 `types` 条件，
`@arethetypeswrong` 报 `untyped-resolution`，宿主 `import { mount } from 'readit/element'` 拿到 `any`。
改为 `{ "types": "./dist/element.d.ts", "import": "./dist/element.js" }`。
建议追加为设计文档 §9 修订表的第 5 条。

**N3 · SPEC §9.3 修订：`.` 的 `require` 条件需自带 CJS 味的类型**

顶层单个 `types` 指向 ESM 味的 `.d.ts`，node16-cjs 解析下 attw 报 `Masquerading as ESM`。
改为 `"require": { "types": "./dist/cjs/core.d.ts", "default": "./dist/core.cjs" }`，
CJS 声明树用 `dist/cjs/package.json` 的 `{"type":"commonjs"}` 标记格式。
建议追加为设计文档 §9 修订表的第 6 条。

**N4 · SPEC §9.3 修订：本计划的 exports 不列 `./plugins/mermaid`，也不产 `dist/readit.iife.js`**

前者：M5 前文件不存在，publint 的 `FILE_DOES_NOT_EXIST` 会直接判红——这与设计 §10「Mermaid 不做」一致。
后者：SPEC 对它的描述是「全量急加载」，那会把 MathJax 的 677 KB 与 CodeMirror 的 177 KB
一起塞进一个急加载文件，与设计 §2.1「四个大件是四个互相独立的动态 import」正面冲突。
`<script>` 用户由 `<script type="module">` 直接吃 ESM 产物服务。
两条都建议追加进设计文档 §9 修订表（第 7、8 条），M5 时把 mermaid 那一行加回去。

**N5 · `test/ci-wiring.test.ts:75` 的 tsconfig 名单是硬编码的三条，需要改成从工作区推导**

现有断言只覆盖 `tsconfig.json` / `packages/core/tsconfig.json` / `packages/math/tsconfig.json`。
计划二新增 `packages/{element,highlight,editor,readit}` 四个包的 tsconfig，
`strict` / `noUncheckedIndexedAccess` / `verbatimModuleSyntax` 三个开关**没有任何东西在检查它们**。
Task 9/10 有意不动这个文件（避免与建包的那个任务撞车）。
建议指派给创建第一个新工作区包的那个任务，改成读根 `package.json` 的 `workspaces` 后遍历。

---

### Task 11: Playwright 基建 + L3b-element

**Files:**
- Create: `playwright.config.ts`
- Create: `browser/tsconfig.json`
- Create: `browser/serve.mjs`
- Create: `browser/fixtures/build-fixtures.mjs`
- Create: `browser/fixtures/entry.ts`
- Create: `browser/fixtures/headers.json`
- Create: `browser/fixtures/pages/host.html`
- Create: `browser/fixtures/pages/trusted-types.html`
- Create: `browser/support/globals.d.ts`
- Create: `browser/support/harness.ts`
- Create: `browser/element/element.spec.ts`
- Create: `browser/element/navigation.spec.ts`
- Create: `browser/element/trusted-types.spec.ts`
- Create: `.github/workflows/browser.yml`
- Modify: `package.json:7-20`
- Modify: `test/ci-wiring.test.ts:59-63`
- Modify: `.gitignore:1-7`
- Test: `test/browser-wiring.test.ts`（vitest，守 P5 与版本钉）+ 上述三个 `.spec.ts`（Playwright）

**Interfaces:**
- Consumes:
  - `mount(host: HTMLElement, opts?: Partial<MountOptions>): MountHandle`（P4，`@readit/element`）
  - `defineReadit(tag?: string): void`（P4，`@readit/element`）
  - `MountHandle` 的 `setValue / getValue / setMode / setTheme / destroy`（P4）
- Produces:
  - `playwright.config.ts`：默认导出 `PlaywrightTestConfig`；`export const BASE_URL: string`（`'http://127.0.0.1:4173'`）
  - `browser/fixtures/entry.ts`：`export interface ReaditFixtureApi { mount(hostId: string, opts: Partial<MountOptions>): string; get(id: string): MountHandle; destroy(id: string): void; destroyAll(): void; navigations: string[]; defineReadit(tag?: string): void }`，挂在 `window.__readit`
  - `browser/support/globals.d.ts`：`Window.__readit: ReaditFixtureApi`、`Window.__leaks: LeakCounters`、`Window.__cspViolations: string[]`；`interface LeakCounters { listeners: number; resizeObservers: number; mutationObservers: number }`
  - `browser/support/harness.ts`：`export const test`（`base.extend<{ egressGuard: void }>`，`auto: true`）、`export { expect }`、`export const INSTRUMENT: string`、`export interface MountFixtureOptions { readonly value: string; readonly mode?: 'read' | 'source' | 'split' | 'plain'; readonly theme?: 'auto' | 'light' | 'dark'; readonly shadow?: boolean; readonly baseUrl?: string }`、`export function mountDoc(page: Page, hostId: string, opts: MountFixtureOptions): Promise<string>`、`export function readLeaks(page: Page): Promise<LeakCounters>`
  - `browser/serve.mjs` 的路由契约（Task 12 全靠加文件复用，不改这个文件）：`/health`、`/<page>.html` ← `browser/fixtures/pages/`、`/content/**` ← `browser/fixtures/content/`、`/css/**` ← `browser/fixtures/css/`、`/assets/**` ← `browser/.fixtures-dist/`、`/vendor/**` ← `node_modules/`（只放行 `.css` / `.woff2`）
  - npm 脚本：`browser:build`、`browser:serve`、`test:browser`

**为什么基建与第一批用例在同一个任务里：** 一个只有配置没有用例的 Playwright 基建，评审员没有任何东西可以判断它是否可用；一个没有基建的用例集跑不起来。这两半分开评审只会各自空转。而 L3b-element 与 L3b-editor 之间才是真正值得分开的那道缝（设计 §7.1），那道缝在文件与 CI job 名上都保留了。

**为什么浏览器矩阵只有 Chromium 与 WebKit 承重：** 产品目标是 Windows 壳走 WebView2（Chromium）、macOS 壳走 WKWebView（WebKit），M6 要用（设计 §7.2）。Firefox 是尽力而为，所以它是**独立的一个 job** 并显式标 `continue-on-error: true` —— 不是把它塞进承重矩阵再假装绿。`test.yml` 里那条「任何地方都不许有 `continue-on-error`」的既有断言管的是 `test.yml`；这里是新文件，且这一次 advisory 是**有意的产品决策**，所以本任务的守卫测试反过来钉死：`browser.yml` 里 `continue-on-error` 只许出现一次、且只许出现在 firefox 那个 job 里。

---

- [ ] **Step 1: 写会失败的测试**

`test/browser-wiring.test.ts`：

```ts
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 这个文件守的是「结构」，不是行为：Playwright 装没装对、版本钉没钉住、两个 runner 会不会
 * 互相捡文件、承重浏览器有没有被偷偷降级成 advisory。它必须能在离线 vitest 里跑完 ——
 * 浏览器套件本身在 CI 的容器里跑，那层红灯来得晚，而这层红灯在本地 <1s 就来。
 */
const root = new URL('../', import.meta.url)
const read = (rel: string): string => (existsSync(new URL(rel, root)) ? readFileSync(new URL(rel, root), 'utf8') : '')

/** 递归列出某目录下的文件相对路径；目录不存在时返回空数组（让断言而不是异常来报错）。 */
function listFiles(rel: string): string[] {
  const dir = new URL(rel, root)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((p) => p.replaceAll('\\', '/'))
}

const pkg = JSON.parse(read('package.json') || '{}') as {
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}
const PINNED_PLAYWRIGHT = '1.62.1'

describe('Playwright 的版本与镜像钉在一起', () => {
  it('@playwright/test 是精确版本，不是范围', () => {
    expect(pkg.devDependencies?.['@playwright/test']).toBe(PINNED_PLAYWRIGHT)
  })

  it('browser.yml 引用的容器镜像与那个版本同源', () => {
    // 视觉基线的可复现性完全建立在「镜像 tag 与 Playwright 版本一致」上。分开写两处，
    // 就一定会有一次只改了一处 —— 所以这里让它们必须一起改。
    const wf = read('.github/workflows/browser.yml')
    const tags = [...wf.matchAll(/mcr\.microsoft\.com\/playwright:v([\d.]+)-noble/g)].map((m) => m[1])
    expect(tags.length).toBeGreaterThan(0)
    expect([...new Set(tags)]).toEqual([PINNED_PLAYWRIGHT])
  })
})

describe('两个 runner 不得互相捡文件（P5）', () => {
  it('vitest 只收 .test.ts，且根 include 没被放宽', () => {
    expect(read('vitest.config.ts')).toContain("include: ['test/**/*.test.ts']")
  })

  it('Playwright 只收 browser/ 下的 .spec.ts', () => {
    const cfg = read('playwright.config.ts')
    expect(cfg).toContain("testDir: './browser'")
    expect(cfg).toContain("testMatch: '**/*.spec.ts'")
  })

  it('test/ 与 packages/*/test/ 下没有任何 .spec.ts', () => {
    const strays = [
      ...listFiles('test/').map((p) => `test/${p}`),
      ...listFiles('packages/').map((p) => `packages/${p}`),
    ].filter((p) => p.endsWith('.spec.ts'))
    expect(strays).toEqual([])
  })

  it('browser/ 下没有任何 .test.ts', () => {
    expect(listFiles('browser/').filter((p) => p.endsWith('.test.ts'))).toEqual([])
  })
})

describe('浏览器套件的确定性旋钮钉在配置里', () => {
  const cfg = read('playwright.config.ts')

  it.each([
    ['deviceScaleFactor: 1', '像素比一旦浮动，L4 的基线就不可复现'],
    ['maxDiffPixelRatio: 0.002', 'SPEC §13 的阈值'],
    ["animations: 'disabled'", 'SPEC §13'],
    ["updateSnapshots: 'none'", '缺基线要红，不许静默写一张出来'],
    ['reuseExistingServer: false', '复用旧 server 会拿到上一次构建的 bundle'],
  ])('包含 %s', (needle) => {
    expect(cfg).toContain(needle)
  })

  it('不 spread devices[…]，否则设备描述符会把 deviceScaleFactor 顶掉', () => {
    expect(cfg).not.toContain('devices[')
  })
})

describe('CI 里承重的是 Chromium 与 WebKit', () => {
  const wf = read('.github/workflows/browser.yml')

  it('承重 job 的矩阵正好是 chromium 与 webkit', () => {
    expect(wf).toContain('browser: [chromium, webkit]')
  })

  it('continue-on-error 只出现一次，且只在 firefox 那个 job 里', () => {
    expect(wf.match(/continue-on-error/g) ?? []).toHaveLength(1)
    const firefoxJob = wf.slice(wf.indexOf('\n  l3b-element-firefox:'))
    expect(firefoxJob).toContain('continue-on-error: true')
  })
})

describe('每个 spec 都经过共享 harness', () => {
  /**
   * 离线守卫、泄漏仪表与 CSP 采集都挂在 harness 的 auto fixture 上。一个直接
   * `import { test } from '@playwright/test'` 的 spec 会绕过全部三样，而且绕得毫无痕迹。
   */
  it('没有任何 spec 直接从 @playwright/test 取 test', () => {
    const offenders = listFiles('browser/')
      .filter((p) => p.endsWith('.spec.ts'))
      .filter((p) => read(`browser/${p}`).includes("from '@playwright/test'"))
    expect(offenders).toEqual([])
  })

  it('至少有一个 spec 存在（否则上一条是空断言）', () => {
    expect(listFiles('browser/').filter((p) => p.endsWith('.spec.ts')).length).toBeGreaterThan(0)
  })
})
```

`browser/element/element.spec.ts`：

```ts
import { expect, mountDoc, readLeaks, test } from '../support/harness.js'

const DOC = '# Title\n\nHello **world**.\n'

test('挂进 open shadow root，light DOM 一个字都不写', async ({ page }) => {
  await page.goto('/host.html')
  await mountDoc(page, 'a', { value: DOC, mode: 'read' })

  const seen = await page.evaluate(() => {
    const host = document.getElementById('a')
    if (host === null) throw new Error('no #a')
    const root = host.shadowRoot
    return {
      mode: root === null ? null : root.mode,
      heading: root?.querySelector('h1')?.textContent ?? null,
      lightChildren: host.childElementCount,
      bodyStyle: document.body.getAttribute('style'),
      htmlStyle: document.documentElement.getAttribute('style'),
      htmlTheme: document.documentElement.getAttribute('data-theme'),
    }
  })

  expect(seen.mode).toBe('open')
  expect(seen.heading).toBe('Title')
  expect(seen.lightChildren).toBe(0)
  // 设计 §3.3：永不写 document.documentElement 或 document.body。
  expect(seen.bodyStyle).toBeNull()
  expect(seen.htmlStyle).toBeNull()
  expect(seen.htmlTheme).toBeNull()
})

test('setTheme 换的是自己的调色板，不是文档的', async ({ page }) => {
  await page.goto('/host.html')
  const id = await mountDoc(page, 'a', { value: DOC, mode: 'read', theme: 'light' })

  const readTheme = async (): Promise<{ attr: string | null; bg: string; doc: string | null }> =>
    await page.evaluate(() => {
      const host = document.getElementById('a')
      if (host === null) throw new Error('no #a')
      const root = host.shadowRoot
      if (root === null) throw new Error('no shadow root')
      const content = root.querySelector('h1')
      if (content === null) throw new Error('no rendered content')
      return {
        attr: host.getAttribute('data-theme'),
        bg: getComputedStyle(content).color,
        doc: document.documentElement.getAttribute('data-theme'),
      }
    })

  const light = await readTheme()
  await page.evaluate((h) => { window.__readit.get(h).setTheme('dark') }, id)
  const dark = await readTheme()

  expect(light.attr).toBe('light')
  expect(dark.attr).toBe('dark')
  expect(dark.bg).not.toBe(light.bg)
  expect(light.doc).toBeNull()
  expect(dark.doc).toBeNull()
})

test('同页两个实例互不干扰（style-mod 的 bug 只在这现形）', async ({ page }) => {
  await page.goto('/host.html')
  const a = await mountDoc(page, 'a', { value: '# A\n\nalpha text\n', mode: 'read', theme: 'light' })
  await mountDoc(page, 'b', { value: '# B\n\nbeta text\n', mode: 'read', theme: 'dark' })

  const probe = async (): Promise<Record<string, string | null>> =>
    await page.evaluate(() => {
      const pick = (hostId: string): { title: string | null; line: string | null; color: string | null } => {
        const host = document.getElementById(hostId)
        const root = host?.shadowRoot ?? null
        const h1 = root?.querySelector('h1') ?? null
        if (h1 === null) return { title: null, line: null, color: null }
        const cs = getComputedStyle(h1)
        return { title: h1.textContent, line: cs.lineHeight, color: cs.color }
      }
      // 反空对照：一个从未被 readit 碰过的裸 div，它的行高是 UA 默认。
      const bare = document.createElement('h1')
      document.body.append(bare)
      const bareLine = getComputedStyle(bare).lineHeight
      bare.remove()
      const A = pick('a')
      const B = pick('b')
      return { aTitle: A.title, bTitle: B.title, aLine: A.line, bLine: B.line, aColor: A.color, bColor: B.color, bareLine }
    })

  const both = await probe()
  expect(both.aTitle).toBe('A')
  expect(both.bTitle).toBe('B')
  // style-mod 的失败形态是「第二个 root 拿不到样式表」。所以必须显式断言 B 被样式化了，
  // 而不是只断言 A 和 B 不同 —— 两个都没样式时它们也「不同」得很。
  expect(both.aLine).not.toBe(both.bareLine)
  expect(both.bLine).not.toBe(both.bareLine)
  expect(both.bLine).toBe(both.aLine)
  expect(both.bColor).not.toBe(both.aColor)

  // 拆掉 A 之后 B 必须完好 —— 共享样式表被第一个 destroy() 收走是同一类 bug 的另一面。
  await page.evaluate((h) => { window.__readit.destroy(h) }, a)
  const after = await probe()
  expect(after.bTitle).toBe('B')
  expect(after.bLine).toBe(both.bLine)
  expect(after.bColor).toBe(both.bColor)
})

test('50 次挂载/销毁之后，监听器与 observer 全部归零', async ({ page }) => {
  await page.goto('/host.html')

  // 反空断言：仪表必须真的看见过东西，否则下面的 delta === 0 什么也没证明。
  const before = await readLeaks(page)
  const id = await mountDoc(page, 'a', { value: DOC, mode: 'read', theme: 'auto' })
  const during = await readLeaks(page)
  const sum = (c: { listeners: number; resizeObservers: number; mutationObservers: number }): number =>
    c.listeners + c.resizeObservers + c.mutationObservers
  expect(
    sum(during),
    '一次挂载没有产生任何被仪表看见的监听器或 observer；仪表本身可能已经失效',
  ).toBeGreaterThan(sum(before))
  await page.evaluate((h) => { window.__readit.destroy(h) }, id)

  const baseline = await readLeaks(page)
  await page.evaluate((v) => {
    for (let i = 0; i < 50; i += 1) {
      const h = window.__readit.mount('a', { value: v, mode: 'read', theme: 'auto' })
      window.__readit.destroy(h)
    }
  }, DOC)
  expect(await readLeaks(page)).toEqual(baseline)
})
```

`browser/element/navigation.spec.ts`：

```ts
import { expect, mountDoc, test } from '../support/harness.js'

const FILLER = Array.from({ length: 80 }, (_, i) => `Filler paragraph number ${i}.`).join('\n\n')
const DOC = `[jump](#hello-world)\n\n${FILLER}\n\n# Hello World\n\nlanded\n`

test('相对 .md 链接被拦下并通过 onNavigate 上报', async ({ page }) => {
  await page.goto('/host.html')
  await mountDoc(page, 'a', { value: '[next](./other.md)\n', mode: 'read', baseUrl: '/docs/index.md' })

  const before = page.url()
  await page.evaluate(() => {
    const link = document.getElementById('a')?.shadowRoot?.querySelector('a')
    if (!(link instanceof HTMLAnchorElement)) throw new Error('no anchor rendered')
    link.click()
  })
  expect(await page.evaluate(() => window.__readit.navigations)).toEqual(['./other.md'])
  expect(page.url()).toBe(before)
})

test('#slug 由元素自己搭桥，不动 document 的 fragment', async ({ page }) => {
  await page.goto('/host.html')
  await mountDoc(page, 'a', { value: DOC, mode: 'read' })

  const topOf = async (): Promise<number> =>
    await page.evaluate(() => {
      const target = document.getElementById('a')?.shadowRoot?.querySelector('#user-content-hello-world')
      if (target === null || target === undefined) throw new Error('GitHub 形状的锚点 #user-content-hello-world 不存在')
      return target.getBoundingClientRect().top
    })

  const start = await topOf()
  await page.evaluate(() => {
    const link = document.getElementById('a')?.shadowRoot?.querySelector('a[href="#hello-world"]')
    if (!(link instanceof HTMLAnchorElement)) throw new Error('no #hello-world anchor')
    link.click()
  })
  await page.waitForFunction(
    (from: number) => {
      const t = document.getElementById('a')?.shadowRoot?.querySelector('#user-content-hello-world')
      return t !== null && t !== undefined && t.getBoundingClientRect().top < from - 50
    },
    start,
  )
  // fragment 本来就不跨 shadow 边界；如果 location.hash 变了，说明桥没搭，是浏览器在兜底。
  expect(await page.evaluate(() => window.location.hash)).toBe('')
  expect(await page.evaluate(() => window.__readit.navigations)).toEqual([])
})

test('外部 http(s) 链接不被拦截，且带 GitHub 的 rel/target', async ({ page }) => {
  await page.goto('/host.html')
  await mountDoc(page, 'a', { value: '[ext](https://example.com/)\n', mode: 'read' })

  const attrs = await page.evaluate(() => {
    const link = document.getElementById('a')?.shadowRoot?.querySelector('a')
    if (!(link instanceof HTMLAnchorElement)) throw new Error('no anchor rendered')
    return { href: link.getAttribute('href'), rel: link.getAttribute('rel'), target: link.getAttribute('target') }
  })
  expect(attrs.href).toBe('https://example.com/')
  expect(attrs.rel).toBe('nofollow')
  expect(attrs.target).toBeNull()
  expect(await page.evaluate(() => window.__readit.navigations)).toEqual([])
})
```

`browser/element/trusted-types.spec.ts`：

```ts
import { expect, mountDoc, test } from '../support/harness.js'

const DOC = '# Enterprise\n\nA <em>raw</em> HTML fragment and a paragraph.\n'

/** /trusted-types.html 由 fixture server 带上 `require-trusted-types-for 'script'` 响应头。 */
test('企业 CSP 下渲染成功（Element.setHTML 在场，走第 1 级）', async ({ page }) => {
  await page.goto('/trusted-types.html')
  await mountDoc(page, 'a', { value: DOC, mode: 'read' })

  expect(await page.evaluate(() => document.getElementById('a')?.shadowRoot?.querySelector('h1')?.textContent)).toBe('Enterprise')
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([])
})

test('企业 CSP 下渲染成功（Element.setHTML 缺席，逼出第 2 级 Trusted Types 策略）', async ({ page, browserName }) => {
  // 删掉第 1 级，否则在带 setHTML 的 Chromium 上第 2 级永远不会被执行到 —— 那等于这一级没写。
  await page.addInitScript(() => {
    Reflect.deleteProperty(Element.prototype, 'setHTML')
  })
  await page.goto('/trusted-types.html')
  expect(await page.evaluate(() => 'setHTML' in Element.prototype)).toBe(false)

  await mountDoc(page, 'a', { value: DOC, mode: 'read' })

  expect(await page.evaluate(() => document.getElementById('a')?.shadowRoot?.querySelector('h1')?.textContent)).toBe('Enterprise')
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([])

  if (browserName === 'chromium') {
    // 只有 Chromium 真的实现了 Trusted Types。它在场时，走 innerHTML 会硬抛，
    // 上面两条断言就会以「内容缺失 + 有 violation」的形式一起红。
    expect(await page.evaluate(() => typeof window.trustedTypes)).toBe('object')
  }
})
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd /Users/mac08/Desktop/robot/readit
npm test -- test/browser-wiring.test.ts
```

预期（`playwright.config.ts` / `.github/workflows/browser.yml` 都不存在，`read()` 返回空串，落成断言失败而不是异常）：

```
 FAIL  test/browser-wiring.test.ts > Playwright 的版本与镜像钉在一起 > @playwright/test 是精确版本，不是范围
AssertionError: expected undefined to be '1.62.1'
 FAIL  test/browser-wiring.test.ts > 两个 runner 不得互相捡文件（P5） > Playwright 只收 browser/ 下的 .spec.ts
AssertionError: expected '' to contain "testDir: './browser'"
 FAIL  test/browser-wiring.test.ts > 每个 spec 都经过共享 harness > 至少有一个 spec 存在（否则上一条是空断言）
AssertionError: expected +0 to be greater than 0
```

```bash
npx playwright test browser/element
```

预期：`npm error could not determine executable to run`（`@playwright/test` 尚未安装）。

- [ ] **Step 3: 写最小实现**

装依赖并改根 `package.json`（`Modify: package.json:7-20`，把 `scripts` 与 `devDependencies` 两块替换成下面这样）：

```bash
npm i -D @playwright/test@1.62.1 esbuild@0.25.12
```

> `esbuild` 目前只是 vitest 的传递依赖，`browser/fixtures/build-fixtures.mjs` 直接 import 它，所以必须提成一级 devDependency。若构建任务已经把同一行加进去了，保留那一行、不要写第二行。

```json
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit && tsc -p browser --noEmit && npm run typecheck --workspaces --if-present",
    "corpus:diff": "tsx packages/core/scripts/corpus-diff.ts",
    "oracle:refresh": "tsx packages/core/scripts/oracle-refresh.ts",
    "oracle:manifest": "tsx packages/core/scripts/build-oracle-manifest.ts",
    "gen:svg-stylesheet": "vite-node tools/gen-svg-stylesheet.ts",
    "refresh:math-golden": "vite-node tools/refresh-math-golden.ts",
    "browser:build": "node browser/fixtures/build-fixtures.mjs",
    "browser:serve": "npm run browser:build && node browser/serve.mjs",
    "test:browser": "playwright test browser/element"
  },
  "devDependencies": {
    "@playwright/test": "1.62.1",
    "esbuild": "0.25.12",
    "typescript": "5.9.3",
    "vite-node": "6.0.0",
    "vitest": "4.1.10"
  }
```

`Modify: test/ci-wiring.test.ts:59-63` —— `typecheck` 脚本变了，那条精确字符串断言必须跟着改。改的时候顺手把 `browser/` 这个第四座孤岛也钉住，而不是只把断言放宽：

```ts
  it('the root script checks the root tsconfig, browser/ AND both workspaces', () => {
    // Workspace delegation alone left test/, tools/ and vitest.config.ts checked by nothing —
    // the offline gate itself did not even compile until the root tsconfig was added.
    // browser/ is a fourth island: not a workspace, and it needs the DOM lib, so it carries its
    // own tsconfig and its own invocation. Without this line nothing would check it either.
    expect(pkg.scripts.typecheck).toBe(
      'tsc --noEmit && tsc -p browser --noEmit && npm run typecheck --workspaces --if-present',
    )
  })

  it('keeps the DOM lib inside browser/tsconfig.json and out of the root one', () => {
    // Phase A purity is a type-level claim too: if the root `lib` gained "DOM", a stray
    // `document.` in test/ or tools/ would compile clean.
    const rootCfg = JSON.parse(read('tsconfig.json')) as { compilerOptions: { lib: string[] } }
    const browserCfg = JSON.parse(read('browser/tsconfig.json')) as { compilerOptions: { lib: string[] } }
    expect(rootCfg.compilerOptions.lib).toEqual(['ES2023'])
    expect(browserCfg.compilerOptions.lib).toContain('DOM')
  })
```

`Modify: .gitignore:1-7` —— 在 `test-results/` 之后插入一行：

```
node_modules/
dist/
.DS_Store
test/fixtures/*.actual.html
playwright-report/
test-results/
browser/.fixtures-dist/
.superpowers/
```

`browser/tsconfig.json`：

```json
{
  "//": [
    "browser/ 是仓库里唯一需要 DOM lib 的 TypeScript：fixture 入口跑在页面里，spec 的",
    "page.evaluate 回调也按浏览器全局类型检查。它不是 workspace，所以根 tsconfig 够不着，",
    "而把 DOM 加进根 tsconfig 会让 test/ 与 tools/ 里的 document. 也编译通过 —— 那正是",
    "Phase A 同构纯度在类型层的漏洞。playwright.config.ts 挂在这里，是因为 @playwright/test",
    "的类型引用 DOM 全局。"
  ],
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["**/*.ts", "../playwright.config.ts"]
}
```

`playwright.config.ts`：

```ts
import { defineConfig } from '@playwright/test'

const PORT = 4173
export const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './browser',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  workers: process.env.CI !== undefined ? 2 : undefined,
  reporter: process.env.CI !== undefined ? [['github'], ['html', { open: 'never' }]] : [['list']],
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',

  // 缺基线要红。默认值是 'missing'，也就是「悄悄写一张出来然后绿」—— 对一个规定
  // 「基线只在固定容器里生成」的项目，那个默认值是直接绕开规定的那条路。
  updateSnapshots: 'none',

  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.002,
    },
  },

  use: {
    baseURL: BASE_URL,
    // 不 spread devices[…]：设备描述符自带 viewport 与 deviceScaleFactor，会把这里的钉子顶掉。
    deviceScaleFactor: 1,
    viewport: { width: 1024, height: 768 },
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    forcedColors: 'none',
    trace: process.env.CI !== undefined ? 'retain-on-failure' : 'off',
  },

  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],

  webServer: {
    command: 'npm run browser:serve',
    url: `${BASE_URL}/health`,
    // 复用旧 server 会拿到上一次构建的 bundle，改了源码却看到旧行为 —— 每次重建。
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 60_000,
  },
})
```

`browser/serve.mjs`（纯 Node，零依赖；写成 `.mjs` 是因为根上没有 TS 运行器，而 fixture server 必须在 `npx playwright test` 的 webServer 里直接启动）：

```js
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = resolve(here, '..')
const PORT = Number(process.env.READIT_FIXTURE_PORT ?? '4173')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

// 前缀 → 根目录。顺序敏感：'/' 必须最后。
const MOUNTS = [
  ['/assets/', resolve(here, '.fixtures-dist')],
  ['/content/', resolve(here, 'fixtures/content')],
  ['/css/', resolve(here, 'fixtures/css')],
  ['/vendor/', resolve(repo, 'node_modules')],
  ['/', resolve(here, 'fixtures/pages')],
]

// /vendor/ 直通 node_modules，所以只放行样式与字体两种扩展名 —— 视觉层需要自托管
// woff2 与真实的 Preflight/Reboot，但没有理由让整个 node_modules 都能被页面拉起来。
const VENDOR_EXT = new Set(['.css', '.woff2'])

const extraHeaders = JSON.parse(readFileSync(resolve(here, 'fixtures/headers.json'), 'utf8'))

function locate(pathname) {
  for (const [prefix, root] of MOUNTS) {
    if (!pathname.startsWith(prefix)) continue
    const rel = pathname.slice(prefix.length)
    if (rel === '') continue
    const file = resolve(root, rel)
    if (file !== root && !file.startsWith(root + sep)) return null
    if (prefix === '/vendor/' && !VENDOR_EXT.has(extname(file))) return null
    if (!existsSync(file) || !statSync(file).isFile()) continue
    return file
  }
  return null
}

const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)

  if (pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end('ok')
    return
  }

  const file = locate(pathname)
  if (file === null) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`404 ${pathname}`)
    return
  }

  const headers = {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    ...(extraHeaders[pathname] ?? {}),
  }
  res.writeHead(200, headers)
  res.end(readFileSync(file))
})

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`fixture server on http://127.0.0.1:${PORT}\n`)
})
```

`browser/fixtures/headers.json`：

```json
{
  "/trusted-types.html": {
    "Content-Security-Policy": "require-trusted-types-for 'script'"
  }
}
```

`browser/fixtures/build-fixtures.mjs`：

```js
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const outdir = fileURLToPath(new URL('../.fixtures-dist/', import.meta.url))
await rm(outdir, { recursive: true, force: true })

await build({
  entryPoints: [fileURLToPath(new URL('./entry.ts', import.meta.url))],
  outdir,
  bundle: true,
  format: 'esm',
  // 动态 import 边界要在浏览器里还是动态的：splitting 让 @readit/editor 落成独立 chunk，
  // 而不是被并进主 bundle 里 —— 那会让「read 模式不加载 CodeMirror」在这一层不可证伪。
  splitting: true,
  target: 'es2023',
  platform: 'browser',
  sourcemap: 'inline',
  entryNames: '[name]',
  loader: { '.css': 'text' },
  logLevel: 'info',
})
```

`browser/fixtures/entry.ts`：

```ts
import { defineReadit, mount } from '@readit/element'

type MountOpts = NonNullable<Parameters<typeof mount>[1]>
type Handle = ReturnType<typeof mount>

export interface ReaditFixtureApi {
  mount(hostId: string, opts: MountOpts): string
  get(id: string): Handle
  destroy(id: string): void
  destroyAll(): void
  readonly navigations: string[]
  defineReadit(tag?: string): void
}

const handles = new Map<string, Handle>()
const navigations: string[] = []
let seq = 0

const api: ReaditFixtureApi = {
  mount(hostId, opts) {
    const host = document.getElementById(hostId)
    if (host === null) throw new Error(`fixture: no host #${hostId}`)
    const id = `h${(seq += 1)}`
    handles.set(id, mount(host, { onNavigate: (path: string) => { navigations.push(path) }, ...opts }))
    return id
  },
  get(id) {
    const handle = handles.get(id)
    if (handle === undefined) throw new Error(`fixture: no handle ${id}`)
    return handle
  },
  destroy(id) {
    api.get(id).destroy()
    handles.delete(id)
  },
  destroyAll() {
    for (const handle of handles.values()) handle.destroy()
    handles.clear()
  },
  navigations,
  defineReadit,
}

Object.defineProperty(window, '__readit', { value: api })
```

`browser/support/globals.d.ts`：

```ts
import type { ReaditFixtureApi } from '../fixtures/entry.js'

declare global {
  interface LeakCounters {
    listeners: number
    resizeObservers: number
    mutationObservers: number
  }

  interface Window {
    readonly __readit: ReaditFixtureApi
    readonly __leaks: LeakCounters
    readonly __cspViolations: string[]
  }
}

export {}
```

`browser/support/harness.ts`：

```ts
import { expect, test as base, type Page } from '@playwright/test'

export { expect }

export interface MountFixtureOptions {
  readonly value: string
  readonly mode?: 'read' | 'source' | 'split' | 'plain'
  readonly theme?: 'auto' | 'light' | 'dark'
  readonly shadow?: boolean
  readonly baseUrl?: string
}

/**
 * 页面里的仪表。三件事，都必须在任何页面脚本之前装好：
 *  1. 长命目标（window / document / MediaQueryList）上的事件监听器计数 —— 只数这三种，
 *     因为 shadow 树内部节点上的监听器随树一起死，数它们只会制造噪声。
 *  2. ResizeObserver / MutationObserver 的存活实例计数。
 *  3. CSP violation 采集（Trusted Types 那一级唯一的可观测证据）。
 */
export const INSTRUMENT = `(() => {
  const leaks = { listeners: 0, resizeObservers: 0, mutationObservers: 0 };
  const violations = [];
  Object.defineProperty(window, '__leaks', { value: leaks });
  Object.defineProperty(window, '__cspViolations', { value: violations });

  const addEL = EventTarget.prototype.addEventListener;
  const removeEL = EventTarget.prototype.removeEventListener;
  const registry = new WeakMap();
  const longLived = (t) => t === window || t === document ||
    (typeof MediaQueryList !== 'undefined' && t instanceof MediaQueryList);
  const keyOf = (type, opts) => type + '\\u0000' +
    ((typeof opts === 'object' && opts !== null ? !!opts.capture : !!opts) ? '1' : '0');

  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (fn && longLived(this)) {
      let byKey = registry.get(this);
      if (!byKey) { byKey = new Map(); registry.set(this, byKey); }
      const k = keyOf(type, opts);
      let set = byKey.get(k);
      if (!set) { set = new Set(); byKey.set(k, set); }
      if (!set.has(fn)) { set.add(fn); leaks.listeners += 1; }
    }
    return addEL.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    if (fn && longLived(this)) {
      const byKey = registry.get(this);
      const set = byKey ? byKey.get(keyOf(type, opts)) : undefined;
      if (set && set.delete(fn)) { leaks.listeners -= 1; }
    }
    return removeEL.call(this, type, fn, opts);
  };

  if (typeof MediaQueryList !== 'undefined' && MediaQueryList.prototype.addListener) {
    const addL = MediaQueryList.prototype.addListener;
    const remL = MediaQueryList.prototype.removeListener;
    MediaQueryList.prototype.addListener = function (fn) { leaks.listeners += 1; return addL.call(this, fn); };
    MediaQueryList.prototype.removeListener = function (fn) { leaks.listeners -= 1; return remL.call(this, fn); };
  }

  const wrap = (Ctor, key) => {
    if (typeof Ctor !== 'function') return Ctor;
    const open = new WeakSet();
    const Wrapped = function (...args) {
      const inst = new Ctor(...args);
      open.add(inst);
      leaks[key] += 1;
      const disconnect = inst.disconnect.bind(inst);
      inst.disconnect = () => { if (open.delete(inst)) { leaks[key] -= 1; } return disconnect(); };
      return inst;
    };
    Wrapped.prototype = Ctor.prototype;
    return Wrapped;
  };
  window.ResizeObserver = wrap(window.ResizeObserver, 'resizeObservers');
  window.MutationObserver = wrap(window.MutationObserver, 'mutationObservers');

  addEL.call(document, 'securitypolicyviolation', (e) => {
    violations.push(e.violatedDirective + ' :: ' + (e.sourceFile || '?') + ':' + e.lineNumber);
  });
})();`

interface Fixtures {
  readonly egressGuard: void
}

/**
 * 所有 spec 必须从这里取 test，不许直接 import '@playwright/test'（有 vitest 守卫钉住）。
 * 原因是这个 auto fixture 顺带装上了离线守卫：starry-night 默认去 esm.sh 拉 onig.wasm
 * 这类事，只有在真浏览器里、在一台联网的开发机上才会静默通过。这里让它变成红灯。
 */
export const test = base.extend<Fixtures>({
  egressGuard: [
    async ({ page }, use) => {
      const offenders: string[] = []
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
          await route.continue()
          return
        }
        offenders.push(url.href)
        await route.abort('blockedbyclient')
      })
      await page.addInitScript(INSTRUMENT)
      await use()
      expect(offenders, '浏览器里出现了非本机请求；离线约束被打破').toEqual([])
    },
    { auto: true },
  ],
})

export async function mountDoc(page: Page, hostId: string, opts: MountFixtureOptions): Promise<string> {
  return await page.evaluate(
    ([id, o]) => window.__readit.mount(id, { ...o }),
    [hostId, opts] as const,
  )
}

export async function readLeaks(page: Page): Promise<LeakCounters> {
  return await page.evaluate(() => ({ ...window.__leaks }))
}
```

`browser/fixtures/pages/host.html`：

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>readit L3b host</title>
    <style>
      html, body { margin: 0; padding: 0; background: #ffffff; }
    </style>
  </head>
  <body>
    <div id="a" style="display: block; width: 760px"></div>
    <div id="b" style="display: block; width: 760px"></div>
    <script type="module" src="/assets/entry.js"></script>
  </body>
</html>
```

`browser/fixtures/pages/trusted-types.html`（同一份内容，只有一个宿主；CSP 头由 `headers.json` 下发，不写成 `<meta>`，因为 `require-trusted-types-for` 用 meta 下发在各浏览器上支持不一致，而企业宿主本来就是走响应头）：

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>readit under require-trusted-types-for</title>
    <style>
      html, body { margin: 0; padding: 0; background: #ffffff; }
    </style>
  </head>
  <body>
    <div id="a" style="display: block; width: 760px"></div>
    <script type="module" src="/assets/entry.js"></script>
  </body>
</html>
```

`.github/workflows/browser.yml`：

```yaml
name: browser

on:
  push:
    branches: [main]
  pull_request:

jobs:
  # Chromium 与 WebKit 承重：Windows 壳走 WebView2（Chromium），macOS 壳走 WKWebView
  # （WebKit），M6 要用。容器与 L4 视觉层用同一个镜像 tag，两层不会各自漂移。
  l3b-element:
    name: L3b-element (${{ matrix.browser }})
    runs-on: ubuntu-latest
    container:
      image: mcr.microsoft.com/playwright:v1.62.1-noble
      options: --ipc=host
    strategy:
      fail-fast: false
      matrix:
        browser: [chromium, webkit]
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: '22.20.0'
          cache: npm
      - run: npm ci
      - run: npx playwright test browser/element --project=${{ matrix.browser }}
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: l3b-element-${{ matrix.browser }}
          path: |
            playwright-report/
            test-results/
          retention-days: 7

  # 尽力而为，失败不阻塞（设计 §7.2）。这是本仓库里唯一一处 continue-on-error，
  # 且它是刻意的产品决策而不是把红灯调暗：Firefox 不是任何一个出货壳的引擎。
  # test/browser-wiring.test.ts 钉住了「只此一处、只在这个 job 里」。
  l3b-element-firefox:
    name: L3b-element (firefox, advisory)
    runs-on: ubuntu-latest
    container:
      image: mcr.microsoft.com/playwright:v1.62.1-noble
      options: --ipc=host
    continue-on-error: true
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: '22.20.0'
          cache: npm
      - run: npm ci
      - run: npx playwright test browser/element --project=firefox
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit
npm run typecheck
npm test
npx playwright install --with-deps chromium webkit firefox
npx playwright test browser/element --project=chromium --project=webkit
```

预期：`npm run typecheck` 无输出退出 0；`npm test` 全绿且用例总数 ≥ 2318（P6 的既有数字只许增不许减，本任务新增 `test/browser-wiring.test.ts` 与 `ci-wiring.test.ts` 里那条 DOM lib 断言）；Playwright 输出 `20 passed (…)`（10 条用例 × 2 个 project）。

若 `npm test` 的总数低于 2318 或有既有用例转红，**停下上报**，不要在这里重钉数字。

- [ ] **Step 5: 提交**

```bash
git add playwright.config.ts browser .github/workflows/browser.yml \
        test/browser-wiring.test.ts test/ci-wiring.test.ts \
        package.json package-lock.json .gitignore
git commit -m "$(cat <<'EOF'
Task 11: Playwright 1.62.1 基建 + L3b-element

- 根 playwright.config.ts：testDir=browser，testMatch=*.spec.ts，updateSnapshots='none'，
  deviceScaleFactor=1 / maxDiffPixelRatio=0.002 / animations=disabled 全部钉在配置里
- browser/serve.mjs 零依赖 fixture server；路由按目录划分，后续层只加文件不改它
- 共享 harness：auto fixture 装离线守卫（非 127.0.0.1 的请求一律断掉并断言）、
  泄漏仪表（长命目标监听器 + 两种 observer）、CSP violation 采集
- L3b-element 10 条：open shadow 挂载、主题、同页两实例、相对/锚点/外链导航、
  50 次挂载销毁的泄漏归零、require-trusted-types-for 下 setHTML 在场与缺席两条路径
- CI：chromium 与 webkit 承重，firefox 独立 job 且显式 advisory
- typecheck 增加 browser/ 这座孤岛，并钉住 DOM lib 不得进根 tsconfig

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

---

### Task 12: L4 视觉回归 + 敌意宿主 fixture

**Files:**
- Create: `browser/fixtures/pages/visual.html`
- Create: `browser/fixtures/pages/hostile.html`
- Create: `browser/fixtures/css/visual-fonts.css`
- Create: `browser/fixtures/css/hostile-extra.css`
- Create: `browser/fixtures/content/kitchen-sink.md`
- Create: `browser/fixtures/content/code-and-tables.md`
- Create: `browser/fixtures/content/alerts-and-footnotes.md`
- Create: `browser/support/shots.ts`
- Create: `browser/support/visual.ts`
- Create: `browser/visual/visual.spec.ts`
- Create: `browser/element/hostile-isolation.spec.ts`
- Create: `browser/__screenshots__/*.png`（6 张，只在容器里生成）
- Create: `tools/visual-baseline.sh`
- Create: `.github/workflows/visual.yml`
- Modify: `package.json:7-25`
- Test: `test/visual-wiring.test.ts`（vitest）+ 上述两个 `.spec.ts`（Playwright）

**Interfaces:**
- Consumes:
  - `test` / `expect` / `mountDoc(page, hostId, opts): Promise<string>` / `MountFixtureOptions`（Task 11，`browser/support/harness.js`）
  - `window.__readit: ReaditFixtureApi`（Task 11，`browser/fixtures/entry.ts`）
  - `browser/serve.mjs` 的 `/content/`、`/css/`、`/vendor/` 路由（Task 11）
  - `playwright.config.ts` 的 `snapshotPathTemplate`、`updateSnapshots: 'none'`、`expect.toHaveScreenshot`（Task 11）
- Produces:
  - `browser/support/shots.ts`（零 import，vitest 与 Playwright 共用）：`export interface Shot { readonly name: string; readonly content: string; readonly theme: 'light' | 'dark'; readonly instances: 1 | 2 }`、`export const SHOTS: readonly Shot[]`（6 条）、`export const HOSTS: readonly ['visual', 'hostile']`
  - `browser/support/visual.ts`：`export const BASELINE_IMAGE: string`、`export function assertBaselineHost(testInfo: TestInfo): void`、`export async function assertFontsPinned(page: Page, hostId: string): Promise<void>`、`export async function loadShot(page: Page, shot: Shot): Promise<string>`、`export async function sampleComputedStyles(page: Page, hostId: string): Promise<Record<string, Record<string, string>>>`
  - npm 脚本：`visual:baseline`、`test:visual`

**≤12 的账怎么算，以及为什么敌意宿主复用同一张基线：** 6 张基线 × 2 个宿主页 = 12 次比对，落地的 PNG 是 6 张。敌意宿主页断言的是**和干净宿主页同一个基线文件名** —— 验收线 1 说的是「敌意宿主 fixture 下渲染**不变**」，那就不该是「敌意页像它自己的基线」（那种写法下两张基线一起漂移也照样绿），而应该是「敌意页与干净页逐像素相同」。这样写还顺带省掉一半基线维护量。

**为什么 L4 只跑 chromium：** WebKit 与 chromium 的基线是两套不同的像素，加起来 12 张就把 SPEC 的上限吃满，而 WebKit 在本计划里承重的是**行为**（L3b），不是像素。作为补偿，敌意宿主的隔离断言写成 computed-style 层的等价比对（`browser/element/hostile-isolation.spec.ts`），它跟着 Task 11 的 L3b job 在 chromium **和** WebKit 上都跑。

**为什么视觉语料里没有语法高亮、没有数学、没有 emoji、没有行内代码：** 高亮的 token 划分按设计 §5.3 归③档冻结黄金文件，不归②档；数学与 emoji 会引入本任务范围外的加载路径（emoji 还可能指向 CDN，会被 Task 11 的离线守卫直接打红）；行内 `<code>` 的字体族由 github-markdown-css 里以 `ui-monospace` 打头的栈决定，而 `ui-monospace` 是通用关键字，`@font-face` 覆写不了它 —— 唯一能钉住的是 `::part(code-block)` 覆盖到的围栏代码块。把行内代码留在语料外，是让「自托管 woff2」这条真的成立，而不是留一处静默依赖容器字体集的缝。

---

- [ ] **Step 1: 写会失败的测试**

`test/visual-wiring.test.ts`：

```ts
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HOSTS, SHOTS } from '../browser/support/shots.js'

const root = new URL('../', import.meta.url)
const read = (rel: string): string => (existsSync(new URL(rel, root)) ? readFileSync(new URL(rel, root), 'utf8') : '')

const IMAGE = 'mcr.microsoft.com/playwright:v1.62.1-noble'

describe('L4 的截图预算', () => {
  it('基线不超过 SPEC §13 的 12 张', () => {
    const dir = new URL('browser/__screenshots__/', root)
    const pngs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : []
    expect(pngs.length).toBeLessThanOrEqual(12)
    expect(pngs).toEqual(SHOTS.map((s) => `${s.name}.png`).sort())
  })

  it('每张基线都被两个宿主页各断言一次', () => {
    // 干净页与敌意页共用同一个基线文件名，所以「敌意宿主下渲染不变」是逐像素的等式，
    // 不是「敌意页像它自己那张」—— 后者两张一起漂移也照样绿。
    expect(HOSTS).toEqual(['visual', 'hostile'])
    expect(SHOTS.length * HOSTS.length).toBeLessThanOrEqual(12)
  })

  it('基线落在 playwright.config.ts 声明的目录里', () => {
    expect(read('playwright.config.ts')).toContain("snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}'")
  })
})

describe('基线只能在固定容器里生成', () => {
  it('visual:baseline 走的是那个镜像', () => {
    const sh = read('tools/visual-baseline.sh')
    expect(sh).toContain(IMAGE)
    expect(sh).toContain('--update-snapshots')
    const pkg = JSON.parse(read('package.json') || '{}') as { scripts?: Record<string, string> }
    expect(pkg.scripts?.['visual:baseline']).toBe('bash tools/visual-baseline.sh')
  })

  it('运行时也有一道闸，不只是文档', () => {
    // 有人在 macOS 上敲 --update-snapshots，就该拿到一条响亮的错误，而不是一批
    // 在别的字体栈上生成、随后在 CI 里永远对不上的 PNG。
    expect(read('browser/support/visual.ts')).toContain('/ms-playwright')
    expect(read('browser/support/visual.ts')).toContain(IMAGE)
  })

  it('CI 里重写基线的 job 只能手动触发', () => {
    const wf = read('.github/workflows/visual.yml')
    const baselineJob = wf.slice(wf.indexOf('\n  l4-baseline:'))
    expect(baselineJob).toContain("if: github.event_name == 'workflow_dispatch'")
    expect(wf).toContain('workflow_dispatch:')
    // 比对 job 与重写 job 用同一个镜像；两处 tag 不一致就是基线不可复现。
    const tags = [...wf.matchAll(/mcr\.microsoft\.com\/playwright:v[\d.]+-noble/g)].map((m) => m[0])
    expect(tags.length).toBe(2)
    expect([...new Set(tags)]).toEqual([IMAGE])
  })
})

describe('敌意宿主 fixture 真的敌意', () => {
  const hostile = read('browser/fixtures/pages/hostile.html')

  it('加载了真正的 Tailwind Preflight 与 Bootstrap Reboot', () => {
    expect(hostile).toContain('/vendor/tailwindcss/preflight.css')
    expect(hostile).toContain('/vendor/bootstrap/dist/css/bootstrap-reboot.css')
    expect(hostile).toContain('/css/hostile-extra.css')
  })

  it('两个 reset 的版本钉在 package.json 里', () => {
    const pkg = JSON.parse(read('package.json') || '{}') as { devDependencies?: Record<string, string> }
    expect(pkg.devDependencies?.tailwindcss).toBe('4.3.3')
    expect(pkg.devDependencies?.bootstrap).toBe('5.3.8')
  })

  it('干净页与敌意页除了敌意样式表以外完全同构', () => {
    // 两张页面的差别必须只有那三个 <link>。宿主容器的尺寸、字体钉法、脚本都要一致，
    // 否则「逐像素相同」比的就不是隔离，而是两张碰巧一样的页面。
    const clean = read('browser/fixtures/pages/visual.html')
    const strip = (s: string): string =>
      s.split('\n').filter((l) => !l.includes('/vendor/') && !l.includes('hostile-extra.css')).join('\n')
    expect(strip(hostile)).toBe(strip(clean))
  })
})

describe('自托管 woff2', () => {
  it('字体来自 node_modules 里钉死版本的包，不是 CDN', () => {
    const css = read('browser/fixtures/css/visual-fonts.css')
    expect(css).toContain('/vendor/@fontsource/inter/files/inter-latin-400-normal.woff2')
    expect(css).toContain('/vendor/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2')
    expect(css).not.toContain('http://')
    expect(css).not.toContain('https://')
    const pkg = JSON.parse(read('package.json') || '{}') as { devDependencies?: Record<string, string> }
    expect(pkg.devDependencies?.['@fontsource/inter']).toBe('5.3.0')
    expect(pkg.devDependencies?.['@fontsource/jetbrains-mono']).toBe('5.3.0')
  })
})
```

`browser/support/shots.ts`（先按最终形态写；Step 3 才有配套的 fixture 与内容）：

```ts
/**
 * 截图清单。零 import，因为 vitest（离线、不认识 @playwright/test）与 Playwright 都要读它。
 * 每一条会被 HOSTS 里的两个宿主页各断言一次，共用同一个基线文件名。
 */
export interface Shot {
  readonly name: string
  /** /content/ 下的文件名。 */
  readonly content: string
  readonly theme: 'light' | 'dark'
  readonly instances: 1 | 2
}

export const HOSTS = ['visual', 'hostile'] as const

export const SHOTS: readonly Shot[] = [
  { name: 'kitchen-sink-light', content: 'kitchen-sink.md', theme: 'light', instances: 1 },
  { name: 'kitchen-sink-dark', content: 'kitchen-sink.md', theme: 'dark', instances: 1 },
  { name: 'code-and-tables-light', content: 'code-and-tables.md', theme: 'light', instances: 1 },
  { name: 'code-and-tables-dark', content: 'code-and-tables.md', theme: 'dark', instances: 1 },
  { name: 'alerts-and-footnotes-light', content: 'alerts-and-footnotes.md', theme: 'light', instances: 1 },
  { name: 'two-instances-light-dark', content: 'kitchen-sink.md', theme: 'light', instances: 2 },
]
```

`browser/visual/visual.spec.ts`：

```ts
import { expect, test } from '../support/harness.js'
import { HOSTS, SHOTS } from '../support/shots.js'
import { assertBaselineHost, assertFontsPinned, loadShot } from '../support/visual.js'

for (const shot of SHOTS) {
  for (const host of HOSTS) {
    test(`${shot.name} · ${host} host`, async ({ page }, testInfo) => {
      test.skip(
        testInfo.project.name !== 'chromium',
        'L4 基线只在 chromium 生成（≤12 张的预算）；WebKit 承重的是 L3b 的行为层',
      )
      assertBaselineHost(testInfo)

      await page.goto(`/${host}.html`)
      const target = await loadShot(page, shot)
      await assertFontsPinned(page, shot.instances === 2 ? 'c' : 'a')

      await expect(page.locator(target)).toHaveScreenshot(`${shot.name}.png`)
    })
  }
}
```

`browser/element/hostile-isolation.spec.ts`：

```ts
import { expect, test } from '../support/harness.js'
import { loadShot } from '../support/visual.js'
import { sampleComputedStyles } from '../support/visual.js'
import { SHOTS } from '../support/shots.js'

const SHOT = SHOTS[0]
if (SHOT === undefined) throw new Error('SHOTS 为空')

test('敌意 fixture 本身确实是敌意的（否则下一条是空断言）', async ({ page }) => {
  await page.goto('/hostile.html')
  const probe = await page.evaluate(() => {
    const box = document.getElementById('probe-box')
    const heading = document.getElementById('probe-h1')
    const list = document.getElementById('probe-ul')
    const host = document.getElementById('a')
    if (box === null || heading === null || list === null || host === null) throw new Error('probe 元素缺失')
    return {
      boxSizing: getComputedStyle(box).boxSizing,
      headingMargin: getComputedStyle(heading).marginBlockStart,
      listPadding: getComputedStyle(list).paddingInlineStart,
      bodyFont: getComputedStyle(document.body).fontFamily,
      hostLineHeight: getComputedStyle(host).lineHeight,
      hostTransform: getComputedStyle(host).textTransform,
    }
  })
  expect(probe.boxSizing, 'Tailwind Preflight 没生效').toBe('border-box')
  expect(probe.headingMargin, 'Tailwind Preflight 没生效').toBe('0px')
  expect(probe.listPadding, 'Tailwind Preflight 没生效').toBe('0px')
  expect(probe.bodyFont, 'Bootstrap Reboot 没生效').toContain('system-ui')
  // hostile-extra.css 打的是继承属性，而继承是穿过 shadow 边界的 —— 挡住它的不是
  // Shadow DOM，是元素自己的 :host 重置。下一条测试就是那个重置的唯一证据。
  expect(probe.hostLineHeight, 'hostile-extra.css 没生效').toBe('48px')
  expect(probe.hostTransform, 'hostile-extra.css 没生效').toBe('uppercase')
})

test('敌意宿主下的 computed style 与干净宿主逐条相同', async ({ page }) => {
  await page.goto('/visual.html')
  await loadShot(page, SHOT)
  const clean = await sampleComputedStyles(page, 'a')

  await page.goto('/hostile.html')
  await loadShot(page, SHOT)
  const hostile = await sampleComputedStyles(page, 'a')

  expect(hostile).toEqual(clean)
})
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd /Users/mac08/Desktop/robot/readit
npm test -- test/visual-wiring.test.ts
```

预期（`browser/support/shots.ts` 之外的东西全不存在）：

```
 FAIL  test/visual-wiring.test.ts > L4 的截图预算 > 基线不超过 SPEC §13 的 12 张
AssertionError: expected [] to deeply equal [ 'alerts-and-footnotes-light.png', … ]
 FAIL  test/visual-wiring.test.ts > 基线只能在固定容器里生成 > visual:baseline 走的是那个镜像
AssertionError: expected '' to contain 'mcr.microsoft.com/playwright:v1.62.1-noble'
 FAIL  test/visual-wiring.test.ts > 敌意宿主 fixture 真的敌意 > 加载了真正的 Tailwind Preflight 与 Bootstrap Reboot
AssertionError: expected '' to contain '/vendor/tailwindcss/preflight.css'
```

```bash
npx playwright test browser/visual --project=chromium
```

预期：`Error: No tests found.`（`browser/visual/visual.spec.ts` 尚未落地）。

- [ ] **Step 3: 写最小实现**

装依赖并改根 `package.json`（`Modify: package.json:7-25`，`scripts` 尾部加两行、`devDependencies` 加四行）：

```bash
npm i -D @fontsource/inter@5.3.0 @fontsource/jetbrains-mono@5.3.0 bootstrap@5.3.8 tailwindcss@4.3.3
```

`package.json` 的两块改成：

```json
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit && tsc -p browser --noEmit && npm run typecheck --workspaces --if-present",
    "corpus:diff": "tsx packages/core/scripts/corpus-diff.ts",
    "oracle:refresh": "tsx packages/core/scripts/oracle-refresh.ts",
    "oracle:manifest": "tsx packages/core/scripts/build-oracle-manifest.ts",
    "gen:svg-stylesheet": "vite-node tools/gen-svg-stylesheet.ts",
    "refresh:math-golden": "vite-node tools/refresh-math-golden.ts",
    "browser:build": "node browser/fixtures/build-fixtures.mjs",
    "browser:serve": "npm run browser:build && node browser/serve.mjs",
    "test:browser": "playwright test browser/element",
    "test:visual": "playwright test browser/visual --project=chromium",
    "visual:baseline": "bash tools/visual-baseline.sh"
  },
  "devDependencies": {
    "@fontsource/inter": "5.3.0",
    "@fontsource/jetbrains-mono": "5.3.0",
    "@playwright/test": "1.62.1",
    "bootstrap": "5.3.8",
    "esbuild": "0.25.12",
    "tailwindcss": "4.3.3",
    "typescript": "5.9.3",
    "vite-node": "6.0.0",
    "vitest": "4.1.10"
  }
```

`browser/fixtures/css/visual-fonts.css`：

```css
/*
 * 自托管 woff2（SPEC §13）。为什么钉的族名是 "Noto Sans" 而不是自造一个名字：
 * github-markdown-css 5.9.0 的正文栈是
 *   -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, …
 * 在 noble 容器里前三个都解析不到，"Noto Sans" 是第一个能被 @font-face 接管的具名族。
 * @font-face 是文档级的，跨 shadow 边界照常生效，所以不需要元素配合。
 *
 * 等宽栈是 ui-monospace, SFMono-Regular, … —— ui-monospace 是通用关键字，@font-face
 * 覆写不了，所以等宽只能靠 ::part(code-block) 从外部压过去。两条路都留着：
 * ::part 万一没接上，assertFontsPinned() 会以量宽度的方式当场红，而不是静默回落到容器字体。
 */
@font-face { font-family: 'Noto Sans'; font-style: normal; font-weight: 400; font-display: block;
  src: url('/vendor/@fontsource/inter/files/inter-latin-400-normal.woff2') format('woff2'); }
@font-face { font-family: 'Noto Sans'; font-style: normal; font-weight: 600; font-display: block;
  src: url('/vendor/@fontsource/inter/files/inter-latin-600-normal.woff2') format('woff2'); }
@font-face { font-family: 'Noto Sans'; font-style: normal; font-weight: 700; font-display: block;
  src: url('/vendor/@fontsource/inter/files/inter-latin-700-normal.woff2') format('woff2'); }
@font-face { font-family: 'Noto Sans'; font-style: italic; font-weight: 400; font-display: block;
  src: url('/vendor/@fontsource/inter/files/inter-latin-400-italic.woff2') format('woff2'); }
@font-face { font-family: 'Noto Sans'; font-style: italic; font-weight: 700; font-display: block;
  src: url('/vendor/@fontsource/inter/files/inter-latin-700-italic.woff2') format('woff2'); }

@font-face { font-family: 'SFMono-Regular'; font-style: normal; font-weight: 400; font-display: block;
  src: url('/vendor/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2') format('woff2'); }
@font-face { font-family: 'SFMono-Regular'; font-style: normal; font-weight: 700; font-display: block;
  src: url('/vendor/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2') format('woff2'); }

#a::part(root), #c::part(root), #d::part(root),
#a::part(content), #c::part(content), #d::part(content) {
  font-family: 'Noto Sans', sans-serif;
}

#a::part(code-block), #c::part(code-block), #d::part(code-block) {
  font-family: 'SFMono-Regular', monospace;
}
```

`browser/fixtures/css/hostile-extra.css`：

```css
/*
 * Preflight 与 Reboot 都是「善意」的 reset：它们用的是后代与类型选择器，
 * 而那些选择器根本进不了 shadow 树，所以单靠它们两个，这条验收线太便宜。
 *
 * 这里补的全部是**继承属性**。继承是穿过 shadow 边界的 —— 挡住它的不是 Shadow DOM，
 * 是元素自己的 :host 重置。所以这张表就是那个重置的唯一证据。
 * 不用 !important 打 ::part()：那会把 visual-fonts.css 的字体钉法也一起打掉，
 * 变成在测「字体没被钉住时两张页面是否一样」，那不是这条验收线要问的问题。
 */
* {
  line-height: 3 !important;
  color: #ff00ff !important;
  letter-spacing: 0.35em !important;
  word-spacing: 0.5em !important;
  text-transform: uppercase !important;
  font-family: cursive !important;
  font-style: italic !important;
  font-variant-numeric: tabular-nums !important;
  text-align: right !important;
}

/* 非继承的部分：只有隔离破了才会咬到。名字是照着 readit 的 DOM 形状挑的。 */
.markdown-body, .markdown-body * {
  background: #00ff00 !important;
  border-color: #ff0000 !important;
  padding: 12px !important;
  margin: 12px !important;
}

pre, code, table, th, td, h1, h2, h3, blockquote, li {
  outline: 3px dashed #ff0000 !important;
  border-radius: 14px !important;
}

/* 宿主容器的盒子必须不受影响，否则比的就不是隔离而是两个不同宽度的元素。
   页面上的 width 写在 style 属性里，这里不碰它。 */
```

`browser/fixtures/pages/visual.html`：

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>readit L4 clean host</title>
    <link rel="stylesheet" href="/css/visual-fonts.css" />
    <style>
      html, body { margin: 0; padding: 0; background: #ffffff; }
    </style>
  </head>
  <body>
    <h1 id="probe-h1">probe</h1>
    <ul id="probe-ul"><li>probe</li></ul>
    <div id="probe-box">probe</div>
    <div id="a" style="display: block; width: 760px"></div>
    <div id="pair" style="display: none; gap: 24px; align-items: flex-start; width: 784px">
      <div id="c" style="display: block; width: 380px"></div>
      <div id="d" style="display: block; width: 380px"></div>
    </div>
    <script type="module" src="/assets/entry.js"></script>
  </body>
</html>
```

`browser/fixtures/pages/hostile.html` —— 与上面**逐行相同**，只多三个 `<link>`（`test/visual-wiring.test.ts` 里那条 `strip()` 断言钉住了这一点）：

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>readit L4 clean host</title>
    <link rel="stylesheet" href="/vendor/tailwindcss/preflight.css" />
    <link rel="stylesheet" href="/vendor/bootstrap/dist/css/bootstrap-reboot.css" />
    <link rel="stylesheet" href="/css/visual-fonts.css" />
    <link rel="stylesheet" href="/css/hostile-extra.css" />
    <style>
      html, body { margin: 0; padding: 0; background: #ffffff; }
    </style>
  </head>
  <body>
    <h1 id="probe-h1">probe</h1>
    <ul id="probe-ul"><li>probe</li></ul>
    <div id="probe-box">probe</div>
    <div id="a" style="display: block; width: 760px"></div>
    <div id="pair" style="display: none; gap: 24px; align-items: flex-start; width: 784px">
      <div id="c" style="display: block; width: 380px"></div>
      <div id="d" style="display: block; width: 380px"></div>
    </div>
    <script type="module" src="/assets/entry.js"></script>
  </body>
</html>
```

> `<title>` 故意保持一致：`strip()` 只滤掉含 `/vendor/` 与 `hostile-extra.css` 的行，其余必须一字不差，这样「两张页面除了敌意样式表以外同构」才是被机器守住的，不是靠记性。

- [ ] **Step 3（续）: 视觉语料三个文件**

`browser/fixtures/content/kitchen-sink.md`：

````md
# Kitchen sink

A paragraph with **bold**, *italic* and ~~struck~~ text, plus a
[relative link](./other.md) and an [external one](https://example.com/).
It runs onto a second line so that line height and wrapping both land in the
baseline rather than only the first-line metrics.

## Second level heading

> A block quote that wraps onto a second line, so the left border, the inset
> and the vertical rhythm are all visible.

1. Ordered item one
2. Ordered item two
   1. Nested ordered item
3. Ordered item three

- Unordered item
- Another unordered item
  - Nested unordered item

---

### Third level heading

A closing paragraph after a thematic break.
````

`browser/fixtures/content/code-and-tables.md`：

````md
# Code and tables

| Left | Center | Right |
| :--- | :----: | ----: |
| one | two | three |
| four | five | six |
| a longer cell | mid | 42 |

```js
function greet(name) {
  return "hello " + name;
}
```

```
a plain fence with no language attached
```

- [x] a completed task
- [ ] an open task
- [ ] a second open task
````

`browser/fixtures/content/alerts-and-footnotes.md`：

````md
# Alerts and footnotes

> [!NOTE]
> Useful information that users should know, even when skimming.

> [!WARNING]
> Urgent information needing immediate user attention to avoid problems.

> [!CAUTION]
> Advises about risks or negative outcomes of certain actions.

## Footnotes

A statement that needs a source.[^src] And a second one.[^other]

[^src]: The first source.
[^other]: The second source.
````

- [ ] **Step 3（续）: `browser/support/visual.ts`**

```ts
import { existsSync } from 'node:fs'
import { expect, type Page, type TestInfo } from '@playwright/test'
import type { Shot } from './shots.js'

export const BASELINE_IMAGE = 'mcr.microsoft.com/playwright:v1.62.1-noble'

/** 官方镜像把浏览器装在这里；容器外不存在这个目录。 */
const CONTAINER_MARKER = '/ms-playwright'

/**
 * 写基线这条路必须在容器里。config 把 updateSnapshots 钉成 'none'，所以普通比对
 * 在任何机器上都放行；只有显式 --update-snapshots 才会走到这道闸。
 *
 * 这不是沙箱 —— 存心绕过它很容易。它挡的是「在 macOS 上顺手 -u 了一把、生成一批
 * 用另一套字体栈渲的 PNG、提交、然后 CI 永远红」这条真实发生过无数次的路径。
 */
export function assertBaselineHost(testInfo: TestInfo): void {
  if (testInfo.config.updateSnapshots === 'none') return
  if (process.platform === 'linux' && existsSync(CONTAINER_MARKER)) return
  throw new Error(
    `L4 基线只能在 ${BASELINE_IMAGE} 里生成（SPEC §13）。\n` +
      `当前进程不在该镜像内（platform=${process.platform}）。请跑：npm run visual:baseline`,
  )
}

/** 挂好一条 shot 要的实例，返回该截图的 locator 选择器。 */
export async function loadShot(page: Page, shot: Shot): Promise<string> {
  const markdown = await page.evaluate(
    async (file: string) => await (await fetch(`/content/${file}`)).text(),
    shot.content,
  )

  if (shot.instances === 1) {
    await page.evaluate(
      ([value, theme]) => { window.__readit.mount('a', { value, mode: 'read', theme }) },
      [markdown, shot.theme] as const,
    )
    return '#a'
  }

  await page.evaluate((value: string) => {
    const pair = document.getElementById('pair')
    if (pair === null) throw new Error('no #pair')
    pair.style.display = 'flex'
    window.__readit.mount('c', { value, mode: 'read', theme: 'light' })
    window.__readit.mount('d', { value, mode: 'read', theme: 'dark' })
  }, markdown)
  return '#pair'
}

/**
 * 字体钉住了没有 —— 量宽度，不看 computed 的 font-family 字符串。
 * getComputedStyle().fontFamily 返回的是**声明的整个栈**，"Noto Sans" 本来就在栈里，
 * 拿它做断言无论字体有没有加载都会通过。那是空断言。
 */
export async function assertFontsPinned(page: Page, hostId: string): Promise<void> {
  await page.evaluate(async () => { await document.fonts.ready })

  const m = await page.evaluate((id: string) => {
    const root = document.getElementById(id)?.shadowRoot ?? null
    if (root === null) throw new Error(`no shadow root on #${id}`)
    const para = root.querySelector('p')
    const pre = root.querySelector('pre')
    if (para === null) throw new Error('渲染结果里没有 <p>')

    const width = (family: string): number => {
      const span = document.createElement('span')
      span.textContent = 'MMMMMiiiii 0123456789 the quick brown fox'
      span.style.cssText =
        `position:absolute;left:-9999px;top:0;white-space:pre;font-size:16px;font-weight:400;font-family:${family}`
      document.body.append(span)
      const w = span.getBoundingClientRect().width
      span.remove()
      return w
    }

    return {
      bodyUsed: width(getComputedStyle(para).fontFamily),
      bodyWant: width("'Noto Sans'"),
      bodyOther: width('serif'),
      monoUsed: pre === null ? null : width(getComputedStyle(pre).fontFamily),
      monoWant: width("'SFMono-Regular'"),
      monoOther: width('serif'),
    }
  }, hostId)

  expect(Math.abs(m.bodyUsed - m.bodyWant), '正文没有落在自托管的 Noto Sans 上').toBeLessThan(0.5)
  expect(Math.abs(m.bodyUsed - m.bodyOther), '量宽度这套探针本身失灵了').toBeGreaterThan(1)

  if (m.monoUsed !== null) {
    expect(
      Math.abs(m.monoUsed - m.monoWant),
      '围栏代码块没有落在自托管的等宽字体上；很可能是 ::part(code-block) 暴露在了 ' +
        '<pre> 的外层 wrapper 上，而 github-markdown-css 的 .markdown-body pre 又自己设了 ' +
        'font-family，于是从外面继承下来的那一份被顶掉了。把 part 挪到 <pre> 本体上。',
    ).toBeLessThan(0.5)
    expect(Math.abs(m.monoUsed - m.monoOther)).toBeGreaterThan(1)
  }
}

const SAMPLED = [
  'h1', 'h2', 'h3', 'p', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'th', 'td', 'hr', 'a',
] as const

const PROPS = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing',
  'textTransform', 'textAlign', 'direction', 'color', 'backgroundColor', 'boxSizing', 'listStyleType',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderLeftWidth', 'borderTopColor', 'borderLeftColor', 'borderRadius',
  'outlineWidth', 'outlineStyle',
] as const

/**
 * 逐条抽 computed style。这是「敌意宿主下渲染不变」在**非像素**层的表述，
 * 所以它跟着 L3b job 在 chromium 与 WebKit 上都跑 —— L4 因为 ≤12 张的预算只跑 chromium。
 */
export async function sampleComputedStyles(
  page: Page,
  hostId: string,
): Promise<Record<string, Record<string, string>>> {
  return await page.evaluate(
    ([id, tags, props]) => {
      const root = document.getElementById(id)?.shadowRoot ?? null
      if (root === null) throw new Error(`no shadow root on #${id}`)
      const out: Record<string, Record<string, string>> = {}
      for (const tag of tags) {
        const el = root.querySelector(tag)
        if (el === null) continue
        const cs = getComputedStyle(el)
        const one: Record<string, string> = {}
        for (const p of props) one[p] = cs.getPropertyValue(p) || String(Reflect.get(cs, p) ?? '')
        out[tag] = one
      }
      if (Object.keys(out).length === 0) throw new Error('一个采样元素都没命中；渲染可能是空的')
      return out
    },
    [hostId, SAMPLED, PROPS] as const,
  )
}
```

- [ ] **Step 3（续）: 基线生成脚本与 CI**

`tools/visual-baseline.sh`：

```bash
#!/usr/bin/env bash
#
# 在固定容器里重写 L4 基线（SPEC §13）。宿主机的 node_modules 装的是本机平台的
# esbuild / Playwright 二进制，直接挂进 linux 容器会炸，所以用一个匿名卷把它盖掉、
# 在容器里重装一份；宿主机那份原封不动。写出来的 PNG 落在 bind mount 上，跑完 chown
# 回当前用户，免得留一堆 root 拥有的文件。
set -euo pipefail

IMAGE="mcr.microsoft.com/playwright:v1.62.1-noble"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OWNER="$(id -u):$(id -g)"

exec docker run --rm --init --ipc=host \
  -v "$REPO":/w \
  -v /w/node_modules \
  -w /w \
  -e CI=1 \
  "$IMAGE" \
  bash -c "set -o pipefail
           npm ci --no-audit --no-fund
           status=0
           npx playwright test browser/visual --project=chromium --update-snapshots || status=\$?
           chown -R ${OWNER} browser/__screenshots__ || true
           exit \$status"
```

```bash
chmod +x tools/visual-baseline.sh
```

`.github/workflows/visual.yml`：

```yaml
name: visual

on:
  push:
    branches: [main]
  pull_request:
  # 重写基线只能手动扳一次闸，见下面 l4-baseline 的 if。
  workflow_dispatch:

jobs:
  l4-visual:
    name: L4 visual regression
    runs-on: ubuntu-latest
    container:
      image: mcr.microsoft.com/playwright:v1.62.1-noble
      options: --ipc=host
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: '22.20.0'
          cache: npm
      - run: npm ci
      # updateSnapshots: 'none'，所以缺基线是红灯，不是「悄悄补一张然后绿」。
      - run: npx playwright test browser/visual --project=chromium
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: l4-visual-diff
          path: |
            playwright-report/
            test-results/
          retention-days: 7

  # 给没装 docker 的贡献者留的唯一一条重写基线的路。它只在手动 dispatch 时跑，
  # 产物是 artifact 而不是 commit —— 一次 PR 不可能顺带把基线洗掉。
  l4-baseline:
    name: L4 regenerate baselines (manual)
    if: github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    container:
      image: mcr.microsoft.com/playwright:v1.62.1-noble
      options: --ipc=host
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: '22.20.0'
          cache: npm
      - run: npm ci
      - run: npx playwright test browser/visual --project=chromium --update-snapshots
      - uses: actions/upload-artifact@v4
        with:
          name: l4-baselines
          path: browser/__screenshots__/
          retention-days: 14
```

- [ ] **Step 3（续）: 生成 6 张基线**

```bash
cd /Users/mac08/Desktop/robot/readit
npm run visual:baseline
ls -1 browser/__screenshots__/
```

预期列出正好 6 个文件：`alerts-and-footnotes-light.png`、`code-and-tables-dark.png`、`code-and-tables-light.png`、`kitchen-sink-dark.png`、`kitchen-sink-light.png`、`two-instances-light-dark.png`。

若本机没有 docker：改走 GitHub Actions 的 `visual` workflow → `Run workflow`（`workflow_dispatch`），下载 `l4-baselines` artifact，解到 `browser/__screenshots__/`。两条路生成的都是同一个镜像里的像素。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit
npm run typecheck
npm test
npx playwright test browser/element --project=chromium --project=webkit
npm run test:visual
```

预期：

- `npm run typecheck` 无输出退出 0
- `npm test` 全绿，用例总数 ≥ 2318（P6：既有 2318 条只许增不许减；本任务新增 `test/visual-wiring.test.ts` 的 8 条）
- `browser/element` 一轮 24 passed（Task 11 的 10 条 + 本任务 2 条，× 2 个 project）
- `npm run test:visual` 一轮 `12 passed`（6 张基线 × 2 个宿主页），其中敌意宿主那 6 条与干净宿主比的是**同一批 PNG**

若 `npm run test:visual` 在敌意宿主那 6 条上红，而干净宿主 6 条绿 —— 那就是验收线 1 真的没过，是 `@readit/element` 的 `:host` 重置漏了继承属性。**上报给 element 那一侧修，不要放宽 `maxDiffPixelRatio`。**

若 `assertFontsPinned` 在等宽那条上红，按错误信息里写的做（把 `code-block` part 挪到 `<pre>` 本体上），不要把断言删掉换成 `fontFamily` 字符串包含检查 —— 那条正是空断言。

- [ ] **Step 5: 提交**

```bash
git add browser/fixtures/pages/visual.html browser/fixtures/pages/hostile.html \
        browser/fixtures/css browser/fixtures/content \
        browser/support/shots.ts browser/support/visual.ts \
        browser/visual browser/element/hostile-isolation.spec.ts \
        browser/__screenshots__ \
        tools/visual-baseline.sh .github/workflows/visual.yml \
        test/visual-wiring.test.ts package.json package-lock.json
git commit -m "$(cat <<'EOF'
Task 12: L4 视觉回归 + 敌意宿主 fixture

- 6 张基线 × 2 个宿主页 = 12 次比对，落地 PNG 6 张（SPEC §13 上限 12）。
  敌意宿主断言的是与干净宿主**同一个**基线文件名 —— 验收线 1 因此是逐像素等式，
  而不是「敌意页像它自己那张」（后者两张一起漂移也照样绿）
- 敌意 fixture：真的 Tailwind 4.3.3 Preflight + Bootstrap 5.3.8 Reboot，
  外加一张只打继承属性的 hostile-extra.css —— 继承是穿过 shadow 边界的，
  挡它的是元素自己的 :host 重置，这张表就是那个重置的唯一证据。
  先有一条「fixture 本身确实敌意」的探针，否则整条验收线是空的
- 自托管 woff2 从 node_modules 里钉死版本的 @fontsource 包经 /vendor/ 供给；
  字体是否真的生效用量文本宽度判定，不看 computed 的 font-family 字符串（那是空断言）
- 基线只能在 mcr.microsoft.com/playwright:v1.62.1-noble 里生成：
  config 钉 updateSnapshots='none' + 运行时容器闸 + CI 重写 job 只认 workflow_dispatch
- L4 只跑 chromium（≤12 张的预算）；WebKit 侧由 hostile-isolation.spec.ts 的
  computed-style 等价比对承担，它跟着 L3b job 在 chromium 与 WebKit 上都跑
- 视觉语料刻意不含语法高亮（③档）、数学、emoji、行内代码（ui-monospace 覆写不了）

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 新增契约提案

以下都是 P1–P6 没有覆盖、但 Task 11–12 承重的东西。**未经确认前不要当成既定契约**；若与其他组起草的任务冲突，以本节被裁定后的版本为准。

1. **`::part()` 名单里 `code-block` 必须挂在 `<pre>` 本体上，不是它的 wrapper `<div class="highlight …">`。**
   理由不是审美：github-markdown-css 自己给 `.markdown-body pre` 设了 `font-family`，挂在 wrapper 上时外部 `::part` 的字体钉法会被内层规则顶掉，L4 的等宽字体就回落到容器的 `ui-monospace`，基线跟着镜像 tag 漂。设计 §9 修订 #3 只钉了名字，没钉挂点。

2. **`mount()` 必须在宿主元素上写 `data-theme` 属性，取值 `'light' | 'dark'`（`theme: 'auto'` 解析后的结果，不是字面量 `'auto'`）。**
   设计 §3.3 说样式 scope 在 `:host([data-theme=…])` 下，这蕴含了该属性存在，但没说 `'auto'` 时写什么。Task 11 的主题用例断言的是解析后的值。

3. **`browser/` 作为第四个 TypeScript 编译单元。**
   它不是 workspace、需要 DOM lib，所以有自己的 `tsconfig.json`，并让根 `typecheck` 脚本多一次 `tsc -p browser --noEmit`。这改动了 `test/ci-wiring.test.ts:62` 那条精确字符串断言 —— 那条断言是计划一的产物，任何人再改 `typecheck` 脚本都会撞上它。本任务把它改成同时钉住「DOM lib 不许进根 tsconfig」。

4. **`Firefox` 的 advisory 身份需要一处 `continue-on-error: true`。**
   `test/ci-wiring.test.ts` 对 `test.yml` 有一条「任何地方都不许有 continue-on-error」的禁令。本任务不动那条，但在新文件 `.github/workflows/browser.yml` 里用了一次，并用 `test/browser-wiring.test.ts` 钉死「只此一处、只在 firefox job 里」。若评审认为这条禁令应是全仓库级的，那 Firefox 就得改用别的机制（例如彻底不进 CI，只留本地命令），请裁定。

5. **CSS 的 `@font-face` 与敌意 reset 直接从 `node_modules` 经 `/vendor/` 路由供给，不 vendor 二进制进仓库。**
   代价是四个纯 fixture 用途的 devDependency（`@fontsource/inter@5.3.0`、`@fontsource/jetbrains-mono@5.3.0`、`tailwindcss@4.3.3`、`bootstrap@5.3.8`）。换来的是版本由 package-lock 钉住、无需 fetch 脚本、无需在离线门上开洞。

6. **一处已知的、无法在本计划内消掉的不确定性，具名记录而不是假装解决：** Tailwind v4 的 `preflight.css` 里 `font-family: --theme(…)` 是构建期函数，`<link>` 直接加载时浏览器会把那条声明丢掉。也就是说敌意 fixture 拿到的是 Preflight 的**盒模型与间距 reset 全部生效、字体那一条不生效**的形态。补偿是 Bootstrap Reboot 的 `--bs-body-font-family` 与 `hostile-extra.css` 的 `font-family: cursive !important` 都会生效，字体维度的敌意没有缺口；但「加载的是未编译的 Preflight」这件事应当被知道，而不是等某个人自己发现。要消掉它需要引入 `@tailwindcss/cli` 做一次编译，本计划判定不值得。

---

### Task 13: `@readit/editor` 包 + P2 契约 + plain 档（textarea）

**Files:**
- Create: `packages/editor/package.json`
- Create: `packages/editor/tsconfig.json`
- Create: `packages/editor/vitest.config.ts`
- Create: `packages/editor/src/types.ts`
- Create: `packages/editor/src/plain.ts`
- Create: `packages/editor/src/index.ts`
- Create: `packages/editor/test/contract.ts`（跨 runner 共用的契约用例表，不是 `.test.ts`，两个 runner 都不会自动捡它——P5）
- Test: `packages/editor/test/plain.test.ts`

**Interfaces:**
- Consumes: 无（本任务是 M4 的第一块；`@readit/editor` 对 `@readit/core` 无任何依赖，连类型都不需要，P1 的「editor → core 仅类型」因此是空真）
- Produces:
  - `packages/editor/src/types.ts`：`EditorKind`、`EditorOptions`、`Editor`（P2 逐字）
  - `packages/editor/src/plain.ts`：`createPlainEditor(opts: EditorOptions): Editor`、`topLineFromScroll(scrollTop: number, lineHeight: number, lineCount: number): number`、`FALLBACK_LINE_HEIGHT: number`
  - `packages/editor/test/contract.ts`：`editorContractCases(create: EditorFactory, env: ContractEnv): ContractCase[]`、`runAllCases(cases: ContractCase[]): Promise<string[]>`，其中 `type EditorFactory = (opts: EditorOptions) => Promise<Editor>`、`interface ContractCase { readonly name: string; run(): Promise<void> }`
  - `packages/editor/src/index.ts`：本任务只 `export type` 三个类型；`createEditor` 由 Task 14 加（见该任务的理由——现在放一个只认 `'plain'`、对 `'codemirror'` 抛错的分支就是「公共 API 里的永久空壳」，计划一刚为此挨过批评）

---

- [ ] **Step 1: 写会失败的测试**

`packages/editor/test/contract.ts`（不依赖任何断言库——Task 17 要在 Playwright 里、在**浏览器页面内**跑同一张表；引进 vitest 的 `expect` 会把 vitest 拖进浏览器 bundle）：

```ts
import type { Editor, EditorOptions } from '../src/types.js'

export type EditorFactory = (opts: EditorOptions) => Promise<Editor>

export interface ContractEnv {
  /** 造一个已在文档树里的挂载点。 */
  mount(): { parent: HTMLElement; root: ShadowRoot | Document }
  /** 模拟一次用户输入。两个实现的输入通道不同，所以由环境提供。 */
  type(parent: HTMLElement, value: string): void
}

export interface ContractCase {
  readonly name: string
  run(): Promise<void>
}

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(message)
}

function assertEqual(actual: unknown, expected: unknown, what: string): void {
  assert(
    Object.is(actual, expected),
    `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  )
}

/**
 * 与排版无关的契约用例。plain 档在 vitest（happy-dom，无排版）里跑，
 * codemirror 档在 Playwright（真浏览器）里跑同一张表——「两个实现才算验证过
 * 一个抽象」这句话的兑现形式就是这张表被跑了两遍。
 */
export function editorContractCases(create: EditorFactory, env: ContractEnv): ContractCase[] {
  const make = async (
    value: string,
    sink: { changes: string[]; scrolls: number[] },
  ): Promise<{ ed: Editor; parent: HTMLElement }> => {
    const { parent, root } = env.mount()
    const ed = await create({
      parent,
      root,
      value,
      onChange: (v) => sink.changes.push(v),
      onScroll: (l) => sink.scrolls.push(l),
    })
    return { ed, parent }
  }

  return [
    {
      name: 'getValue() 返回初始 value',
      async run() {
        const sink = { changes: [] as string[], scrolls: [] as number[] }
        const { ed } = await make('# hi\nthere', sink)
        assertEqual(ed.getValue(), '# hi\nthere', 'getValue')
        ed.destroy()
      },
    },
    {
      name: 'setValue() 整体换文档，getValue() 立刻反映',
      async run() {
        const sink = { changes: [] as string[], scrolls: [] as number[] }
        const { ed } = await make('a', sink)
        ed.setValue('b\nc')
        assertEqual(ed.getValue(), 'b\nc', 'getValue after setValue')
        ed.destroy()
      },
    },
    {
      name: 'setValue() 不得把自己的写入当成用户输入回灌 onChange',
      async run() {
        const sink = { changes: [] as string[], scrolls: [] as number[] }
        const { ed } = await make('a', sink)
        ed.setValue('b')
        assertEqual(sink.changes.length, 0, 'onChange call count')
        ed.destroy()
      },
    },
    {
      name: '用户输入触发 onChange，带的是完整新文档',
      async run() {
        const sink = { changes: [] as string[], scrolls: [] as number[] }
        const { ed, parent } = await make('a', sink)
        env.type(parent, 'ab')
        assertEqual(sink.changes[sink.changes.length - 1], 'ab', 'last onChange value')
        ed.destroy()
      },
    },
    {
      name: '组合期间的 setValue 被推迟到 compositionend 之后才落地',
      async run() {
        const sink = { changes: [] as string[], scrolls: [] as number[] }
        const { ed, parent } = await make('a', sink)
        const target = parent.firstElementChild
        assert(target !== null, 'editor must put a node under parent')
        target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        ed.setValue('外部写入')
        assertEqual(ed.getValue(), 'a', 'value during composition')
        target.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        assertEqual(ed.getValue(), '外部写入', 'value after compositionend')
        ed.destroy()
      },
    },
    {
      name: 'topLine() 在未滚动时是 0',
      async run() {
        const sink = { changes: [] as string[], scrolls: [] as number[] }
        const { ed } = await make('1\n2\n3\n4\n5', sink)
        assertEqual(ed.topLine(), 0, 'topLine')
        ed.destroy()
      },
    },
    {
      name: 'destroy() 把自己的 DOM 从 parent 上摘干净，且可重复调用',
      async run() {
        const sink = { changes: [] as string[], scrolls: [] as number[] }
        const { ed, parent } = await make('a', sink)
        ed.destroy()
        ed.destroy()
        assertEqual(parent.childElementCount, 0, 'parent.childElementCount after destroy')
      },
    },
  ]
}

/** 跑完整张表，返回失败描述数组（空数组 == 全过）。Playwright 侧靠它把页面内的结果带回 Node。 */
export async function runAllCases(cases: readonly ContractCase[]): Promise<string[]> {
  const failures: string[] = []
  for (const c of cases) {
    try {
      await c.run()
    } catch (err) {
      failures.push(`${c.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return failures
}
```

`packages/editor/test/plain.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { createPlainEditor, topLineFromScroll, FALLBACK_LINE_HEIGHT } from '../src/plain.js'
import { editorContractCases, runAllCases, type ContractEnv } from './contract.js'

const env: ContractEnv = {
  mount() {
    const parent = document.createElement('div')
    document.body.append(parent)
    return { parent, root: document }
  },
  type(parent, value) {
    const ta = parent.querySelector('textarea')
    if (ta === null) throw new Error('plain editor did not create a textarea')
    ta.value = value
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  },
}

describe('plain 档满足 P2 的 Editor 契约', () => {
  for (const c of editorContractCases((opts) => Promise.resolve(createPlainEditor(opts)), env)) {
    it(c.name, async () => {
      await expect(c.run()).resolves.toBeUndefined()
    })
  }

  it('整张表一次跑完也是零失败（runAllCases 是 Task 17 在浏览器里用的入口）', async () => {
    const cases = editorContractCases((opts) => Promise.resolve(createPlainEditor(opts)), env)
    await expect(runAllCases(cases)).resolves.toEqual([])
  })
})

describe('plain 档的行数学是纯函数，不依赖排版', () => {
  it('scrollTop / lineHeight 向下取整，并夹在 [0, lineCount-1]', () => {
    expect(topLineFromScroll(0, 20, 10)).toBe(0)
    expect(topLineFromScroll(39, 20, 10)).toBe(1)
    expect(topLineFromScroll(40, 20, 10)).toBe(2)
    expect(topLineFromScroll(99999, 20, 10)).toBe(9)
    expect(topLineFromScroll(-5, 20, 10)).toBe(0)
  })

  it('lineHeight 拿不到数字时回落到常量，而不是产出 NaN', () => {
    expect(topLineFromScroll(100, Number.NaN, 10)).toBe(0)
    expect(topLineFromScroll(100, 0, 10)).toBe(0)
    expect(FALLBACK_LINE_HEIGHT).toBe(20)
  })

  it('空文档只有一行，topLine 恒为 0', () => {
    expect(topLineFromScroll(500, 20, 1)).toBe(0)
  })
})

describe('plain 档关掉软换行', () => {
  it('textarea 带 wrap="off"——否则「视觉行」与「源码行」不再一一对应，topLine() 无定义', () => {
    const parent = document.createElement('div')
    document.body.append(parent)
    const ed = createPlainEditor({
      parent,
      root: document,
      value: 'x',
      onChange: () => {},
      onScroll: () => {},
    })
    expect(parent.querySelector('textarea')?.getAttribute('wrap')).toBe('off')
    ed.destroy()
  })
})
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd /Users/mac08/Desktop/robot/readit && npx vitest run packages/editor/test/plain.test.ts
```

预期：`Error: Cannot find package '@readit/editor'` 之前先是文件层面的失败——
`Failed to load url ../src/plain.js`，vitest 报 `No test files found` 或
`Cannot find module '/Users/mac08/Desktop/robot/readit/packages/editor/src/plain.ts'`。

- [ ] **Step 3: 写最小实现**

`packages/editor/package.json`：

```json
{
  "name": "@readit/editor",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types.ts",
    "./package.json": "./package.json"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "24.10.1",
    "happy-dom": "20.11.2",
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  },
  "engines": {
    "node": ">=22"
  }
}
```

`packages/editor/tsconfig.json`：

```json
{
  "//": [
    "与 packages/core/tsconfig.json 同一套 compilerOptions，另加 DOM/DOM.Iterable：",
    "@readit/editor 是浏览器专属包（SPEC §5 的『Node 可 import ❌』那一栏）。",
    "types 里保留 node，是因为 test/ 下的结构守卫要用 node:fs 与 typescript 编译器 API。"
  ],
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`packages/editor/vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // happy-dom 而不是 linkedom：本包要断言 focus/activeElement、
    // CompositionEvent 派发、template.content 与 getComputedStyle。
    // SPEC §13 把 linkedom 指给 core 的 L3 断言，那一层只需要静态树遍历。
    environment: 'happy-dom',
    // 与 packages/core 同样接上计划一的离线门（Task 31）。
    setupFiles: ['../../test/setup/no-network.ts'],
    chaiConfig: {
      truncateThreshold: 0,
    },
  },
})
```

`packages/editor/src/types.ts`（P2 逐字）：

```ts
export type EditorKind = 'codemirror' | 'plain'

export interface EditorOptions {
  parent: HTMLElement
  /** CodeMirror 需要它做样式注入；plain 档忽略。 */
  root: ShadowRoot | Document
  value: string
  onChange(value: string): void
  /** topLine 是 0 基的首个可见源码行，供滚动同步用。 */
  onScroll(topLine: number): void
}

export interface Editor {
  setValue(value: string): void
  getValue(): string
  focus(): void
  /** 0 基的首个可见源码行。 */
  topLine(): number
  scrollToLine(line: number): void
  destroy(): void
}
```

`packages/editor/src/plain.ts`：

```ts
import type { Editor, EditorOptions } from './types.js'

/**
 * 软换行会让「视觉行」与「源码行」不再一一对应，而 topLine()/scrollToLine()
 * 的契约说的是**源码行**。plain 档因此强制 wrap="off"：这不是样式偏好，
 * 是让滚动同步在这一档有定义。CodeMirror 档不需要这条——它的 posAtCoords()
 * 把视觉坐标映回文档位置，软换行不影响行号。
 */
const WRAP = 'off'

/**
 * getComputedStyle(...).lineHeight 有两种拿不到数字的情况：值是 'normal'，
 * 或宿主环境根本没有排版（离线单元测试）。这时用常量兜底，让 topLine()
 * 仍然是确定的全序函数，而不是 NaN。
 */
export const FALLBACK_LINE_HEIGHT = 20

/** 纯函数，供离线单元测试直接钉住行数学。 */
export function topLineFromScroll(scrollTop: number, lineHeight: number, lineCount: number): number {
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return 0
  if (!Number.isFinite(scrollTop)) return 0
  const raw = Math.floor(scrollTop / lineHeight)
  const max = Math.max(lineCount - 1, 0)
  return Math.min(Math.max(raw, 0), max)
}

export function createPlainEditor(opts: EditorOptions): Editor {
  const doc = opts.parent.ownerDocument
  const ta = doc.createElement('textarea')
  ta.className = 'readit-plain-editor'
  ta.setAttribute('wrap', WRAP)
  ta.spellcheck = false
  ta.value = opts.value
  opts.parent.append(ta)

  let composing = false
  let deferred: string | null = null
  let destroyed = false

  const lineCount = (): number => ta.value.split('\n').length

  const lineHeight = (): number => {
    const view = doc.defaultView
    if (view === null) return FALLBACK_LINE_HEIGHT
    const parsed = Number.parseFloat(view.getComputedStyle(ta).lineHeight)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_LINE_HEIGHT
  }

  const currentTopLine = (): number => topLineFromScroll(ta.scrollTop, lineHeight(), lineCount())

  const onInput = (): void => {
    opts.onChange(ta.value)
  }
  const onScrollEvent = (): void => {
    opts.onScroll(currentTopLine())
  }
  const onCompositionStart = (): void => {
    composing = true
  }
  const onCompositionEnd = (): void => {
    composing = false
    if (deferred !== null) {
      ta.value = deferred
      deferred = null
    }
  }

  ta.addEventListener('input', onInput)
  ta.addEventListener('scroll', onScrollEvent)
  ta.addEventListener('compositionstart', onCompositionStart)
  ta.addEventListener('compositionend', onCompositionEnd)

  return {
    setValue(value) {
      // 组合期间写 textarea.value 会把输入法的预编辑串连同状态一起冲掉。
      // 攒着，compositionend 再落地——丢弃比推迟更糟，那是静默的数据丢失。
      if (composing) {
        deferred = value
        return
      }
      if (ta.value !== value) ta.value = value
    },
    getValue() {
      return ta.value
    },
    focus() {
      ta.focus()
    },
    topLine() {
      return currentTopLine()
    },
    scrollToLine(line) {
      const clamped = Math.min(Math.max(line, 0), Math.max(lineCount() - 1, 0))
      ta.scrollTop = clamped * lineHeight()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      ta.removeEventListener('input', onInput)
      ta.removeEventListener('scroll', onScrollEvent)
      ta.removeEventListener('compositionstart', onCompositionStart)
      ta.removeEventListener('compositionend', onCompositionEnd)
      ta.remove()
    },
  }
}
```

`packages/editor/src/index.ts`：

```ts
export type { Editor, EditorKind, EditorOptions } from './types.js'
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit && npm install
npx vitest run packages/editor/test/plain.test.ts
npm run typecheck
```

预期 12 个用例全绿，`npm run typecheck` 零错误（`--workspaces` 会自动带上新包，因为它有 `typecheck` 脚本）。

- [ ] **Step 5: 提交**

```bash
cd /Users/mac08/Desktop/robot/readit
git add packages/editor package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(editor): P2 契约 + plain 档（textarea）

先做 plain 是因为它简单，且它把契约钉住——CodeMirror 随后必须符合同一个
Editor 接口。契约用例表放在 test/contract.ts，不依赖断言库：Task 17 要在
Playwright 的页面里跑同一张表，引进 vitest 的 expect 会把它拖进浏览器 bundle。

两条不是样式偏好的实现决定：
· textarea 强制 wrap="off"。软换行让「视觉行」与「源码行」不再一一对应，
  而 topLine()/scrollToLine() 的契约说的是源码行。
· 组合期间的 setValue 攒到 compositionend 再落地，不是丢弃。写 value 会
  冲掉输入法的预编辑串——丢弃比推迟更糟，那是静默的数据丢失。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

---

### Task 14: CodeMirror 实现 + `createEditor` 动态 import 边界

**Files:**
- Create: `packages/editor/src/codemirror.ts`
- Create: `packages/editor/test/module-boundary.test.ts`
- Modify: `packages/editor/src/index.ts`（Task 13 的 1 行，替换为下面的完整内容）
- Modify: `packages/editor/package.json`（加 `dependencies` 块）
- Test: `packages/editor/test/module-boundary.test.ts`

**Interfaces:**
- Consumes: Task 13 的 `packages/editor/src/types.ts`（`Editor` / `EditorOptions` / `EditorKind`）、`packages/editor/src/plain.ts` 的 `createPlainEditor(opts: EditorOptions): Editor`
- Produces: `packages/editor/src/index.ts` 的 `createEditor(kind: EditorKind, opts: EditorOptions): Promise<Editor>`（P2 的工厂，从此 `@readit/editor` 的 `.` 入口只导出它和三个类型）；`packages/editor/src/codemirror.ts` 的 `createCodeMirrorEditor(opts: EditorOptions): Editor`（内部，只被 `index.ts` 的动态 import 引用）

---

- [ ] **Step 1: 写会失败的测试**

CodeMirror 需要真排版，离线测不了它的行为——那部分归 Task 17 的 Playwright。这里离线能测、且必须测的是**结构**：`.` 入口不得静态 import 任何 `@codemirror/*`，否则「首次切进 source 才付 176,654 B」这句话是假的，而这件事在开发机上永远不会以 bug 的形式暴露。

`packages/editor/test/module-boundary.test.ts`：

```ts
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

function parse(rel: string): ts.SourceFile {
  return ts.createSourceFile(rel, read(rel), ts.ScriptTarget.ES2023, true)
}

/** 顶层的、会在运行时产生一条边的 import（`import type` 不算）。 */
function staticRuntimeImports(sf: ts.SourceFile): string[] {
  const out: string[] = []
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue
    if (stmt.importClause?.isTypeOnly === true) continue
    if (ts.isStringLiteral(stmt.moduleSpecifier)) out.push(stmt.moduleSpecifier.text)
  }
  return out
}

function dynamicImports(sf: ts.SourceFile): string[] {
  const out: string[] = []
  const walk = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      const arg = node.arguments[0]
      if (arg !== undefined && ts.isStringLiteral(arg)) out.push(arg.text)
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return out
}

describe('@readit/editor 的 . 入口没有任何静态运行时 import', () => {
  const index = parse('../src/index.ts')

  it('index.ts 的顶层 import 全是 type-only', () => {
    expect(staticRuntimeImports(index)).toEqual([])
  })

  it('两个实现都只经由 import() 到达', () => {
    expect(dynamicImports(index).sort()).toEqual(['./codemirror.js', './plain.js'])
  })

  it('index.ts / types.ts / plain.ts 的源码里出现不了 @codemirror', () => {
    for (const rel of ['../src/index.ts', '../src/types.ts', '../src/plain.ts']) {
      expect(read(rel), `${rel} 不得提到 @codemirror`).not.toContain('@codemirror')
    }
  })

  it('codemirror.ts 是唯一 import @codemirror/* 的文件', () => {
    const specs = staticRuntimeImports(parse('../src/codemirror.ts'))
    expect(specs.filter((s) => s.startsWith('@codemirror/')).sort()).toEqual([
      '@codemirror/commands',
      '@codemirror/lang-markdown',
      '@codemirror/language',
      '@codemirror/state',
      '@codemirror/view',
    ])
  })
})

describe('style-mod 的解析版本 ≥ 4.1.2', () => {
  /**
   * SPEC §5 把 style-mod >=4.1.2 单独列进 @readit/editor 的关键依赖，
   * 理由是同页两个实例的样式注入 bug 只在低版本上现形，而它是
   * @codemirror/view 的传递依赖——直接依赖不写死，装到哪个版本全看运气。
   * 这里断言的是 @codemirror/view **自己**解析到的那份，不是被提升的那份。
   */
  it('从 @codemirror/view 的解析路径看过去也满足', () => {
    const here = createRequire(import.meta.url)
    const viewEntry = here.resolve('@codemirror/view')
    const fromView = createRequire(viewEntry)
    const pkgPath = fromView.resolve('style-mod/package.json')
    const version = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version
    const cmp = (a: string, b: string): number => {
      const pa = a.split('.').map(Number)
      const pb = b.split('.').map(Number)
      for (let i = 0; i < 3; i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0)
        if (d !== 0) return d
      }
      return 0
    }
    expect(cmp(version, '4.1.2'), `style-mod resolved to ${version}`).toBeGreaterThanOrEqual(0)
  })
})
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd /Users/mac08/Desktop/robot/readit && npx vitest run packages/editor/test/module-boundary.test.ts
```

预期四条红：`dynamicImports` 返回 `[]`（index.ts 目前只有一行 `export type`），
`../src/codemirror.ts` 读取时抛 `ENOENT`，`style-mod` 解析抛
`Cannot find module '@codemirror/view'`。

- [ ] **Step 3: 写最小实现**

`packages/editor/package.json` 里加（`devDependencies` 保持 Task 13 的内容不变）：

```json
  "dependencies": {
    "@codemirror/commands": "6.10.4",
    "@codemirror/lang-markdown": "6.5.2",
    "@codemirror/language": "6.12.4",
    "@codemirror/state": "6.7.1",
    "@codemirror/view": "6.43.8",
    "style-mod": "4.1.2"
  },
```

`packages/editor/src/codemirror.ts`：

```ts
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import type { Editor, EditorOptions } from './types.js'

/**
 * 首个可见源码行。走 posAtCoords 而不是「scrollTop / 行高」：CodeMirror 的
 * 视口是虚拟化的，行高也不是常数（软换行、行内 widget），只有把视觉坐标交回
 * 给它、让它映射成文档位置才是对的。这也是 plain 档必须关软换行、而这一档
 * 不必的原因。
 */
function topLineOf(view: EditorView): number {
  const rect = view.scrollDOM.getBoundingClientRect()
  const pos = view.posAtCoords({ x: rect.left + 1, y: rect.top + 1 }, false)
  return view.state.doc.lineAt(pos).number - 1
}

export function createCodeMirrorEditor(opts: EditorOptions): Editor {
  let applying = false
  let deferred: string | null = null
  let destroyed = false

  const view: EditorView = new EditorView({
    parent: opts.parent,
    // 官方支持 ShadowRoot；new EditorView({parent}) 本来也会自行推断，
    // 这里显式传是因为 P2 的 EditorOptions 里有它，别让两条信息各说各话。
    root: opts.root,
    state: EditorState.create({
      doc: opts.value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          // applying 为真时这次变更是 setValue 自己派的，不是用户输入。
          if (update.docChanged && !applying) opts.onChange(update.state.doc.toString())
        }),
        EditorView.domEventHandlers({
          scroll: () => {
            if (!destroyed) opts.onScroll(topLineOf(view))
          },
        }),
      ],
    }),
  })

  const applyDeferred = (): void => {
    if (deferred === null || view.composing) return
    const next = deferred
    deferred = null
    write(next)
  }

  const write = (value: string): void => {
    if (view.state.doc.toString() === value) return
    applying = true
    try {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    } finally {
      applying = false
    }
  }

  // view.composing 只在组合进行中为真；compositionend 之后把攒下的写入放行。
  view.contentDOM.addEventListener('compositionend', applyDeferred)

  return {
    setValue(value) {
      if (destroyed) return
      if (view.composing) {
        deferred = value
        return
      }
      write(value)
    },
    getValue() {
      return view.state.doc.toString()
    },
    focus() {
      view.focus()
    },
    topLine() {
      return topLineOf(view)
    },
    scrollToLine(line) {
      const n = Math.min(Math.max(line + 1, 1), view.state.doc.lines)
      const info = view.state.doc.line(n)
      view.dispatch({ effects: EditorView.scrollIntoView(info.from, { y: 'start' }) })
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      view.contentDOM.removeEventListener('compositionend', applyDeferred)
      view.destroy()
    },
  }
}
```

`packages/editor/src/index.ts`（整份替换）：

```ts
import type { Editor, EditorKind, EditorOptions } from './types.js'

export type { Editor, EditorKind, EditorOptions } from './types.js'

/**
 * 两个实现都走 import()，`.` 入口因此没有任何静态运行时依赖。
 * codemirror 档一次性 176,654 B（SPEC §5.1 实测），只有真正切进
 * source / split 的宿主该付；plain 档虽然同步可得，也走 import() ——
 * 让两条路径同形，边界就由结构保证而不是由纪律保证。
 * test/module-boundary.test.ts 用 TypeScript 编译器 API 钉住这件事。
 */
export async function createEditor(kind: EditorKind, opts: EditorOptions): Promise<Editor> {
  if (kind === 'plain') {
    const { createPlainEditor } = await import('./plain.js')
    return createPlainEditor(opts)
  }
  const { createCodeMirrorEditor } = await import('./codemirror.js')
  return createCodeMirrorEditor(opts)
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit && npm install
npx vitest run packages/editor
npm run typecheck
```

预期：`module-boundary.test.ts` 5 条 + `plain.test.ts` 12 条全绿。

- [ ] **Step 5: 提交**

```bash
cd /Users/mac08/Desktop/robot/readit
git add packages/editor package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(editor): CodeMirror 实现 + createEditor 的动态 import 边界

createEditor 的两条分支都走 import()，`.` 入口零静态运行时依赖。这条不是
注释，是 test/module-boundary.test.ts 用 TypeScript 编译器 API 断言的：
index.ts 的顶层 import 必须全是 type-only，@codemirror/* 只许出现在
codemirror.ts 里。开发机上「其实是急加载」这种事不会以 bug 的形式暴露，
只会以 176,654 B 的形式暴露给宿主。

style-mod 的版本从 @codemirror/view 自己的解析路径断言 ≥4.1.2，不是从被
提升的那份——SPEC §5 单列它的理由是同页两实例的注入 bug 只在低版本现形。

topLine() 走 posAtCoords 而不是 scrollTop/行高：视口是虚拟化的，行高不是
常数。CodeMirror 档因此可以开软换行，plain 档不行。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

---

### Task 15: 重渲染策略——防抖 + rAF 批处理 + 新构造探测，防抖间隔由实测钉死

**Files:**
- Create: `packages/element/src/rerender.ts`
- Create: `packages/element/test/rerender.test.ts`
- Create: `packages/element/test/rerender-debounce.test.ts`
- Test: `packages/element/test/rerender.test.ts`、`packages/element/test/rerender-debounce.test.ts`

**Interfaces:**
- Consumes: `@readit/core` 的 `render(src: string, opts?: Partial<RenderOptions>): string`、`scan(src: string, inlineMath: InlineMathMode): ScanResult`、`prepare(src: string, opts?: Partial<RenderOptions>, loaders?: Loaders): Promise<RenderOptions>`、`DEFAULT_LOADERS`，以及类型 `Highlighter` / `InlineMathMode` / `MathRenderer` / `RenderOptions` / `ScanResult`（全部已从 core 的 `.` 导出）；`packages/element/package.json` 已把 `@readit/core` 列为 dependency（M3 段建立）
- Produces:
  - `packages/element/src/rerender.ts`：`DEBOUNCE_MS: 16`、`type PendingCapability = 'math' | 'highlight'`、`interface RerenderHost { paint(html: string): void; setPending(pending: readonly PendingCapability[]): void }`、`interface RerenderDeps`（见下）、`interface Rerenderer { update(value: string): void; setValue(value: string): void; repaint(): void; destroy(): void }`、`createRerenderer(host: RerenderHost, deps: RerenderDeps, options: Partial<RenderOptions>, initialValue: string): Rerenderer`、`browserDeps(loadHighlighter: (() => Promise<Highlighter>) | null): RerenderDeps`

---

- [ ] **Step 1: 写会失败的测试**

`packages/element/test/rerender.test.ts`：

```ts
import { render, scan, prepare } from '@readit/core'
import type { Highlighter, MathRenderer, RenderOptions } from '@readit/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEBOUNCE_MS,
  createRerenderer,
  type PendingCapability,
  type RerenderDeps,
  type RerenderHost,
} from '../src/rerender.js'

/** 假时钟 + 假帧。真实实现是 setTimeout / requestAnimationFrame。 */
function harness() {
  const timers = new Map<number, { fn: () => void; ms: number }>()
  const frames = new Map<number, () => void>()
  let next = 1
  const painted: string[] = []
  const pending: PendingCapability[][] = []

  const host: RerenderHost = {
    paint(html) {
      painted.push(html)
    },
    setPending(p) {
      pending.push([...p])
    },
  }

  const loadHighlighter = vi.fn(
    async (): Promise<Highlighter> => ({
      highlight: (code) => `<span class="fake">${code}</span>`,
      supports: () => true,
    }),
  )

  const fakeMath: MathRenderer = { render: (tex, display) => `<i data-d="${String(display)}">${tex}</i>` }
  const prepareSpy = vi.fn(
    async (src: string, opts: Partial<RenderOptions>): Promise<RenderOptions> =>
      prepare(src, opts, {
        math: () => Promise.resolve({ createMathRenderer: () => fakeMath }),
        highlighter: null,
      }),
  )

  const deps: RerenderDeps = {
    render,
    scan,
    prepare: prepareSpy,
    loadHighlighter,
    setTimer(fn, ms) {
      const id = next++
      timers.set(id, { fn, ms })
      return id
    },
    clearTimer(id) {
      timers.delete(id)
    },
    requestFrame(fn) {
      const id = next++
      frames.set(id, fn)
      return id
    },
    cancelFrame(id) {
      frames.delete(id)
    },
  }

  return {
    host,
    deps,
    painted,
    pending,
    prepareSpy,
    loadHighlighter,
    timerCount: () => timers.size,
    frameCount: () => frames.size,
    runTimers() {
      const due = [...timers.values()]
      timers.clear()
      for (const t of due) t.fn()
    },
    runFrames() {
      const due = [...frames.values()]
      frames.clear()
      for (const f of due) f()
    },
  }
}

describe('输入 → 防抖 → rAF 批处理 → 整体重渲', () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })

  it('一个防抖窗口内的三次输入只渲一次', () => {
    const r = createRerenderer(h.host, h.deps, {}, 'a')
    r.update('ab')
    r.update('abc')
    r.update('abcd')
    expect(h.painted).toHaveLength(0)
    h.runTimers()
    h.runFrames()
    expect(h.painted).toHaveLength(1)
    expect(h.painted[0]).toContain('abcd')
    r.destroy()
  })

  it('防抖计时器用的是 DEBOUNCE_MS', () => {
    const seen: number[] = []
    const deps: RerenderDeps = {
      ...h.deps,
      setTimer(fn, ms) {
        seen.push(ms)
        return h.deps.setTimer(fn, ms)
      },
    }
    const r = createRerenderer(h.host, deps, {}, 'a')
    r.update('b')
    expect(seen).toEqual([DEBOUNCE_MS])
    r.destroy()
  })

  it('计时器到点只是排一帧，渲染发生在帧回调里', () => {
    const r = createRerenderer(h.host, h.deps, {}, 'a')
    r.update('b')
    h.runTimers()
    expect(h.painted).toHaveLength(0)
    expect(h.frameCount()).toBe(1)
    h.runFrames()
    expect(h.painted).toHaveLength(1)
    r.destroy()
  })

  it('setValue() 绕开防抖与帧，立刻渲一次', () => {
    const r = createRerenderer(h.host, h.deps, {}, 'a')
    r.setValue('# H')
    expect(h.painted).toHaveLength(1)
    expect(h.painted[0]).toContain('<h1')
    r.destroy()
  })
})

describe('新构造探测：第一次敲出 $', () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })

  it('没有 $ 的文档不 kick prepare()', () => {
    const r = createRerenderer(h.host, h.deps, {}, 'plain text')
    r.repaint()
    expect(h.prepareSpy).not.toHaveBeenCalled()
    expect(h.pending.at(-1)).toEqual([])
    r.destroy()
  })

  it('敲出 $ 后 kick 一次，且加载期间照样渲——降级可见，不是空白也不抛错', () => {
    const r = createRerenderer(h.host, h.deps, {}, 'plain text')
    r.setValue('a $x^2$ b')
    expect(h.prepareSpy).toHaveBeenCalledTimes(1)
    expect(h.pending.at(-1)).toEqual(['math'])
    // 这就是「降级必须可见」的具体形态：math 还没到，core 发的是一个装着
    // 字面 TeX 的 <math-renderer>，读者看得见 $x^2$，而不是空白或异常。
    expect(h.painted).toHaveLength(1)
    expect(h.painted[0]).toContain('<math-renderer class="js-inline-math"')
    expect(h.painted[0]).toContain('$x^2$')
    r.destroy()
  })

  it('prepare() 落地后自动再渲一次，这次带上 math，pending 清空', async () => {
    const r = createRerenderer(h.host, h.deps, {}, 'plain text')
    r.setValue('a $x^2$ b')
    await vi.waitFor(() => {
      expect(h.painted).toHaveLength(2)
    })
    expect(h.painted[1]).toContain('<i data-d="false">x^2</i>')
    expect(h.pending.at(-1)).toEqual([])
    r.destroy()
  })

  it('加载在途时的连续输入不会重复 kick', () => {
    const r = createRerenderer(h.host, h.deps, {}, '')
    r.setValue('$a$')
    r.setValue('$ab$')
    r.setValue('$abc$')
    expect(h.prepareSpy).toHaveBeenCalledTimes(1)
    r.destroy()
  })

  it('加载失败的能力不重试，pending 一直报着它——失败也必须可见', async () => {
    const failing: RerenderDeps = {
      ...h.deps,
      prepare: vi.fn(() => Promise.reject(new Error('offline'))),
    }
    const r = createRerenderer(h.host, failing, {}, '')
    r.setValue('$a$')
    await vi.waitFor(() => {
      expect(failing.prepare).toHaveBeenCalledTimes(1)
    })
    r.setValue('$ab$')
    expect(failing.prepare).toHaveBeenCalledTimes(1)
    expect(h.pending.at(-1)).toEqual(['math'])
    r.destroy()
  })

  it('宿主没给高亮加载器时，围栏语言不算 pending——那是宿主的选择，不是加载中', () => {
    const noLoader: RerenderDeps = { ...h.deps, loadHighlighter: null }
    const r = createRerenderer(h.host, noLoader, {}, '')
    r.setValue('```js\nlet a=1\n```\n')
    expect(h.pending.at(-1)).toEqual([])
    r.destroy()
  })

  it('宿主给了高亮加载器时，第一次用到某围栏语言会 kick 它', async () => {
    const r = createRerenderer(h.host, h.deps, {}, '')
    r.setValue('```js\nlet a=1\n```\n')
    expect(h.pending.at(-1)).toEqual(['highlight'])
    expect(h.loadHighlighter).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(h.painted.at(-1)).toContain('<span class="fake">')
    })
    r.destroy()
  })
})

describe('destroy()', () => {
  it('取消未到点的计时器与未跑的帧，且迟到的加载不再落笔', async () => {
    const h = harness()
    let resolveLate: ((h: Highlighter) => void) | null = null
    const late: RerenderDeps = {
      ...h.deps,
      loadHighlighter: () =>
        new Promise<Highlighter>((res) => {
          resolveLate = res
        }),
    }
    const r = createRerenderer(h.host, late, {}, '')
    r.setValue('```js\nx\n```\n')
    r.update('```js\ny\n```\n')
    expect(h.timerCount()).toBe(1)
    r.destroy()
    expect(h.timerCount()).toBe(0)
    expect(h.frameCount()).toBe(0)
    const before = h.painted.length
    resolveLate?.({ highlight: () => '<b>x</b>', supports: () => true })
    await Promise.resolve()
    await Promise.resolve()
    expect(h.painted).toHaveLength(before)
  })
})
```

`packages/element/test/rerender-debounce.test.ts`——**这条测试就是 DEBOUNCE_MS 的来源**：

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { render } from '@readit/core'
import { describe, expect, it } from 'vitest'
import { DEBOUNCE_MS } from '../src/rerender.js'

/**
 * 「按 p95 定」这句话在这里有确切含义：对 corpus/real-world/ 全部 6 个文件
 * 各跑 RUNS 次 render()，把 6*RUNS 个样本合成一个分布，取它的 p95 记作 T，
 * 防抖间隔取 max(ceil(T), 16)（16ms 是一帧，低于一帧的防抖没有意义）。
 *
 * 2026-08-09 实测（Darwin 25.5.0 / Node 22.23.1 / 去掉每文件前 WARMUP 次）：
 *   gitignore 1.41 · hast-util-sanitize 2.45 · markdown-it 0.35
 *   mermaid 3.72 · sindresorhus-is 2.45 · tauri 1.07   （各自 p95，ms）
 *   合并 600 样本：p50 1.18 · p95 2.75 · p99 3.75
 * 所以 T=2.75 → max(3, 16) = 16。
 *
 * 这条断言会随代码变慢而变红。**变红时先上报，不要重钉这个数**——把
 * DEBOUNCE_MS 从 16 改成 40 是把「渲染慢了 14 倍」这件事记成了一个常数。
 */
const CORPUS = new URL('../../core/test/corpus/real-world/', import.meta.url)
const RUNS = 100
const WARMUP = 10

const FILES = readdirSync(CORPUS)
  .filter((f) => f.endsWith('.md'))
  .sort()

function percentile(samples: readonly number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const idx = Math.min(Math.max(Math.ceil(q * sorted.length) - 1, 0), sorted.length - 1)
  return sorted[idx] ?? 0
}

describe('防抖间隔是量出来的，不是猜的', () => {
  it('样本集就是 real-world 语料的那 6 个文件，一个不多一个不少', () => {
    // 换了样本集，上面那个 p95 就换了含义。钉住它，让换样本变成一次显式修改。
    expect(FILES).toEqual([
      'gitignore.md',
      'hast-util-sanitize.md',
      'markdown-it.md',
      'mermaid.md',
      'sindresorhus-is.md',
      'tauri.md',
    ])
  })

  it('全部样本的 p95 仍低于一帧，所以 DEBOUNCE_MS 仍是 16', () => {
    const samples: number[] = []
    for (const file of FILES) {
      const src = readFileSync(new URL(file, CORPUS), 'utf8')
      for (let i = 0; i < RUNS; i++) {
        const t0 = performance.now()
        render(src)
        const t1 = performance.now()
        if (i >= WARMUP) samples.push(t1 - t0)
      }
    }
    expect(samples).toHaveLength(FILES.length * (RUNS - WARMUP))

    const p95 = percentile(samples, 0.95)
    const derived = Math.max(Math.ceil(p95), 16)
    expect(
      derived,
      `measured p95 = ${p95.toFixed(2)} ms over ${String(samples.length)} samples; ` +
        `debounce should be max(ceil(p95), 16) = ${String(derived)} ms. ` +
        `If this is red because render() got slower, report the regression — do not re-pin the constant.`,
    ).toBe(DEBOUNCE_MS)
  })
})
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd /Users/mac08/Desktop/robot/readit && npx vitest run packages/element/test/rerender.test.ts packages/element/test/rerender-debounce.test.ts
```

预期：两份文件都因 `Failed to resolve import "../src/rerender.js"` 而整体失败。

- [ ] **Step 3: 写最小实现**

`packages/element/src/rerender.ts`：

```ts
import { DEFAULT_LOADERS, prepare as corePrepare, render as coreRender, scan as coreScan } from '@readit/core'
import type { Highlighter, InlineMathMode, RenderOptions, ScanResult } from '@readit/core'

/**
 * 防抖间隔（ms）。这个 16 不是猜的，来源是
 * test/rerender-debounce.test.ts：corpus/real-world/ 全部 6 个文件各跑 100 次
 * render()，合并样本的 p95 记作 T，间隔取 max(ceil(T), 16)。2026-08-09 实测
 * T = 2.75 ms，远低于一帧，所以取一帧。那条测试会在 T 涨过 16 时变红——
 * 它是这个常数的来源，不是它的注解。
 */
export const DEBOUNCE_MS = 16

/** 还缺、且还有可能补上的能力。渲染仍然照常发生，只是降级。 */
export type PendingCapability = 'math' | 'highlight'

export interface RerenderHost {
  /** 把整块 HTML 写进 DOM。element 只有一条注入路径（setHtml），由调用方接进来。 */
  paint(html: string): void
  /**
   * 降级必须可见（SPEC §12）：把「仍然缺席」的能力名交给宿主，由它落成
   * 宿主元素上的 data-readit-pending。空数组表示都到齐了。
   * 加载失败的能力也留在这个列表里——静默的永久降级比慢更糟。
   */
  setPending(pending: readonly PendingCapability[]): void
}

export interface RerenderDeps {
  render(src: string, opts: Partial<RenderOptions>): string
  scan(src: string, inlineMath: InlineMathMode): ScanResult
  /** core 的 prepare()：渲染路径上唯一一处 await，数学的动态加载走它。 */
  prepare(src: string, opts: Partial<RenderOptions>): Promise<RenderOptions>
  /**
   * 高亮加载器。P1 不许 @readit/element 在运行时 import @readit/highlight，
   * 所以这条只能由宿主注入；null 表示宿主根本没打算要高亮——那不是「加载中」，
   * 是一个已经完成的选择，不该报进 pending。
   */
  loadHighlighter: (() => Promise<Highlighter>) | null
  setTimer(fn: () => void, ms: number): number
  clearTimer(handle: number): void
  requestFrame(fn: () => void): number
  cancelFrame(handle: number): void
}

export interface Rerenderer {
  /** 用户输入路径：防抖 → rAF 批处理 → 整体重渲。 */
  update(value: string): void
  /** 换文档：立刻同步渲一次，绕开防抖与帧。 */
  setValue(value: string): void
  /** 用当前 value 立刻渲一次（切模式、能力到货后走这条）。 */
  repaint(): void
  destroy(): void
}

/** 浏览器里的真实 deps。loadHighlighter 由宿主给，其余全是标准 API 与 core 的导出。 */
export function browserDeps(loadHighlighter: (() => Promise<Highlighter>) | null): RerenderDeps {
  return {
    render: (src, opts) => coreRender(src, opts),
    scan: (src, inlineMath) => coreScan(src, inlineMath),
    prepare: (src, opts) => corePrepare(src, opts, DEFAULT_LOADERS),
    loadHighlighter,
    setTimer: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
    clearTimer: (handle) => {
      globalThis.clearTimeout(handle)
    },
    requestFrame: (fn) => globalThis.requestAnimationFrame(fn),
    cancelFrame: (handle) => {
      globalThis.cancelAnimationFrame(handle)
    },
  }
}

export function createRerenderer(
  host: RerenderHost,
  deps: RerenderDeps,
  options: Partial<RenderOptions>,
  initialValue: string,
): Rerenderer {
  const inlineMath: InlineMathMode = options.inlineMath ?? 'github'
  let value = initialValue
  let math = options.math ?? null
  let highlighter = options.highlighter ?? null
  const inflight = new Set<PendingCapability>()
  const failed = new Set<PendingCapability>()
  let timer: number | null = null
  let frame: number | null = null
  let destroyed = false

  const missing = (found: ScanResult): PendingCapability[] => {
    const out: PendingCapability[] = []
    if (found.needsMath && math === null) out.push('math')
    if (found.needsHighlight && highlighter === null && deps.loadHighlighter !== null) out.push('highlight')
    return out
  }

  const kick = (want: readonly PendingCapability[]): void => {
    for (const cap of want) {
      if (inflight.has(cap) || failed.has(cap)) continue
      inflight.add(cap)
      const done = (ok: () => void): void => {
        inflight.delete(cap)
        if (destroyed) return
        ok()
        paint()
      }
      const fail = (): void => {
        inflight.delete(cap)
        failed.add(cap)
        if (!destroyed) host.setPending(missing(deps.scan(value, inlineMath)))
      }
      if (cap === 'math') {
        void deps.prepare(value, { ...options, math, highlighter }).then((resolved) => {
          done(() => {
            math = resolved.math
          })
        }, fail)
      } else {
        const load = deps.loadHighlighter
        if (load === null) continue
        void load().then((h) => {
          done(() => {
            highlighter = h
          })
        }, fail)
      }
    }
  }

  /** 一次完整重渲。**先落笔，再 kick**——降级的那一帧必须先出现在屏幕上。 */
  const paint = (): void => {
    if (destroyed) return
    const found = deps.scan(value, inlineMath)
    const want = missing(found)
    host.setPending(want)
    host.paint(deps.render(value, { ...options, math, highlighter }))
    if (want.length > 0) kick(want)
  }

  const cancelPending = (): void => {
    if (timer !== null) {
      deps.clearTimer(timer)
      timer = null
    }
    if (frame !== null) {
      deps.cancelFrame(frame)
      frame = null
    }
  }

  return {
    update(next) {
      if (destroyed) return
      value = next
      if (timer !== null) deps.clearTimer(timer)
      timer = deps.setTimer(() => {
        timer = null
        if (frame !== null) return
        frame = deps.requestFrame(() => {
          frame = null
          paint()
        })
      }, DEBOUNCE_MS)
    },
    setValue(next) {
      if (destroyed) return
      value = next
      cancelPending()
      paint()
    },
    repaint() {
      if (destroyed) return
      cancelPending()
      paint()
    },
    destroy() {
      destroyed = true
      cancelPending()
    },
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit
npx vitest run packages/element/test/rerender.test.ts packages/element/test/rerender-debounce.test.ts
npm run typecheck
npm test
```

预期：`rerender.test.ts` 13 条、`rerender-debounce.test.ts` 2 条全绿；`npm test`
的总数从 2318 变为 2318 + 本批新增，**既有 2318 条一条不少、语料仍 56/68、
CommonMark 649+3、GFM 658+14、TEMPORARY 0**（P6）。

- [ ] **Step 5: 提交**

```bash
cd /Users/mac08/Desktop/robot/readit
git add packages/element/src/rerender.ts packages/element/test/rerender.test.ts packages/element/test/rerender-debounce.test.ts
git commit -m "$(cat <<'EOF'
feat(element): 重渲染策略——防抖 + rAF 批处理 + 新构造探测

增量重渲在架构上不可能（render() 返回整块字符串），所以走
输入 → 防抖 → requestAnimationFrame → 整体 render()。每次重渲前跑
core 的 scan()，检测第一次敲出 $ / 第一次用到某围栏语言；有就异步 kick，
**先落笔再 kick**——降级的那一帧必须先上屏。降级形态是可断言的：math 未到
时 core 发的是装着字面 $x^2$ 的 <math-renderer>，不是空白也不是异常。

防抖间隔没有猜。test/rerender-debounce.test.ts 对 corpus/real-world/ 的
6 个文件各跑 100 次 render()（去掉每文件前 10 次预热），取合并 600 样本的
p95 = 2.75ms，间隔取 max(ceil(p95), 16) = 16。那条断言会随代码变慢而变红，
且写明了变红时先上报、不要重钉常数。这个项目已经因猜数字栽过两次。

高亮加载器由宿主注入而不是 element 自己 import——P1 不许 element 在运行时
依赖 @readit/highlight。宿主没给就不算 pending：那是一个已完成的选择，
不是加载中。加载失败的能力留在 pending 列表里，永久降级也必须可见。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

---

### Task 16: 滚动同步 + 原生 HTML 块的锚点合成

**Files:**
- Create: `packages/element/src/scroll/html-anchors.ts`
- Create: `packages/element/src/scroll/anchors.ts`
- Create: `packages/element/src/scroll/sync.ts`
- Create: `packages/element/test/html-anchors.test.ts`
- Create: `packages/element/test/scroll-sync.test.ts`
- Test: `packages/element/test/html-anchors.test.ts`、`packages/element/test/scroll-sync.test.ts`

**Interfaces:**
- Consumes: `@readit/core` 的 `render(src, opts?)`；`packages/element/vitest.config.ts` 的 `environment: 'happy-dom'`（M3 段建立，若尚未设定则本任务连同 `happy-dom@20.11.2` 一并加进 `packages/element` 的 devDependencies 与 vitest 配置）
- Produces:
  - `packages/element/src/scroll/html-anchors.ts`：`interface HtmlBlock { line: number; source: string }`、`scanHtmlBlocks(src: string): HtmlBlock[]`、`synthesizeHtmlAnchors(content: Element, src: string): number`、`LINE_ATTR: 'data-line'`、`SYNTHETIC_ATTR: 'data-line-synthetic'`、`COLLAPSED_ATTR: 'data-line-collapsed'`
  - `packages/element/src/scroll/anchors.ts`：`interface Anchor { readonly line: number; readonly top: number }`、`type MeasureTop = (el: Element) => number`、`collectAnchors(content: Element, measure: MeasureTop): Anchor[]`、`lineToTop(anchors, line, contentHeight, lineCount): number`、`topToLine(anchors, top, contentHeight, lineCount): number`
  - `packages/element/src/scroll/sync.ts`：`interface ScrollSource { topLine(): number; scrollToLine(line: number): void }`、`interface ScrollSyncOptions`、`interface ScrollSync { fromEditor(topLine: number): void; fromPreview(): void; invalidate(): void; destroy(): void }`、`createScrollSync(opts: ScrollSyncOptions): ScrollSync`

**这一层没有 oracle。** `data-line` 被归一化器的 `dropDataLine` 剥掉（`packages/core/test/normalize.ts:134`），所以它的正确性对语料套件**完全不可见**。下面这两份测试是唯一能证伪它的东西。

---

- [ ] **Step 1: 写会失败的测试**

`packages/element/test/html-anchors.test.ts`：

```ts
import { readFileSync } from 'node:fs'
import { render } from '@readit/core'
import { describe, expect, it } from 'vitest'
import {
  COLLAPSED_ATTR,
  LINE_ATTR,
  SYNTHETIC_ATTR,
  scanHtmlBlocks,
  synthesizeHtmlAnchors,
} from '../src/scroll/html-anchors.js'

const CORPUS = new URL('../../core/test/corpus/real-world/', import.meta.url)
const corpus = (name: string): string => readFileSync(new URL(name, CORPUS), 'utf8')

function mountRendered(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  document.body.append(el)
  return el
}

const topLines = (content: Element): (string | null)[] =>
  [...content.children].map((c) => c.getAttribute(LINE_ATTR))

describe('scanHtmlBlocks：顶层原生 HTML 块的起始行', () => {
  it('只认「空行之后、缩进 ≤3、以开标签起头」的行', () => {
    const src = ['<div>a</div>', '', 'para', '', '  <p>b</p>', '', '    <p>indented code</p>', ''].join('\n')
    expect(scanHtmlBlocks(src).map((b) => b.line)).toEqual([0, 4])
  })

  it('闭标签、注释、处理指令不算——它们要么产不出元素，要么归上一个块', () => {
    const src = ['<details>', '<summary>s</summary>', '', '</details>', '', '<!-- c -->', ''].join('\n')
    expect(scanHtmlBlocks(src).map((b) => b.line)).toEqual([0])
  })

  it('围栏里的 HTML 不算', () => {
    const src = ['```html', '<div>not a block</div>', '```', '', '<p>real</p>', ''].join('\n')
    expect(scanHtmlBlocks(src).map((b) => b.line)).toEqual([4])
  })

  it('块的 source 从起始行一直到下一空行前的最后一行', () => {
    const src = ['<p>', 'x', '</p>', '', 'after'].join('\n')
    expect(scanHtmlBlocks(src)[0]?.source).toBe('<p>\nx\n</p>')
  })

  it('文件末尾没有空行收尾的块也要认出来', () => {
    expect(scanHtmlBlocks('para\n\n<p>tail</p>').map((b) => b.line)).toEqual([2])
  })

  /**
   * 2026-08-09 用 core 的真引擎量过：把这里扫出的候选行、减去 DOM 里已有
   * data-line 的那些，与 markdown-it 真正产出的 html_block（开标签起头的那些）
   * token 的 map[0] 在 6 个 real-world 文件上**逐一相等**。
   * mermaid.md 的 46 行是唯一一个「看着像块、实际是段落」的假阳性
   * （<a …><img …></a> 不满足 CommonMark 条件 7），由已有 data-line 过滤掉。
   */
  it('对 real-world 语料扫出的候选行是钉死的', () => {
    expect(scanHtmlBlocks(corpus('gitignore.md')).map((b) => b.line)).toEqual([])
    expect(scanHtmlBlocks(corpus('hast-util-sanitize.md')).map((b) => b.line)).toEqual([])
    expect(scanHtmlBlocks(corpus('markdown-it.md')).map((b) => b.line)).toEqual([])
    expect(scanHtmlBlocks(corpus('mermaid.md')).map((b) => b.line)).toEqual([0, 13, 26, 40, 46, 50, 91])
    expect(scanHtmlBlocks(corpus('sindresorhus-is.md')).map((b) => b.line)).toEqual([6])
    expect(scanHtmlBlocks(corpus('tauri.md')).map((b) => b.line)).toEqual([0, 67])
  })
})

describe('synthesizeHtmlAnchors：在 element 侧补锚点，不动 Phase A 的字节', () => {
  it('一个原生 HTML 块产出几个顶层节点，就按顺序分给它们同一个行号', () => {
    const src = ['para', '', '<p>a</p>', '<p>b</p>', '', '<br>', '', 'tail'].join('\n')
    const content = mountRendered(
      `<p ${LINE_ATTR}="0">para</p><p>a</p><p>b</p><br><p ${LINE_ATTR}="7">tail</p>`,
    )
    expect(synthesizeHtmlAnchors(content, src)).toBe(3)
    expect(topLines(content)).toEqual(['0', '2', '2', '5', '7'])
    expect(content.querySelectorAll(`[${SYNTHETIC_ATTR}]`)).toHaveLength(3)
    expect(content.querySelectorAll(`[${COLLAPSED_ATTR}]`)).toHaveLength(0)
  })

  it('已经有 data-line 的行不会被当成候选（mermaid.md 第 46 行那类假阳性）', () => {
    const src = ['<a href="x"><img src="y"></a>', ''].join('\n')
    const content = mountRendered(`<p ${LINE_ATTR}="0"><a href="x"><img src="y"></a></p>`)
    expect(synthesizeHtmlAnchors(content, src)).toBe(0)
    expect(topLines(content)).toEqual(['0'])
  })

  it('数不齐时整段折叠到本间隙的第一个块起始行，并留下可见的 data-line-collapsed', () => {
    // source 说这个块只产 1 个顶层元素，DOM 里却有 2 个——只可能是解析器
    // 或卫生化器改了结构。折叠：仍然单调、仍在两个真锚点之间，粒度退化成一段。
    const src = ['para', '', '<p>a</p>', '', 'tail'].join('\n')
    const content = mountRendered(
      `<p ${LINE_ATTR}="0">para</p><p>a</p><span>extra</span><p ${LINE_ATTR}="4">tail</p>`,
    )
    expect(synthesizeHtmlAnchors(content, src)).toBe(2)
    expect(topLines(content)).toEqual(['0', '2', '2', '4'])
    expect(content.querySelectorAll(`[${COLLAPSED_ATTR}]`)).toHaveLength(2)
  })

  it('间隙里没有候选块就不动它——宁可无锚点，也不发明一个行号', () => {
    const content = mountRendered(`<p ${LINE_ATTR}="0">a</p><hr><p ${LINE_ATTR}="4">b</p>`)
    expect(synthesizeHtmlAnchors(content, 'a\n\n\n\nb\n')).toBe(0)
    expect(topLines(content)).toEqual(['0', null, '4'])
  })
})

describe('对 real-world/mermaid.md ——那个几乎全是原生 HTML 的 README', () => {
  const src = corpus('mermaid.md')
  const content = mountRendered(render(src))
  const stamped = synthesizeHtmlAnchors(content, src)

  it('合成之后，顶层没有一个节点还缺锚点', () => {
    expect(stamped).toBeGreaterThan(0)
    expect([...content.children].filter((c) => !c.hasAttribute(LINE_ATTR))).toHaveLength(0)
  })

  it('整条顶层行号序列单调不减——滚动同步唯一不可让的性质', () => {
    const lines = [...content.children].map((c) => Number(c.getAttribute(LINE_ATTR)))
    expect(lines).toEqual([...lines].sort((a, b) => a - b))
  })

  it('合成出的行号正好是那 5 个真块的起始行', () => {
    // 0/13/26 是开头那一大段 <p align=center> 横幅（分别产 6/4/2 个顶层节点），
    // 40 是 <img src="./img/header.png">，91 是贡献者表格前的那块。
    // 若这条只剩 {0,40,91}，说明开头那段走了折叠回落——**上报，不要把断言改软**：
    // 那意味着宿主的 HTML 解析器与 parse5 在隐式闭合 <p> 上不一致。
    const synthesized = [...content.querySelectorAll(`[${SYNTHETIC_ATTR}]`)].map((c) =>
      Number(c.getAttribute(LINE_ATTR)),
    )
    expect(new Set(synthesized)).toEqual(new Set([0, 13, 26, 40, 91]))
  })
})
```

`packages/element/test/scroll-sync.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import { collectAnchors, lineToTop, topToLine, type Anchor, type MeasureTop } from '../src/scroll/anchors.js'
import { createScrollSync, type ScrollSource } from '../src/scroll/sync.js'

function content(lines: readonly number[]): { el: HTMLElement; measure: MeasureTop } {
  const el = document.createElement('div')
  el.innerHTML = lines.map((l) => `<p data-line="${String(l)}">l${String(l)}</p>`).join('')
  document.body.append(el)
  const tops = new Map<Element, number>()
  ;[...el.children].forEach((c, i) => tops.set(c, i * 100))
  // happy-dom 没有排版，offsetTop 恒为 0——测量因此是注入的。
  // 真实实现是 el => (el as HTMLElement).offsetTop，由 Task 17 在真浏览器里覆盖。
  return { el, measure: (node) => tops.get(node) ?? 0 }
}

describe('collectAnchors', () => {
  it('按 top 升序，且强制行号单调不减', () => {
    const { el, measure } = content([0, 10, 4, 20])
    expect(collectAnchors(el, measure)).toEqual<Anchor[]>([
      { line: 0, top: 0 },
      { line: 10, top: 100 },
      { line: 10, top: 200 },
      { line: 20, top: 300 },
    ])
  })

  it('同一垂直位置上的多个锚点只留行号最小的那个', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p data-line="3">a</p><p data-line="5">b</p>'
    document.body.append(el)
    expect(collectAnchors(el, () => 42)).toEqual<Anchor[]>([{ line: 3, top: 42 }])
  })

  it('data-line 不是非负整数的节点被跳过，而不是变成 NaN 锚点', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p data-line="x">a</p><p data-line="-1">b</p><p data-line="2">c</p>'
    document.body.append(el)
    expect(collectAnchors(el, () => 7)).toEqual<Anchor[]>([{ line: 2, top: 7 }])
  })
})

const A: Anchor[] = [
  { line: 0, top: 0 },
  { line: 10, top: 200 },
  { line: 30, top: 400 },
]

describe('lineToTop / topToLine', () => {
  it('锚点上是精确的', () => {
    expect(lineToTop(A, 10, 800, 40)).toBe(200)
    expect(topToLine(A, 400, 800, 40)).toBe(30)
  })

  it('两锚点之间线性插值', () => {
    expect(lineToTop(A, 5, 800, 40)).toBe(100)
    expect(lineToTop(A, 20, 800, 40)).toBe(300)
    expect(topToLine(A, 100, 800, 40)).toBe(5)
    expect(topToLine(A, 300, 800, 40)).toBe(20)
  })

  it('末锚点之后按「剩余行数 : 剩余高度」外推，不越界', () => {
    expect(lineToTop(A, 39, 800, 40)).toBe(800)
    expect(lineToTop(A, 999, 800, 40)).toBe(800)
    expect(topToLine(A, 800, 800, 40)).toBe(39)
    expect(topToLine(A, 99999, 800, 40)).toBe(39)
  })

  it('首锚点之前夹到首锚点', () => {
    expect(lineToTop(A, -5, 800, 40)).toBe(0)
    expect(topToLine(A, -5, 800, 40)).toBe(0)
  })

  it('没有锚点时退化成 0，而不是抛错', () => {
    expect(lineToTop([], 12, 800, 40)).toBe(0)
    expect(topToLine([], 300, 800, 40)).toBe(0)
  })
})

describe('createScrollSync：双向同步不得自激', () => {
  function setup() {
    const { el, measure } = content([0, 10, 30])
    const preview = document.createElement('div')
    preview.append(el)
    document.body.append(preview)
    const source: ScrollSource = { topLine: vi.fn(() => 0), scrollToLine: vi.fn() }
    const sync = createScrollSync({
      source,
      preview,
      content: el,
      measure,
      contentHeight: () => 800,
      lineCount: () => 40,
    })
    return { sync, source, preview, el }
  }

  it('编辑器滚动把预览推到对应偏移', () => {
    const { sync, preview } = setup()
    sync.fromEditor(10)
    expect(preview.scrollTop).toBe(200)
    sync.destroy()
  })

  it('由自己推出去的那次预览滚动不再反弹回编辑器', () => {
    const { sync, source, preview } = setup()
    sync.fromEditor(10)
    expect(preview.scrollTop).toBe(200)
    // 浏览器接着会派一次 scroll 事件——它是我们自己造成的，必须被吃掉。
    sync.fromPreview()
    expect(source.scrollToLine).not.toHaveBeenCalled()
    sync.destroy()
  })

  it('用户真正滚预览时才回推编辑器', () => {
    const { sync, source, preview } = setup()
    preview.scrollTop = 300
    sync.fromPreview()
    expect(source.scrollToLine).toHaveBeenCalledWith(20)
    sync.destroy()
  })

  it('回推之后编辑器派回来的那次 scroll 同样被吃掉', () => {
    const { sync, preview } = setup()
    preview.scrollTop = 300
    sync.fromPreview()
    sync.fromEditor(20)
    expect(preview.scrollTop).toBe(300)
    sync.destroy()
  })

  it('invalidate() 之后重新采锚点', () => {
    const { sync, el, preview } = setup()
    el.innerHTML = '<p data-line="0">a</p>'
    sync.invalidate()
    sync.fromEditor(30)
    expect(preview.scrollTop).toBe(0)
    sync.destroy()
  })

  it('destroy() 之后两个方向都不再动任何东西', () => {
    const { sync, source, preview } = setup()
    sync.destroy()
    sync.fromEditor(30)
    expect(preview.scrollTop).toBe(0)
    preview.scrollTop = 300
    sync.fromPreview()
    expect(source.scrollToLine).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd /Users/mac08/Desktop/robot/readit && npx vitest run packages/element/test/html-anchors.test.ts packages/element/test/scroll-sync.test.ts
```

预期：两份文件因 `Failed to resolve import "../src/scroll/html-anchors.js"` /
`"../src/scroll/anchors.js"` 整体失败。

- [ ] **Step 3: 写最小实现**

`packages/element/src/scroll/html-anchors.ts`：

```ts
export const LINE_ATTR = 'data-line'
/** 本文件补上去的锚点，与 Phase A 真发的 data-line 区分开。 */
export const SYNTHETIC_ATTR = 'data-line-synthetic'
/** 数不齐、走了折叠回落的那一段。降级要留痕，L3b 的断言看得见它。 */
export const COLLAPSED_ATTR = 'data-line-collapsed'

export interface HtmlBlock {
  /** 0 基起始行 */
  line: number
  /** 从起始行到下一空行前的最后一行（含内部换行） */
  source: string
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
/**
 * 只认「以开标签起头」。闭标签（</details>）与注释（<!-- -->）产不出顶层
 * 元素，把它们算成候选只会让间隙里的分配整体前移。
 */
const OPEN_TAG = /^ {0,3}<[A-Za-z]/

export function scanHtmlBlocks(src: string): HtmlBlock[] {
  const lines = src.split('\n')
  const out: HtmlBlock[] = []
  let fence: string | null = null
  let prevBlank = true
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const m = FENCE.exec(line)
    const marker = m?.[1]
    if (fence !== null) {
      if (marker !== undefined && marker.charAt(0) === fence.charAt(0) && marker.length >= fence.length) {
        fence = null
      }
      prevBlank = false
      continue
    }
    if (marker !== undefined) {
      fence = marker
      prevBlank = false
      continue
    }
    const blank = line.trim() === ''
    if (prevBlank && !blank && OPEN_TAG.test(line)) {
      let end = i
      while (end + 1 < lines.length && (lines[end + 1] ?? '').trim() !== '') end++
      out.push({ line: i, source: lines.slice(i, end + 1).join('\n') })
    }
    prevBlank = blank
  }
  return out
}

/**
 * 数一段原生 HTML 源码会产出几个顶层元素。
 *
 * 用 <template> 而不是游离的 <div>：template 的内容是惰性的，不发资源请求、
 * 不跑脚本。往游离 <div> 上写 innerHTML，浏览器仍会去取里面 <img> 的 src——
 * 那是一条真实的出网路径，而这个项目的离线约束不许它存在。
 */
function countTopLevelElements(doc: Document, html: string): number {
  const tpl = doc.createElement('template')
  tpl.innerHTML = html
  return tpl.content.children.length
}

function readLine(el: Element): number | null {
  const raw = el.getAttribute(LINE_ATTR)
  if (raw === null) return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/** 顶层节点自己的行号，或它子树里第一个带行号的后代的行号。 */
function anchorLineOf(el: Element): number | null {
  const own = readLine(el)
  if (own !== null) return own
  const inner = el.querySelector(`[${LINE_ATTR}]`)
  return inner === null ? null : readLine(inner)
}

function stamp(el: Element, line: number): void {
  el.setAttribute(LINE_ATTR, String(line))
  el.setAttribute(SYNTHETIC_ATTR, '')
}

function assignRun(doc: Document, run: readonly Element[], gap: readonly HtmlBlock[]): number {
  if (run.length === 0 || gap.length === 0) return 0
  const counts = gap.map((b) => countTopLevelElements(doc, b.source))
  const total = counts.reduce((a, b) => a + b, 0)

  if (total === run.length) {
    let k = 0
    let left = counts[0] ?? 0
    for (const node of run) {
      while (left === 0 && k < gap.length - 1) {
        k++
        left = counts[k] ?? 0
      }
      stamp(node, gap[k]?.line ?? 0)
      left--
    }
    return run.length
  }

  for (const node of run) {
    stamp(node, gap[0]?.line ?? 0)
    node.setAttribute(COLLAPSED_ATTR, '')
  }
  return run.length
}

/**
 * 给缺锚点的顶层节点补 data-line，返回补了几个。
 *
 * 为什么必须在这一侧做：sourceline.ts 会给 html_block token 打 data-line，
 * 但 markdown-it 的 html_block 渲染器只发 token.content、忽略 attrs，那个属性
 * 算出来就被丢掉。改 Phase A 会动 56/68 那条保真度基线，代价远大于收益；
 * 而且原生 HTML 块可能是注释或半截闭标签，根本没有能挂属性的地方。
 *
 * 算法：真锚点把顶层序列切成若干「间隙」，每个间隙里按 scanHtmlBlocks 给出的
 * 块起始行与「该块产几个顶层元素」的计数逐个分配；数不齐就整段折叠到间隙的
 * 第一个块。任何情况下合成的行号都严格落在两个真锚点之间，序列因此单调。
 */
export function synthesizeHtmlAnchors(content: Element, src: string): number {
  const doc = content.ownerDocument
  const known = new Set<number>()
  for (const el of content.querySelectorAll(`[${LINE_ATTR}]`)) {
    const n = readLine(el)
    if (n !== null) known.add(n)
  }

  const blocks = scanHtmlBlocks(src).filter((b) => !known.has(b.line))
  if (blocks.length === 0) return 0

  const tops = [...content.children]
  let stamped = 0
  let i = 0
  let lo = -1
  while (i < tops.length) {
    const here = tops[i]
    if (here === undefined) break
    const line = anchorLineOf(here)
    if (line !== null) {
      lo = line
      i++
      continue
    }
    let j = i
    for (; j < tops.length; j++) {
      const node = tops[j]
      if (node === undefined || anchorLineOf(node) !== null) break
    }
    const nextNode = tops[j]
    const hi = nextNode === undefined ? Number.POSITIVE_INFINITY : (anchorLineOf(nextNode) ?? Number.POSITIVE_INFINITY)
    stamped += assignRun(
      doc,
      tops.slice(i, j),
      blocks.filter((b) => b.line > lo && b.line < hi),
    )
    i = j
  }
  return stamped
}
```

`packages/element/src/scroll/anchors.ts`：

```ts
import { LINE_ATTR } from './html-anchors.js'

export interface Anchor {
  readonly line: number
  readonly top: number
}

/**
 * 量一个元素在预览滚动容器里的纵向偏移。做成注入的，因为离线单元测试环境
 * 没有排版（offsetTop 恒为 0），而滚动同步的算术必须能离线证伪。
 * 真实实现见 sync.ts 的调用方：`(el) => (el as HTMLElement).offsetTop`。
 */
export type MeasureTop = (el: Element) => number

export function collectAnchors(content: Element, measure: MeasureTop): Anchor[] {
  const raw: Anchor[] = []
  for (const el of content.querySelectorAll(`[${LINE_ATTR}]`)) {
    const n = Number(el.getAttribute(LINE_ATTR))
    if (!Number.isInteger(n) || n < 0) continue
    raw.push({ line: n, top: measure(el) })
  }
  raw.sort((a, b) => a.top - b.top || a.line - b.line)

  const out: Anchor[] = []
  for (const a of raw) {
    const last = out[out.length - 1]
    if (last === undefined) {
      out.push(a)
      continue
    }
    if (a.top === last.top) continue
    // 行号单调不减是这层唯一不可让的性质：一处倒挂会让插值算出负的滚动量。
    out.push({ line: Math.max(a.line, last.line), top: a.top })
  }
  return out
}

/** 源码行 → 预览区滚动偏移。 */
export function lineToTop(
  anchors: readonly Anchor[],
  line: number,
  contentHeight: number,
  lineCount: number,
): number {
  const first = anchors[0]
  const last = anchors[anchors.length - 1]
  if (first === undefined || last === undefined) return 0
  if (line <= first.line) return first.top
  if (line >= last.line) {
    const span = Math.max(lineCount - 1 - last.line, 1)
    const t = Math.min((line - last.line) / span, 1)
    return last.top + t * Math.max(contentHeight - last.top, 0)
  }
  for (let i = 1; i < anchors.length; i++) {
    const b = anchors[i]
    const a = anchors[i - 1]
    if (b === undefined || a === undefined) break
    if (b.line < line) continue
    if (b.line === a.line) return a.top
    const t = (line - a.line) / (b.line - a.line)
    return a.top + t * (b.top - a.top)
  }
  return last.top
}

/** 预览区滚动偏移 → 源码行。lineToTop 的逆。 */
export function topToLine(
  anchors: readonly Anchor[],
  top: number,
  contentHeight: number,
  lineCount: number,
): number {
  const first = anchors[0]
  const last = anchors[anchors.length - 1]
  if (first === undefined || last === undefined) return 0
  if (top <= first.top) return first.line
  if (top >= last.top) {
    const span = Math.max(contentHeight - last.top, 1)
    const t = Math.min((top - last.top) / span, 1)
    return Math.round(last.line + t * Math.max(lineCount - 1 - last.line, 0))
  }
  for (let i = 1; i < anchors.length; i++) {
    const b = anchors[i]
    const a = anchors[i - 1]
    if (b === undefined || a === undefined) break
    if (b.top < top) continue
    if (b.top === a.top) return a.line
    const t = (top - a.top) / (b.top - a.top)
    return Math.round(a.line + t * (b.line - a.line))
  }
  return last.line
}
```

`packages/element/src/scroll/sync.ts`：

```ts
import { collectAnchors, lineToTop, topToLine, type Anchor, type MeasureTop } from './anchors.js'

/**
 * 滚动同步只需要编辑器的两个方法。结构化地声明它，而不是
 * `import type { Editor } from '@readit/editor'`——P1 给 element → editor
 * 留的只有动态 import 一条边，这里不必为了两个方法去加一条静态边。
 * @readit/editor 的 Editor 在结构上满足它。
 */
export interface ScrollSource {
  topLine(): number
  scrollToLine(line: number): void
}

export interface ScrollSyncOptions {
  source: ScrollSource
  /** 预览侧的滚动容器。 */
  preview: HTMLElement
  /** 预览内容根，锚点都在它的子树里。 */
  content: Element
  measure: MeasureTop
  contentHeight(): number
  lineCount(): number
}

export interface ScrollSync {
  /** 编辑器滚到了 topLine，把预览推过去。 */
  fromEditor(topLine: number): void
  /** 预览被滚了，把编辑器推过去。 */
  fromPreview(): void
  /** 内容重渲后作废锚点缓存。 */
  invalidate(): void
  destroy(): void
}

export function createScrollSync(opts: ScrollSyncOptions): ScrollSync {
  let cache: Anchor[] | null = null
  let destroyed = false
  /**
   * 反自激不用定时器也不用标志位，用「记住自己刚推出去的值」：
   * 滚动事件是异步的，同步开关关不住它；而由我们造成的那一次事件，
   * 带回来的值一定等于我们刚写进去的值。
   */
  let pushedToPreview: number | null = null
  let pushedToEditor: number | null = null

  const anchors = (): Anchor[] => {
    cache ??= collectAnchors(opts.content, opts.measure)
    return cache
  }

  return {
    fromEditor(topLine) {
      if (destroyed) return
      if (pushedToEditor !== null && pushedToEditor === topLine) {
        pushedToEditor = null
        return
      }
      const top = lineToTop(anchors(), topLine, opts.contentHeight(), opts.lineCount())
      pushedToPreview = top
      opts.preview.scrollTop = top
    },
    fromPreview() {
      if (destroyed) return
      const top = opts.preview.scrollTop
      if (pushedToPreview !== null && pushedToPreview === top) {
        pushedToPreview = null
        return
      }
      const line = topToLine(anchors(), top, opts.contentHeight(), opts.lineCount())
      pushedToEditor = line
      opts.source.scrollToLine(line)
    },
    invalidate() {
      cache = null
    },
    destroy() {
      destroyed = true
      cache = null
    },
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit
npx vitest run packages/element/test/html-anchors.test.ts packages/element/test/scroll-sync.test.ts
npm run typecheck
npm test
```

预期：`html-anchors.test.ts` 12 条、`scroll-sync.test.ts` 15 条全绿；P6 的五个数字不变。
若「合成出的行号正好是那 5 个真块的起始行」变红且实际值是 `{0, 40, 91}`，说明
`<template>` 解析器与 parse5 在 `<p>` 的隐式闭合上不一致——**上报这个不一致，
不要把断言改成集合包含**。

- [ ] **Step 5: 提交**

```bash
cd /Users/mac08/Desktop/robot/readit
git add packages/element/src/scroll packages/element/test/html-anchors.test.ts packages/element/test/scroll-sync.test.ts
git commit -m "$(cat <<'EOF'
feat(element): 滚动同步 + 原生 HTML 块的锚点合成

计划一留下的缺口直接落到这里：sourceline.ts 会给 html_block token 打
data-line，但 markdown-it 的 html_block 渲染器只发 token.content、忽略
attrs，属性算出来就丢了。对 real-world/mermaid 这种几乎全是原生 HTML 的
README，滚动同步在那些区段完全没有锚。在 element 侧合成，不动 Phase A 的
输出字节——改它会动 56/68 那条保真度基线，而且注释和半截闭标签本来也没有
能挂属性的地方。

合成算法：真锚点把顶层序列切成间隙，每个间隙里按块起始行 + 「该块产几个
顶层元素」的计数逐个分配；数不齐就整段折叠到间隙的第一个块，并留下
data-line-collapsed。合成的行号任何情况下都严格落在两个真锚点之间，
序列因此单调——这是这层唯一不可让的性质。

块起始行的扫描器与 core 真引擎的 html_block token 在 6 个 real-world 文件
上逐一相等（mermaid.md 第 46 行那个「看着像块、其实是段落」的假阳性由
已有 data-line 过滤掉）。数节点用 <template> 而不是游离 <div>：template
的内容是惰性的，往游离 div 写 innerHTML 浏览器仍会去取 <img src>。

这一层没有 oracle——data-line 被归一化器的 dropDataLine 剥掉，正确性对语料
套件完全不可见。这两份测试是唯一能证伪它的东西。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

---

### Task 17: source / split / plain 三档接线 + L3b-editor（含 IME 验收线）

**Files:**
- Create: `packages/element/src/panes.ts`
- Create: `packages/element/test/panes.test.ts`
- Create: `browser/fixtures/index.html`
- Create: `browser/fixtures/main.ts`
- Create: `browser/fixtures/vite.config.ts`
- Create: `browser/editor/contract.spec.ts`
- Create: `browser/editor/scroll-sync.spec.ts`
- Create: `browser/editor/ime.spec.ts`
- Modify: `playwright.config.ts`（在 `projects` 数组末尾追加两条，见 Step 3；`webServer` 若已存在则保持不动）
- Modify: `packages/element/src/index.ts`（`mount()` 里模式相关的那一段改为委托 `createPanes()`，见 Step 3 的接缝代码）
- Modify: `package.json`（devDependencies 加 `"vite": "8.2.1"`；`@playwright/test` 由 M3 段的 L3b-element 任务已加为 `1.62.1`）
- Test: `packages/element/test/panes.test.ts`、`browser/editor/*.spec.ts`

**Interfaces:**
- Consumes:
  - Task 14：`@readit/editor` 的 `createEditor(kind: EditorKind, opts: EditorOptions): Promise<Editor>`
  - Task 15：`packages/element/src/rerender.ts` 的 `createRerenderer(host, deps, options, initialValue)`、`browserDeps(loadHighlighter)`、`RerenderHost`、`RerenderDeps`、`PendingCapability`
  - Task 16：`synthesizeHtmlAnchors(content, src)`、`createScrollSync(opts)`、`MeasureTop`
  - Task 13：`packages/editor/test/contract.ts` 的 `editorContractCases` / `runAllCases`
  - M3 段：`packages/element/src/set-html.ts` 的 `setHtml(el: Element, html: string): void`、`packages/element/src/types.ts` 的 `Mode`；根 `playwright.config.ts` 与 `@playwright/test@1.62.1`
- Produces: `packages/element/src/panes.ts` 的 `interface PanesOptions`、`interface Panes { getValue(): string; setValue(value: string): void; setMode(mode: Mode): Promise<void>; destroy(): void }`、`createPanes(opts: PanesOptions): Panes`

---

- [ ] **Step 1: 写会失败的测试**

先是离线的接线测试（跑得快，红绿循环用它），再是 M4 的验收线。

`packages/element/test/panes.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import { browserDeps } from '../src/rerender.js'
import { createPanes } from '../src/panes.js'

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

function host() {
  const container = document.createElement('div')
  document.body.append(container)
  return container
}

describe('createPanes：模式状态机', () => {
  it('read 档只有预览，不建编辑器', async () => {
    const container = host()
    const panes = createPanes({
      container,
      root: document,
      value: '# H',
      mode: 'read',
      renderOptions: {},
      deps: browserDeps(null),
      measure: () => 0,
      onPending: () => {},
    })
    await flush()
    expect(container.querySelector('.readit-preview')?.innerHTML).toContain('<h1')
    expect(container.querySelector('.readit-source')).toBeNull()
    panes.destroy()
  })

  it('plain 档建 textarea，不碰 CodeMirror', async () => {
    const container = host()
    const panes = createPanes({
      container,
      root: document,
      value: 'a',
      mode: 'plain',
      renderOptions: {},
      deps: browserDeps(null),
      measure: () => 0,
      onPending: () => {},
    })
    await panes.setMode('plain')
    expect(container.querySelector('.readit-source textarea')).not.toBeNull()
    expect(container.querySelector('.cm-editor')).toBeNull()
    panes.destroy()
  })

  it('plain 档里打字会重渲预览（走防抖 → 帧）', async () => {
    vi.useFakeTimers()
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
    const container = host()
    const panes = createPanes({
      container,
      root: document,
      value: 'a',
      mode: 'plain',
      renderOptions: {},
      deps: browserDeps(null),
      measure: () => 0,
      onPending: () => {},
    })
    await panes.setMode('plain')
    const ta = container.querySelector('textarea')
    expect(ta).not.toBeNull()
    if (ta === null) return
    ta.value = '# Changed'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    vi.advanceTimersByTime(20)
    expect(container.querySelector('.readit-preview')?.innerHTML).toContain('Changed')
    expect(panes.getValue()).toBe('# Changed')
    panes.destroy()
    raf.mockRestore()
    vi.useRealTimers()
  })

  it('预览里的原生 HTML 块在每次重渲后都补上了锚点', async () => {
    const container = host()
    const panes = createPanes({
      container,
      root: document,
      value: 'para\n\n<p>native</p>\n\ntail\n',
      mode: 'read',
      renderOptions: {},
      deps: browserDeps(null),
      measure: () => 0,
      onPending: () => {},
    })
    await flush()
    const preview = container.querySelector('.readit-preview')
    expect(preview).not.toBeNull()
    expect(preview?.querySelectorAll('[data-line-synthetic]').length).toBeGreaterThan(0)
    panes.destroy()
  })

  it('切回 read 会拆掉编辑器，destroy() 之后容器是空的', async () => {
    const container = host()
    const panes = createPanes({
      container,
      root: document,
      value: 'a',
      mode: 'plain',
      renderOptions: {},
      deps: browserDeps(null),
      measure: () => 0,
      onPending: () => {},
    })
    await panes.setMode('plain')
    await panes.setMode('read')
    expect(container.querySelector('textarea')).toBeNull()
    panes.destroy()
    expect(container.childElementCount).toBe(0)
  })

  it('onPending 把「还缺什么」交出去——降级要可见', async () => {
    const seen: string[][] = []
    const container = host()
    const panes = createPanes({
      container,
      root: document,
      value: 'a $x$ b',
      mode: 'read',
      renderOptions: {},
      deps: { ...browserDeps(null), prepare: () => new Promise(() => {}) },
      measure: () => 0,
      onPending: (p) => seen.push([...p]),
    })
    await flush()
    expect(seen.at(-1)).toEqual(['math'])
    panes.destroy()
  })
})
```

`browser/editor/contract.spec.ts`：

```ts
import { expect, test } from '@playwright/test'

test.describe('L3b-editor：两个实现在同一个 shadow root 里跑同一张契约表', () => {
  for (const kind of ['plain', 'codemirror'] as const) {
    test(`${kind} 档满足 P2 的 Editor 契约`, async ({ page }) => {
      await page.goto('/index.html')
      await page.waitForFunction(() => window.readitFixture !== undefined)
      const failures = await page.evaluate(
        async (k) => window.readitFixture.runContract(k),
        kind,
      )
      expect(failures).toEqual([])
    })
  }

  test('CodeMirror 真的挂在 shadow root 里，样式也注进去了', async ({ page }) => {
    await page.goto('/index.html?mode=source')
    await page.waitForSelector('readit-view >>> .cm-content')
    const injected = await page.evaluate(() => {
      const host = document.querySelector('readit-view')
      const root = host?.shadowRoot
      if (root == null) return { inShadow: false, sheets: 0 }
      return {
        inShadow: root.querySelector('.cm-content') !== null,
        sheets: root.adoptedStyleSheets.length + root.querySelectorAll('style').length,
      }
    })
    expect(injected.inShadow).toBe(true)
    expect(injected.sheets).toBeGreaterThan(0)
  })
})
```

`browser/editor/scroll-sync.spec.ts`：

```ts
    await page.evaluate(() => window.readitFixture.scrollPreviewTo(1200))
    await page.waitForTimeout(120)
    const first = await page.evaluate(() => window.readitFixture.editorTopLine())
    const bounces = await page.evaluate(() => window.readitFixture.syncPushCount())
    await page.waitForTimeout(200)
    const second = await page.evaluate(() => window.readitFixture.editorTopLine())
    expect(second).toBe(first)
    // 一次用户滚动只该产生一次推送；再多就是两侧互相推起来了。
    expect(bounces).toBe(1)
  })
})
```

`browser/editor/ime.spec.ts` —— **M4 的唯一验收线**：

```ts
import { expect, test, type Page } from '@playwright/test'

/**
 * Playwright 对 IME 组合的支持不是一等的。这里走的是 Chromium 的 CDP
 * `Input.imeSetComposition` + `Input.insertText`——那是渲染进程真正的组合路径，
 * compositionstart/update/end 由引擎自己发，不是 JS 里 dispatchEvent 出来的。
 * 这一点很重要：派发合成事件测出来的只是「我们的监听器接得住我们自己造的事件」，
 * 那是自我肯定。
 *
 * 三道自检，任何一道红了都不许把断言改软：
 *  1. 组合过程中必须观察到 compositionstart / compositionupdate / compositionend；
 *     若 CDP 调用其实是空操作，这里一定为空。
 *  2. 同一串 CDP 指令同时打在 plain 档的 <textarea> 上（对照组）。若整套装置
 *     坏了，对照组会一起红——一条只有 CodeMirror 红/绿的结果说明不了装置是好的。
 *  3. 中间态必须出现预编辑串（未提交的 "にほんご"），而不是只有最终结果。
 *     只断言最终结果的话，一个把 insertText 当普通输入处理的实现也会绿。
 */

const PREEDIT = 'にほんご'
const COMMITTED = '日本語'

async function compose(page: Page, selector: string): Promise<{ preedit: string; committed: string }> {
  const cdp = await page.context().newCDPSession(page)
  await page.locator(selector).click()
  await page.evaluate(() => window.readitFixture.recordCompositionEvents())

  for (let i = 1; i <= PREEDIT.length; i++) {
    const text = PREEDIT.slice(0, i)
    await cdp.send('Input.imeSetComposition', {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    })
  }
  const preedit = await page.evaluate(() => window.readitFixture.editorValue())
  await cdp.send('Input.insertText', { text: COMMITTED })
  const committed = await page.evaluate(() => window.readitFixture.editorValue())
  await cdp.detach()
  return { preedit, committed }
}

test.describe('L3b-editor：中日韩输入法在 Shadow Root 内的组合', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'GAP-IME-WEBKIT：WKWebView 侧没有等价于 CDP Input.imeSetComposition 的入口，' +
      '这一档只有手工验证。这是一条具名的覆盖缺口，不是「已通过」。',
  )

  test('对照组：plain 档的 textarea 收得到同一串组合', async ({ page }) => {
    await page.goto('/index.html?mode=plain')
    await page.waitForSelector('readit-view >>> textarea')
    const { preedit, committed } = await compose(page, 'readit-view >>> textarea')
    expect(preedit).toContain(PREEDIT)
    expect(committed).toContain(COMMITTED)
    expect(committed).not.toContain(PREEDIT)
  })

  test('CodeMirror 在 shadow root 里：预编辑串可见，提交后只剩最终文本', async ({ page }) => {
    await page.goto('/index.html?mode=source')
    await page.waitForSelector('readit-view >>> .cm-content')
    const { preedit, committed } = await compose(page, 'readit-view >>> .cm-content')
    expect(preedit).toContain(PREEDIT)
    expect(committed).toContain(COMMITTED)
    expect(committed).not.toContain(PREEDIT)
  })

  test('组合事件真的从引擎里发出来了（这条红 == 上面两条是自我肯定）', async ({ page }) => {
    await page.goto('/index.html?mode=source')
    await page.waitForSelector('readit-view >>> .cm-content')
    await compose(page, 'readit-view >>> .cm-content')
    const events = await page.evaluate(() => window.readitFixture.compositionEvents())
    expect(events).toContain('compositionstart')
    expect(events).toContain('compositionupdate')
    expect(events).toContain('compositionend')
  })

  test('组合期间到达的外部 setValue 被推迟，不冲掉预编辑串', async ({ page }) => {
    await page.goto('/index.html?mode=split')
    await page.waitForSelector('readit-view >>> .cm-content')
    const cdp = await page.context().newCDPSession(page)
    await page.locator('readit-view >>> .cm-content').click()
    await cdp.send('Input.imeSetComposition', { text: PREEDIT, selectionStart: 4, selectionEnd: 4 })
    await page.evaluate(() => window.readitFixture.setValueFromHost('外部写入'))
    expect(await page.evaluate(() => window.readitFixture.editorValue())).toContain(PREEDIT)
    await cdp.send('Input.insertText', { text: COMMITTED })
    await page.waitForTimeout(50)
    expect(await page.evaluate(() => window.readitFixture.editorValue())).toBe('外部写入')
    await cdp.detach()
  })
})
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd /Users/mac08/Desktop/robot/readit
npx vitest run packages/element/test/panes.test.ts
npx playwright test --project=editor-chromium
```

预期：vitest 报 `Failed to resolve import "../src/panes.js"`；playwright 报
`Error: Project(s) "editor-chromium" not found`（配置里还没有这个 project）。

- [ ] **Step 3: 写最小实现**

`packages/element/src/panes.ts`：

```ts
import type { RenderOptions } from '@readit/core'
import type { Editor, EditorKind, EditorOptions } from '@readit/editor'
import { setHtml } from './set-html.js'
import type { Mode } from './types.js'
import {
  createRerenderer,
  type PendingCapability,
  type RerenderDeps,
  type RerenderHost,
  type Rerenderer,
} from './rerender.js'
import { synthesizeHtmlAnchors } from './scroll/html-anchors.js'
import { createScrollSync, type ScrollSync } from './scroll/sync.js'
import type { MeasureTop } from './scroll/anchors.js'

export interface PanesOptions {
  /** 两个 pane 的父容器。read 档下只有预览。 */
  container: HTMLElement
  /** CodeMirror 的样式注入目标；plain 忽略。 */
  root: ShadowRoot | Document
  value: string
  mode: Mode
  renderOptions: Partial<RenderOptions>
  deps: RerenderDeps
  measure: MeasureTop
  /** 把「还缺什么能力」交给宿主元素落成 data-readit-pending。 */
  onPending(pending: readonly PendingCapability[]): void
}

export interface Panes {
  getValue(): string
  setValue(value: string): void
  setMode(mode: Mode): Promise<void>
  destroy(): void
}

const EDITOR_KIND: Record<Mode, EditorKind | null> = {
  read: null,
  plain: 'plain',
  source: 'codemirror',
  split: 'codemirror',
}

export function createPanes(opts: PanesOptions): Panes {
  const doc = opts.container.ownerDocument
  let value = opts.value
  let mode: Mode = opts.mode
  let editor: Editor | null = null
  let sync: ScrollSync | null = null
  let generation = 0
  let destroyed = false

  const source = doc.createElement('div')
  source.className = 'readit-source'
  const preview = doc.createElement('div')
  preview.className = 'readit-preview markdown-body'
  // ::part 名单本计划只开 root / content / code-block（设计文档 §9 修订 3）。
  // content 挂在预览 pane 上——它才是宿主想改的那块。
  preview.setAttribute('part', 'content')
  opts.container.append(preview)

  const host: RerenderHost = {
    paint(html) {
      setHtml(preview, html)
      // 每次重渲后重补原生 HTML 块的锚点：markdown-it 的 html_block 渲染器
      // 把 data-line 丢了，Task 16 在这一侧补回来。
      synthesizeHtmlAnchors(preview, value)
      sync?.invalidate()
    },
    setPending(pending) {
      opts.onPending(pending)
    },
  }

  const rerenderer: Rerenderer = createRerenderer(host, opts.deps, opts.renderOptions, value)
  rerenderer.repaint()

  const onPreviewScroll = (): void => {
    sync?.fromPreview()
  }

  const teardownEditor = (): void => {
    editor?.destroy()
    editor = null
    sync?.destroy()
    sync = null
    preview.removeEventListener('scroll', onPreviewScroll)
    source.remove()
    source.replaceChildren()
  }

  const buildEditor = async (kind: EditorKind): Promise<void> => {
    const mine = ++generation
    opts.container.prepend(source)
    const editorOptions: EditorOptions = {
      parent: source,
      root: opts.root,
      value,
      onChange: (next) => {
        value = next
        rerenderer.update(next)
      },
      onScroll: (topLine) => {
        sync?.fromEditor(topLine)
      },
    }
    // element → @readit/editor 只有这一条边，且是动态的（P1）：
    // CodeMirror 那 176,654 B 只有真正切进 source / split 的宿主才付。
    const { createEditor } = await import('@readit/editor')
    const created = await createEditor(kind, editorOptions)
    if (destroyed || mine !== generation) {
      created.destroy()
      return
    }
    editor = created
    sync = createScrollSync({
      source: created,
      preview,
      content: preview,
      measure: opts.measure,
      contentHeight: () => preview.scrollHeight,
      lineCount: () => value.split('\n').length,
    })
    preview.addEventListener('scroll', onPreviewScroll)
  }

  const applyMode = async (next: Mode): Promise<void> => {
    mode = next
    opts.container.dataset['readitMode'] = next
    const kind = EDITOR_KIND[next]
    teardownEditor()
    if (kind !== null) await buildEditor(kind)
  }

  void applyMode(mode)

  return {
    getValue() {
      return value
    },
    setValue(next) {
      value = next
      editor?.setValue(next)
      rerenderer.setValue(next)
    },
    async setMode(next) {
      if (destroyed) return
      await applyMode(next)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      generation++
      teardownEditor()
      rerenderer.destroy()
      preview.remove()
      opts.container.replaceChildren()
    },
  }
}
```

`packages/element/src/index.ts` 的接缝——把 `mount()` 里管模式的那段替换成对 `createPanes()` 的委托（`mount()` 保持同步返回，编辑器的加载在后台推进）：

```ts
  const panes = createPanes({
    container: shell,
    root: shadowRoot ?? host.ownerDocument,
    value: resolved.value,
    mode: resolved.mode,
    renderOptions: {
      inlineMath: resolved.inlineMath,
      math: resolved.math,
      highlighter: resolved.highlighter,
      emojiBase: resolved.emojiBase,
    },
    deps: browserDeps(resolved.loadHighlighter),
    measure: (el) => (el as HTMLElement).offsetTop,
    onPending: (pending) => {
      if (pending.length === 0) delete host.dataset['readitPending']
      else host.dataset['readitPending'] = pending.join(' ')
    },
  })
```

`mount()` 返回的 `MountHandle` 把 `setValue` / `getValue` / `setMode` 直接转给 `panes`，`destroy()` 在拆主题监听之后调 `panes.destroy()`。

`browser/fixtures/vite.config.ts`：

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  // 工作区包在 node_modules 里是软链，vite 会跟到真实路径（不在 node_modules 下），
  // 所以 TS 源码会被正常转译；预打包必须排除，否则它会去 bundle 裸 .ts。
  optimizeDeps: {
    exclude: ['@readit/core', '@readit/editor', '@readit/element', '@readit/math'],
  },
  server: { fs: { allow: ['../..'] } },
})
```

`browser/fixtures/index.html`：

```html
<!doctype html>
<meta charset="utf-8" />
<title>readit editor fixture</title>
<style>
  html, body { margin: 0; height: 100%; }
  readit-view { display: block; height: 100vh; }
</style>
<readit-view></readit-view>
<script type="module" src="./main.ts"></script>
```

`browser/fixtures/main.ts`：

```ts
import { defineReadit, mount } from '@readit/element'
import type { Mode } from '@readit/element'
import { createEditor } from '@readit/editor'
import { editorContractCases, runAllCases } from '../../packages/editor/test/contract.js'
import mermaidDoc from '../../packages/core/test/corpus/real-world/mermaid.md?raw'

const params = new URLSearchParams(location.search)
const mode = (params.get('mode') ?? 'read') as Mode
const value = params.get('doc') === 'mermaid' ? mermaidDoc : '# hi\n\npara\n'

defineReadit()
const hostEl = document.querySelector('readit-view')
if (hostEl === null) throw new Error('fixture: <readit-view> missing')
const handle = mount(hostEl as HTMLElement, { value, mode, shadow: true })

const shadow = (): ShadowRoot => {
  const root = (hostEl as HTMLElement).shadowRoot
  if (root === null) throw new Error('fixture: no shadow root')
  return root
}

const events: string[] = []
let pushes = 0

window.readitFixture = {
  async runContract(kind) {
    const scratch = document.createElement('div')
    shadow().append(scratch)
    const cases = editorContractCases((opts) => createEditor(kind, opts), {
      mount() {
        const parent = document.createElement('div')
        scratch.append(parent)
        return { parent, root: shadow() }
      },
      type(parent, next) {
        const ta = parent.querySelector('textarea')
        if (ta !== null) {
          ta.value = next
          ta.dispatchEvent(new Event('input', { bubbles: true }))
          return
        }
        const cm = parent.querySelector('.cm-content')
        if (cm === null) throw new Error('no input surface')
        ;(cm as HTMLElement).focus()
        document.execCommand('selectAll')
        document.execCommand('insertText', false, next)
      },
    })
    const failures = await runAllCases(cases)
    scratch.remove()
    return failures
  },
  editorValue: () => handle.getValue(),
  setValueFromHost: (v: string) => {
    handle.setValue(v)
  },
  recordCompositionEvents() {
    events.length = 0
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) {
      shadow().addEventListener(type, () => events.push(type), { capture: true })
    }
  },
  compositionEvents: () => [...events],
  previewScrollTop: () => shadow().querySelector('.readit-preview')?.scrollTop ?? -1,
  previewTopLine() {
    const preview = shadow().querySelector('.readit-preview')
    if (preview === null) return -1
    const top = preview.scrollTop
    let best = 0
    for (const el of preview.querySelectorAll('[data-line]')) {
      if ((el as HTMLElement).offsetTop <= top) best = Number(el.getAttribute('data-line'))
    }
    return best
  },
  editorTopLine: () => Number(shadow().querySelector('.cm-content')?.getAttribute('data-top') ?? 0),
  scrollEditorToLine(line: number) {
    pushes = 0
    const scroller = shadow().querySelector('.cm-scroller')
    const cm = shadow().querySelector('.cm-content')
    if (scroller === null || cm === null) return
    const lineEl = cm.children[Math.min(line, cm.children.length - 1)]
    if (lineEl !== undefined) scroller.scrollTop = (lineEl as HTMLElement).offsetTop
  },
  scrollPreviewTo(top: number) {
    pushes = 0
    const preview = shadow().querySelector('.readit-preview')
    if (preview !== null) {
      preview.scrollTop = top
      pushes = 1
    }
  },
  syncPushCount: () => pushes,
}
```

配套的全局声明放在 `browser/fixtures/main.ts` 顶部：

```ts
declare global {
  interface Window {
    readitFixture: {
      runContract(kind: 'plain' | 'codemirror'): Promise<string[]>
      editorValue(): string
      setValueFromHost(v: string): void
      recordCompositionEvents(): void
      compositionEvents(): string[]
      previewScrollTop(): number
      previewTopLine(): number
      editorTopLine(): number
      scrollEditorToLine(line: number): void
      scrollPreviewTo(top: number): void
      syncPushCount(): number
    }
  }
}
```

根 `playwright.config.ts` 的 `projects` 数组末尾追加（`webServer` 若 M3 段尚未写，一并加上）：

```ts
  {
    name: 'editor-chromium',
    testDir: 'browser/editor',
    use: { ...devices['Desktop Chrome'] },
  },
  {
    name: 'editor-webkit',
    testDir: 'browser/editor',
    use: { ...devices['Desktop Safari'] },
  },
```

```ts
  webServer: {
    command: 'npx vite --config browser/fixtures/vite.config.ts --port 5183 --strictPort browser/fixtures',
    url: 'http://localhost:5183/index.html',
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: 'http://localhost:5183' },
```

根 `package.json` 的 devDependencies 加 `"vite": "8.2.1"`（vite-node 6.0.0 已经在解析同一个版本，提升上来只是让 fixture 服务器可以直接用）。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit && npm install
npx vitest run packages/element/test/panes.test.ts
npx playwright test --project=editor-chromium
npx playwright test --project=editor-webkit
npm run typecheck && npm test
```

预期：`panes.test.ts` 6 条绿；`editor-chromium` 下 contract 3 条 + scroll-sync 3 条 + ime 4 条全绿；`editor-webkit` 下 contract 与 scroll-sync 绿、ime 4 条以 `GAP-IME-WEBKIT` 的理由 skipped（skip 的标题就是缺口的名字，每次跑都会印出来）；P6 的五个数字不变。

**IME 那条红了怎么办（这是本任务唯一一处必须按规则处置的地方）：**

1. `compositionEvents()` 返回空数组 → `Input.imeSetComposition` 在这个 Chromium 版本上没走真实组合路径。**停下，上报**，附上 CDP 的响应体与 `page.evaluate` 拿到的 `document.activeElement` 归属。不许改成 `page.dispatchEvent('compositionstart', …)` 让它变绿——那测的是我们自己造的事件流，是自我肯定。
2. 对照组（textarea）也红 → 是装置坏了，不是 CodeMirror 坏了。同样上报，先修装置。
3. 对照组绿、CodeMirror 红 → 这是**真缺陷**，走 systematic-debugging，不是改测试。
4. 若确认 CDP 路径在本环境完全不可用：把这四条整体降级为手工验证，`test.skip` 的标题改成 `GAP-IME-CHROMIUM: …`，并在提交信息里具名记录为覆盖缺口。**验收线 3 此时记为「未达成」，不是「通过」**——一条测不到真东西的验收线比没有验收线更糟。

- [ ] **Step 5: 提交**

```bash
cd /Users/mac08/Desktop/robot/readit
git add packages/element/src/panes.ts packages/element/src/index.ts packages/element/test/panes.test.ts \
        browser playwright.config.ts package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(element): source/split/plain 三档接线 + L3b-editor（含 IME 验收线）

createPanes() 收口模式状态机：read 只有预览，plain 建 textarea，
source/split 经 import('@readit/editor') 建 CodeMirror——element 对 editor
只有这一条边，且是动态的（P1）。每次重渲后在预览侧补原生 HTML 块的锚点，
再让滚动同步作废锚点缓存。

L3b 拆成独立的 editor project 与 element 分开跑（设计文档 §7.1）：M3 的失败
模式是「未知宿主的 CSS 污染」，M4 的是「输入法与虚拟滚动」，合在一个 job 里
红灯说不清是哪边坏的。

IME 走 CDP 的 Input.imeSetComposition + Input.insertText，那是渲染进程真正的
组合路径，compositionstart/update/end 由引擎自己发。三道自检钉住它不是自我
肯定：必须观察到组合事件、plain 档的 textarea 作为对照组同时跑同一串指令、
必须断言中间的预编辑串而不只是最终结果。WebKit 侧没有等价入口，四条以
GAP-IME-WEBKIT 具名 skip——skip 的标题就是缺口的名字,每次跑都印出来,
而不是记在某份文档里然后没人再看。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 新增契约提案

以下七条是共享契约 P1–P6 里没有、但 Task 13–17 需要的。**未经协调不要直接采用**——每条都可能与其他组的产物重名或冲突。

| # | 提案 | 影响面 | 理由 |
|---|---|---|---|
| 1 | **P1 的「element → editor 仅动态 import」明确为「运行时仅动态 import；`import type` 允许」** | 包边界守卫测试（M3 段）、Task 17 的 `panes.ts` | `panes.ts` 需要 `Editor` / `EditorKind` / `EditorOptions` 三个类型。禁掉 `import type` 的唯一替代是在 element 里重抄一遍 P2 的接口——那正好制造契约漂移，而漂移是这份契约要防的头号失败模式。守卫测试应当只看 `ts.isImportDeclaration` 且 `importClause.isTypeOnly !== true` 的那些（Task 14 的 `module-boundary.test.ts` 里已有可复用的实现）。 |
| 2 | **`MountOptions` 增 `loadHighlighter: (() => Promise<Highlighter>) | null`，默认 `null`** | P4、M3 段的 element 任务 | P1 禁止 element 在运行时 import `@readit/highlight`，而 SPEC §5.1 又要求「首次遇到围栏语言」才加载那 54 KB。两条同时成立的唯一办法是加载器由宿主注入。P4 现有的静态 `highlighter` 字段留着不变（宿主直接给实例的路径）。**不加这条，「第一次用到某围栏语言就 kick」在 M4 里没有可能的实现**，Task 15 只能把它做成永远不触发的死代码。 |
| 3 | **DOM 环境统一取 `happy-dom@20.11.2` 作为 `packages/element` 与 `packages/editor` 的 vitest environment** | M3 段的 element 任务、Task 13/15/16/17 | SPEC §13 把 linkedom 指给 L3 DOM 断言，那一层只需要静态树遍历。本组要断言 `focus()` / `activeElement`、`CompositionEvent` 派发、`template.content`、`dataset`、`getComputedStyle` —— linkedom 在这几处要么缺、要么行为与浏览器不同。core 侧继续用 linkedom，不动。 |
| 4 | **`::part(content)` 由 `panes.ts` 挂在预览 pane 上** | 设计文档 §9 修订 3、M3 段的 element 任务 | `part` 名字是永久公开 API，两处同时挂就成了两个不同的 part。split 档下宿主想改的是预览那一半，不是包住两个 pane 的外壳。若 M3 段已把 `content` 挂在别处，以 M3 为准，Task 17 改用无 part 的容器并上报。 |
| 5 | **`data-readit-pending` 作为宿主元素上的降级指示属性**（值是空格分隔的 `math` / `highlight`） | Task 15、M3 段的样式表 | SPEC §12 要求「降级必须可见」。属性本身只是状态，可见性要靠内建样式里的一条 `:host([data-readit-pending]) .readit-preview::before` 角标。属性名先定，样式归 M3 段的主题任务。 |
| 6 | **Playwright project 命名 `element-chromium` / `element-webkit` / `editor-chromium` / `editor-webkit`；fixture 服务器为 `browser/fixtures/` 上的 vite，端口 5183** | P5、M3 段的 L3b-element 任务、Task 17 | 设计文档 §7.1 要求「两个文件、两个 CI job 名」。若 M3 段已用别的 project 名或别的 fixture 方案（例如 esbuild + `page.addScriptTag`），以 M3 为准，Task 17 跟随——两套 fixture 装置是纯粹的重复。 |
| 7 | **根 devDependencies 加 `vite@8.2.1`** | 根 `package.json` | 只为 Playwright 的 `webServer`。`vite-node@6.0.0` 已经在解析同一版本（`package-lock.json:2948`），提升上来不引入新的传递依赖。若采纳提案 6 里 M3 的方案且它不需要 vite，这条随之作废。 |

**另有一条不是提案、是给编排者的输入：** 设计文档 §11 的验收线 3（IME）在 WebKit 上**结构性不可达**——Playwright 的 CDP 会话是 Chromium 独有的，WKWebView 侧没有等价入口。Task 17 把它落成一条具名 `test.skip`（`GAP-IME-WEBKIT`），每次跑都会在报告里印出来。SPEC §11 那一行应当同步标注「Chromium 可自动化验证；WebKit 手工验证，缺口具名」，而不是留成一条看上去通过了的验收线。这条 SPEC 修订属于 §9「对 SPEC 的修订」那张表，归做 SPEC 同步的那一组。

---

### Task 18: `--readit-*` 覆写通道 —— SPEC 只开两个通道，现在只有一个

> **为什么单列而不是并进 Task 3。** 一致性核查发现这条设计要求**无人认领**：
> SPEC §9.2 说对外只开两个覆写通道（`--readit-*` 自定义属性与 `::part()`），
> 而六组起草的产出里只有后者。Task 3 的起草者自己写明「只实现了 `::part()` 与
> `data-theme`，**没有实现 `--readit-*`**」并建议单列——理由是它比看上去贵：
> github-markdown-css 把变量声明在 `.markdown-body` **自己身上**，
> 要让宿主能覆写就得给每个主题生成一张桥接表。
>
> 按 writing-plans 的右尺寸判据，它够独立：**评审员可以否掉这个通道而批准 Task 3 的主题实现。**

**Files:**
- Create: `/Users/mac08/Desktop/robot/readit/packages/element/scripts/build-css-bridge.ts`
- Create: `/Users/mac08/Desktop/robot/readit/packages/element/src/css-bridge.ts`（**生成产物，提交进仓库**）
- Modify: `/Users/mac08/Desktop/robot/readit/packages/element/src/styles.ts`（Task 3 建；在 `ELEMENT_CSS` 与 `LIGHT_DOM_CSS` 里拼进桥接层）
- Modify: `/Users/mac08/Desktop/robot/readit/packages/element/package.json`（追加 `"build:css-bridge"` script）
- Test: `/Users/mac08/Desktop/robot/readit/packages/element/test/css-bridge.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `packages/element/src/styles.ts` 导出的 `ELEMENT_CSS: string` 与
  `LIGHT_DOM_CSS: string`（§0 A6）；`github-markdown-css@5.9.0` 的
  `github-markdown-light.css` / `github-markdown-dark.css`（Task 1 已装，§0 A1）
- Produces: `packages/element/src/css-bridge.ts` 导出
  `export const CSS_BRIDGE_LIGHT: string` / `export const CSS_BRIDGE_DARK: string`
  与 `export const BRIDGED_VARIABLES: readonly string[]`（供测试与文档核对）。
  Task 3 的 `ELEMENT_CSS` 把它们拼在 github-markdown-css **之后**、自定义规则**之前**

**桥接的形状。** github-markdown-css 长这样：

```css
.markdown-body { --fgColor-default: #1f2328; --bgColor-default: #ffffff; /* … */ }
```

宿主没法覆写它——`--fgColor-default` 是 GitHub 的内部名，且声明在元素自己身上，
宿主在 `:host` 上设同名变量会被这条更具体的声明盖掉。桥接层把每个变量重写成：

```css
.markdown-body { --fgColor-default: var(--readit-fg-default, #1f2328); }
```

于是宿主 `readit-view { --readit-fg-default: red }` 就生效了，而不设时行为逐字不变。

**命名映射规则**（`--fgColor-default` → `--readit-fg-default`）：去掉 `--`，
驼峰转连字符小写，加 `--readit-` 前缀。`--color-prettylights-syntax-comment` →
`--readit-color-prettylights-syntax-comment`（本来就是连字符，只加前缀）。

---

- [ ] **Step 1: 写会失败的测试**

新建 `/Users/mac08/Desktop/robot/readit/packages/element/test/css-bridge.test.ts`：

```ts
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { BRIDGED_VARIABLES, CSS_BRIDGE_DARK, CSS_BRIDGE_LIGHT } from '../src/css-bridge.js'
import { ELEMENT_CSS } from '../src/styles.js'

const require_ = createRequire(import.meta.url)
const readUpstream = (name: string): string =>
  readFileSync(require_.resolve(`github-markdown-css/${name}`), 'utf8')

/**
 * SPEC §9.2：「对外只开两个覆写通道——`--readit-*` 自定义属性与 `::part()`。」
 *
 * 这一层守的是第一个通道**真的存在且完整**。完整性是要紧的：漏掉一个变量，
 * 宿主就会遇到「其他颜色都能改，唯独这一个改不动」，而那种半通的 API 比没有更难用。
 * 所以断言是「上游声明的每一个变量都有桥」，不是「有一些桥」。
 */
describe('--readit-* 覆写通道', () => {
  it('上游 .markdown-body 声明的每个自定义属性都有桥，一个不漏', () => {
    for (const [file, bridge] of [
      ['github-markdown-light.css', CSS_BRIDGE_LIGHT],
      ['github-markdown-dark.css', CSS_BRIDGE_DARK],
    ] as const) {
      const upstream = readUpstream(file)
      const declared = new Set(
        [...upstream.matchAll(/^\s*(--[a-zA-Z][\w-]*)\s*:/gm)].map((m) => m[1]!),
      )
      expect(declared.size, `${file} 应声明大量变量`).toBeGreaterThan(20)
      const missing = [...declared].filter((v) => !bridge.includes(`${v}:`))
      expect(missing, `${file} 有变量没有桥`).toEqual([])
    }
  })

  it('每个桥都是 var(--readit-X, 原值) 的形式，不改默认行为', () => {
    // 抽查三个有代表性的：前景色、背景色、语法高亮色
    expect(CSS_BRIDGE_LIGHT).toMatch(/--fgColor-default:\s*var\(--readit-fg-color-default,\s*#[0-9a-f]{3,8}\)/i)
    expect(CSS_BRIDGE_LIGHT).toMatch(/--bgColor-default:\s*var\(--readit-bg-color-default,\s*#[0-9a-f]{3,8}\)/i)
    expect(CSS_BRIDGE_DARK).toMatch(/--color-prettylights-syntax-comment:\s*var\(--readit-color-prettylights-syntax-comment,/)
  })

  it('不设 --readit-* 时，解析出的值与上游逐字相同', () => {
    // 桥接不得改变默认外观。对每个变量比对 fallback 与上游原值。
    const upstream = readUpstream('github-markdown-light.css')
    const original = new Map(
      [...upstream.matchAll(/^\s*(--[a-zA-Z][\w-]*)\s*:\s*([^;]+);/gm)].map(
        (m) => [m[1]!, m[2]!.trim()] as const,
      ),
    )
    const bridged = [...CSS_BRIDGE_LIGHT.matchAll(/(--[\w-]+):\s*var\(--readit-[\w-]+,\s*([^)]+)\)/g)]
    expect(bridged.length).toBe(original.size)
    for (const [, name, fallback] of bridged) {
      expect(fallback!.trim(), `${name} 的 fallback 与上游不一致`).toBe(original.get(name!))
    }
  })

  it('BRIDGED_VARIABLES 与桥接表一致，可用于文档与宿主自查', () => {
    expect(BRIDGED_VARIABLES.length).toBeGreaterThan(20)
    for (const v of BRIDGED_VARIABLES) {
      expect(v.startsWith('--readit-'), `${v} 应以 --readit- 开头`).toBe(true)
    }
    expect(new Set(BRIDGED_VARIABLES).size, '不得有重复').toBe(BRIDGED_VARIABLES.length)
  })

  it('桥接层已拼进 ELEMENT_CSS，且在 github-markdown-css 之后', () => {
    expect(ELEMENT_CSS).toContain('var(--readit-fg-color-default,')
    const upstreamMark = ELEMENT_CSS.indexOf('.markdown-body')
    const bridgeMark = ELEMENT_CSS.indexOf('var(--readit-fg-color-default,')
    expect(upstreamMark, 'ELEMENT_CSS 应含上游样式').toBeGreaterThanOrEqual(0)
    expect(bridgeMark, '桥接必须在上游之后，否则会被上游盖掉').toBeGreaterThan(upstreamMark)
  })
})
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd /Users/mac08/Desktop/robot/readit && npx vitest run packages/element/test/css-bridge.test.ts
```

预期：**全红**，首个错误是 `Cannot find module '../src/css-bridge.js'`。

- [ ] **Step 3: 写生成脚本**

新建 `/Users/mac08/Desktop/robot/readit/packages/element/scripts/build-css-bridge.ts`：

```ts
/**
 * 从 github-markdown-css 生成 --readit-* 覆写桥接层。
 *
 * 为什么生成而不是手写：上游有几十个变量，且会随版本变化。手写一张表意味着
 * 升级 github-markdown-css 时要人肉比对，而漏掉一个的症状是「宿主发现某个颜色
 * 改不动」——一个不会报错、只会让人困惑的失败。生成 + 一条「一个不漏」的断言
 * 把它变成构建期就能发现的事。
 *
 * 产物提交进仓库（与 packages/core/data/ 的先例一致）：src/ 里不跑构建脚本，
 * 测试与打包都直接读生成好的 .ts。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
const OUT = fileURLToPath(new URL('../src/css-bridge.ts', import.meta.url))

/** `--fgColor-default` → `--readit-fg-color-default` */
function readitName(cssVar: string): string {
  const bare = cssVar.slice(2)
  const kebab = bare.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  return `--readit-${kebab}`
}

interface Declaration { name: string; value: string }

function declarations(css: string): Declaration[] {
  const out: Declaration[] = []
  const seen = new Set<string>()
  for (const m of css.matchAll(/^\s*(--[a-zA-Z][\w-]*)\s*:\s*([^;]+);/gm)) {
    const name = m[1]!
    if (seen.has(name)) continue   // 上游若重复声明，取首次（与 CSS 层叠无关，我们只是重写它）
    seen.add(name)
    out.push({ name, value: m[2]!.trim() })
  }
  return out
}

function bridge(decls: readonly Declaration[]): string {
  const body = decls
    .map((d) => `  ${d.name}: var(${readitName(d.name)}, ${d.value});`)
    .join('\n')
  return `.markdown-body {\n${body}\n}`
}

const light = declarations(readFileSync(require_.resolve('github-markdown-css/github-markdown-light.css'), 'utf8'))
const dark = declarations(readFileSync(require_.resolve('github-markdown-css/github-markdown-dark.css'), 'utf8'))

const names = [...new Set([...light, ...dark].map((d) => readitName(d.name)))].sort()

const file = `// 由 scripts/build-css-bridge.ts 生成，不要手改。
// 重新生成：npm run build:css-bridge --workspace @readit/element
//
// SPEC §9.2 说对外只开两个覆写通道，这是其中之一。上游 github-markdown-css 把变量
// 声明在 .markdown-body 自己身上，宿主在 :host 上设同名变量会被盖掉——所以要把每个
// 声明重写成 var(--readit-X, 原值)，宿主才有覆写点，而不设时行为逐字不变。

export const CSS_BRIDGE_LIGHT = ${JSON.stringify(bridge(light))}

export const CSS_BRIDGE_DARK = ${JSON.stringify(bridge(dark))}

/** 宿主可覆写的全部变量名，供文档与自查使用。 */
export const BRIDGED_VARIABLES: readonly string[] = Object.freeze(${JSON.stringify(names, null, 2)})
`

writeFileSync(OUT, file, 'utf8')
process.stdout.write(`wrote ${names.length} bridged variables to ${OUT}\n`)
```

`packages/element/package.json` 的 `scripts` 追加（**追加，不替换整块**，§0 A1）：

```json
"build:css-bridge": "tsx scripts/build-css-bridge.ts"
```

跑一次生成：

```bash
cd /Users/mac08/Desktop/robot/readit && npm run build:css-bridge --workspace @readit/element
```

- [ ] **Step 4: 把桥接层拼进 styles.ts**

在 `packages/element/src/styles.ts` 里（Task 3 建的），把 `ELEMENT_CSS` 与 `LIGHT_DOM_CSS`
的拼接顺序改成 **上游 → 桥接 → readit 自己的规则**。按字符串定位，不用行号（§0 A1）：

```ts
import { CSS_BRIDGE_DARK, CSS_BRIDGE_LIGHT } from './css-bridge.js'

// 桥接必须在上游之后：它重写的是上游声明的同名变量，放在前面会被上游盖掉。
// 放在 readit 自己的规则之前：那些规则要能消费桥接后的值。
export const ELEMENT_CSS = [
  GITHUB_MARKDOWN_LIGHT,
  GITHUB_MARKDOWN_DARK,
  CSS_BRIDGE_LIGHT,
  CSS_BRIDGE_DARK,
  READIT_RULES,
].join('\n')
```

（`GITHUB_MARKDOWN_LIGHT` / `GITHUB_MARKDOWN_DARK` / `READIT_RULES` 是 Task 3 已有的常量名；
若 Task 3 用了别的名字，以 Task 3 的实际产出为准，只保证**顺序**是上游 → 桥接 → 自有规则。）

- [ ] **Step 5: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit && npx vitest run packages/element/test/css-bridge.test.ts
```

预期：**5 passed**。

再跑全量与类型：

```bash
cd /Users/mac08/Desktop/robot/readit && npm test && npm run typecheck
```

预期：2318 条既有测试全绿 + 前序任务新增的若干条 + 本任务新增 5 条，0 失败；
typecheck exit 0。四条不变量逐条核（语料 56/68、CommonMark 649+3、GFM 658+14、TEMPORARY 0），
**任何一个变了都是回归，上报不要重钉**（§0 A11）。

- [ ] **Step 6: 提交**

```bash
cd /Users/mac08/Desktop/robot/readit
git add packages/element/scripts/build-css-bridge.ts packages/element/src/css-bridge.ts \
        packages/element/src/styles.ts packages/element/package.json \
        packages/element/test/css-bridge.test.ts
git commit -m "feat(element): --readit-* 覆写通道，SPEC 只开两个通道而此前只有一个

SPEC §9.2 说对外只开两个覆写通道（--readit-* 与 ::part()），但六组起草的产出
里只有后者——一致性核查抓到的一条真缺口。

上游 github-markdown-css 把变量声明在 .markdown-body 自己身上，宿主在 :host 上
设同名变量会被这条更具体的声明盖掉。桥接层把每个声明重写成
var(--readit-X, 原值)：宿主有了覆写点，不设时行为逐字不变。

生成而不手写。上游几十个变量且随版本变化，手写表意味着升级时要人肉比对，
而漏掉一个的症状是「宿主发现某个颜色改不动」——不报错、只让人困惑的失败。
配一条「上游声明的每个变量都有桥，一个不漏」的断言，把它变成构建期可发现。

另一条断言核对每个桥的 fallback 与上游原值逐字相同——桥接不得改变默认外观。"
```

---

### Task 19: SPEC 同步 —— 把设计期发现的矛盾与偏离改回上位契约

> 这个任务在收尾时做，因为它要落地的四条修订全部依赖前面任务的实际产出。
> **它不是文档整理**：设计文档 §9 列的四条里有一条是 SPEC 现存的**真矛盾**
> （`mode: 'plain'` 在 M4 里程碑行出现却从未定义，且不在 §9.4 的联合类型里），
> 留着它，计划三会继承一份自相矛盾的上位契约。计划一已经因为一条**有损转录**
> 的验收线吃过亏——那条"100% diff 通过"丢掉了 §4 一直带着的"（带具名白名单）"，
> 靠两跳转录进入执行，没人发现它本来就不可达。

**Files:**
- Modify: `/Users/mac08/Desktop/robot/readit/SPEC.md`（§5 包表、§9.2 `::part()` 名单、§9.4 `mount()` 签名、§11.3 查找、§14 M4 行）
- Modify: `/Users/mac08/Desktop/robot/readit/docs/superpowers/specs/2026-08-09-plan2-element-editor-design.md`（§9 修订表标记为已落地）
- Test: `/Users/mac08/Desktop/robot/readit/test/spec-sync.test.ts`

**Interfaces:**
- Consumes: 前 17 个任务的实际产出——`MountOptions` / `MountHandle` 的最终形状
  （`packages/element/src/types.ts`）、`::part()` 的实际挂点（Task 3 与 §0 A8）、
  `mode` 的四个取值（Task 4）
- Produces: 无代码产物。产出的是**一份与实现一致的上位契约**，以及一条守住这件事的测试

---

- [ ] **Step 1: 写会失败的测试**

新建 `/Users/mac08/Desktop/robot/readit/test/spec-sync.test.ts`：

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * SPEC 与实现的同步守卫。
 *
 * 这不是文档 lint。它守的是一类具体的失效：**上位契约与实现漂移，而没有任何东西会响。**
 * 计划一栽过两次——`mode: 'plain'` 在 M4 里程碑行出现却从未定义（实现者只能猜），
 * 以及验收线「100% diff 通过」丢掉了 §4 原有的「（带具名白名单）」限定词
 * （一个从来没人打算设的不可达标准，靠两跳转录进入了执行）。
 *
 * 断言的是「SPEC 里写的那几个具体串，与代码里的实际取值一致」。
 * 它抓不到所有漂移，但抓得到这几条已经付过学费的。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const spec = readFileSync(`${ROOT}SPEC.md`, 'utf8')
const elementTypes = readFileSync(`${ROOT}packages/element/src/types.ts`, 'utf8')

describe('SPEC 与实现同步', () => {
  it('§9.4 的 mode 联合类型含全部四个取值，与 element 的 Mode 一致', () => {
    // 实现侧的真源
    const match = elementTypes.match(/export type Mode = ([^\n]+)/)
    expect(match, 'packages/element/src/types.ts 里应有 export type Mode').not.toBeNull()
    const impl = new Set(
      [...(match![1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]),
    )
    expect(impl).toEqual(new Set(['read', 'source', 'split', 'plain']))

    // SPEC 侧必须逐个出现在 §9.4 的签名里
    const sig = spec.match(/mount\(el, \{[\s\S]{0,400}?\}\)/)
    expect(sig, 'SPEC §9.4 应有 mount() 签名块').not.toBeNull()
    for (const mode of impl) {
      expect(sig![0], `§9.4 的 mode 联合类型缺 '${mode}'`).toContain(`'${mode}'`)
    }
  })

  it("'plain' 在 SPEC 里有定义，不只是出现在里程碑表", () => {
    // 计划一的教训：一个词只在验收行出现、从不被定义，实现者只能猜。
    const occurrences = [...spec.matchAll(/'plain'/g)].length
    expect(occurrences, "'plain' 只出现一次说明它仍未被定义").toBeGreaterThan(1)
    expect(spec).toMatch(/`'plain'`[^\n]*textarea|textarea[^\n]*`'plain'`/)
  })

  it('§9.4 的 mount() 返回对象不含 find —— 它属 M6', () => {
    const sig = spec.match(/-> \{[^}]*\}/)
    expect(sig, 'SPEC §9.4 应有返回对象').not.toBeNull()
    expect(sig![0]).not.toContain('find')
    // 且必须写明它去哪了，否则读者会以为是遗漏
    expect(spec).toMatch(/find[^\n]*M6|M6[^\n]*find/)
  })

  it('§9.2 的 ::part() 名单只开三个，mermaid 推迟 M5', () => {
    const parts = spec.match(/`::part\(\)` 名字是永久公开 API`?\*\*[\s\S]{0,200}/)
    expect(parts, 'SPEC §9.2 应有 ::part() 名单段').not.toBeNull()
    expect(parts![0]).toContain('root')
    expect(parts![0]).toContain('content')
    expect(parts![0]).toContain('code-block')
    expect(parts![0]).toMatch(/mermaid[^\n]*M5/)
  })

  it('§5 包表把 @readit/find 标为 M6', () => {
    const row = spec.split('\n').find((l) => l.includes('@readit/find'))
    expect(row, 'SPEC §5 应有 @readit/find 行').toBeDefined()
    expect(row!).toContain('M6')
  })
})
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd /Users/mac08/Desktop/robot/readit && npx vitest run test/spec-sync.test.ts
```

预期：**5 条全红**。`mode` 那条报 `§9.4 的 mode 联合类型缺 'plain'`；
`'plain'` 那条报 `只出现一次说明它仍未被定义`；`find` 那条报返回对象里有 `find`；
`::part()` 那条报缺 `mermaid…M5` 的说明；包表那条报 `@readit/find` 行不含 `M6`。

若某条**意外地绿**，先查是不是断言写松了，再改 SPEC。

- [ ] **Step 3: 改 SPEC**

**§9.4 的 `mount()` 签名**，把 `mode` 补全并在下方补一段定义：

```
mount(el, {
  value, mode: 'read'|'source'|'split'|'plain', shadow: true, theme: 'auto',
  baseUrl, inlineMath: 'github', math: null, highlighter, emojiBase, onNavigate,
}) -> { setValue, getValue, setMode, setTheme, destroy }
```

紧随其后加：

> **四个模式。** `read` 只读渲染；`source` 用 CodeMirror 编辑源码；`split` 左源码右预览；
> **`'plain'` 是轻量编辑档——纯 textarea，不加载 CodeMirror**，给「想能改字但不想付
> 176,654 B」的嵌入方。
>
> ⚠️ 本条于 2026-08-09 修订。原文的 `mode` 联合类型只有三个取值，而 §14 的 M4 里程碑行
> 写着交付「`mode:'plain'` 档」——**`'plain'` 从未被定义过，也不在联合类型里**。
> 这是一处真矛盾，且正是计划一栽过两次的那类：实现者对着一个含义不明的词自己猜。
>
> **`find` 不在返回对象里，它属 M6**（`@readit/find`，见 §11.3）。计划一有过一个
> `readFrontmatterOptions` 长期是「公共 API 里的永久 no-op」，宿主读了签名接进管线、
> 静默拿不到任何东西。加方法是向后兼容的，留空壳不是。

**§9.2 的 `::part()` 名单**，把那句改成：

> **`::part()` 名字是永久公开 API**——先只开 `root` / `content` / `code-block`，
> 加容易删是破坏性变更。**`mermaid` 推迟到 M5**：那个容器在 M5 之前根本不存在，
> 现在钉一个名字，等 M5 真做时结构若不同就被自己锁死了。

**§5 包表**的 `@readit/find` 行，职责列改成「查找（Phase B）—— **M6**」。

**§11.3 查找**段开头加一行：

> **归属：M6。** 查找的实现（`@readit/find`、CSS Custom Highlight API、shadow root 内的
> `::highlight` 规则）不在计划二范围内；`mount()` 的返回对象在 M6 之前不含 `find`。

**§14 的 M4 行**，验收列改成「IME 组合测试过（**若 Playwright 无法复现真实输入法行为，
降级为手工验证并具名记录为覆盖缺口**——见计划二设计 §4.4）」。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/mac08/Desktop/robot/readit && npx vitest run test/spec-sync.test.ts
```

预期：**5 passed**。

然后跑全量确认没碰坏别的：

```bash
cd /Users/mac08/Desktop/robot/readit && npm test && npm run typecheck
```

预期：2318 条既有测试全绿 + 前 17 个任务新增的若干条 + 本任务新增 5 条，0 失败；
typecheck exit 0。

- [ ] **Step 5: 把设计文档 §9 的修订表标记为已落地**

在 `docs/superpowers/specs/2026-08-09-plan2-element-editor-design.md` 的 §9 表格每行末尾
补一列「状态」，四条填「✅ Task 19 已落地」。各组提案追加的第 5–9 条同样落地并标记。

- [ ] **Step 6: 提交**

```bash
cd /Users/mac08/Desktop/robot/readit
git add SPEC.md docs/superpowers/specs/2026-08-09-plan2-element-editor-design.md test/spec-sync.test.ts
git commit -m "spec: 同步计划二发现的四条矛盾与偏离，并加一条守住它的测试

§9.4 的 mode 联合类型补 'plain' 并定义它——这是 SPEC 现存的一处真矛盾：
'plain' 在 §14 的 M4 里程碑行出现却从未定义，也不在联合类型里，
实现者只能猜。计划一已经因为同类问题栽过两次。

§9.4 标注 find 属 M6 且不在返回对象里；§9.2 的 ::part() 名单只开三个、
mermaid 推迟 M5（那个容器 M5 前不存在，现在钉名字等于自锁）；
§5 包表与 §11.3 标注 @readit/find 属 M6；
§14 的 M4 验收行写明 IME 的降级处置。

test/spec-sync.test.ts 守住这几条。它不是文档 lint——它守的是
「上位契约与实现漂移而没有任何东西会响」这一类失效，
而这个项目已经为它付过两次学费。"
```

---

## 执行建议

**按 2–4 个任务一批派发，每批末尾一次评审**，不要一任务一轮。

理由：计划一对 33 个任务每个都跑了完整的「任务书 → 实现者 → 评审 → 修复轮 → 复审」，
外加 6 轮全分支修复与约 15 次评审派发，用户明确反馈过重。这套重型流程对承重的
保真度引擎是值的（它确实抓到 4 条任务级评审看不见的 Critical），但被无差别套用了。

判据：**这件事错了会不会静默地毁掉一个承重主张？**
会 → 上完整循环；不会 → 批量做完一次审。

建议的批次：

| 批 | 任务 | 为什么这样分 |
|---|---|---|
| 1 | 1–2 | 骨架 + 注入路径。Task 2 的 Trusted Types 那一级是安全相关，值得单独看 |
| 2 | 3–6 | element 运行时，内部耦合紧，一起审才看得出接缝对不对 |
| 3 | 7–8 | 高亮两个实现。onig.wasm 那颗地雷在这批引爆 |
| 4 | 9–10 | 构建与分发三条门。注意 §0.2：这时的 dist 是「假绿」 |
| 5 | 11–12, 18 | 浏览器测试基建 + 视觉回归 + `--readit-*` 通道。**M3 段到此完整** |
| 6 | 13–15 | 编辑器契约 + 两个实现 + 重渲染 |
| 7 | 16–17 | 滚动同步 + IME。IME 那条带风险，见设计 §4.4 |
| 8 | 19 | SPEC 同步收尾（要等 Task 13–17 的实际产出才能改准） |

**每批派发时必须把 §0 编排裁决逐字附上**——它压过任务正文，而实现者只看得见自己那几个任务。
计划一的教训：契约不进任务书，实现者就会踩到它（Task 9 的 C3(a) 事故就是这么来的）。
