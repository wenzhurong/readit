# 计划二设计：element + Shadow DOM + 编辑器（M3 + M4）

**上位契约：** `readit/SPEC.md`。本文档细化其中的 M3 与 M4，不推翻它；凡与 SPEC 不一致之处，
在 §9「对 SPEC 的修订」里逐条列明并说明理由。

**前置状态：** 计划一（M0+M1+M2）已合入 `main`。Phase A 引擎可用：语料保真度 56/68，
CommonMark 649/652 + 3 PERMANENT，GFM 658/672 + 14 PERMANENT，2318 条测试全绿，
三平台 CI 通过。剩余债务见 `docs/plans/2026-08-08-plan2-debt.md`。

---

## 1. 四条决策与理由

设计前问了四个问题，答案锁定如下。**这四条是本计划的前提，不在实施期重新讨论。**

| # | 决策 | 理由 |
|---|---|---|
| 1 | **M3 与 M4 一起做**，照 SPEC 原切分 | 用户裁定。控制端曾建议只做 M3（M3 单独即完整交付物、M4 表面积大、两者失败模式不重叠），用户选择完整范围。**保留意见的兑现方式见 §7：L3b 拆成两个文件两个 CI job，让红灯自己说清是哪边。** |
| 2 | **构建进范围，发布不进** | 「可嵌入」是 M3 的核心主张，而今天没有任何宿主装得上 readit（两个包 `private: true`，`exports` 指向裸 `.ts`）。产出 `dist/` 并用 `npm pack` → 装进隔离宿主 fixture 验证，把主张变成可证伪的；不做 npm 发布这个不可逆动作（版本号烧掉、名字占掉，且 API 在 M4 还会动）。 |
| 3 | **`mode: 'plain'` = 轻量编辑档**：纯 textarea，不加载 CodeMirror | SPEC 里 `'plain'` **只出现一次**（M4 里程碑行），从未定义，且与 §9.4 的 `mode: 'read'\|'source'\|'split'` 矛盾。「档」这个词在 SPEC 中一贯表示「同一能力的不同成本层级」（§4 保真度三档、§5.2 高亮双默认），故取此义。实际价值：嵌入方想要能改字但不想付 CodeMirror 的 176,654 B。 |
| 4 | **三个工作区包 → 一个发布产物** | SPEC §5 列工作区包、§9.3 描述发布产物的子路径，两者兼容。选它而非「单包多入口」，是因为**动态 import 边界必须由结构保证而非纪律保证**——SPEC §5.1 要求四个大件是四个互相独立的动态 import，单包多入口会把这条降级成自觉，而这个项目已反复证明纪律会烂、结构不会。 |

---

## 2. 架构与包边界

三个新工作区包，加上已有的 `@readit/core`（同构引擎）与 `@readit/math`。

| 包 | 拥有什么 | 关键依赖（精确版本） | Node 可 import |
|---|---|---|---|
| `@readit/element` | Web Component + `mount()` + Shadow DOM + 主题 + 模式状态机 + 导航历史栈 + `setHtml()` 注入路径 | github-markdown-css **5.9.0** | ❌ 浏览器专属 |
| `@readit/highlight` | `Highlighter` adapter + 两个实现 | @wooorm/starry-night **3.10.0** / shiki **4.4.2** | ✅ 纯函数 |
| `@readit/editor` | CodeMirror 源码模式 + 滚动同步 + `plain` 档 | @codemirror/view **6.43.8**、state **6.7.1**、language **6.12.4**、commands **6.10.4**、lang-markdown **6.5.2**、style-mod **>=4.1.2** | ❌ 浏览器专属 |

### 2.1 动态 import 边界 == 包边界

```
readit                      ~60–70 KB   急加载：core + element
  ./plugins/highlight       ~54 KB      首次遇到围栏语言
  ./plugins/math            ~677 KB     首次遇到 $        （计划一已建）
  ./editor                  ~177 KB     首次切进 source / split
  ./plugins/mermaid         ~1–1.5 MB   M5，本计划不做
```

体积数字取自 SPEC §5.1（2026-08-06 实测，`esbuild --bundle --minify` + `gzip -9`）。

### 2.2 一条不可让的边界

**`.` 入口不得 import 任何浏览器专属内容。** `import { render } from 'readit'` 在 Node 里必须
直接拿到 HTML 字符串——这是计划一 Phase A 同构纯度的延续，也是 SSR 宿主唯一的入口。
`@readit/element` 只出现在 `./element` 子路径下，不进 `.` 的依赖图。

**这条做成一条会失败的测试**（在 Node 里 import `.`，断言 `document` / `window` / `navigator`
全程未被触及），不做成注释。计划一的经验是注释会漂移。

**推论：** `defineReadit()` 与 `mount()` 只能从 `./element` 取，宿主多写一行 import。这是刻意的。

### 2.3 为什么 `@readit/highlight` 是纯函数

高亮是 M3 里唯一既属浏览器层、又能被 Node 侧断言的部分。把它做成纯函数意味着它的保真度
进现有的离线测试层，不必等浏览器起来。这不是巧合，是设计选择。

---

## 3. element 的运行时

### 3.1 注册与挂载

`defineReadit(tag = 'readit-view')`，内部 `customElements.get(tag)` 守卫。
**import 时不自动 `customElements.define`**——同页两个版本会抛不可恢复的 `NotSupportedError`。

命令式入口与自定义元素共用同一份内核：

```ts
mount(el, {
  value, mode: 'read'|'source'|'split'|'plain', shadow: true, theme: 'auto',
  baseUrl, inlineMath: 'github', math: null, highlighter, emojiBase, onNavigate,
}) -> { setValue, getValue, setMode, setTheme, destroy }
```

`emojiBase` 是计划一新增的选项（离线宿主用它把自定义 emoji 指回本地打包的 PNG，
见 `RenderOptions.emojiBase` 的文档注释与 SPEC §6 规则 10 的冲突说明）。

### 3.2 四个模式

| mode | 渲染 | 加载 CodeMirror |
|---|---|---|
| `read` | 只读渲染 | 否 |
| `source` | CodeMirror 编辑源码 | 是（+177 KB） |
| `split` | 左源码右预览 | 是 |
| `plain` | textarea 编辑源码 | **否** |

### 3.3 Shadow DOM 与主题

照 SPEC §9.1/§9.2 执行，无偏离：

- Shadow DOM **`open` 为默认**；`shadow: false` 逃生舱保留给需要宿主自行改样式、
  或对 find-in-page / ARIA 有特殊要求的场景
- 主题用 github-markdown-css 的**单主题文件**（`github-markdown-light.css` / `-dark.css`，
  各 22,219 B），scope 在 `:host([data-theme=…])` 下。
  ⚠️ 合并版 `github-markdown.css` 的 dark 规则嵌在 `@media (prefers-color-scheme: dark)` 里，
  在浅色系统上无论放哪都不生效——用单主题文件不是偏好，是因为合并版在这里坏掉
- `theme: 'auto'` 读 `getComputedStyle(host).colorScheme`（继承属性，跨 shadow 边界，
  所以宿主设在 `:root`、`.dark` 包装器还是没设都工作）
- 对外只开 `--readit-*` 自定义属性与 `::part()`
- **永不写 `document.documentElement` 或 `document.body`**

### 3.4 导航是元素的能力，不是壳的

照 SPEC §11.2：

| 类型 | 行为 |
|---|---|
| `./other.md` | 拦截，走元素内部的历史栈；`onNavigate(path)` 回调交宿主决定如何取内容 |
| `#slug` | **必须拦截并自己搭桥。** GitHub 把 `id` 放在兄弟 `<a id="user-content-slug">` 上、`href` 却是不带前缀的 `#slug`，靠前端 JS 搭桥；而 fragment 本来就不跨 shadow 边界。照抄 GitHub 的 DOM（保①档）+ 自己写桥接（保可用），两者不冲突 |
| 外部 `http(s)` | 交系统浏览器 |

**前进/后退是元素的能力。** M6 的「导航」指的是壳把 `onNavigate` 接到文件读取上，不是历史栈本身。

### 3.5 `destroy()` 与泄漏检测

`destroy()` 是强制的：拆 CodeMirror view、所有 ResizeObserver / MutationObserver、
matchMedia 监听。在长生命周期的宿主 SPA 里漏掉这些是可嵌入组件的经典 bug。

**用一条泄漏检测测试守住**（挂载/销毁 50 次后断言监听器计数归零），不靠代码评审看。

### 3.6 注入路径唯一化

所有 HTML 入 DOM 走一个内部 `setHtml(el, str)`，三级：

1. `'setHTML' in Element.prototype` → `Element.setHTML()`
2. 否则 `window.trustedTypes` 存在 → 单一 Trusted Types 策略
   （`DOMPurify.sanitize(s, { RETURN_TRUSTED_TYPE: true })`）
3. 否则对**已消毒**内容用 `innerHTML`

**没有第 2 级，任何下发 `require-trusted-types-for 'script'` 的企业宿主里组件直接硬抛，
而本地开发永远不会暴露。** 所以它需要一条模拟该 CSP 的测试——否则这一级等于没写。

---

## 4. 编辑器、滚动同步与 `plain` 档

### 4.1 两个编辑实现，一个契约

CodeMirror 走 `./editor` 动态 import，`root: ShadowRoot`（官方支持，
`new EditorView({parent})` 会自行推断）。`plain` 档是同一个编辑接口的第二个实现（textarea），
两者共用 `setValue / getValue / onChange` 契约。

**这是又一处「两个实现才算验证过一个抽象」**——与高亮双实现同理。

### 4.2 重渲染策略

SPEC 未规定，本设计定死。

**增量重渲在架构上不可能**：`render()` 返回整块字符串。SPEC 的决策台账当初否掉 comrak-wasm
的理由之一正是「返回整块 HTML 字符串故无法增量重渲」，markdown-it 同理。

split / source 模式下：

1. 输入 → 防抖 → `requestAnimationFrame` 批处理 → 整体 `render()` 重渲
2. 每次重渲前跑 `scan()`（计划一已从 `.` 导出的同步预扫描），检测是否出现**新构造**
   （第一次敲出 `$`、第一次敲出 ```` ```mermaid ````、第一次用到某个围栏语言）
3. 若有，异步 kick `prepare()`，加载完再渲一次；**这期间按已加载的能力降级渲染**
   （§12「降级必须可见」——不是空白，不是抛错）

**防抖间隔不猜，且「按 p95 定」这句本身要说清是什么的 p95。** 具体做法：对
`corpus/real-world/` 全部 6 个文件各跑 100 次 `render()`，取全部样本的 p95 耗时 `T`，
防抖间隔取 `max(T, 16ms)`（16ms 是一帧，低于它防抖没有意义）。把这次测量提交成一条测试
——不是记在文档里，而是一条会随代码变慢而失败的断言。

这个项目已因猜数字栽过两次（验收线的有损转录、`imageStyle` 的 n=1 推断），
所以「测量」这个词在这里必须落到一个具体的分布、一个具体的样本量、一个具体的门。

### 4.3 滚动同步

走 `data-line`，**块级粒度**。markdown-it 只在块级 token 上有 `map`，行内全无——
字符级同步不是没做，是拿不到数据。

**⚠️ 计划一留下的、直接落到 M4 头上的缺口：原生 HTML 块没有滚动锚点。**
`sourceline.ts` 会给 `html_block` token 打 `data-line`，但 markdown-it 的 `html_block`
渲染器只发 `token.content`、**忽略 attrs**，所以那个属性算出来就被丢掉。全分支评审记录了这一点。
对一个几乎全是原生 HTML 的 README（`real-world/mermaid` 就是），滚动同步会在那些区段失灵。

**处理方式：在 element 侧合成锚点，不改 Phase A 的输出字节。** 改 Phase A 会动 56/68 那条
保真度基线，代价远大于收益。

**⚠️ 滚动同步没有 oracle。** `data-line` 被归一化器的 `dropDataLine` 剥掉，所以它的正确性
**对语料套件完全不可见**。它需要自己的一层测试，且那层测试是唯一能证伪它的东西。

### 4.4 IME

中日韩输入法在 Shadow Root 内的 CodeMirror 里组合，是 **M4 的唯一验收线**。只能在真浏览器里测。

**已知风险，实施期须先解决：** Playwright 对 IME 组合的支持不是一等的。可行路径是通过
CDP 或直接派发 `compositionstart` / `compositionupdate` / `compositionend` 事件序列，
但那**模拟的是事件流，不是真实输入法**。若实测发现事件序列无法复现真实 IME 的行为，
**上报而不是把测试写成自我肯定**——一条测不到真东西的验收线比没有验收线更糟。
备选是把这一条降级为手工验证并具名记录为覆盖缺口。

---

## 5. 高亮

### 5.1 双默认

`Highlighter` 接口计划一已建（`{ highlight(code, lang): string | null, supports(lang): boolean }`），
本计划填两个实现。

| | 桌面壳默认 | 嵌入默认 |
|---|---|---|
| 实现 | starry-night 3.10.0 | Shiki 4.4.2（JS 正则引擎） |
| 体积 | ~215 KB gzip（本地磁盘，成本≈0） | ~54 KB gzip，**零 WASM** |
| 输出 | GitHub 真实的 `pl-*` class + Primer 变量 | 内联 hex 色值，用 GitHub 的 VS Code 主题 |

两个实现不是冗余：**只有一个实现的适配器接口等于没有被验证过。** 这个项目刚在 D2-1 上
证明了 n=1 不是测量，对抽象同理。

### 5.2 onig.wasm：计划一的离线门恰好能抓的地雷

starry-night 的默认浏览器路径**硬编码** `fetch('https://esm.sh/vscode-oniguruma@2/release/onig.wasm')`。
必须覆写 `getOnigurumaUrlFetch` 指向本地文件。SPEC 原话：「**不改就直接违反离线约束，
且在联网开发机上永远测不出来**」。

计划一建的离线门（`fetch` + `net.Socket.connect` + `dns` 四个面 64 个入口 + `dgram`，
外加 CI 的 `unshare --net` 无出网命名空间）**正是能测出它的东西**。这条地雷会在第一次跑套件时炸，
而不是在 M6 某个联网的开发机上静默通过。

### 5.3 保真度归档

**高亮输出归 ③档，不撞 GitHub oracle。** D-TOKEN 已写死：20 种 TreeLights 语言的 token 划分
与 GitHub 不同且永远不同。所以对**自家冻结黄金文件**，锁死依赖版本——与数学（D-MATH）同一套办法。

**须写进计划的一件事：语料套件目前对语法高亮的覆盖是零。** 它跑 `highlighter: null`，
而归一化器的 `flattenHighlight` 把两侧的高亮 span 一起抹平。高亮落地时打开的是一个
**当前语料完全看不见的保真面**。分工是：

- ①档能验的只有 wrapper class（语言识别对不对、外壳对不对）
- token 划分归 ③档黄金文件

这个分工本身是对的，写在这里是为了让实施者知道语料抓不到它，而不是自己去发现。

### 5.4 语法包体积上限

> **本节是原始决策程序，已被 §5.4.1 的实测结果执行完毕并取代——留作历史语境，
> 不代表当前依据。** 尤其是下面第 3 步：它写的备用阈值（第 90 百分位）在实测后被
> §5.4.1「结论」第 2 条证伪——p90 定义上必然拦下分布里 10% 的语言，这条规则对任何
> 实测分布都会自我触发，不是只在这批数据里恰好触发；把它当「阈值」用，等于给自己
> 写了一条必然会启动的闸门规则，与第 2 步「若不足以构成超上限就不建」自相矛盾。
> 详见 §5.4.1。

SPEC §12：「语法包超体积上限 → 不高亮 + 一个『仍要加载』的显式入口。
**这是产品决策不是埋点**，阈值与文案在实现前定死。」

**先测，再决定这道闸要不要建。** 顺序是：

1. 把两个实现全部语言包的实际 gzip 体积量一遍，提交成表
2. **若实测最大值本身就不足以构成「超上限」**（SPEC §5.1 记的 Shiki 侧是每语言 0.8–16 KB，
   16 KB 对一个已经付了 54 KB 的宿主不算负担），则**不建这道闸**，把那张表与这个结论
   一起记进设计文档。YAGNI 优先于照抄一条基于估算写下的要求
3. ~~若确有语言包大到该拦，阈值取「实测表里位于第 90 百分位的体积」，并在表里标出哪些语言会被拦~~
   （**已作废，见上方说明与 §5.4.1 结论第 2 条**）

**文案现在定死，无论闸门是否建：**

> 这个代码块的语言包较大（`<N>` KB），已跳过高亮。[仍要加载]

（文案先定是因为 SPEC 要求「在实现前定死」；闸门是否需要则要靠测量回答，
而 SPEC 写这条时手上只有估算。）

### 5.4.1 实测结果与结论（2026-08-10，闸门：不建）

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

---

## 6. 构建与分发验证

### 6.1 产出

`dist/` + SPEC §9.3 的 exports 映射 + `.d.ts`。

**CSS 双形态发布：** 作为 JS 字符串内联进 `./element`（走 `adoptedStyleSheets`，
不要求宿主的打包器配 CSS）**和** `./styles.css`（给 light DOM 消费者）。
**不用** CSS module scripts（`import s from './x.css' with {type:'css'}`）——
那会强迫每个消费者的打包器支持 CSS import 属性，正是「未知宿主」必须避开的耦合。

CJS 仅为遗留打包器保留在 `require` 条件下，下个大版本移除。

### 6.2 三条会失败的门

不是三个手工步骤：

1. **`publint` + `@arethetypeswrong/cli`** 进 CI
2. **`npm pack` → 把 tarball 装进隔离宿主 fixture → 真跑一遍。**
   这是「可嵌入」这个主张的证伪测试，也是本计划决策 2 的兑现
3. **Node 里 import `.`，断言 `document` / `window` / `navigator` 全程未被触及**

### 6.3 一件被记成「计划三材料」、但构建让它现在承重的事

`@readit/core` ↔ `@readit/math` 的**循环工作区依赖**（债务 D2-9）。
math→core 是纯类型导入却声明成了运行时依赖。今天没事，因为没人构建；一旦真打包就会咬。
**本计划必须修掉它**——移到 `devDependencies`，或把 `MathRenderer` 类型移进 `@readit/math`
由 core 反向导入。

---

## 7. 测试分层

| 层 | 内容 | 在哪 |
|---|---|---|
| **L3b-element** | Shadow DOM 挂载、主题、**同页两实例**（style-mod 的 bug 只在这现形）、导航与锚点桥接、`destroy()` 泄漏检测、Trusted Types CSP 场景 | Playwright，CI |
| **L3b-editor** | CodeMirror 在 shadow root 内、**中日韩 IME 组合**、滚动同步 | Playwright，CI |
| **L4 视觉回归** | ≤12 张，`animations:'disabled'`，`maxDiffPixelRatio: 0.002`，`deviceScaleFactor: 1`，自托管 woff2，只在 `mcr.microsoft.com/playwright:v1.62.1-noble` 里生成基线。**外加敌意宿主 fixture**（页面加载 Tailwind Preflight + Bootstrap Reboot）证明隔离是真的 | Playwright **1.62.1**，CI |
| **滚动同步** | 自己一层——`data-line` 被归一化器剥掉，**它没有 oracle**，这层是唯一能证伪它的东西 | 本地 + L3b |
| **高亮** | 语言识别进①档；token 划分对自家冻结黄金文件（③档 D-TOKEN） | 本地，**离线** |

### 7.1 L3b 为什么拆成两个

**这是对决策 1 那条保留意见的兑现。** M3 与 M4 的失败模式不重叠——一个是「未知宿主的 CSS
污染进来了」，一个是「输入法与虚拟滚动」。合在一份计划里，两类风险会互相掩盖，
**套件变红时说不清是哪边坏的**。拆成两个文件、两个 CI job 名，让红灯自己说清。

### 7.2 浏览器矩阵

- **Chromium** 与 **WebKit** 承重，必须过。理由是产品目标：Windows 壳走 WebView2（Chromium），
  macOS 壳走 WKWebView（WebKit），M6 要用
- **Firefox** 尽力而为，失败不阻塞

### 7.3 既有套件不得退化

计划一的 2318 条测试、语料 56/68、规格 649/652 + 658/672、TEMPORARY 0 全部保持。
语料台账的三向棘轮继续生效。**本计划新增的任何东西都不得让既有数字变化**；
若变化，那是回归，须上报而非重钉。

---

## 8. 错误处理

照 SPEC §12，原则是「**降级必须可见。护栏的误判要变成难看，不能变成静默的数据丢失。**」

本计划新增的两处：

| 情形 | 行为 |
|---|---|
| 相对跳转文件不存在 | 窗口内错误态，显示**解析后的完整路径**，后退键仍可用 |
| 宿主下发 `require-trusted-types-for 'script'` | 走 `setHtml()` 第 2 级；有测试覆盖该 CSP 场景 |

---

## 9. 对 SPEC 的修订

实施期须同步改 `SPEC.md`，每条都是本设计发现的不一致：

| # | 位置 | 修订 | 状态 |
|---|---|---|---|
| 1 | §9.4 `mount()` 签名 | `mode` 联合类型补 `'plain'`，并定义它（轻量编辑档，textarea，不加载 CodeMirror）。**这是 SPEC 现存的一处真矛盾**：`'plain'` 在 M4 里程碑行出现却从未定义，且不在联合类型里 | ✅ Task 19 已落地 |
| 2 | §9.4 `mount()` 返回对象 | 标注 `find` 属 M6，本计划不导出。**理由：计划一刚因 `readFrontmatterOptions` 是「公共 API 里的永久 no-op」吃过评审批评**——宿主读了签名接进管线，静默拿不到任何东西。加方法向后兼容，留空壳不是 | ✅ Task 19 已落地 |
| 3 | §9.2 `::part()` 名单 | 本计划只开 `root` / `content` / `code-block`；`mermaid` 推迟到 M5。SPEC 自己说这些名字是「永久公开 API，加容易删是破坏性变更」，而 mermaid 容器在 M5 前不存在——现在钉名字，等 M5 结构若不同就被自己锁死 | ✅ Task 19 已落地 |
| 4 | §5 包表 | `@readit/find` 标注为 M6 | ✅ Task 19 已落地 |
| 5 | §5.1 体积预算表 | 「每语言 0.8–16 KB 按需」是估算，实测为 0.08–194 KB（中位 1.4 KB、p99 30.4 KB），尾部低估 12 倍。已按实测改写，并在 §5.4.1 记下体积上限闸门**不建**的完整论证 | ✅ 批次 3 已落地（早于 Task 19；本批复核措辞与实测一致，未改） |
| 6 | §12「语法包超体积上限 → 不高亮 + 一个『仍要加载』的显式入口」 | **经实测决定不实现**，理由见 §5.4.1：最坏语法包（194.2 KB gzip）比本项目已无条件接受的数学包懒加载（~677 KB gzip，同样无闸门）还小 3.5 倍（批次 8 收尾时统一措辞——此前这一行写的是「3 倍以上」，与 §5.4.1 正文、`gate.rationale` 两处「3.5 倍」口径不一；真实测量比值是 677/194.2 ≈ 3.49，`lang-pack-sizes.test.ts` 的断言故意把守护阈值收在 3 倍留出余量，那是测试的容错带宽，不是这句话本身该用的数字）；§5.4 原定的备用阈值（p90）会误伤 `cpp`/`php`/`jsx`/`tsx` 等常用语言，且对任何分布都必然拦下 10%，规则本身自证不成立。文案（`这个代码块的语言包较大（<N> KB），已跳过高亮。[仍要加载]`）仍照 SPEC 要求定死，记在 `packages/highlight/data/lang-pack-sizes.json` 的 `gate.copyIfEverBuilt` 字段，由 `packages/highlight/test/lang-pack-sizes.test.ts` 逐字盯住，但不导出为 API 符号（闸门未建，导出即是又一个 `readFrontmatterOptions` 式的永久 no-op）。SPEC §12 这一行需要在 SPEC.md 里改写为「已评估，决定不实现，见设计文档 §5.4.1」而非删除——删除会抹掉「为什么没做」这个信息 | ✅ Task 19 已落地（SPEC §12 此前一直未同步，批次 8 实测发现并补上） |
| 7 | §14 M4 验收行 | IME 验收线在 WebKit 上不是「已通过」，是具名覆盖缺口：WKWebView 没有等价于 CDP `Input.imeSetComposition` 的入口，四条真机组合测试整体 `test.skip`（`GAP-IME-WEBKIT`）。**缺口边界比"4 条用例跳过"更宽**——共享契约表（`packages/editor/test/contract.ts`）另按 `kind === 'plain'` 把 CodeMirror 从"组合期间 setValue 被推迟"这条契约用例里整条排除，与浏览器无关，Chromium 上也一样排除。来源：task-17-brief.md 的「新增契约提案」附言 + D2-19（docs/plans/2026-08-08-plan2-debt.md） | ✅ Task 19 已落地 |

---

## 9.5 计划内的分期：M3 先行

范围是 M3 + M4（决策 1），但**实施计划必须把它们排成两段，中间设一个检查点**：

- **第一段 M3** —— element + Shadow DOM + 高亮 + 构建与分发验证 + L3b-element + L4。
  这一段结束时，`readit` 是一个**可被外部宿主安装并使用的只读渲染器**，
  §11 的验收线 1、2、4、5、6 全部可判。
- **第二段 M4** —— 编辑器 + `plain` 档 + 滚动同步 + L3b-editor。验收线 3。

这样排的两个理由：

1. **M3 单独就是可交付的。** 若在第一段结束时需要停下（无论出于什么原因），
   停在那里得到的是一个完整的东西，而不是半个。
2. **失败模式隔离。** 这与 §7.1 拆 L3b 是同一件事在计划层面的体现——
   第一段的风险是「未知宿主的 CSS 污染」，第二段是「输入法与虚拟滚动」，
   排成两段意味着第一段的绿是真的绿，不会被第二段的问题回头污染。

---

## 10. 明确不做

- **Mermaid**（M5）、**桌面壳**（M6）、**签名分发**（M7）
- **查找**（`@readit/find`）——M6
- **npm 发布**——决策 2，只构建不发布
- **计划一遗留债务里与本计划无关的部分**——见 `docs/plans/2026-08-08-plan2-debt.md`。
  本计划只处理 D2-9（循环依赖，构建让它承重）。其余（D2-2 `DIR_AUTO_TAGS` 封闭世界、
  D2-4 台账盲区、D2-5 离线守卫已披露逃逸等）继续挂账
- **Windows 真机测试**——按用户指示推迟；CI 的 windows-latest 继续跑

---

## 11. 验收线

| # | 验收线 | 可达性 |
|---|---|---|
| 1 | 敌意宿主 fixture（Tailwind Preflight + Bootstrap Reboot）下渲染不变 | L4，可达 |
| 2 | 同页两个实例互不干扰 | L3b-element，可达 |
| 3 | 中日韩 IME 组合在 shadow root 内的 CodeMirror 里正确 | L3b-editor，**有风险**——见 §4.4，Playwright 的 IME 支持非一等。若实测无法复现真实输入法行为，降级为手工验证并**具名记录为覆盖缺口**，不得把测试写成自我肯定 |
| 4 | `npm pack` 出的 tarball 能装进隔离宿主并跑起来 | 可达 |
| 5 | Node 里 import `.` 不触及任何浏览器全局 | 可达 |
| 6 | 计划一的既有数字全部不变（2318 条 / 56/68 / 649+3 / 658+14 / TEMPORARY 0） | 可达 |

**第 3 条是唯一一条带风险的**，且风险已具名。这是从计划一学到的：
一条不可达的验收线写进契约，代价是它会被两跳转录进执行，然后没人知道它本来就做不到。
