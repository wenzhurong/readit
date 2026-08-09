# readit 计划一：四条验收线核对（Task 32b 完成记录）

**日期：** 2026-08-08
**分支：** `plan1-engine`，HEAD `25b1326`
**执行任务：** Task 32b（Task 32 拆分出的第三部分，`32a` → `24` → `32b`）
**性质：** 测量，不修代码。本记录中的每一个数字都来自一条实际跑过的命令，命令逐条列在下面。

---

## 0. 先跑基线

```
$ npm test
GITHUB_TOKEN is required. Unauthenticated is 60 requests/hour and a burnt budget means a
403 lockout for 42 minutes. Create a fine-grained PAT with public read access.

 Test Files  40 passed (40)
      Tests  2148 passed (2148)
   Duration  2.12s
```

与任务给定的预期基线 **2148 passed / 0 failed** 一致。`GITHUB_TOKEN is required` 一行是 `oracle-refresh.ts` 里的静态提示字符串（被某个已导入模块打印出来），不是一次网络请求——整套件 2.12 秒跑完，未曾等待任何 I/O，离线要求成立。

---

## 1. Step 5 验收表（已填入计划文件 `docs/plans/2026-08-06-plan1-engine.md`）

| # | 验收线 | 目标 | 实测 | 判定 |
|---|--------|------|------|------|
| 1 | GFM 0.29 规格 | 672/672 减白名单，TEMPORARY **已清空** | 674 tests passed（672 examples + 2 元测试）。`known-failures.json` 的 `gfm-0.29` 段 14 条，全部 PERMANENT，附具体理由；`TEMPORARY` 计数 = 0。658/672 精确字节匹配 + 14 条白名单。Task 10–13 原本要修的 14 条 TEMPORARY（autolink 11、tagfilter 1、table 1、strikethrough 1）确认已修好清出白名单，不是被重新分类蒙混过去。 | **MET** |
| 2 | CommonMark 0.31.2 规格 | 652/652 减白名单（仅 3 条 PERMANENT） | 654 tests passed（652 examples + 2 元测试）。`known-failures.json` 的 `commonmark-0.31.2` 段恰好 3 条，全部 PERMANENT。649/652 精确匹配。 | **MET** |
| 3 | 语料归一化 diff | 58 个语料 100% 通过 | **45/60**（语料实际收敛在 60 个文件，落在 SPEC 13.3 的 45–60 目标带；"58"是本表起草时的估计值，已被 Task 24 的真实语料规模取代）。`corpus.test.ts` 64 tests 全绿，但那是棘轮通过，不是 diff 通过。独立脚本绕过棘轮直接跑 `compareToFixture`：45/60 真字节级匹配，15/60 真不匹配，与 `known-mismatches.json` 的 15 个键逐一对应，无陈旧条目。 | **NOT MET** |
| 4 | 美元护栏 | `github` 154/159 + 5 条具名偏离；`strict` 147/159 | 166 tests passed。`github` 模式 154/159 一致 + 5 条具名偏离（M025/M047/M082/M083/M096，各自独立断言"与 GitHub 不同"，非跳过）。`strict` 模式 147/159（154 减去 7 条 STRICT_ONLY_LOSSES）。 | **MET** |
| 5 | 数学确定性 | 重复+顺序置换+跨进程全绿；10 条 README 构造同步渲染成功 | `determinism.test.ts` 5/5 passed：(a) 重复渲染字节相同、(b) 顺序置换（identity/reverse/+1/+2/+3）逐一相同、(b2) `\newcommand` 不跨 `convert()` 泄漏、(c) 两个独立子进程 SHA-256 一致、(d) golden constructs 在置换下也稳定。`golden-readme-constructs.test.ts` 11/11 passed：10 条 README 构造全部同步渲染成功并匹配各自 golden 文件。 | **MET** |

---

## 2. 每条命令与关键输出

```
$ npm test
 Test Files  40 passed (40)
      Tests  2148 passed (2148)

$ cd packages/core && npx vitest run test/spec/gfm.test.ts
 Test Files  1 passed (1)
      Tests  674 passed (674)

$ cd packages/core && npx vitest run test/spec/spec.test.ts
 Test Files  1 passed (1)
      Tests  654 passed (654)

$ cd packages/core && npx vitest run test/corpus.test.ts --reporter=verbose
 Test Files  1 passed (1)
      Tests  64 passed (64)
（60 个语料条目全部标绿——但这是棘轮语义，见下方独立脚本）

$ cd packages/core && npx vitest run test/inline-math/corpus.test.ts --reporter=verbose
 Test Files  1 passed (1)
      Tests  166 passed (166)

$ cd packages/math && npx vitest run test/determinism.test.ts --reporter=verbose
 Test Files  1 passed (1)
      Tests  5 passed (5)

$ cd packages/math && npx vitest run test/golden-readme-constructs.test.ts --reporter=verbose
 Test Files  1 passed (1)
      Tests  11 passed (11)

$ cd packages/core && npx vitest run test/integration.test.ts --reporter=verbose
 Test Files  1 passed (1)
      Tests  19 passed (19)
```

独立脚本（绕过 `known-mismatches.json` 棘轮，直接调用 `compareToFixture`）：

```
$ npx vite-node measure-corpus.mjs
Total corpus files: 60
TRUE byte-diff match (ignoring ledger): 45/60
TRUE mismatch: 15/60
Mismatching files:
  frontend/mermaid-large
  frontend/mermaid-syntax-error
  frontend/mermaid-valid
  gfm/emoji
  gfm/footnotes
  gfm/strikethrough
  gfm/tagfilter
  github-only/anchor-emoji
  github-only/anchor-image
  github-only/frontmatter-malformed
  github-only/frontmatter-scalar
  github-only/image-absolute-external
  real-world/hast-util-sanitize
  real-world/mermaid
  real-world/sindresorhus-is
（无 "on ledger but now matches" 警告 —— known-mismatches.json 里没有陈旧条目）
```

---

## 3. 验收线 1（TEMPORARY 清空 + PERMANENT 理由）核对

```
$ grep -c "TEMPORARY" packages/core/test/spec/known-failures.json
0
```

**TEMPORARY 条目为 0，硬要求满足。** 历史对照（Task 32a 报告）：修复前该文件有 14 条 TEMPORARY（GFM）+ 14 条 PERMANENT（GFM 3 + CommonMark 3 之外的另 11 条，具体见 32a 报告的 before/after 表），Task 10–13 把 14 条 TEMPORARY 全部真正修好（不是重新归类），32a 报告明确写道："No TEMPORARY entry failed to clear; none was reclassified to PERMANENT."

**当前 17 条 PERMANENT 条目（GFM 14 + CommonMark 3）逐条审计——每条都有理由：**

| 套件 | 条目 | 理由摘要 |
|---|---|---|
| gfm-0.29 | 187/217/218 | 空引用块内部换行；markdown-it 15 上游渲染器行为 |
| gfm-0.29 | 279/280 | 任务列表；cmark-gfm 自己标记 `disabled` 且属性序永久冲突 |
| gfm-0.29 | 398/426/434/435/436/473/474/475/477（9 条） | emphasis 0.29 vs 0.31.2 delimiter-run 规则漂移，锁定的 markdown-it 15 实现 0.31.2 |
| commonmark-0.31.2 | 218/239/240 | 同一空引用块内部换行问题 |

全部 17 条都附有具体、可验证的理由，无空白条目。**次要观察（非阻断项）：** 6 条"空引用块内部换行"类理由（gfm 187/217/218、cm 218/239/240）表述为"上游渲染器行为"，而不是像 emphasis 漂移那 9 条那样直接对应"任何 JS 解析器都不可能匹配"的严格定义——理论上可以在 `blockquote_open`/`blockquote_close` 上加一条自定义 renderer 覆写来消掉这个差异，这不是解析器层面的不可能，而是"当前渲染规则集没有覆写它"。但理由文本本身指出这是纯空白差异且 §13.1 归一化器第 9 步已经把它折叠掉，对 L2 语料保真度无影响；这不构成"缺理由"的发现，只是理由的严格性弱于 emphasis 那组，留作记录。9 条 emphasis 漂移条目的理由最扎实：版本锁定（不得回退到 14.3.0 / 不得升级）本身就是全局约束，逻辑上排除了同时满足两个版本的可能。

---

## 4. 验收线 2 缺口核算（最重要的部分）

**目标：** 60/60（语料归一化后 100% diff 通过）
**实测：** 45/60
**判定：NOT MET。**

### 4.1 历史轨迹

| 里程碑 | 结果 | 来源 |
|---|---|---|
| Task 24（首次大规模测量） | 38/60（22 处不匹配，13 类 readit-bug 原因 + 3 个 D-MERMAID 偏离文件 + 2 处归一化器缺口） | task-24-report.md |
| Task 34（补齐块级数学，SPEC §8.6 缺口）+ Task 35（原生 HTML 的 SHAPE 层装饰） | 2115 pass / 15 fail（即 45/60，15 处不匹配"名称与成因均未变"） | task-35-report.md |
| Task 36（双向棘轮白名单，15 个文件 18 条已具名归因） | `npm test` 变绿（2148/2148），但棘轮语义是"这些文件继续不匹配" | task-36-report.md，commit `25b1326` |
| **Task 32b（本任务）** | 独立重新测量，确认 **45/60**，15 个不匹配文件名单与 `known-mismatches.json` 逐一对应，无陈旧条目 | 本报告 §2 |

`npm test` 全绿这件事本身**不代表 100% diff 通过**——它代表"15 处已知不匹配被正确地记录为债务并持续如实断言自己仍然不匹配"。这是"具名的债务"，不是"验收线 2 达标"。

### 4.2 15 个不匹配文件的成因分类（18 条 cause，程序化统计自 `known-mismatches.json`）

| 类别 | 条数 | 文件 |
|---|---|---|
| `deviation` | 4 | `frontend/mermaid-large`、`frontend/mermaid-syntax-error`、`frontend/mermaid-valid`、`real-world/mermaid`（其 3 条 cause 之一） |
| `readit-bug` | 8 | `gfm/emoji`、`gfm/footnotes`、`gfm/strikethrough`、`gfm/tagfilter`、`github-only/anchor-emoji`、`github-only/frontmatter-malformed`、`github-only/frontmatter-scalar`、`real-world/mermaid`（其 3 条 cause 之一） |
| `normalizer-gap` | 6 | `github-only/anchor-image`、`github-only/image-absolute-external`、`real-world/hast-util-sanitize`、`real-world/mermaid`（其 3 条 cause 之一）、`real-world/sindresorhus-is`（2 条 cause） |
| **合计** | **18** | **15 个文件**（`real-world/mermaid` 3 条、`real-world/sindresorhus-is` 2 条，其余 13 个文件各 1 条） |

### 4.3 哪些是"计划外设计排除"，哪些是"后续计划的在案债务"

**设计上排除在本计划之外（`deviation`，4 条 cause，涉及 4 个文件）：**
`frontend/mermaid-large`、`frontend/mermaid-syntax-error`、`frontend/mermaid-valid`、`real-world/mermaid` 的 D-MERMAID 差异——readit 把 ```mermaid 围栏渲染成普通的 `highlight-source-mermaid` 代码块，GitHub 渲染成 `<section data-type="mermaid">`。**Mermaid 渲染是里程碑 M5**（`SPEC.md` 顶部："计划三（M5+M6+M7：Mermaid + 壳 + 分发）另行编写"），不属于本计划（M0+M1+M2）范围。这 4 条 cause 无法通过"修 bug"解决，只能等 M5 那份计划实现 Mermaid 渲染。`real-world/mermaid` 因为几乎全篇都是 mermaid 示例，这一条差异主导了整个文件的行数差异。

**后续计划的在案债务（`readit-bug` 8 条 + `normalizer-gap` 中 5 条 = 13 条 cause，可在不引入新架构的前提下修复）：**
- `readit-bug`（8 条）：都是 readit 自己代码里的具体缺陷——emoji 的 `customBase` 默认值未被覆写导致 src 是相对路径而非 GitHub CDN 绝对地址；脚注区块用硬编码字符串绕过了 token 管线所以拿不到 `dir="auto"`；markdown-it 内建删除线规则不满足 GFM 的"一个或两个波浪线"规则；`applyRawHtmlPolicy`/`applySanitize` 在 `applyTagfilter` 之前跑，把 tagfilter 该保留的 9 个标签内容直接冲掉而非只转义 `<`；标题锚点的 slugger 不认 emoji 的 `:shortcode:`；损坏的 YAML frontmatter 没有实现 GitHub 的 flash-error 回退；`empty: {}` 的 frontmatter 值生成了多余的空 `<thead>`；以及一条 badge 图片堆叠标题的 aria-label 空格未折叠。
- `normalizer-gap` 中的 5 条：`restoreCamo` 目前只覆盖 `<img src>`，没覆盖同一个合成 image-wrapper `<a href>`（覆盖 `github-only/anchor-image`、`github-only/image-absolute-external`、`real-world/sindresorhus-is` 的一条 cause）；`flattenHighlight` 只匹配 `highlight-source-*` 前缀，漏掉了 Linguist 给 `text.html.basic` 打的 `highlight-text-html-basic`（`real-world/hast-util-sanitize`）；`undoGithubUrlRewrites` 只处理文档自身仓库/ref 前缀的 URL，没处理跨仓库的 `/blob/` → `/raw/` 改写（`real-world/mermaid` 的一条 cause）。这 5 条都是 `normalize.ts`/`rules/*.ts` 里的具体逻辑缺口，不需要新架构，是下一份计划的直接可执行项。

**结构性地卡在当前架构之外（`normalizer-gap` 中 1 条）：**
`real-world/sindresorhus-is` 的另一条 cause——GitHub 给动图 `<img>` 加 `data-animated-image=""` 是靠检查图片实际字节得出的，而 Phase A 的 `render()` 是纯同步、不碰网络、不读字节的（本计划的承重约束）。这条差异**不是"忘了写"，是当前 Phase A 架构本身排除的**：要修就要么违反"离线纯函数"的核心约束，要么在 Phase A 之外新增一道读字节的异步缝——这已经超出"下一份计划修几个 bug"的量级，需要单独的架构决策，`known-mismatches.json` 里也明确写着"Not reproducible without a network fetch, which this suite must not add"。

### 4.4 如果下一份计划把"在案债务"的 13 条 cause 全部修完

45/60 现有通过 + 10 个"纯 readit-bug/normalizer-gap"文件（`gfm/emoji`、`gfm/footnotes`、`gfm/strikethrough`、`gfm/tagfilter`、`github-only/anchor-emoji`、`github-only/anchor-image`、`github-only/frontmatter-malformed`、`github-only/frontmatter-scalar`、`github-only/image-absolute-external`、`real-world/hast-util-sanitize`）修好 = **55/60**。剩余 5/60（`frontend/mermaid-large`、`frontend/mermaid-syntax-error`、`frontend/mermaid-valid`、`real-world/mermaid`、`real-world/sindresorhus-is`）中，4 个卡在 M5 Mermaid，1 个（`sindresorhus-is`）即使修完它的 camo-href 那一条 cause，仍会因 `data-animated-image` 那条结构性 cause 停在不匹配，除非有新的架构决策。**60/60 在本计划的架构边界内不可达**——即使做完所有"容易"的修复，也还差 Mermaid（M5 的范围）和一次关于图片字节检查的架构决定。

---

## 5. 与既往报告矛盾之处

未发现矛盾。本次独立测量（45/60，15 个文件名单，18 条 cause，4/8/6 的类别分布）与 task-35-report.md（"2115 pass / 15 fail"）、task-36-report.md（15 文件 18 因、4 deviation / 8 readit-bug / 6 normalizer-gap 的类别统计）完全一致。`known-mismatches.json` 中没有发现"实际已匹配但仍挂在白名单上"的陈旧条目。

---

## 6. 计划一交付了什么、没交付什么（直白陈述）

**交付了：**
- 一个可 `import`、同步、离线、字节确定的 Markdown 渲染引擎，16 条规则装配进单一 `MarkdownIt` 实例后端到端跑通（Task 32a）。
- GFM 0.29 规格 672/672（658 精确匹配 + 14 条有理由的 PERMANENT 白名单），TEMPORARY 债务清零——不是隐藏，是真的修好了。
- CommonMark 0.31.2 规格 652/652（649 精确匹配 + 3 条有理由的 PERMANENT 白名单）。
- 美元护栏（行内数学 vs 货币符号消歧）159 例 oracle 语料：`github` 模式 154/159 + 5 条具名偏离；`strict` 模式 147/159，均与设计目标一致。
- MathJax 数学渲染的确定性：重复渲染、顺序置换、跨进程哈希三类测试全绿，10 条 README 构造全部同步渲染成功。
- 一份从 38/60 提升到 45/60 的真实语料保真度改进（Task 34 补齐块级数学、Task 35 补齐原生 HTML 的 SHAPE 层装饰），加上一份诚实、具名、程序化校验的债务台账（`known-mismatches.json`，Task 36 的双向棘轮防止台账腐烂）。

**没有交付：**
- **验收线 2（语料归一化后 100% diff 通过）没有达标。** 目标 60/60，实测 45/60，差 15 个文件。`npm test` 全绿这件事，代表的是"15 处已知偏离被诚实记录并持续断言自己没有被悄悄修复或悄悄隐藏"，不代表语料保真度达到了计划开篇承诺的 100%。
- 这 15 处差异里，4 条从设计上就不属于本计划（Mermaid 是 M5，另有计划），1 条（图片字节检测）撞上了 Phase A"离线同步"这条本计划自己定的承重约束，剩下 10 个文件的 13 条 cause 是纯粹的、可修的、已经写清楚原因和修复方向的技术债，留给下一份计划。

计划一的价值主张建立在"数字必须可证伪"上；这条验收线没达标就是没达标，不应该被"scope 收窄后算通过"这种说法软化掉。

---

## 7. 附注：全分支评审后的最终数字（2026-08-08）

本记录正文写于套件 **2148 通过** 时。其后进行了一次全分支评审（两个视角：架构/契约、
测试套件完整性）与六轮修复，每轮均经评审。**四条验收线的判定一字未变**，
但套件规模与仪器强度变了：

| | 记录正文时 | 收尾时 | 说明 |
|---|---|---|---|
| `npm test` | 2148 / 0 | **2279 / 0** | 净增 131 条，全部为新增守卫与钉桩 |
| GFM 0.29 | 658 精确 + 14 PERMANENT | **不变** | TEMPORARY 仍为 0，且现由测试断言而非散文 |
| CommonMark 0.31.2 | 649 精确 + 3 PERMANENT | **不变** | |
| 语料 | 45/60 | **不变** | 15 条钉住的量级零改动 |
| 美元护栏 | 154/159 + 5；strict 147/159 | **不变** | |
| 数学确定性 | 全绿 | **不变** | |

**验收线 2 仍为 NOT MET（45/60）。** 全分支评审没有改变这个数字，
它改变的是这个数字**周围的防护**。

### 全分支评审修掉的四条 Critical

1. **`render()` 在默认安全模式下遇到 `<template>` 抛异常** —— 对一个宣称渲染任意
   不可信 Markdown 的纯全函数而言，这是对宿主的拒绝服务。降级路径经验证
   **每一个输出字节都是 `sanitizeTree` 的产物**，clobbering 亦结构性保留。
   后续两轮把真实触发集从 `{template}` 修正为 `{col, script, template}`
   （`col` 还是位置敏感的）—— 三次「完整集」声明被推翻。
2. **13 条 SHAPE 规则里 9 条可被错放进 `SEMANTIC_RULES` 而套件全绿** ——
   Task 32a 的 harness 重构把计划里那个自我监管的棘轮弄没了。现已恢复为
   结构性集合相等断言 + 声明形式无关的完备性扫描（错放数已重测为 7/13 并由测试现算）。
3. **语料台账过度匹配：15/60 文件豁免于全部回归检测** —— 棘轮只断言「仍不相等」。
   现补上第三向（失配量级 `{hunks, edits}`）与 3b（四条全盲条目逐字钉输出）。
   盲区口径 **5249 行 → 99 行**，且由测试实时重算。
4. **`http` 到裸 IP 逃出离线守卫** —— 后续查明 `net.connect()` 整套 API 的
   套接字守卫都是死的，而「覆盖 net」的既有测试只测到了 DNS 层。
   现覆盖 `fetch` / `net.Socket.connect` / dns 四个面（64 入口点）/ `dgram`。

### 剩余债务

全部具名记录在 `docs/plans/2026-08-08-plan2-debt.md`（16 条，五类，各带出处与还清方式）。
其中最要紧的三条是**「广度由做声明的人自选」**这一类风险——
`imageStyle` 的三声明形式源自 **n=1** 的夹具实例，却往每一个含图片的原生 HTML 文档里发字节。
