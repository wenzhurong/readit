# 可编辑与保存执行报告

**日期**：2026-08-18  
**基线**：`main` / `11556eb`  
**状态**：E1–E6 实现完成；双平台真引擎验收未执行；未 commit、未 push

## 1. 交付结果

### E1 — 元素编辑事件

- `MountOptions` 新增可空的 `onChange(value)`，默认值为 `null`。
- 用户在 CodeMirror/textarea 中编辑时上报最新全文；宿主 `setValue()`、四模式切换和主题
  切换均不触发回调。
- 浏览器夹具记录回调值，Chromium/WebKit 合同用例已经写入。

### E2 — 桌面入口

- macOS 从 Tauri 默认菜单出发扩展 Save 和 Reading/Source/Split，保留默认 Edit、Window、
  全屏等原生能力，并同步模式选中态。
- Windows 使用 capture 快捷键处理 `Ctrl+1/2/3` 和 `Ctrl+S`，忽略 Shift/Alt、重复和已处理事件。
- CodeMirror 首次动态加载期间显示确定性的可见 pending，成功或降级后移除。

### E3 — Rust 原子保存

- Rust 独立持有当前 Markdown 路径与单调递增 generation；保存命令不接收路径。
- 同目录唯一临时文件写入完整字节，继承原权限，`flush` + `sync_all` 后原子替换目标。
- 当前文档锁覆盖整个替换过程；旧 generation 不能写到当前或先前文档。
- 成功、失败都不遗留 `.readit-save-*`，失败信息带目标路径且不 panic。

### E4 — 可测试的保存状态机

- 状态机独立在 `shell/src/save-state.ts`，`main.ts` 只负责元素、Tauri 与 UI 接线。
- 保存按请求快照串行；A 保存期间继续编辑 B，A 成功后 B 仍脏。
- watcher 用内容 + generation 区分自写回声和真实外部变更，不使用时间窗。
- clean 时应用磁盘值；dirty 时保留本地文本并提示；冲突去重且追踪最新磁盘内容。
- 导航/关闭的保存失败或保存过程中再次编辑都会阻止离开。

### E5 — 可见状态与离开保护

- 标题和状态区显示 dirty/saving；冲突提示提供“用磁盘版本/保留我的修改”。
- 导航、关闭和退出共用“保存/放弃/取消”语义。
- Rust 同时拦截 `CloseRequested` 和 `ExitRequested`；前端 ready 前保留启动失败退路，ready
  后去重并等待前端决策。
- composition 事件门推迟保存、模式切换、watcher 应用、导航和退出，并在
  `compositionend` 后再跨一个事件循环边界执行；未使用猜测的毫秒抑制窗。

### E6 — 文档和债务

- SPEC 与 README 已登记公开回调、菜单、保存状态机、冲突和退出语义。
- D2-28 标为已还清；历史 `172.4 MB` 仍按当时数学/高亮/Mermaid 三大件记录。
- M6 手工清单新增第 7 项，macOS WKWebView 与 Windows WebView2 都保持“未执行”。

## 2. 缺陷回注证据

以下回注均只为证明测试有效，观察到红灯后已恢复源码并重跑为绿：

| 契约 | 注入的缺陷 | 红灯 | 恢复后的绿灯 |
|---|---|---|---|
| 程序化更新不得触发 `onChange` | 在 `kernel.setValue()` 中主动调用回调 | `mount.test.ts:128`：期望 0 次，实际 1 次，参数为 `# Programmatic` | 同一筛选用例 1/1 通过 |
| 用户编辑必须触发 `onChange` | 暂时移除 panes 用户编辑转发 | 用户编辑断言期望 1 次，实际 0 次 | 元素目标组通过 |
| 保存 A 时编辑 B，B 必须仍脏 | 暂时在保存成功后无条件清 dirty | 状态机时序断言由绿转红 | 状态机目标组通过 |
| 必须发生原子替换 | 暂时改为直接覆盖目标文件 | Unix inode 断言由绿转红 | Rust 原子保存目标组通过 |

新增断言还覆盖默认值、pending、快捷键过滤、菜单保留、generation、失败清理、冲突选择、
关闭/退出去重和 composition 排序。没有为每个叶子断言逐一制造独立 mutation；上表记录的是
实际执行过的四个高风险缺陷回注，不把普通绿灯伪写成“先红后绿”。

## 3. 自动化实测

| 命令 | 实际结果 |
|---|---|
| `npx vitest run shell/test/save-state.test.ts ... packages/element/test/panes.test.ts` | 6 文件 / 59 项通过 |
| `npm run typecheck` | 通过，含根、browser 与全部 workspace |
| `npm run build --workspace=readit-shell-frontend` | 通过；仅有既有的大 chunk 警告 |
| `npx vitest run --exclude test/offline-gate.test.ts` | 95 文件 / 2877 项通过 |
| `npm test` | 95 文件、2899 项通过；`offline-gate` 2 项因沙箱 loopback 权限失败 |
| `cargo fmt --check` | 通过 |
| `cargo clippy --all-targets -- -D warnings` | 通过，0 警告 |
| `cargo test -- --skip watcher::tests::parent_watch_reports_atomic_replacement_but_ignores_siblings` | 35 项通过、1 项过滤 |
| Chromium/WebKit `onChange` Playwright 用例 | 未启动：沙箱拒绝监听 `127.0.0.1:5183`（`EPERM`） |

完整 `npm test` 的两项失败分别是 UDP loopback 等待超时，以及 TCP loopback 得到 `EPERM`
而非用例允许的 `ECONNREFUSED/CONNECTED`；同时出现 `bind EPERM 0.0.0.0`。排除该网络门禁后，
其余 2877 项全部通过。Rust 被过滤的既有真实 watcher 用例在本沙箱持续等待文件系统通知而
超时；新增 document/save/leave/menu 测试均已运行。

## 4. 四条不变量

| 不变量 | 本轮实测 | 结论 |
|---|---|---|
| JS 测试 | 2899 通过 / 2 个 loopback 沙箱失败；排除门禁后 2877/2877 | 产品测试无回归，完整门禁受环境阻塞 |
| Rust 测试 + Clippy | 35 通过 / 1 个既有 watcher 过滤；Clippy 0 警告 | 新增覆盖通过 |
| 债务台账条目数 | 18 | 不变 |
| 规格白名单 `TEMPORARY` 条目 | `known-failures.json` 中 0 | 不变 |

## 5. 实际运行与阅读结论的边界

实际运行得到：单元/集成测试数量、类型检查、构建、Rust 格式与 Clippy、原子替换 inode/权限/
失败清理、缺陷回注红灯，以及三个沙箱错误。

来自代码与文档核对但尚未真机证明：macOS 原生菜单的最终视觉/快捷键、WebView2 快捷键、
两平台输入法组合、文件权限交互提示和系统级关闭/退出流程。Chromium/WebKit 合同用例已写，
但本环境连测试服务器都无法监听，不能把它记为通过。

## 6. 阶段边界

实现层已经补齐“切到源码编辑并保存”这条 v1 目标。正式验收仍差 M6 手工清单第 7 项：在
真实 WKWebView 与 WebView2 中验证编辑、保存、外部冲突、IME、权限错误、关窗和退出。当前
工作树只包含实现与文档改动；提交和推送属于后续独立授权。
