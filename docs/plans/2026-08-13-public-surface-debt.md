# readit：公共接口面债务清偿（供 Codex 执行）

**日期**：2026-08-13
**范围**：不新增里程碑。只清偿「影响可嵌入性」的在案债务 + 补上保护它们的守卫。
**基线提交**：`66bff73`（`main`）
**执行方式**：6 个任务分 3 批，每批做完自审并报告，等确认后再进下一批。

---

## 0. 你需要先知道的（读完再动手）

### 0.1 这个项目是什么

readit 是一个 Markdown 阅读/编辑组件，目标是**产出与 GitHub 的 Markdown 阅读器高度相似的输出**，
且既能给人用、也能被别的项目嵌入。GitHub 的输出被选作最高参考标准，保真度对着
`packages/core/test/fixtures/` 这份**钉住的快照**衡量（不是对着实时的 GitHub，
2026-08-12 已明确，见 SPEC §13.4）。

已交付 M0–M4：Phase A 渲染引擎、美元护栏与数学、Web Component（Shadow DOM / 主题 /
四模式）、编辑器（CodeMirror 与 plain 双档）与滚动同步。剩余 M5（Mermaid）/ M6（壳）/
M7（签名分发）不在本方案范围内。

### 0.2 架构里两条承重的约束（违反了就是把地基拆了）

**Phase A 纯粹同步。** `render(src, opts) -> string` 必须是纯函数：无 DOM、无网络、
无 I/O、无时间、无随机。整条渲染路径上**唯一**允许 `await` 的是 `prepare()`。
`packages/core/test/no-await-on-render-path.test.ts` 是这条约束的棘轮。

**保真度由棘轮台账守着，不是由「全绿」守着。** `packages/core/test/known-mismatches.json`
记录 12 条与 GitHub 的具名失配，三个方向都会断构建：
不在名单上的失败 / 名单内的条目修好了 / 名单内条目的失配量级变了。
**看到台账相关的红，先判断是哪个方向，不要直接改名单让它变绿。**

### 0.3 ⚠️ 这个项目最常见的失效模式——请认真读这一段

**「声明的广度由做声明的人自己选定」，而它倾向于错。**

这不是抽象的告诫。这条代码库为它栽过**至少九次**，每次形状都一样：某人写下一个
「完整集 / 一个不少 / 零差异 / 全部覆盖」的声明，而验证它的样本是同一个人挑的。
实例（全部有据可查，见 `docs/plans/2026-08-08-plan2-debt.md` 末节）：

- `imageStyle` 的三声明形式源自 **1 个**实例，实测七种形态里**错了四种**，
  且四处全部产出语法非法的 CSS（`50%px` / `10empx` / `abcpx`）。
- 第 1 级消毒器审计声称「跑完整语料、逐元素逐属性 diff 到**零差异**」，
  漏了 `<g-emoji>`——因为诊断语料是声明者自己选的，只含另一种 emoji 路径。
- 一条测试标题写「EXTRA_ELEMENTS 覆盖的元素**一个不少**」，而两个自定义元素
  从未被查验；更糟的是那条断言**在结构上就测不出来**（查的是内容不是标签本身，
  而浏览器对未知元素是 unwrap，内容照样在）。
- 一条泄漏护栏跑 50 次挂载/销毁断言「监听器归零」，而循环里 `setMode()` 没 await，
  **CodeMirror 从未被构造出来**——护栏是空的，插桩证明探针一次都没触发。
- D2-20 记为「五项继承属性没重置」，实际是**八项**：那五项抄自一张手挑的采样表，
  而那张表漏了一项，另两项根本来自别的源头，是逐像素比对逼出来的。

**因此对你的要求：**

1. 写下「完整 / 全部 / 一个不少」之类的措辞前，先问**广度是谁定的**、
   **验证它的东西和被验证的东西是不是同源**。
2. 能枚举就不要抽样。本方案的 T1 就是一次刻意的枚举。
3. **新增或修改任何断言后，必须验证它真的会红**——临时把被测行为改坏，
   看它变红，再改回来看它变绿。没做这一步的断言，等于没写。
4. 报告里不要写「应该没问题」「预期通过」。写你**实际跑过的命令和它的输出**。

### 0.4 这个仓库里会咬人的具体陷阱

| 陷阱 | 说明 |
|---|---|
| `packages/element/src/styles/base-css.ts` 的反引号 | `BASE_CSS` 是模板字面量，CSS 注释写在它**内部**。注释里用反引号引代码会提前闭合字面量，报错指向 oxc transform、离真因很远。**注释里引代码用双引号。** 已有断言钉住「全文件只许两个反引号」。 |
| 裸子串守卫 | `test/ci-wiring.test.ts` 断言 `.github/workflows/test.yml` 里不出现 advisory-job 那个 key；`test/browser-wiring.test.ts` 断言它在 `browser.yml` 里**只出现一次**。**注释里提到那个词也会被计数**。 |
| 测试文件归属 | `*.test.ts` = vitest；`*.spec.ts` = Playwright。放错位置不会被跑。 |
| `npm test` 全程离线 | `test/setup/no-network.ts` 会拦截 fetch/socket/dns。**不要在测试里发网络请求**。 |
| happy-dom 的 URL 缺陷 | 全局 `URL` 对「相对路径 + file: base」解析有 bug。测试里取路径用 `dirname(fileURLToPath(import.meta.url))` + `node:path`，不要走全局 `URL`。 |
| 提交身份 | 已配置为 `mmy420`，直接 `git commit` 即可，**不要改 git 配置**。 |
| 暂存 | **显式列路径，绝不 `git add -A`**。 |

### 0.5 四条不变量——任何一条变了都是回归

跑 `npm test` 之后核对：

```bash
npm test                    # 期望：76 个文件 / 2694 通过 / 0 跳过 / 0 失败
npm run typecheck           # 期望：6 包 + 根 + browser/ 零错误
```

| 不变量 | 当前值 | 怎么看 |
|---|---|---|
| 语料精确匹配 | **56/68** | `packages/core/test/corpus.test.ts` |
| 棘轮台账条目 | **12** | `packages/core/test/known-mismatches.json` |
| CommonMark | **649 + 3 白名单** | `known-failures.json` 的 `commonmark-0.31.2` 段 |
| GFM | **658 + 14 白名单** | `known-failures.json` 的 `gfm-0.29` 段 |
| `TEMPORARY` 计数 | **0** | 全名单里搜 `TEMPORARY` |

**这四条任何一条动了，停下来上报，不要自己重钉。**

### 0.6 卡住了怎么办

**停下来上报是正确做法，不是失败。** 前一轮有实现者在一个任务上阻塞并上报，
结果测出了 SPEC 的一处真矛盾。若你发现任务书的前提与实测不符——比如某个
文件不是它说的那样、某条债务其实已经还清——**停下来说**，不要按错误前提硬做。

（本方案写作时就发生过一次：债务台账里有三条状态是过期的，照抄会让你去修
已经修好的东西。所有前提都已在 2026-08-13 重新实测，但仍以你的实测为准。）

---

## 1. 范围

### 做

清偿**影响可嵌入性**的债务，以及保护这些接口的守卫。共 6 个任务。

### 明确不做（不要顺手做）

| 项 | 为什么不做 |
|---|---|
| **发布到 npm** | 用户 2026-08-09 明确定的范围：「build 在范围内，publish 不在」。`private: true` 保留。 |
| M5 Mermaid / M6 壳 / M7 签名 | 属计划三。 |
| D2-2 / D2-3（语料保真度推断） | 还清它们需要对活 oracle 抓取，而 `npm test` 全程离线。属另一件事。 |
| D2-4 / D2-5 / D2-7 / D2-8 | 测量仪器的已知边界，已在台账写明，不是缺陷。 |
| D2-16 `corpus-diff.ts` 无测试 | 工具代码，不在嵌入方视线里。 |
| D2-21 真 WKWebView/WebView2 验收 | 归 M6，且需要真机。 |
| D2-22 容器里 2px 内联盒差 | 本机复现不了，只能靠 CI 往返，收益不匹配。已具名记账。 |
| 任何 Windows 实测 | 用户 2026-08-08 指示推迟。 |

---

## 2. 当前公共接口面（2026-08-13 实测）

发布外观包 `packages/readit`，`exports` 有 7 个子路径。实际导出的符号：

```
./                 DEFAULT_LOADERS, DEFAULT_OPTIONS, GITHUB_EMOJI_BASE,
                   prepare, readFrontmatterOptions, render, renderWithExplain, scan
./element          DEFAULT_MOUNT_OPTIONS, DEFAULT_TAG, defineReadit, mount
./editor           createEditor
./plugins/math     （未在本次实测中枚举，T1 要补）
./plugins/highlight（同上）
./styles.css       CSS 产物
./package.json
```

**目前没有任何测试钉住这份符号清单**——`packages/readit/test/build-output.test.ts`
查的是 dist 的机制（CJS 具名导出注解、chunk 拆分、自包含性），不查导出了哪些名字。
所以增删一个公共导出**不是一次可见的动作**。T2 补这个。

---

## 3. 批次一：公共接口面的枚举与钉桩

### T1 — 枚举并审计**全部**公共导出符号

**这个任务的形状是刻意的**：不要只查债务台账点名的那几个。台账的清单本身就是
一次自选广度，而它已经被证明会漏（见 §0.3）。**枚举，不要抽样。**

**做什么：**

1. 从 `packages/readit/package.json` 的 `exports` 取全部子路径（含
   `./plugins/math`、`./plugins/highlight` —— §2 里没枚举它们，你要补上）。
2. `npm run build` 后，对每个 JS 子路径实际 `import()` 一次，取 `Object.keys()`，
   得到**真实**的导出符号全集。不要从源码 `export` 语句推断——构建会重排。
3. 对每一个符号，回答四个问题，产出一张表：
   - 它有真实实现吗，还是空壳 / 恒定返回值 / `void param` 这类死代码？
   - 有测试覆盖它的**行为**吗（不是只 import 一下）？
   - 它的行为与 SPEC 一致吗？（相关章节：§7.1 选项与优先级、§9.4 `mount()`、
     §5 包与职责）
   - 类型签名承诺的东西，实现真的给了吗？
4. **已知会命中的三条**（作为起点，不是全集）：
   - `readFrontmatterOptions` —— 恒返回 `{}`，见 T3
   - `createSpecEngine` 的 `opts` 形参 —— `void opts`（注意：它**不在**公共导出面里，
     只被 `packages/core/test/integration.test.ts` 用；确认后按内部清理处理，见 T6）
   - `scanDollars` / `replaceEmoji` —— 声称是「单测接缝」而导出，但没有测试 import 它们
     （两者在生产路径上**都有真实调用方**，所以不是死代码，见 T6）

**产出**：`docs/plans/2026-08-13-public-surface-audit.md`，含上述表格 + 一段
「这次枚举覆盖了什么、**没覆盖什么**」的自陈。最后这半句是硬要求——
不写边界的完整性声明，就是 §0.3 那个模式。

**验收**：表格里每一行都有你实际跑过的证据（命令 / 输出片段 / 文件行号）。

---

### T2 — 给公共导出面加一条钉子

**为什么**：增删公共导出目前是一次**静默**的动作。对一个主打「可嵌入」的库，
公共符号集是最不该悄悄变的东西。

**做什么**：新增 `packages/readit/test/public-surface.test.ts`：

- 对每个 JS 子路径断言导出符号集**逐字相等**（排序后比较，避免顺序噪音）。
- 断言消息里写明：**增删公共导出是破坏性变更，要在这里显式改一行，
  并在提交信息里说明为什么**。
- 同时钉住 `exports` 子路径清单本身（少一个子路径同样是破坏性变更）。

**验收（必须做「验证它会红」这一步）**：

```bash
# 1. 先绿
npx vitest run packages/readit/test/public-surface.test.ts

# 2. 临时在 packages/core/src/index.ts 加一个 `export const __probe = 1`
#    重新 build 后跑，确认这条测试变红，且报错信息指出多了哪个符号
npm run build && npx vitest run packages/readit/test/public-surface.test.ts

# 3. 撤销探针，重新 build，确认变绿
```

报告里要贴出第 2 步**红的实际输出**。

---

## 4. 批次二：D2-10 —— 实现 `readFrontmatterOptions`

### T3 — 把公共 API 里的永久 no-op 实现掉

**现状（实测）**：`packages/core/src/index.ts:56`

```ts
export function readFrontmatterOptions(
  src: string,
): { inlineMath?: InlineMathMode } {
  void src
  return {}
}
```

唯一的调用方是 `packages/core/test/smoke.test.ts:81`，而那条测试**断言它返回 `{}`**
——也就是说**测试把缺陷钉住了**。这是 T3 要一并处理的。

**为什么是实现而不是删除**：SPEC §7.1（第 463 行）把它定义成**承重设计**：

> ⚠️ **纯度约束**：Phase A **不得**自己读 frontmatter。单独提供纯函数
> `readFrontmatterOptions(src) -> {inlineMath?}`，由宿主/壳调用后作为选项传入。
> 这是承重的而非风格问题——一旦泄漏进渲染函数，同构纯度保证就没了。同时：
> 读取某个键**不得**把它从输出里移除，frontmatter 仍照常渲染成表格。

删掉它就等于把「frontmatter 影响渲染选项」这条能力推回 Phase A 内部，破坏纯度。

**契约（SPEC 已完整给出，不要猜）**：

- 键名：**`readit-inline-math`**（SPEC 第 459 行）。键必须**扁平且带命名空间**——
  扁平是因为 GitHub 把 frontmatter 渲染成可见表格、嵌套 YAML 会渲染成嵌套表；
  带命名空间是为了不与 Jekyll / Hugo / Obsidian 的键碰撞。
- 取值：`'github' | 'strict' | 'off'`（`InlineMathMode`，见 `packages/core/src/types.ts:12`）。
- 优先级链（SPEC 第 459 行）：**显式 API > 文档 frontmatter 键 > 应用设置 > 内置默认**。
  本函数只负责中间那一环——它**只返回读到的东西**，不做合并；合并由调用方做。
- **读取不得改变渲染输出**：frontmatter 仍照常渲染成表格。
- 纯函数：无 I/O、无时间、无随机（受 `no-await-on-render-path.test.ts` 与 T4 的守卫约束）。

**可复用的现成能力**：`packages/core/src/rules/frontmatter.ts` 已有
`load(yaml, { schema: CORE_SCHEMA })` 的解析路径与错误处理。
**用 `CORE_SCHEMA`，不要换成 `DEFAULT_SCHEMA`** —— 那个选择关闭了四条 js-yaml 高危
向量（merge key、`!!omap` 等），已有守卫测试盯着，换了会静默打开它们。

**边界情形要逐个测，不要只测 happy path**（这正是 §0.3 那条要求的落点）：

| 输入 | 期望 |
|---|---|
| 无 frontmatter | `{}` |
| 有 frontmatter 但无该键 | `{}` |
| `readit-inline-math: off` / `strict` / `github` | 对应值 |
| 值不合法（如 `readit-inline-math: yes`） | `{}`（不抛，不猜） |
| 值大小写不同（`Off`） | 你来定并写明理由，然后测它 |
| frontmatter 语法损坏 | `{}`，且**不得抛异常**（宿主会直接调它） |
| 嵌套写法（`readit: {inline-math: off}`） | `{}` —— SPEC 明确要求键**扁平** |
| frontmatter 里有该键时，`render()` 的输出**不变** | 用现有语料断言表格照常渲染 |

**同时要做**：把 `smoke.test.ts:81` 那条「断言返回 `{}`」的测试换掉。
它现在钉的是缺陷。新测试放哪里由你定（建议 `packages/core/test/rules/frontmatter.test.ts`
或新建一个），但**不要留下一条断言 no-op 的测试**。

**验收**：

```bash
npm test          # 四条不变量不许动
npm run typecheck
```

报告里给出：先红后绿的证据（新测试在实现之前是红的）、边界情形逐条的实测结果、
以及「`render()` 输出不变」这条是怎么验的。

---

## 5. 批次三：契约守卫与内部清理

### T4 — D2-6：Phase A 纯度的另一半上棘轮

**现状（实测）**：`packages/core/test/no-await-on-render-path.test.ts` 扫的是
`await` / `async` / 动态 import（第 32–35 行）。纯度的**另一半**——
无 `Date.now` / `Math.random` / `new Date` / 同步 I/O / 模块级可变状态——
**只被 grep 验证过，没有测试守着**。性质今天成立，但被破坏时不会报警。

**做什么**：在同一个文件里（或同形的新文件）补上这一半的扫描，形状照抄既有那半。

注意几点：
- `packages/core/src/prepare.ts` 是 `await` 的唯一豁免，但**纯度的这一半对它同样适用**
  ——确认后决定是否豁免，并写明理由。
- 「模块级可变状态」不好用正则扫全，**能扫到什么就声明什么**，
  扫不到的部分在文件头写明边界（见 §0.3 第 1 条）。
- 必须验证它会红：临时往某个 `src/` 文件里塞一个 `Date.now()`，看它红，再撤掉。

---

### T5 — D2-15：dir-auto 策略在两处表述，没有东西保证它们一致

**现状（实测）**：

- `packages/core/src/rules/dirauto.ts:10` 的 `DIR_AUTO_TOKENS`（markdown-it **token 类型**）
- `packages/core/src/rules/rawshape.ts:49` 的 `DIR_AUTO_TAGS`（**HTML 标签名**）

两者是同一条策略（「哪些元素发 `dir="auto"`」）的两种表述，走两条不同的代码路径
（Markdown 路径 vs 原始 HTML 路径）。**两边漂移会导致同一份文档的两个部分行为不一致**，
而现在没有任何东西保证它们同步。

（台账里同节提到的 `OCTICON_LINK` **已经共享了**——`rawshape.ts:7` 从 `heading.ts` import。
这半条已还清，不要重做。请先自己确认这一点。）

**做什么**：加一条断言把两者钉在一起。不必强行合并成一个常量（token 类型与标签名
是两个域，硬合并会引入一层没必要的映射），但**必须有东西在它们分叉时报警**。
一个映射表 + 双向断言即可。

**验证它会红**：往其中一边加一个元素而另一边不加，看它红。

---

### T6 — 内部清理三小件

逐条先确认现状再动手（台账可能过期）：

1. **D2-11 `createSpecEngine` 的死形参**（`packages/core/src/engine.ts:228-236`）：
   `opts: RenderOptions` 后面紧跟 `void opts`。函数本身是活的
   （`packages/core/test/integration.test.ts:149` 依赖它），只有形参是死的。
   删掉形参并更新调用点与注释。**注意它不在公共导出面里**，所以这是内部改动。

2. **D2-13 孤儿脚本**：`packages/core/scripts/extract-gfm-autolink-examples.mjs`
   —— 台账说全仓零引用、职能已被 `fetch-specs.ts` 的 `parseGfmSpec` 吸收。
   **先自己 grep 确认零引用**，再删。

3. **D2-14 声明了却没接线的单测接缝**：`math-inline.ts` 的 `scanDollars`、
   `emoji.ts` 的 `replaceEmoji`。两者在生产路径上**都有真实调用方**
   （`math-inline.ts:265`、`emoji.ts:123`），所以不是死代码——
   债务是「为单测而 export，却没有任何测试 import 它们」。
   二选一并写明理由：**要么补上直接测它们的单元测试**（`scanDollars` 是 110 行的
   R0–R8 护栏核心，直接测它有真实价值），**要么去掉 `export` 关键字**。
   我倾向前者，但你实测后自己判断。

---

## 6. 每批做完要交什么

写到 `docs/plans/2026-08-13-public-surface-report.md`（追加，不要覆盖前一批）：

- 每个任务：改了什么、**先红后绿的命令与实际输出**
- **每条新增/修改的断言，「验证它会红」那一步的证据**
- 四条不变量的实测值（§0.5 的表，逐行对照）
- 与任务书前提不符的地方（有就写，没有就写「无」）
- 你的自审：**哪些地方你的验证广度是你自己选的**，边界在哪

然后给一段 15 行以内的短报告：状态 / 提交 / 一行测试小结 / 顾虑 / 报告路径。

---

## 7. 提交约定

- 每个任务一个提交，`git commit` 直接用（身份已配好 `mmy420`）。
- **显式列暂存路径，绝不 `git add -A`**。
- 提交信息写**为什么**，不只是写做了什么。这个仓库的提交信息是给半年后的人读的。
- 不要推送，交给用户决定。
