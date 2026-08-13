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
