# 计划三执行报告

**日期**：2026-08-13

**基线**：`186343a`

**本报告范围**：Phase A（M5 Mermaid）、Phase B（`@readit/find`）与 Phase C 分批记录。

## 裁决

- Mermaid Phase A 输出采用用户指定的**分支 A**：继续输出本地
  `highlight-source-mermaid` 代码块，浏览器侧在同一 wrapper 内水合。四条
  D-MERMAID 记为永久架构性偏离，台账仍为 12 条。
- Phase C 的产品下限采用用户确认的 **macOS 14 + Safari ≥ 17.2**。这不是 Mermaid
  真 WKWebView 下界已经测完；若手工矩阵测出更高下限，发布门槛随之上调。
- Phase C 采用“可可靠自动化的自动化 + 六项具名真机清单”的分界；清单见
  `docs/plans/2026-08-13-m6-manual-acceptance.md`，未实际勾选前不记 M6 真机验收通过。

## Phase A — M5 Mermaid

### A1 — `@readit/mermaid` 与离屏渲染

提交：`0b6f8a4 feat(mermaid): add offscreen renderer plugin`

落地内容：

- 新增懒加载的 `@readit/mermaid` 包，固定 `mermaid 11.16.1` 与
  `dompurify 3.4.13`。
- 等待目标字体，调用两参数 `mermaid.render(id, source)`；用绝对定位且真实布局的
  Mermaid 临时节点测量，随后自行消毒 SVG、注入、执行 `bindFunctions`。
- 仅清除 `foreignObject` HTML 后代上的 `opacity` / `transform` / `filter`，保留 SVG
  几何变换。
- Mermaid 与 DOMPurify 留在独立插件闭包，不污染其他入口。

先红后绿与断言负向证据：

- 包和公开子路径尚不存在时，包测试、发布 `exports`、构建产物与导入方向守卫均红；
  建包并显式更新公共表面后转绿。
- 临时破坏字体等待、两参数 render/离屏规则、消毒/绑定顺序、WebKit 属性护栏、错误态与
  “只水合一次”路径时，相应 renderer 断言会红；恢复后：
  `npx vitest run packages/mermaid/test --reporter=verbose` → **1 文件 / 4 通过**。
- 产物门恢复后：`packages/readit/test/build-output.test.ts` 的 Mermaid 独立闭包两条断言
  均通过；真实闭包大于 500 KB，不是桩。

### A2 — element 按需水合

提交：`dcaeb81 feat(element): hydrate Mermaid on demand`

落地内容：

- `scan().needsMermaid` 接上消费者；`MountOptions.loadMermaid`、
  `PendingCapability = 'mermaid'` 与 `data-readit-pending` 完整接线。
- 能力到货前继续显示 Phase A 源码；到货后水合当前内容；加载失败不重试且保持可见降级。

先红后绿与断言负向证据：

- 接线前，新增的默认选项、pending、能力到货水合、失败后不重试及无 loader 不报 pending
  断言均红；逐条接线后转绿。
- 批次收尾复跑：
  `npx vitest run packages/element/test/rerender.test.ts packages/element/test/mount.test.ts --reporter=verbose`
  → **2 文件 / 49 通过**。

### A3 — 真浏览器结构、降级与视觉

提交：`ed4a7b0 test(mermaid): cover browser hydration and visuals`

落地内容：

- 浏览器结构断言覆盖可见 SVG、节点/绑定状态、懒加载 chunk 被截断后的源码与 pending、
  语法错误的具名可见错误态。
- 新增 Mermaid L4 场景；截图只在固定 Playwright Linux 容器内比较。

先红后绿与断言负向证据：

- 临时把离屏测量规则改为 `display:none` 后，可见 SVG 的结构断言在真浏览器中变红；
  恢复 `position:absolute;left:-99999px` 后转绿。
- 截断 Mermaid chunk 与语法错误不是恒绿替身：测试分别断言 Phase A 源码、pending、错误
  `role=alert` 和组件继续可用。
- 本批最终 `npm run test:browser` 中 Mermaid 的 Chromium/WebKit 6 条均通过。
- macOS 本机直接跑 `npm run test:visual` 因字体/平台基线按预期 **12/12 红**，未重钉；
  使用 `mcr.microsoft.com/playwright:v1.62.1-noble` 固定容器只比较、不更新，实际输出
  **12 passed (6.6s)**。

### A4 — SPEC 与台账

提交：`3ce8e8e docs(mermaid): record permanent Phase A shape`

- SPEC 的 M5 状态与 Mermaid 输出边界同步。
- 四条 D-MERMAID explanation 改写为分支 A 的永久架构性偏离；每条明确本地 wrapper、
  GitHub 托管 enrichment shell 与离线产品选择。
- `npm run corpus:diff -- --check`：所有已记录差异均显示 `recorded ... (in sync)`，退出码 0。

## Phase B — `@readit/find`

### B1 — DOM 独立文本模型

提交：`9286513 feat(find): build a DOM-independent text model`

落地内容：

- 新增零依赖 `@readit/find` workspace 包。
- `buildTextModel` 构建扁平文本与 `Text node + offset` 映射；`rangeForMatch` 支持跨节点
  Range；`findTextMatches` 是字面量、默认忽略大小写、非重叠匹配。
- `lineAtOffset` 让源码模式按完整文档字符串定位，不读取 CodeMirror 虚拟化 DOM。

先红后绿与断言负向证据：

- 实现前新增 4 条模型测试全部红。
- 临时破坏文本拼接/隐藏节点过滤/字面量匹配/源码行换算后 **4/4 红**；恢复后
  `packages/find/test/model.test.ts` → **4/4 通过**。

### B2 — Custom Highlight、`<mark>` 降级与内置 UI

提交：`b0428c8 feat(find): highlight matches without mutating content`

落地内容：

- 主路径用共享 `CSS.highlights` 注册表与 `::highlight(readit-find[-current])`；多实例贡献合并，
  销毁一个实例不会清掉另一个实例。
- 当前 Range 通过 `getBoundingClientRect()` 手写滚动。
- 无 Custom Highlight 时用可逆的 `<mark data-readit-find>`，跨内联节点仍只计一个逻辑命中。
- 无参 `find()` 打开嵌套 shadow 查找栏；输入、前后按钮、Enter/Shift+Enter、Escape 共用状态机。

先红后绿与断言负向证据：

- 控制器 7 条测试实现前为红；临时切断注册表、滚动、mark 恢复、源码回调与 UI 状态机后
  **7/7 红**；恢复后 **7/7 通过**。
- `@readit/find` 最终总计 **11/11 通过**；发布插件闭包无运行时依赖，实测 minified+gzip
  **3176 B**，在计划的手写预算内。

### B3 — `mount().find`、发布表面与真浏览器

提交：`9b85e65 feat(element): expose document find`

落地内容：

- `MountHandle` 从五个方法增为六个，加入精确签名的 `find()`；销毁后调用仍抛统一的
  `已经 destroy` 错误。
- read/split 搜索可见预览 DOM；source/plain 搜索完整文档模型并调用编辑器行滚动。
- Phase A 重绘及 Mermaid 替换为 SVG 后刷新活动查询，让 Range 重新绑定到已连接的新节点。
- 查找 CSS 写入 shadow 内；查找 UI 自身再用一层 shadow，更新计数不会改变外层
  `shadowRoot.innerHTML`。
- 新增 `readit/plugins/find` 明确子路径并同步 build、类型重写、公共符号清单、依赖方向与
  SPEC。
- 真浏览器检查发现单窗格 source 的父窗格会被 CodeMirror 内容撑高；补
  `.readit-source { height: 100% }` 后真实 `.cm-scroller` 才产生滚动。

先红后绿与断言负向证据：

- B3 实现前的定向 Vitest：SPEC 仍声明不含 find、MountHandle 仍只有五个方法、
  `./plugins/find` 不存在，实际 **4 failures**。
- 新增销毁断言后临时删掉 `kernel.find()` 的 `assertLive()`：实际 **1 failed**，收到
  `Cannot read properties of null` 而不是 `/已经 destroy/`；恢复后该断言通过。
- 临时把产物里的 `readit-find-current` 全部改名：build-output 定向断言实际
  **1 failed / 17 skipped**；恢复并重建后 **18/18 通过**。
- 对五条浏览器路径同时注入故障（强制绕开 Custom Highlight、禁用源码滚动、改坏 mark
  属性、禁止 UI open）：Chromium/WebKit 实际 **10/10 failed**，五类测试在两个引擎中
  各自变红；恢复后 **10/10 passed**。
- 最终补跑 Firefox：
  `npx playwright test browser/element/find.spec.ts --project=element-firefox` →
  **5 passed (10.6s)**。

## 全批最终验证

| 命令 | 实际结果 |
|---|---|
| `npm test` | **80 文件 / 2821 通过 / 0 失败** |
| `npm run typecheck` | 根、browser 与 8 个 workspace 全部零错误 |
| `npm run test:perf` | **5 通过 / 1 校准专用跳过** |
| `npm run build` | 退出码 0 |
| `npm run test:browser` | Chromium/WebKit **56 通过 / 2 既有能力跳过 / 0 失败** |
| Firefox 的 B3 定向验收 | **5 通过 / 0 失败** |
| 固定 Linux 容器 L4 | **12 通过 / 0 失败** |
| `npm run corpus:diff -- --check` | 退出码 0，全部记录 `in sync` |
| `git diff --check` | 退出码 0 |

## 四条不变量

以下数字由当前 JSON 清单程序化重算，不从散文抄录：

| 不变量 | 实测 | 结论 |
|---|---:|---|
| 语料精确匹配 | **56/68** | 不变 |
| 棘轮台账条目 | **12** | 不变 |
| CommonMark | **649 + 3 白名单** | 不变 |
| GFM | **658 + 14 白名单** | 不变 |
| `TEMPORARY` | **0** | 不变 |

## 计划前提与实测差异

- 计划基线写的是 77 文件 / 2794 测试；新增 `find` 单元与浏览器接线后，最终自然增长为
  80 文件 / 2821 测试。这是新增覆盖，不是不变量漂移。
- `docs/plans/2026-08-13-plan3-report.md` 原先不存在；“追加”没有既有目标，因此本次创建。
- B3 暴露了计划未点名的 source 单窗格高度缺口：CodeMirror 已虚拟跳转到屏幕外命中，
  但父窗格无确定高度导致 `.cm-scroller.scrollTop` 永远为 0。已用两引擎真实布局复现并修复。
- 其余 Phase A/B 前提与实测一致。

## 自审：验证广度与边界

- 文本模型枚举验证了跨节点、脚本/样式/template、`hidden`、`aria-hidden`、字面量与大小写；
  没有声称覆盖 CSS 计算后的 `display:none`、伪元素生成内容、iframe 或 closed shadow。
- 浏览器查找五条路径在 Chromium、WebKit、Firefox 都跑过；全量 element 回归脚本按仓库现状只跑
  Chromium/WebKit，Firefox 是本批新增功能的定向 5 条，不是全仓 Firefox 回归。
- L4 比较只在固定 Linux 镜像中有判定意义；macOS 结果仅作为“环境确实不同”的诊断，不参与
  基线裁决。
- Mermaid 的结构断言钉可见 SVG、错误/降级与绑定状态，不钉随机布局产生的完整 SVG 字节；
  几何由固定容器截图覆盖。
- `@readit/find` 体积门钉小于 20 KB 的数量级并禁止两个原生捷径字符串，不是精确字节快照；
  实测 gzip 3176 B 另行记录。

## 阶段边界

Phase A 与 Phase B 完成。Phase C 未开始；开始前仍须把 §2.2 的最终 macOS/Safari 下限和
§2.3 的自动化/手工验收分界裁决清楚。
