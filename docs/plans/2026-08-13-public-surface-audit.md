# readit 公共接口面审计

**日期**：2026-08-13

**审计基线**：`8c2881a`（代码与任务书指定的 `66bff73` 相同；其后只有任务书文档提交）

**审计对象**：`packages/readit/package.json` 中全部 7 个 `exports` 子路径；其中 5 个是 JS 入口

## 1. 枚举方法与实测结果

先运行真实发布构建，再从 `package.json` 的 `exports` 出发解析每个 ESM 目标，逐个
`import()` 产物并读取 `Object.keys()`。没有从源码 `export` 语句反推。

```text
$ npm run build
> build
> vite-node packages/readit/build.ts

$ node --input-type=module -e '<从 package.json.exports 解析目标并逐个 import()>'
.                       ["DEFAULT_LOADERS","DEFAULT_OPTIONS","GITHUB_EMOJI_BASE","prepare","readFrontmatterOptions","render","renderWithExplain","scan"]
./element               ["DEFAULT_MOUNT_OPTIONS","DEFAULT_TAG","defineReadit","mount"]
./editor                ["createEditor"]
./plugins/math          ["TEX_PACKAGES","createMathRenderer"]
./plugins/highlight     ["createShikiHighlighter","createStarryNightHighlighter"]
./styles.css            (non-JS: ./dist/readit.css)
./package.json          (non-JS: ./package.json)
```

因此本次逐符号审计覆盖 **5 个 JS 子路径、17 个运行时符号**。发布入口来源可由
`packages/readit/build.ts:13-19` 复核；7 个子路径的声明来源是
`packages/readit/package.json:18-52`。

行为覆盖复核实际运行了两组测试：

```text
$ npx vitest run <15 个与公共符号直接相关的测试文件>
Test Files  15 passed (15)
Tests       225 passed (225)

$ npx playwright test contract.spec.ts --project=editor-chromium --project=editor-webkit
8 passed (9.7s)
```

第一条命令包含 core 的 smoke/prepare/corpus、element 的 define/mount/panes、editor 的
plain/module-boundary、math 的 renderer/determinism、highlight 的 shiki/starry-night/
离线 WASM，以及 readit 的 node-purity/build-output。第二条直接让
`createEditor('plain'|'codemirror')` 的两个返回实现跑同一张编辑器契约表。

## 2. 逐符号审计

判定列中的“类型吻合”指构建后的可达 `.d.ts` 所承诺的返回形状由实现给出；它不表示
类型系统能够表达所有语义约束（例如纯度或确定性）。共同的声明入口链见
`packages/readit/dist/{core,element,editor}.d.ts:1` 与
`packages/readit/dist/plugins/{math,highlight}.d.ts:1`。

| 子路径 / 符号 | 真实实现证据 | 行为测试证据 | SPEC 对照 | 类型承诺与判定 |
|---|---|---|---|---|
| `.` / `DEFAULT_LOADERS` | `packages/core/src/prepare.ts:17-20`：math 是真实动态 import，highlighter 明确为 `null` | `packages/core/test/prepare.test.ts:55-65,88-92`：真实加载 MathJax、只调一次、钉住 highlighter 为空 | §3.1 唯一异步缝（`SPEC.md:138-152`）一致 | `Loaders` 声明见产物 `prepare.d.ts:9-18`，实现吻合；对象本身可变，见 §3 |
| `.` / `DEFAULT_OPTIONS` | `packages/core/src/types.ts:48-55`：六个真实默认字段；`index.ts:16-18` 被 `render` 合并使用 | `packages/core/test/smoke.test.ts:74-79`、`prepare.test.ts:49-52,80-86`；语料测试另以真实默认渲染 | `inlineMath:'github'` 与 §8.6 一致；但对象可被外部改写并改变同输入的 `render()`，违反 §3.3 的纯函数承诺，见 §3 | 产物 `types.d.ts:13-43` 的 `RenderOptions` 形状与值吻合；**语义不吻合：可变全局默认参与纯函数** |
| `.` / `GITHUB_EMOJI_BASE` | `packages/core/src/types.ts:14-15`：真实绝对 CDN 前缀；被默认选项和 emoji 规则消费 | `packages/core/test/rules/emoji.test.ts:63-66`，且 corpus 的固定 oracle 会独立约束 URL | 与 GitHub 形状保真一致；源码 `types.ts:29-43` 已诚实记录它和离线宿主的冲突及 `emojiBase` 出口 | 产物为字符串字面量类型（`types.d.ts:11-12`），吻合 |
| `.` / `prepare` | `packages/core/src/prepare.ts:53-67`：扫描并按需解析 math/highlighter，不是空壳 | `packages/core/test/prepare.test.ts:48-92` 覆盖无能力、真实 math、注入、off、选项透传 | §3.1 的唯一 `await` 接缝一致 | `Promise<RenderOptions>`（产物 `prepare.d.ts:24-28`）由 async 实现给出，吻合 |
| `.` / `readFrontmatterOptions` | `packages/core/src/index.ts:51-60`：`void src; return {}`，是永久 no-op | `packages/core/test/smoke.test.ts:81-85` 只把 no-op 钉绿，**没有契约行为覆盖** | **不一致**：§8.6 要求读取扁平的 `readit-inline-math`（`SPEC.md:449-465`） | 返回 `{}` 在结构上落入声明联合，但没有兑现 `inlineMath?` 的语义承诺；T3 的明确命中项 |
| `.` / `render` | `packages/core/src/index.ts:20-23`，走完整 `renderWithExplain` / engine | `packages/core/test/corpus.test.ts:20-49,112-144` 对固定 GitHub 快照做三向棘轮；smoke `:19-72` 覆盖精确形状与消毒 | §3 Phase A 同步/同构、§6 形状职责一致；但它通过可变 `DEFAULT_OPTIONS` 取默认值，纯度例外见 §3 | `(src, Partial<RenderOptions>?) => string`（产物 `index.d.ts:4-5`）与同步实现吻合 |
| `.` / `renderWithExplain` | `packages/core/src/index.ts:37-46`：返回真实 HTML 和美元判定日志 | `packages/core/test/smoke.test.ts:36-54` 验证默认空日志与端到端非空日志；规则细节见 `inline-math/explain.test.ts:31-170` | §8.6 `explain:true`（`SPEC.md:465`）一致 | `RenderResult {html, explain}`（产物 `index.d.ts:18`、`types.d.ts:44-52`）吻合 |
| `.` / `scan` | `packages/core/src/prepare.ts:22-47`：真实扫描 math/mermaid/语言并去重 | `packages/core/test/prepare.test.ts:10-46` 覆盖无命中、三种 math、mermaid、裸围栏、语言顺序去重 | §3.1/§11.1 的 prepare 前保守扫描一致 | `ScanResult` 四字段（产物 `prepare.d.ts:2-8,23`）全部由实现给出，吻合 |
| `./element` / `DEFAULT_MOUNT_OPTIONS` | `packages/element/src/kernel.ts:12-27`：十个真实默认字段并被解析器消费 | `packages/element/test/mount.test.ts:38-58` 用独立字面量逐字段断言，并验证局部覆盖 | §9.4 的四模式、shadow/theme/渲染器/导航字段一致 | `MountOptions`（产物 `kernel.d.ts:5-6`）吻合；对象本身可变，见 §3 |
| `./element` / `DEFAULT_TAG` | `packages/element/src/index.ts:37,112`：真实默认参数 `readit-view` | `packages/element/test/define.test.ts:20-25` 同时断言常量和注册结果 | §9.3 `defineReadit(tag='readit-view')` 一致 | 字符串字面量类型（产物 `element/index.d.ts:5`）吻合 |
| `./element` / `defineReadit` | `packages/element/src/index.ts:55-120`：延迟造类、registry get 守卫、真实 define | `packages/element/test/define.test.ts:20-91` 覆盖默认/重复/多标签/属性/断连重连；`no-auto-define.test.ts` 保护 import 无副作用 | §9.3 不自动注册、同页多版本守卫一致 | `(tag?: string) => void`（产物 `element/index.d.ts:6`）吻合；无 DOM 环境明确抛错，不是假 void |
| `./element` / `mount` | `packages/element/src/index.ts:16-35`：真实 kernel，并只投影五方法句柄 | `packages/element/test/mount.test.ts:65-116,157-183,234-276` 覆盖句柄精确键集、渲染、模式、主题、销毁；leak 套件覆盖资源释放 | §9.4 的十项选项与五方法返回对象一致，`find` 未提前出现 | `MountHandle`（`types.ts:31-37`、产物 `element/index.d.ts:4`）五方法均真实提供，吻合 |
| `./editor` / `createEditor` | `packages/editor/src/index.ts:12-19`：按 kind 动态加载 plain/CodeMirror 并返回实例 | 真浏览器 `browser/fixtures/entry.ts:77-112` 直接调用；`browser/editor/contract.spec.ts:18-33` 两引擎跑 7 条/6 条契约，本次实测 8/8 通过；Vitest 的 mount/panes 另覆盖真实路由 | §5 包职责、§5.1 懒加载、§9.4 四模式一致 | `Promise<Editor>`（产物 `editor/index.d.ts:10`；方法形状 `editor/src/types.ts:13-21`）由两个实现给出，吻合 |
| `./plugins/math` / `TEX_PACKAGES` | `packages/math/src/index.ts:16-28`：冻结的五项 allowlist，被 TeX 构造消费（`:75-77`） | `packages/math/test/renderer.test.ts:39-50,65-94` 钉名单并对 html/unicode/CSS 活向量做负测 | §7.1 的五包配置、§7.2 排除 html/unicode/mhchem 一致 | `readonly string[]`（产物 `math/index.d.ts:2-8`），运行时 `Object.isFrozen(...) === true`，吻合 |
| `./plugins/math` / `createMathRenderer` | `packages/math/src/index.ts:66-88`：真实 MathJax SVG、每公式新文档、剥离 latex hints、保留 data-tex | `packages/math/test/renderer.test.ts:4-117` 覆盖形状/安全/隔离；`determinism.test.ts:28-85` 覆盖重复、置换、跨进程哈希 | §7 与 §17.3 的修订（`SPEC.md:964-969`）一致 | 返回 `MathRenderer` 的同步 `render()`（产物 `math/index.d.ts:9-16`），实现吻合 |
| `./plugins/highlight` / `createShikiHighlighter` | `packages/highlight/src/shiki.ts:38-73`：按需加载语法，返回同步 adapter | `packages/highlight/test/shiki.test.ts:17-98` 覆盖语言集、未知语言、同步、文本、外壳、双主题、确定性和黄金文件 | §5.2 的嵌入默认、零 WASM、adapter 形状一致 | `Promise<Highlighter>` 与可选 `langs`（产物 `highlight/shiki.d.ts:2-26`）吻合 |
| `./plugins/highlight` / `createStarryNightHighlighter` | `packages/highlight/src/starry-night.ts:58-76`：真实 common 语法集与本地 WASM URL 覆写 | `packages/highlight/test/starry-night.test.ts:20-78` 覆盖 adapter/黄金文件；`onig-wasm-offline.test.ts:29-66` 证明默认远端路径会被离线门拦、覆写走本地 | §5.2 的桌面默认、真实 `pl-*` class、WASM 离线必做项一致 | 必填绝对 `onigWasmUrl`、返回 `Promise<Highlighter>`（产物 `highlight/starry-night.d.ts:6-37`）与实现吻合 |

## 3. 审计命中与任务书前提偏差

### 3.1 已知命中：`readFrontmatterOptions` 是公共 no-op

这是 17 个运行时符号里唯一没有兑现自身公共语义的函数。现有 smoke 测试并非行为保护，
而是把缺陷固定为绿色。按任务书在 T3 实现并替换该断言。

### 3.2 新命中：可变 `DEFAULT_OPTIONS` 破坏默认调用的纯函数语义

任务书 §0.2 与 SPEC §3.3 都把 `render(src, opts)` 描述为输入的纯函数；任务书 T4 又说
“无模块级可变状态”的性质今天成立。真实发布产物反例：

```text
$ node --input-type=module -e '<import dist/core.js；改写 DEFAULT_OPTIONS.inlineMath；前后 render 同一 src>'
{"frozen":false,"inlineMath":"github","before":"...<math-renderer ...>$x$</math-renderer>..."}
{"inlineMath":"off","after":"...pre $x$ end...</p>\n","same":false}
```

即外部代码可以改写公开对象，使相同 `render(src)` 在同一进程中返回不同结果。这不是
类型错配：公开的 `RenderOptions` 本来就是可变类型；它是类型没有表达、实现也没有保护的
纯度错配。它也意味着 T4 仅扫描 `let`/`var` 或赋值表达式仍可能假绿——模块级 `const`
所指对象的属性同样可变。

同一只读探针（只在独立 Node 进程内改内存，不改仓库）还得到：

```text
{"DEFAULT_OPTIONS":false,"DEFAULT_LOADERS":false,"DEFAULT_MOUNT_OPTIONS":false,"TEX_PACKAGES":true}
```

`DEFAULT_LOADERS` 与 `DEFAULT_MOUNT_OPTIONS` 也可变，会分别改变后续 `prepare()` / `mount()`
的默认行为；它们没有 Phase A `render()` 那样明确的纯函数承诺，所以本审计把它们记为
公共全局配置风险，不擅自扩展本方案去修。`TEX_PACKAGES` 已在运行时冻结。

### 3.3 其余结果

- `createSpecEngine(opts)`、`scanDollars`、`replaceEmoji` 均不在上述 17 个发布运行时符号里；
  它们属于任务书 T6 指定的内部清理面，不混入本公共表。
- 除 `readFrontmatterOptions` 与 `DEFAULT_OPTIONS` 的纯度问题外，未发现其他“类型承诺存在、
  运行时没有对应值/方法”的公共符号。
- 数学和高亮两个此前未枚举的子路径都不是空壳；它们分别有 2 个真实运行时符号。

## 4. 这次枚举覆盖了什么、没覆盖什么

**覆盖了**：当前工作树 `package.json.exports` 的全部 7 个键；构建后 5 个 ESM JS 入口的
全部 enumerable runtime keys；每个 runtime key 的实现、已有行为测试、相关 SPEC 条款和
构建后可达声明；根入口的 Node 同构行为；编辑器两种实现的 Chromium/WebKit 真浏览器契约。

**没有覆盖**：

1. 类型专用导出（interface/type）不会出现在 `Object.keys()`，本次只沿每个运行时符号所需
   的类型闭包核对，没有另做“全部 type-only 名字”的封闭枚举。
2. `./styles.css` 和 `./package.json` 是非 JS 子路径，没有运行时符号；只确认它们在 exports
   枚举内。本次没有重新做 CSS 视觉像素审计或清单字段语义审计。
3. 根入口的 CJS 条件没有单独做第二份符号全集枚举；已有
   `packages/readit/test/build-output.test.ts:153-165` 钉住 CJS 具名导出注解，
   `node-purity.test.ts:10-35` 钉住 ESM/CJS 行为一致，但这不等于逐名比较两套 key。
4. 行为覆盖列证明的是所列测试本次实际通过，并不声称测试用例覆盖了每个参数组合。
   尤其 `DEFAULT_OPTIONS`/`DEFAULT_LOADERS`/`DEFAULT_MOUNT_OPTIONS` 的可变性此前没有测试。
5. 不访问实时 GitHub、不刷新 oracle；保真结论只对仓库钉住的快照与既有 SPEC 成立。

## 5. 可复跑的完整命令

```bash
npm run build

node --input-type=module -e 'import { readFile } from "node:fs/promises"; import { resolve } from "node:path"; import { pathToFileURL } from "node:url"; const pkg=JSON.parse(await readFile("packages/readit/package.json","utf8")); const esmTarget=(v)=>typeof v==="string"?v:(v.import??v["module-sync"]); for (const [subpath,entry] of Object.entries(pkg.exports)) { const target=esmTarget(entry); const resolved=typeof target==="string"?target:target.default; if (!/\.(?:m?js)$/.test(resolved)) { console.log(`${subpath}\t(non-JS: ${resolved})`); continue } const mod=await import(pathToFileURL(resolve("packages/readit",resolved))); console.log(`${subpath}\t${JSON.stringify(Object.keys(mod).sort())}`) }'

npx vitest run packages/core/test/smoke.test.ts packages/core/test/prepare.test.ts packages/core/test/corpus.test.ts packages/element/test/define.test.ts packages/element/test/mount.test.ts packages/element/test/panes.test.ts packages/editor/test/plain.test.ts packages/editor/test/module-boundary.test.ts packages/math/test/renderer.test.ts packages/math/test/determinism.test.ts packages/highlight/test/shiki.test.ts packages/highlight/test/starry-night.test.ts packages/highlight/test/onig-wasm-offline.test.ts packages/readit/test/node-purity.test.ts packages/readit/test/build-output.test.ts

npx playwright test contract.spec.ts --project=editor-chromium --project=editor-webkit

node --input-type=module -e 'import { pathToFileURL } from "node:url"; import { resolve } from "node:path"; const m=await import(pathToFileURL(resolve("packages/readit/dist/core.js"))); const src="pre $x$ end."; const before=m.render(src); console.log(JSON.stringify({frozen:Object.isFrozen(m.DEFAULT_OPTIONS),inlineMath:m.DEFAULT_OPTIONS.inlineMath,before})); m.DEFAULT_OPTIONS.inlineMath="off"; const after=m.render(src); console.log(JSON.stringify({inlineMath:m.DEFAULT_OPTIONS.inlineMath,after,same:before===after}));'

node --input-type=module -e 'import { pathToFileURL } from "node:url"; import { resolve } from "node:path"; const core=await import(pathToFileURL(resolve("packages/readit/dist/core.js"))); const element=await import(pathToFileURL(resolve("packages/readit/dist/element.js"))); const math=await import(pathToFileURL(resolve("packages/readit/dist/plugins/math.js"))); console.log(JSON.stringify({DEFAULT_OPTIONS:Object.isFrozen(core.DEFAULT_OPTIONS),DEFAULT_LOADERS:Object.isFrozen(core.DEFAULT_LOADERS),DEFAULT_MOUNT_OPTIONS:Object.isFrozen(element.DEFAULT_MOUNT_OPTIONS),TEX_PACKAGES:Object.isFrozen(math.TEX_PACKAGES)}));'
```
