# readit 公共接口面债务清偿报告

## 批次一：T1 + T2（2026-08-13）

**状态**：完成，等待确认后再进入批次二。

**代码基线**：`66bff73`；任务书提交：`8c2881a`。

**本批提交**：`a638489`（T1）、`bcb4b21`（T2）。

### T1 — 枚举并审计全部公共运行时导出

新增 `docs/plans/2026-08-13-public-surface-audit.md`。审计从
`packages/readit/package.json.exports` 的全部 7 个子路径出发，先构建，再对 5 个 JS
目标逐个真实 `import()` / `Object.keys()`，得到 17 个运行时符号；逐行反查实现、行为测试、
相关 SPEC 与构建后的声明文件。此前计划正文未枚举的结果是：

```text
./plugins/math       ["TEX_PACKAGES","createMathRenderer"]
./plugins/highlight  ["createShikiHighlighter","createStarryNightHighlighter"]
```

审计行为套件实测：

```text
$ npx vitest run <报告 §1 列出的 15 个文件>
Test Files  15 passed (15)
Tests       225 passed (225)

$ npx playwright test contract.spec.ts --project=editor-chromium --project=editor-webkit
8 passed (9.7s)
```

T1 是只读审计，没有新增/修改断言，故没有“实现前红灯”。它命中计划内的
`readFrontmatterOptions` no-op，也发现一处计划外前提偏差：可变的公开
`DEFAULT_OPTIONS` 会改变后续同输入 `render(src)` 的结果，详见“前提偏差”。

### T2 — 钉住公共导出面

新增 `packages/readit/test/public-surface.test.ts`，共 6 条断言：

1. `exports` 的 7 个子路径排序后逐字相等；
2. 5 个 JS 子路径各自从真实构建产物 import，运行时 keys 排序后逐字相等。

所有失败消息都包含：

```text
增删公共导出是破坏性变更：请在 public-surface.test.ts 显式更新对应清单，并在提交信息里说明为什么。
```

**初始绿灯**：

```text
$ npx vitest run packages/readit/test/public-surface.test.ts
Test Files  1 passed (1)
Tests       6 passed (6)
```

**任务书指定的根入口故障注入**：临时在 `packages/core/src/index.ts` 加
`export const __probe = 1`，重新构建后实际红灯：

```text
$ npm run build && npx vitest run packages/readit/test/public-surface.test.ts
FAIL  ... > . 的运行时导出符号集逐字相等
AssertionError: .: 增删公共导出是破坏性变更...

- Expected
+ Received
  [
    "DEFAULT_LOADERS",
    "DEFAULT_OPTIONS",
    "GITHUB_EMOJI_BASE",
+   "__probe",
    "prepare",
    "readFrontmatterOptions",
    "render",
    "renderWithExplain",
    "scan",

Test Files  1 failed (1)
Tests       1 failed | 5 passed (6)
```

**逐条证明 6 条新断言都会红**：在同一次临时故障注入中，给 5 个 JS 入口各加
`__probe`，并给 manifest 多加 `./__probe` 子路径。实际输出：

```text
$ npm run build && npx vitest run packages/readit/test/public-surface.test.ts
test/public-surface.test.ts (6 tests | 6 failed)
  × exports 子路径清单逐字相等
  × . 的运行时导出符号集逐字相等
  × ./editor 的运行时导出符号集逐字相等
  × ./element 的运行时导出符号集逐字相等
  × ./plugins/highlight 的运行时导出符号集逐字相等
  × ./plugins/math 的运行时导出符号集逐字相等

Received 逐项分别多出：
  "./__probe"
  "__probe"（五个 JS 入口各一处）

Test Files  1 failed (1)
Tests       6 failed (6)
```

**撤销全部探针后的绿灯**：

```text
$ npm run build && npx vitest run packages/readit/test/public-surface.test.ts
Test Files  1 passed (1)
Tests       6 passed (6)
```

探针只存在于未提交的故障注入阶段；最终 `git diff` 中没有任何 `__probe`。

### 完整回归

```text
$ npm test
Test Files  77 passed (77)
Tests       2700 passed (2700)
Duration    15.98s

$ npm run typecheck
根 tsc + browser/ + @readit/core/editor/element/highlight/math/readit：零错误
```

任务书写的代码基线是 76 文件 / 2694 测试；T2 恰好新增 1 个文件 / 6 条测试，因此本批
的 77 / 2700 是可解释的精确增量，不是既有测试消失或数量漂移。

### 四条不变量实测

实测命令读取当前语料发现规则、两个 JSON 台账及 spec 总例数；`npm test` 同时证明对应
棘轮断言均通过。

| 不变量 | 任务书基线 | 本批实测 | 结果 |
|---|---:|---:|---|
| 语料精确匹配 | 56/68 | 68 个 snapshot corpus - 12 个具名 mismatch = **56/68** | 不变 |
| 棘轮台账条目 | 12 | **12** | 不变 |
| CommonMark | 649 + 3 白名单 | 652 - 3 = **649 + 3** | 不变 |
| GFM | 658 + 14 白名单 | 672 - 14 = **658 + 14** | 不变 |
| `TEMPORARY` 计数 | 0 | **0** | 不变 |

实测输出：

```json
{
  "corpus": { "total": 68, "mismatches": 12, "matches": 56 },
  "commonmark": { "passed": 649, "whitelist": 3 },
  "gfm": { "passed": 658, "whitelist": 14 },
  "temporary": 0
}
```

### 与任务书前提不符的地方

1. **T4 的“性质今天成立”前提不成立于公开默认对象。** 发布产物的
   `Object.isFrozen(DEFAULT_OPTIONS) === false`。独立 Node 进程内先后用同一个
   `src = 'pre $x$ end.'` 调 `render(src)`，中间只做
   `DEFAULT_OPTIONS.inlineMath = 'off'`，实测前一次含 `<math-renderer>`、后一次保留
   `$x$`，`same:false`。这与任务书 §0.2 / SPEC §3.3 的“输出是输入的纯函数”冲突；
   也说明 T4 只扫 `let`/`var` 或直接赋值会漏掉 `const` 指向的可变对象。
2. 同一探针得到 `DEFAULT_LOADERS:false`、`DEFAULT_MOUNT_OPTIONS:false`、
   `TEX_PACKAGES:true`（值为 `Object.isFrozen` 结果）。前两者会形成可变的全局默认行为，
   但没有 `render()` 同等级的纯度承诺；本批只记录，没有擅自扩展 6 任务范围修复。
3. 除上述项外，T1/T2 所需文件、子路径、实现和测试接线均与任务书前提一致。

### 自审：验证广度由谁选、边界在哪

- 子路径广度不是手选：来自 manifest 的全部 7 个 `exports` key；少/多一个都会由 T2
  的第一条断言报警。
- 运行时名字广度不是从源码猜：来自构建后 5 个 ESM 入口的全部 enumerable keys；
  T2 逐入口精确比较，不做抽样。
- 行为测试文件的选择由本次审计者选定；报告只声称这些套件实际通过，不声称每个参数组合
  都覆盖。17 行各有独立文件行号，完整边界在审计文档 §4。
- type-only 导出不在 `Object.keys()` 的可见面；本批只沿运行时符号所需声明闭包核对，
  没有枚举全部 type-only 名字。
- 根入口的 CJS 条件有既有具名导出注解与 ESM/CJS 行为一致性测试，但本批没有对 CJS
  再做一张逐名 key 表；T2 钉的是任务书明确要求的 `import()` 面。
- CSS 与 `package.json` 是非 JS 子路径，本批钉住“路径存在于公开面”，没有把视觉像素或
  manifest 所有字段重新包装成“公共符号审计”。
- 可变性探针检查了 4 个公开数组/对象；没有递归证明整个发布模块图深冻结，因此不把发现
  表述成“全部模块级可变状态的完整清单”。

## 批次二：T3（2026-08-13）

**状态**：完成，等待确认后再进入批次三。

**本批提交**：`6214d5b`（T3）。

### 实现

`readFrontmatterOptions(src)` 不再恒返回 `{}`。新增
`packages/core/src/frontmatter-options.ts` 作为不依赖 DOM/markdown-it 的共享纯模块：

- `parseFrontmatter()` 是可见表格渲染与宿主选项读取共用的唯一 YAML 路径；
- 继续逐字使用 `load(yaml, { schema: CORE_SCHEMA })`，解析错误统一折成不抛异常的结果；
- 只识别文档第 1 行开始、由现有规则同形 `---[ \t]*` 围出的 frontmatter；
- 只读顶层扁平键 `readit-inline-math`；
- 只接受精确小写字面量 `github | strict | off`，不负责与应用/API 默认值合并；
- `render()` 不调用本函数，因此 frontmatter 键仍显示在表格里，也不会被 Phase A 隐式应用。

`packages/core/src/rules/frontmatter.ts` 改为从该模块导入同一份 parser 与 fence 判断；原有
`yamlErrorMessage` 内部导出继续从规则模块转发，避免无关的内部兼容性变化。
`packages/core/src/index.ts` 只再导出宿主需要的 `readFrontmatterOptions`。

大小写裁决：`Off` 返回 `{}`。理由是 `InlineMathMode` 和 SPEC §8.6 都只定义三个小写
字面量；自动 lower-case 会在没有契约依据时发明第二套合法配置拼写，还会让拼写错误静默生效。

### 先红后绿

先只改测试、保留 no-op 实现。实际红灯：

```text
$ npx vitest run packages/core/test/rules/frontmatter.test.ts packages/core/test/smoke.test.ts
frontmatter.test.ts (27 tests | 4 failed)
  × reads the exact off literal
  × reads the exact strict literal
  × reads the exact github literal
  × reads without consuming the key or making render() apply it implicitly

AssertionError: expected {} to deeply equal { inlineMath: 'off' }
Test Files  1 failed | 1 passed (2)
Tests       4 failed | 28 passed (32)
```

实现后的目标绿灯：

```text
$ npx vitest run packages/core/test/rules/frontmatter.test.ts packages/core/test/smoke.test.ts
Test Files  2 passed (2)
Tests       32 passed (32)
```

最终连同 Phase A await 门复核：

```text
$ npx vitest run packages/core/test/rules/frontmatter.test.ts packages/core/test/smoke.test.ts packages/core/test/no-await-on-render-path.test.ts
Test Files  3 passed (3)
Tests       55 passed (55)
```

### 边界情形逐条实测

| 输入 | 实测结果 |
|---|---|
| 无 frontmatter | `{}` |
| 有 frontmatter、无键 | `{}` |
| `readit-inline-math: off` | `{ inlineMath: 'off' }` |
| `readit-inline-math: strict` | `{ inlineMath: 'strict' }` |
| `readit-inline-math: github` | `{ inlineMath: 'github' }` |
| 非法值 `yes` | `{}` |
| 大小写不同 `Off` | `{}`（严格字面量策略） |
| 损坏 YAML `[off` | `{}`，不抛异常 |
| 嵌套 `readit: { inline-math: off }` 的等价块写法 | `{}` |
| 正文后部才出现同名围栏/键 | `{}` |

渲染隔离用例使用：

```text
---
readit-inline-math: off
title: T
---

$x$
```

一次对象断言同时实测：读取结果为 `{inlineMath:'off'}`；读取前后 `render(src)` 逐字相等；
输出仍含 `<th>readit-inline-math</th>`；默认 `render(src)` 仍输出
`<math-renderer class="js-inline-math"...>`，证明它没有擅自应用 frontmatter 的 `off`。

### 每条新增断言的故障注入证据

1. **合法值与端到端读取**：原 no-op 实现已让 `off/strict/github` 和综合断言 4 条全红，
   输出见“先红后绿”。
2. **全部负例**：临时让函数恒返回 `{inlineMath:'off'}`，实际 27 条中 9 条失败：

   ```text
   × returns an empty object for no frontmatter
   × returns an empty object for frontmatter without the key
   × returns an empty object for invalid value
   × returns an empty object for different case
   × returns an empty object for malformed YAML
   × returns an empty object for nested key
   × returns an empty object for same text below the opening line
   × reads the exact strict literal
   × reads the exact github literal
   Tests  9 failed | 18 passed (27)
   ```

3. **读取不得污染渲染选项**：临时让该读取对综合用例改写
   `DEFAULT_OPTIONS.inlineMath = 'off'`，断言实际收到：

   ```diff
   - "outputUnchanged": true,
   - "renderStillUsesItsDefault": true,
   + "outputUnchanged": false,
   + "renderStillUsesItsDefault": false,
   ```

4. **键必须继续可见**：临时让 `render()` 从 HTML 删除该 `<th>`，断言实际收到：

   ```diff
   - "keyStillVisible": true,
   + "keyStillVisible": false,
   ```

上述故障代码均已撤销；提交前在 `packages/core/src` / `test` 搜索 `__probe` 与两段故障特征，
没有残留。

### 分发边界的中途失败与修复

第一版把公共函数直接从 `rules/frontmatter.ts` 再导出。目标测试通过，但第一次完整
`npm test` 在 readit 的构建 global setup 正确失败：

```text
Error: 发布产物里残留了裸模块说明符，装包方解析不了（它的 dependencies 是空的）：
[types] cjs/types/packages/core/src/rules/frontmatter.d.ts → markdown-it
[types] types/packages/core/src/rules/frontmatter.d.ts → markdown-it
```

原因：公共声明闭包因此走进规则文件的 `import type { MarkdownIt, Token } from 'markdown-it'`。
修法不是给发布包补依赖，而是把共享 YAML 能力移到不依赖 markdown-it 的
`frontmatter-options.ts`；规则与公共 API 各自只依赖它。随后 `npm run build` 通过，产物
`frontmatter-options.d.ts` 只引用包内相对 `./types.js`，T2 公共接口测试仍为 6/6。

### 完整回归与不变量

```text
$ npm test
Test Files  77 passed (77)
Tests       2711 passed (2711)
Duration    11.88s

$ npm run typecheck
根 tsc + browser/ + @readit/core/editor/element/highlight/math/readit：零错误
```

相对批次一的 2700：新增边界/隔离用例 11 条，删除 smoke 中钉住 no-op 的 1 条，净增 10；
新增 `frontmatter-options.ts` 又被枚举式 `no-await-on-render-path.test.ts` 自动生成 1 条扫描，
合计精确增加 11 条。

| 不变量 | 批次二实测 | 结果 |
|---|---:|---|
| 语料精确匹配 | **56/68** | 不变 |
| 棘轮台账条目 | **12** | 不变 |
| CommonMark | **649 + 3** | 不变 |
| GFM | **658 + 14** | 不变 |
| `TEMPORARY` 计数 | **0** | 不变 |

### 与任务书前提不符的地方

- 任务书所说的 `CORE_SCHEMA` 解析能力与错误处理确实存在，且实测可复用。
- 任务书没有说明“直接从规则文件再导出”会扩大发布声明闭包；完整构建门发现后，改为
  共享纯模块。契约与任务范围未改变，这是实现落点的订正。
- 批次一发现的可变 `DEFAULT_OPTIONS` 仍存在且仍在原 6 任务范围之外；本批的故障注入
  反而证明新隔离断言能抓到读取函数利用这条可变性污染渲染的情况。
- 除上述已报告项外，无新的任务书前提偏差。

### 自审：验证广度由谁选、边界在哪

- 任务书表格里的 8 类边界全部枚举；另加“键只在正文后部出现”以钉住文档起点边界。
- 大小写策略由本次实现者裁决，不是 oracle 实测；选择依据是现有类型与 SPEC 的精确字面量，
  因此报告只声称“契约严格匹配”，不声称 GitHub 或其他 YAML 工具一定同样处理。
- fence 只接受与现有渲染规则相同的 `---` + 可选空白；未扩展到 YAML 的 `...` 结束符，
  因为可见渲染路径也不接受它，扩大读取面会让两条路径分叉。
- 测试覆盖字符串输入与当前 YAML schema，不声称枚举了 js-yaml 能构造的所有对象图；
  非 mapping、数组、损坏输入在实现中统一走 `{}`，现有规则套件继续保护 schema 安全副作用。
- 读取为按行线性扫描，未单独做超大文档性能基准；它不做 I/O、DOM、网络、时间或随机操作，
  且新增源文件已被 no-await 枚举门实际收录。

## 批次三：T4 + T5 + T6（2026-08-13）

**状态**：完成；方案内 6 个任务全部结束。

**本批提交**：`39b18ee`（T4）、`8d5ba7a`（T5）、`f9a50f5`（T6）。

### T4 — Phase A 非异步纯度棘轮

`packages/core/test/no-await-on-render-path.test.ts` 继续用原扫描保护 await/async/dynamic
import，另用 TypeScript AST 对 `packages/core/src/**/*.ts` 的全部 24 个文件逐个生成三类测试：

- 直接语法的 `Date.now`、`Math.random`、`new Date`；
- `fs` / `node:fs` / `child_process` / `node:child_process` 的运行时静态 import、动态
  import 或 `require`；
- 顶层 `let`/`var`，以及以顶层变量为根的直接赋值、自增减、delete 和已列出的集合/数组
  写方法。

`prepare.ts` 只在原来的 await 半边豁免；上述三类扫描不豁免它。文件头写明静态证明边界，
运行时另断言 `DEFAULT_OPTIONS`、`DEFAULT_LOADERS` 已冻结。

这次不是只加测试，因为任务书所称“性质今天成立”与实测不符。实现同时做了三项订正：

1. 两个公开默认对象改成 `Readonly<...>` 并 `Object.freeze()`；
2. `scan()` 每次调用自行创建 fence 正则，不再写模块级 `FENCE_INFO.lastIndex`；美元判断改为
   无状态的 `String.includes()`；
3. tagfilter 的模块级可写 `WeakSet` 改为每个 MarkdownIt 实例上的私有 symbol 标记。

**五类初始故障注入**：临时在 `types.ts` 加 `Date.now()`、运行时 `node:fs` import、顶层
`let`，并同时解除两个默认对象的冻结。实际输出：

```text
$ npx vitest run packages/core/test/no-await-on-render-path.test.ts
test/no-await-on-render-path.test.ts (98 tests | 5 failed)
  × packages/core/src/types.ts contains no time or randomness
    Received: ["line 70: Date.now"]
  × packages/core/src/types.ts contains no synchronous I/O capability
    Received: ["line 68: import node:fs"]
  × packages/core/src/types.ts contains no direct module-state writes
    Received: ["line 71: top-level let/var"]
  × DEFAULT_OPTIONS is frozen public module state
  × DEFAULT_LOADERS is frozen public module state
Test Files  1 failed (1)
Tests       5 failed | 93 passed (98)
```

**自审补出的 prepare 动态 import 探针**：第一版只抓静态 import/require；由于
`prepare.ts` 在旧半边允许动态 import，这会留下交叉漏洞。补上 AST 分支后，临时加入
`void import('node:fs')`，实际输出：

```text
$ npx vitest run packages/core/test/no-await-on-render-path.test.ts
test/no-await-on-render-path.test.ts (98 tests | 1 failed)
  × packages/core/src/prepare.ts contains no synchronous I/O capability
    Received: ["line 65: import node:fs"]
Test Files  1 failed (1)
Tests       1 failed | 97 passed (98)
```

全部探针撤销后的最终绿灯：

```text
$ npx vitest run packages/core/test/no-await-on-render-path.test.ts
Test Files  1 passed (1)
Tests       98 passed (98)
```

### T5 — dir-auto 两条路径同策略守卫

已确认 `rawshape.ts` 继续直接从 `heading.ts` import `OCTICON_LINK`，没有重做已还清部分。
`DIR_AUTO_TOKENS` 与 `DIR_AUTO_TAGS` 仅从 core 内部规则模块导出给测试；测试中的显式映射为：

```text
paragraph_open   -> p
heading_open     -> h1, h2, h3, h4, h5, h6
bullet_list_open -> ul
ordered_list_open -> ol
```

一条断言精确比较映射的 token keys 与 Markdown 路径集合，另一条精确比较映射的 tag values
与 raw HTML 路径集合。两个方向分别故障注入：

```text
# 只给 DIR_AUTO_TOKENS 加 __probe_open
Test Files  1 failed (1)
Tests       1 failed | 5 passed (6)
Received 多出 "__probe_open"

# 恢复 token，只给 DIR_AUTO_TAGS 加 __probe
Test Files  1 failed (1)
Tests       1 failed | 5 passed (6)
Received 多出 "__probe"
```

恢复后的相关路径：

```text
$ npx vitest run packages/core/test/rules/dirauto.test.ts packages/core/test/rules/rawshape.test.ts
Test Files  2 passed (2)
Tests       51 passed (51)
```

### T6 — 内部清理三小件

1. `createSpecEngine` 删除未读取的 `opts: RenderOptions` 与 `void opts`，签名只保留可选
   `rules`；更新 integration、spec harness、tagfilter 三个真实调用点及相关注释。
2. 删除 `extract-gfm-autolink-examples.mjs`。全仓 `rg` 找到的名字只在本方案、旧债务表和
   旧实施计划中作为文档记录；脚本、manifest、源码与测试均无执行引用。现役能力由
   `fetch-specs.ts:parseGfmSpec` 承担，并有 `fetch-specs.test.ts`。
3. 保留 `scanDollars` / `replaceEmoji` 的内部 export，因为前者是 R0–R8 的 110 行核心，
   后者的交替 text/raw 分片也是独立契约；分别补 4 条和 3 条直接单元测试。美元测试精确钉
   单/双 delimiter offsets、mask、UTF-16 astral offset 与 explain log；emoji 测试钉 Unicode
   同片、custom raw 分片及 unknown-candidate latch。

**七条新断言的故障注入**：临时让 `scanDollars` 对 direct-case probe 恒返回 `[]`，让
`replaceEmoji` 对 probe 恒返回原文。实际输出：

```text
$ npx vitest run packages/core/test/rules/math-inline.test.ts packages/core/test/rules/emoji.test.ts
math-inline.test.ts (27 tests | 4 failed)
  × reports single and display delimiter widths
  × ignores a masked opener without shifting later offsets
  × counts astral characters as two UTF-16 code units
  × writes exact flattened-run offsets to the supplied decision log
emoji.test.ts (17 tests | 3 failed)
  × keeps Unicode replacements in the surrounding text fragment
  × splits custom markup into alternating text and raw fragments
  × latches after an unknown candidate before replacing the next known one
Test Files  2 failed (2)
Tests       7 failed | 37 passed (44)
```

恢复后连同三个 `createSpecEngine` 调用路径和 `parseGfmSpec`：

```text
$ npx vitest run packages/core/test/rules/math-inline.test.ts \
    packages/core/test/rules/emoji.test.ts packages/core/test/integration.test.ts \
    packages/core/test/rules/tagfilter.test.ts packages/core/test/spec/fetch-specs.test.ts
Test Files  5 passed (5)
Tests       97 passed (97)
```

### 完整回归

重写/折叠最终提交后的最终树实测：

```text
$ npm test
Test Files  77 passed (77)
Tests       2794 passed (2794)
Duration    11.76s

$ npm run typecheck
根 tsc + browser/ + @readit/core/editor/element/highlight/math/readit：零错误

$ npm run build
vite-node packages/readit/build.ts：退出码 0

$ npx vitest run packages/readit/test/public-surface.test.ts
Test Files  1 passed (1)
Tests       6 passed (6)
```

`npm test` 期间照常打印 `GITHUB_TOKEN is required...`：字符串来自测试导入的
`oracle-refresh.ts` 静态提示，不是网络请求；进程最终退出码为 0。相对批次二的 2711，
T4 对 24 个源码文件新增三类扫描并加两个冻结用例，共 +74；T5 +2；T6 +7；合计恰为
**+83 = 2794**。

第一次辅助计数命令错误地读取不存在的 `packages/core/test/corpus-manifest.json`，在 typecheck
已通过后以 `ENOENT` 退出。纠正为复用 `corpus-harness.ts` 的目录规则（排除 adversarial /
inline-math）后，得到下列实际值；这个辅助命令错误没有被包装成成功。

### 四条不变量实测

```json
{
  "corpusExactMatches": 56,
  "corpusTotal": 68,
  "knownMismatchEntries": 12,
  "commonmarkPassing": 649,
  "commonmarkWhitelist": 3,
  "gfmPassing": 658,
  "gfmWhitelist": 14,
  "temporary": 0
}
```

| 不变量 | 批次三实测 | 结果 |
|---|---:|---|
| 语料精确匹配 | **56/68** | 不变 |
| 棘轮台账条目 | **12** | 不变 |
| CommonMark | **649 + 3** | 不变 |
| GFM | **658 + 14** | 不变 |
| `TEMPORARY` 计数 | **0** | 不变 |

### 与任务书前提不符的地方

- T4 的“性质今天成立”不成立：除批次一已报告的两个可变公开默认对象外，实测还发现
  `prepare.ts` 写模块级 global regex 的 `lastIndex`，tagfilter 写模块级 `WeakSet`。三类
  问题均已在 T4 清掉，而不是写一条对现状假绿的守卫。
- T6 的“全仓零引用”若按字面包含文档并不成立：当前方案和两个历史计划会提到孤儿脚本；
  实测成立的是零可执行/manifest 引用。删除不会切断任何命令或 fixture 生产路径。
- `createSpecEngine` 不只在 integration 测试出现；另有 spec harness 与 tagfilter 单测两个
  调用点。任务书只用 integration 证明函数是活的，并未明确声称它是唯一调用方，但实现已
  按全仓枚举更新三处。
- T5 所述 `OCTICON_LINK` 已共享、两个测试接缝均有生产调用方等其余前提均与实测一致。

### 自审：验证广度由谁选、边界在哪

- T4 的源码广度来自对 `packages/core/src` 的递归枚举，不是手选文件；新增文件会自动进入
  三类扫描。禁止语法的广度由本次实现者选择：能抓直接时间/随机调用、四个 Node I/O 模块
  的三种运行时加载形态、顶层变量的直接写；抓不到 alias、computed/eval、第三方内部状态、
  Deno/Bun 等其他运行时 API，或藏在 opaque factory 里的状态。该边界已写在测试头部。
- `Object.freeze` 检查只覆盖 core 发布根入口的两个公开默认容器，且是浅冻结；两者当前成员
  是 primitive/null/function，没有嵌套可写配置对象。本批没有顺手冻结 element 的
  `DEFAULT_MOUNT_OPTIONS`，因为它不在 Phase A 纯函数契约内。
- T5 的 exact equality 能证明两份代码集合没有越过显式映射漂移；映射本身仍由实现者依据
  两份现有实测策略写定，不证明 GitHub oracle 永远仍是这一组标签。
- T6 对调用点与脚本引用使用全仓 `rg` 枚举；direct test 输入由实现者选择，不是 R0–R8 或
  emoji 字典的完整枚举。`scanDollars` 的完整规则广度仍由既有间接 R0–R9、explain、159 例
  corpus 承担；新测试只证明 exported seam 本身被直接接线且关键返回形状可观察。
- 本批未改保真度台账、规格白名单或 oracle fixture；三向 ratchet 与全部规格套件在最终
  `npm test` 中实际通过，没有通过重钉换绿。
