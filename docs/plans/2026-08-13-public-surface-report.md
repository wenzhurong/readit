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
