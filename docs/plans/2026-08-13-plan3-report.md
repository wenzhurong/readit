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

## Phase C 第一批 — macOS 壳 C1–C3

前置裁决提交：`d6a7137 docs(plan3): lock Phase C acceptance boundary`

- 产品下限落为 **macOS 14 + Safari ≥ 17.2**；真 WKWebView Mermaid 下界仍待手工矩阵，
  若测出更高版本才通过则上调发布门槛。
- 新建 `docs/plans/2026-08-13-m6-manual-acceptance.md`，保留双击、二次启动、Cmd+F、
  原子保存、真 WKWebView Mermaid、安装/启动/稳态资源六项。当前全部未勾选，M6 真机
  验收仍未达成。

### C1 — 异步且按当前文档目录收口的资源协议

提交：`4d936e4 feat(shell): scope async resource protocol`

落地内容：

- 新建独立于 `spike/tauri-probe` 的正式 `shell/src-tauri`，固定 Tauri 2.11.5；
  `register_asynchronous_uri_scheme_protocol("readit", ...)` 在独立线程读盘并响应。
- 协议根随当前 Markdown 文档切换，只允许访问该文档目录内已存在的普通文件；普通、
  percent-encoded、反斜杠父目录穿越与 encoded absolute path 均拒绝，解析后的 symlink
  若越出根目录返回 403。
- CSP 同时列出 `readit:` 与 `http://readit.localhost`；资源响应带 MIME、`no-store` 与
  CORS 头。正式图标由仓库内 SVG 源生成，不复用 throwaway spike 的产物。

先红后绿与负向证据：

- 空解析器首次运行：10 条最终测试中的路径/作用域四类实际 **4 failed / 2 passed**；
  实现后 C1 定向 **10/10 通过**。
- 分别破坏“尚无当前文档”的错误类型、两个 CSP origin、成功状态、MIME、响应体、CORS、
  404 与 400 映射，相应断言逐项变红；恢复后 Rust test 与 `clippy -D warnings` 均通过。

### C2 — 文件关联、Opened 持久交接与正式前端

提交：`d16d731 feat(shell): persist and open associated documents`

落地内容：

- `bundle.fileAssociations` 声明 `md` / `markdown`、`Viewer`、`rank: Default`；bundle 的
  `minimumSystemVersion` 为 14.0。
- `RunEvent::Opened` 先把 file URL 转成路径存入 `Arc<AppState>` 的 FIFO，再发唤醒事件；
  前端先注册监听、再通过 `take_pending_path` 排空队列，因此 Opened 早于 Ready/Window 时
  也不会丢文档。
- `open_document` 在阻塞线程读盘、拒绝非 Markdown 与非 UTF-8；读盘成功后才切换 C1 的
  资源根，失败导航不会弄坏当前文档图片。
- 正式 Vite 前端消费 `readit/element`，数学沿 element 既有 `prepare()` 懒加载，Mermaid
  与高亮由宿主动态加载；23 个自定义 emoji 构建时复制到本地 `/emoji/`。
- 相对图片/音视频 URL 重写到 `readit://localhost/`；MutationObserver 覆盖数学/高亮等
  异步重绘。OS 新开文档通过真实 anchor click 交给 element 既有历史控制器，不在壳里
  重造前进/后退栈。

先红后绿与负向证据：

- AppState/打开/关联实现前 Rust 定向 **4/4 红**；前端资源与路由桩首次运行
  **3 failed / 1 passed**，接线后 Rust C1+C2 **14/14**、前端 **5/5**。
- 临时移除资源根切换后，读盘与 payload 断言仍通过、协议响应从 200 变 503；临时用
  lossy UTF-8 后非法字节断言变红。
- 分别把关联扩展改成 `mdx`、role 改成 `Editor`、rank 改成 `None`，三处断言各自变红；
  移除 shell 的根 Vitest project 后 CI 接线断言变红。
- 临时允许 `..` 与断开 MutationObserver 后，两类前端断言同时变红；恢复后全仓
  **82 文件 / 2826 通过**。
- 真实执行 `tauri build --bundles app` 后读取 `.app/Contents/Info.plist`：
  `CFBundleTypeExtensions = [md, markdown]`、`CFBundleTypeRole = Viewer`、
  `LSHandlerRank = Default`、`LSMinimumSystemVersion = 14.0`。

### C3 — 单实例与二次调用路由

提交：`3beb49a feat(shell): route second launches into open window`

落地内容：

- `tauri-plugin-single-instance` 精确固定 **2.4.3**，并是 Builder 上第一个注册的插件。
- 首次 CLI 启动与插件回调共用裸 argv 解析：跳过 argv[0]、flag 与 URL 形参数；相对路径
  按发起进程的 cwd 解析；不把 Windows 路径喂给 URL parser。
- 二次调用把 Markdown 路径压入同一 AppState 队列、唤醒前端，并 show / unminimize /
  focus `main` 窗口；前端再通过 C2 的 anchor click 路由进 element 历史。

先红后绿与负向证据：

- argv 队列桩首次运行实际 **1/1 红**（0 路径而非 2）；实现后 C1–C3 Rust
  **16/16 通过**。
- 临时不按第二进程 cwd 解析时，断言得到裸 `relative file.md` 而非绝对路径；临时允许
  URL 形参数时队列从 2 变 3，两次均实际变红。
- 插件版本改为语义等价但不符合固定文本的 manifest 写法时精确固定断言变红；在首个
  `.plugin(` 之前注入故障标记时注册顺序断言变红。
- 加入插件后重新生成 release `.app` 成功；Rust `clippy --all-targets -- -D warnings`、
  shell Vitest **5/5**、shell TypeScript 均零错误。

## Phase C 第一批最终验证

| 命令 / 检查 | 实际结果 |
|---|---|
| `cargo test --offline --manifest-path shell/src-tauri/Cargo.toml` | **16 通过 / 0 失败** |
| `cargo clippy --offline --manifest-path shell/src-tauri/Cargo.toml --all-targets -- -D warnings` | 退出码 0 |
| `npm test --workspace=readit-shell-frontend` | **2 文件 / 5 通过** |
| `npm run typecheck` | 根、browser 与 9 个 workspace 全部零错误 |
| `npm test` | **82 文件 / 2826 通过 / 0 失败** |
| `npm run build --workspace=readit-shell-frontend` | 退出码 0，离线 emoji 已复制 |
| `tauri build --bundles app` | release `readit.app` 生成成功 |
| `git diff --check` | 退出码 0 |

依赖审计的已知未处理项：`npm audit --json` 实际报告 **2 high / 0 critical**。两项都不是
本批新增依赖：一项是 `packages/core` 直接固定的 `js-yaml 4.1.0`（当前建议修复到 4.3.1），
另一项是既有 `vite → postcss → nanoid 3.3.17` 的传递依赖。按 C1–C3 批次边界，本批没有
擅自升级核心解析依赖或重写 lockfile 来混入安全维护；发布前需单独开具名修复批次并跑完整
语料/快照回归。

## 阶段边界

Phase A、Phase B 与 Phase C 第一批 C1–C3 完成。**按计划在批次边界停止**：C4 文件监听、
C5 更新器、C6 外部链接和 C7 Cmd+F 尚未开始；六项真机清单也尚未执行。因此这不是
“M6 已验收”，只是 C1–C3 的实现与可自动化验证完成。

## Phase C 第二批 — macOS 壳 C4–C5

本节追加于第一批边界之后；上节“C4/C5 尚未开始”只描述第一批提交时的状态。

### C4 — 原子替换后仍存活的文件监听

提交：`6144b8e feat(shell): survive atomic document replacement`

落地内容：

- 精确固定 `notify 8.2.0`。监听目标不是可能被 rename 替换掉的文件 inode，而是文档的
  父目录（非递归）；事件必须命中当前文档路径且不是纯 access/rescan 才会通知前端。
- `AppState` 只在新文档已经成功读取并完成资源作用域切换后替换 watcher；打开失败不会
  丢掉旧文档监听，重复打开同一路径则复用现有 watcher。
- Rust 发出 `readit-document-changed`；前端只接受当前文档的事件，以 80 ms 窗口合并
  burst，组件销毁时取消待执行刷新，避免重复读取和旧文档竞态。

先红后绿与负向证据：

- Rust 首次因 `DocumentWatcher` 尚不存在而红；前端首次因 `watch-reload.js` 尚不存在而红。
- 临时让 Rust 事件过滤恒为 false 后，真实临时文件写入再 `fs::rename` 覆盖当前文档的
  macOS FSEvents 测试在 5 秒超时并失败；恢复后 watcher 定向测试通过，并确认同目录 sibling
  不会触发当前文档刷新。
- 临时把前端事件处理改成 no-op 后，“burst 只刷新一次”断言从期望 1 得到 0；恢复后前端
  定向 **7/7 通过**，当时 Rust 全套 **17/17 通过**。

### C5 — 独立于 M7 的签名更新通道

提交：`650aa50 feat(shell): add signed GitHub release updates`

落地内容：

- 精确固定并注册官方 `tauri-plugin-updater 2.10.1`；单实例插件仍保持第一个注册。
  Rust `check_for_update` 持有待安装 update，只有用户点击“安装并重启”后
  `install_update` 才下载、验签、安装并重启；检查失败或无更新时 UI 保持隐藏，不静默安装。
- `createUpdaterArtifacts: true`、updater 公钥与固定的 GitHub Releases
  `latest.json` endpoint 已写入配置。手动触发的 `release macOS` workflow 使用官方 Tauri
  Action，为 `aarch64-apple-darwin` 与 `x86_64-apple-darwin` 生成草稿 Release 与 updater
  manifest；工作流只引用两个 Actions secret 名称。
- 维护者指南记录 updater minisign 与 Apple 代码签名的信任边界、secret 注入、密钥备份、
  本机构建及发布步骤。当前 `signingIdentity: "-"` 只是 ad-hoc 签名，不提供 Developer ID、
  notarization 或 Gatekeeper 分发信任，故没有把 M7 记成完成。
- 最终加密私钥仅在 `/Users/mac08/.tauri/readit.key`，口令仅在 macOS 钥匙串；仓库只含
  公钥与 secret 名。首次经 npm wrapper 生成时，wrapper 在日志中展开了 `-p` 参数；该对
  密钥立即按泄露处理并轮换，旧材料被覆盖，最终提交、公钥与构建产物均使用全新密钥。

先红后绿与负向证据：

- workflow 不存在、前端 updates 模块不存在时，相应合同测试先红。
- 临时关闭 `createUpdaterArtifacts` 并把 workflow 的手动触发改成 push 后，Rust 的两条 C5
  配置/工作流合同测试 **2/2 红**；恢复后 **2/2 通过**。
- 临时让“无更新/离线”显示 UI，并让“有更新”自动安装、状态错误且没有点击处理后，前端
  四条合同测试 **4/4 红**；恢复后 **4/4 通过**。
- 首次本地 release 故意只给 `TAURI_SIGNING_PRIVATE_KEY_PATH`，bundler 明确报
  `public key found, no private key` 且没有生成签名；改用官方支持的
  `TAURI_SIGNING_PRIVATE_KEY=/Users/mac08/.tauri/readit.key` 后成功生成
  `readit.app.tar.gz`（8,055,134 bytes）及 `.sig`（404 bytes）。
- 对生成的 `.app` 执行 `codesign --verify --deep --strict --verbose=2` 成功；实际是 arm64、
  `Signature=adhoc` 且无 TeamIdentifier，不把它描述成已公证或可公开分发的安装包。

## Phase C 第二批最终验证

| 命令 / 检查 | 实际结果 |
|---|---|
| `cargo test --manifest-path shell/src-tauri/Cargo.toml` | **19 通过 / 0 失败** |
| `cargo clippy --manifest-path shell/src-tauri/Cargo.toml --all-targets -- -D warnings` | 退出码 0 |
| `npm test --workspace=readit-shell-frontend` | **4 文件 / 11 通过** |
| `npm run build --workspace=readit-shell-frontend` | 退出码 0 |
| `npm run typecheck` | 根、browser 与 9 个 workspace 全部零错误 |
| `npm test` | **84 文件 / 2832 通过 / 0 失败**；既有无 GitHub token 警告不影响离线通过 |
| `npm run test:perf` | **5 通过 / 1 跳过**，32.16 秒 |
| 四个 core spec/corpus Vitest 文件 | **4 文件 / 1416 通过** |
| workflow YAML 解析 | Ruby 解析成功 |
| updater release bundle + `codesign --verify` | arm64 本地签名产物生成，严格验证通过 |
| `git diff --check` | 退出码 0 |

四条不变量的批次收尾实测值：

| 不变量 | 实测 |
|---|---|
| 语料总数 / 已纳入断言 | **68 / 56** |
| mismatch 台账 | **12** |
| CommonMark 已知失败 / 通过 | **3 / 649** |
| GFM 已知失败 / 通过 | **14 / 658** |

临时豁免计数为 **0**。本批没有改变上述值。

依赖审计复跑仍为 **2 high / 0 critical**：既有 `js-yaml 4.1.0` 与既有链路中的
`nanoid 3.3.17`，本批没有改动 npm lockfile，也没有把安全升级混入壳功能提交。
本机没有安装 `cargo-audit`，因此只完成 Rust 精确版本检查、编译、测试和 clippy；没有把
“未运行 Rust advisory 数据库审计”写成通过。

## 第二批证据边界与前提偏差

**实际运行得到的结论**：macOS 上真实触发了 temp-write + rename 的 FSEvents 路径；Rust、
前端、全仓、语料与性能测试均实际运行；本机实际生成并验证了 arm64 updater bundle 与
minisign `.sig`；workflow YAML 实际完成语法解析。

**只来自配置或文档阅读、尚未端到端运行的结论**：Intel matrix、GitHub Actions、草稿
Release、线上 `latest.json`、从已发布 Release 检查/下载/验签/安装/重启均未执行。工作流
只验证了静态形状，不代表 Action 已成功运行；两个 GitHub Actions secrets 也尚未上传。

与计划前提相比有三处执行细化或实测偏差：

1. C4 计划只规定必须覆盖 atomic rename；实际选用父目录非递归监听，并在 JS 侧用 80 ms
   合并事件，这是为适配 notify 对文件替换语义而选择的实现广度。
2. Tauri CLI 生成密钥时提示过 `TAURI_SIGNING_PRIVATE_KEY_PATH`，但本次 bundler 实测不接受
   该变量；官方文档所列的 `TAURI_SIGNING_PRIVATE_KEY` 可接受私钥文件路径并成功构建。
3. npm wrapper 会回显带 `-p` 的展开命令；因此初始 keypair 作废并轮换，指南也明确禁止该
   调用形状。除此之外，本批没有发现与 C4/C5 计划前提不符之处。

自审的验证广度边界：C4 覆盖本机 FSEvents 与真实 rename，但没有替代“用真实编辑器保存”、
网络文件系统或跨卷操作；C5 只实际构建当前 arm64 机器，没有实际跑 Intel runner、GitHub
发布链路或完整 updater 安装重启。离线检查失败时不展示更新 UI 是有意的产品策略。

## 第二批阶段边界

Phase C 第二批 **C4 与 C5 完成**，在获批批次边界停止；**C6 外部链接与 C7 Cmd+F 未开始**。
六项真机清单仍全部未勾选，其中“真实编辑器原子保存”不能由上述自动化 rename 测试替代，
安装/启动/稳态资源也不能由本地 bundle 构建替代。因此当前仍不是“M6 已验收”，也不是
“M7 已完成”。
