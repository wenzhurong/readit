# readit Windows 调试与项目状态评估

**日期**：2026-08-14
**依据**：[Windows 侧验证方案](./windows-test-plan.md)
**上游快照**：[57a3100e7a94965ed3f54a160daea9b6c018e6e4](https://github.com/wenzhurong/readit/commit/57a3100e7a94965ed3f54a160daea9b6c018e6e4)
**结论级别**：Windows Node/Playwright 实测；Windows WebView2 与桌面壳未覆盖

## 执行摘要

- 引擎与库层在本机通过：`86` 个 Vitest 文件、`2844` 项测试全部通过。
- Windows 上此前没有本机记录的 Playwright 浏览器层全绿：五个 project 合计
  **118 通过 / 6 个具名跳过 / 0 失败**，与文档给出的 macOS 参考基线一致。
- 未发现 Windows 特有的渲染或业务逻辑缺陷。中文+空格路径、三种 `core.autocrlf`、
  CR 对抗语料及大小写/路径扫描均通过。
- `npm run typecheck` 在 Node 24 + npm 11 下退出 `1`：根目录启动的 `vite-node` 无法解析
  workspace 内的 `esbuild`。同一构建脚本从 `readit` workspace 上下文执行成功，之后全部
  TypeScript 检查通过。该问题属于**构建/依赖布局兼容性缺陷**，不是类型或渲染缺陷。
- 超长路径在当前机器上被系统/工具链阻断：默认 Git clone 报 `Filename too long`；仅临时
  启用 `core.longpaths=true` 后 clone 成功，但 `npm install` 又以 `spawn cmd.exe ENOENT`
  失败。测试没有进入项目代码，不能据此判定项目长路径逻辑失败。
- 项目尚不具备 Windows 桌面交付能力：没有 Windows bundle 配置、发布矩阵或可运行壳，
  真 WebView2 仍为零覆盖。因此不能把 Playwright Chromium 全绿写成“Windows 产品验收通过”。
- 当前依赖审计仍为 **2 high / 0 critical**；[GitHub Releases](https://github.com/wenzhurong/readit/releases)
  页面没有任何已发布版本。

## 环境

| 项 | 实测值 |
|---|---|
| OS | Microsoft Windows 11 Home 64-bit |
| OS 版本 / build | `10.0.26200` / `26200` |
| Node | `v24.18.0` |
| npm / npx | `11.16.0` |
| Git | `2.51.0.windows.1` |
| 仓库路径 | `D:\robot\readit` |
| 上游分支 / 提交 | `main` / `57a3100e7a94965ed3f54a160daea9b6c018e6e4` |
| `core.autocrlf` | global 未设置；system=`true`，来自 `C:/Program Files/Git/etc/gitconfig` |
| `core.longpaths` | global/system 均未设置 |
| `LongPathsEnabled` | `0` |

系统 PATH 原本没有 Node/npm。本次使用工作区已经存在的
`D:\robot\node-v24.18.0-win-x64.zip`，仅为测试命令临时加入 PATH，没有升级系统环境。

### 源码与可复现性说明

本机直连 `github.com` 的 Git HTTPS 端点超时，因此当前 `D:\robot\readit` 是通过 GitHub
官方 `codeload.github.com` 获得的源码工作树，不含 `.git`。为保证特殊路径、长路径与
`autocrlf` 测试仍经过真实 Git checkout，本次又按完整 SHA 下载官方归档，创建一次性本地
Git 种子仓库，再从该种子执行各组 `git clone`。

调试结束前用种子仓库索引比对了全部上游跟踪文件；npm 11 改写的 `package-lock.json` 已恢复
为上游字节，产品源码没有被本次调试修改。

## 第 3 节：基本验证

### `npm install`

- 结果：通过，安装 `360` 个包。
- 警告：npm 11 报告两个 `esbuild@0.25.12` postinstall 尚未进入 `allowScripts` 清单。
- 该警告没有阻止 workspace 上下文中的 esbuild 构建，也没有影响 Vitest 或 Playwright。

### `npm test`

```text
Test Files  86 passed (86)
Tests       2844 passed (2844)
Duration    12.21s
```

退出码为 `0`，数字与测试计划基线完全一致。

运行中还有两类非阻塞输出：

- Node 24 的 `[DEP0190]`：带 `shell: true` 的子进程参数拼接将来存在安全/兼容性风险。
- `GITHUB_TOKEN is required`：测试仍在离线模式下全部通过，提示没有改变结果。

### `npm run typecheck`

结果：**失败，exit code 1**。失败发生在类型检查之前的 `npm run build`：

```text
Error: Cannot find package 'esbuild' imported from
'D:/robot/readit/packages/readit/build.ts'
code: ERR_MODULE_NOT_FOUND
```

定位证据：

- `packages/readit/package.json` 已声明 `esbuild: 0.25.12`。
- `packages/readit/node_modules/esbuild` 实际存在，包内容和 Windows 可执行依赖完整。
- 根脚本通过根级 `vite-node packages/readit/build.ts` 启动；npm 11 将 `esbuild` 放在
  workspace 下而不是根 `node_modules`，ViteNode 根解析上下文找不到它。
- `npm install` 还会重写 lockfile，移除原 lock 中根级可选 peer `esbuild@0.28.2` 条目；
  本次已恢复 lockfile，没有把这种 npm 11 归一化结果留在源码中。
- 改用 `npm exec --workspace=readit -- vite-node build.ts` 后，同一个 `build.ts` exit `0`。
- 构建完成后分别执行根 `tsc --noEmit`、`tsc -p browser --noEmit` 以及所有 workspace
  `typecheck`，全部 exit `0`。

判定：这是可复现的**构建入口/包管理器布局兼容性问题**。最新 CI 在 Node `22.20.0` 上
是绿色，但项目的 `engines.node` 声明为 `>=22`，没有钉 npm 版本；当前脚本对 Node 24/npm 11
不稳健。建议让根 build 显式在 `readit` workspace 上下文运行，或在根声明它直接解析的
构建依赖，并增加 Node 24/npm 11 或明确 package manager 版本的门。

## 第 4 节：浏览器层（本次重点）

| Project | 结果 | 说明 |
|---|---:|---|
| `element-chromium` | **34 通过 / 0 失败** | 最接近未来 WebView2 的 Playwright 代理信号 |
| `element-webkit` | **32 通过 / 2 跳过 / 0 失败** | 仅作参考，不是 Windows 出货引擎 |
| `editor-chromium` | **11 通过 / 0 失败** | 包含 Shadow DOM、真实组合事件和双向滚动 |
| `editor-webkit` | **7 通过 / 4 跳过 / 0 失败** | 4 条 IME 为具名设计内跳过 |
| `element-firefox` | **34 通过 / 0 失败** | advisory，不阻塞交付判断 |
| **合计** | **118 通过 / 6 跳过 / 0 失败** | 与文档参考基线一致 |

覆盖到的高价值行为包括：

- Shadow DOM 隔离、主题变量、双实例互不干扰与销毁后资源释放；
- Chromium 下的中日韩组合事件、CodeMirror 组合期写入推迟；
- 文档查找、视口外源码命中、Custom Highlight 与 `<mark>` 降级；
- Mermaid 懒加载、水合、网络失败可见回落与语法错误态；
- Trusted Types、两级消毒、外部链接桥接、Cmd+F 及滚动同步。

构建 fixture 时 Vite 报告一条 `INEFFECTIVE_DYNAMIC_IMPORT`：测试入口静态导入 editor，
而 element 也动态导入它。CodeMirror 本身仍保持独立动态 chunk，网络中断降级用例实际通过；
该警告不构成本次失败，但值得在后续精简测试构建时消除。

### 边界

这些结果证明 L3b 在 Windows 上的 Playwright Chromium/WebKit/Firefox 中可用，尤其补上了
Windows Chromium 系的高价值信号；它们**不证明真 WebView2**。当前没有 Windows Tauri 壳，
无法运行双击关联、单实例、`readit://`、更新器或真 WebView2 冒烟。

按计划没有运行 `npm run test:visual`，因为 L4 基线只在固定 Linux 容器中有判定意义。

## 第 5 节：四项真机条件

### 5.1 空格与非 ASCII 路径

测试路径：`C:\Users\21943\我的 项目\readit`

- 本地 Git clone：通过。
- `npm install`：通过，360 个包。
- `npm test`：**86 文件 / 2844 通过 / 0 失败**。
- workspace 上下文构建：exit `0`，`packages/readit/dist` 可正常写入。

结论：中文、空格、子进程调用、语料遍历和构建写入均未暴露路径问题。

### 5.2 超长路径

测试根路径长度为 `229`，随后再叠加仓库文件和 `node_modules` 层级。

默认配置：

```text
git clone exit 128
fatal: cannot stat '.../.git/hooks/applypatch-msg.sample': Filename too long
```

仅对重试命令临时加入 `-c core.longpaths=true` 后，clone exit `0`；继续安装时：

```text
npm install exit -4058
npm error syscall spawn C:\WINDOWS\system32\cmd.exe
npm error enoent spawn C:\WINDOWS\system32\cmd.exe ENOENT
npm warn cleanup ... EPERM ... rmdir ...
```

本机 `core.longpaths` 未启用，系统 `LongPathsEnabled=0`。失败发生在 Git/npm/Windows 路径
处理层，尚未执行项目测试，因此分类为**环境/工具链阻断**，不是渲染或业务逻辑缺陷。
应在启用系统长路径并设置 Git `core.longpaths=true` 的机器上重新执行本节，才能评价项目本身。

### 5.3 `core.autocrlf` 三种设置

为避免污染用户全局配置，使用逐次 clone 命令级 `core.autocrlf` 覆盖。

| 设置 | `npm test` | `EOL-CR.md` | `EOL-CR+LF.md` | checkout 状态 |
|---|---:|---|---|---|
| `true` | 2844 通过 | SHA256 `359FAB1D…0651`；CR=6/LF=0 | SHA256 `5F06E1FE…7B35`；CR=6/LF=6 | clean |
| `input` | 2844 通过 | 同上 | 同上 | clean |
| `false` | 2844 通过 | 同上 | 同上 | clean |

结论：三种设置结果一致，`.gitattributes` 的 `* -text` 有效；两个对抗语料的 CR 字节没有
被改写。

### 5.4 大小写不敏感文件系统

在主工作树重新执行测试并扫描 `ENOENT|cannot find`：

```text
TEST_EXIT=0
CASE_PATH_MATCHES=0
```

没有发现 Windows 大小写折叠导致的语料覆盖或路径缺失症状。

## CI 与依赖状态

### GitHub Actions

截至本报告，上游 `57a3100` 的最新 main 运行均为 Success：

- [test #25](https://github.com/wenzhurong/readit/actions/runs/31791080623)：typecheck、perf、三系统 unit matrix；
- [browser #17](https://github.com/wenzhurong/readit/actions/runs/31791080631)：Chromium/WebKit/Firefox；
- [visual #25](https://github.com/wenzhurong/readit/actions/runs/31791080625)：固定环境 L4，14 passed；
- [offline #25](https://github.com/wenzhurong/readit/actions/runs/31791080597)：无外网测试套件。

本机发现的 npm 11 build 失败与 CI 绿色并不矛盾：CI 固定 Node 22.20.0，而本机使用
Node 24.18.0/npm 11.16.0，暴露的是未覆盖的依赖布局组合。

### `npm audit`

实测：**2 high / 0 critical**，exit `1`。

| 包 | 层级 | 状态 |
|---|---|---|
| `js-yaml` | 直接依赖 | high；当前范围 `4.0.0 - 4.3.0`，建议版本 `4.3.1` |
| `nanoid` | 传递依赖 | high；当前范围 `<3.3.18`，存在可用修复 |

这与已有计划三报告记录一致，但仍未处理。发布前应单独升级并跑完整语料、浏览器和视觉回归，
尤其不能把解析器依赖升级混入其他功能修改。

## 项目当前状态评估

| 维度 | 当前状态 | 评价 |
|---|---|---|
| 核心引擎与 8 个包 | 2844 单测全绿；规格/语料棘轮齐全 | **稳定，工程成熟度高** |
| 浏览器 L3b | Windows 五个 project 118/6/0 | **可用；新增 Windows 证据充分** |
| 类型与构建 | 类型本身全绿；根 build 在 npm 11 下失败 | **存在构建可移植性缺陷** |
| macOS Tauri 壳 | Phase C C1–C7 自动化完成 | **实现较完整，但 M6 六项真机清单仍全未勾选** |
| Windows Tauri 壳 | 无 Windows bundle/发布配置 | **尚未构建，无法交付** |
| 真引擎验收 | macOS 有开发期 WKWebView 探针；Windows WebView2 为零 | **尚未形成双平台验收门** |
| 发布 | 8 个包均 `0.0.0` + `private`；shell `0.1.0` + `private`；无 GitHub Release | **预发布/内部工程状态** |
| 安全维护 | npm audit 2 high；Rust advisory 未在本次运行 | **发布前必须处理** |
| 文档与上手 | SPEC/计划/债务文档详尽，但根目录无 README | **内部可追溯性强，外部上手面不足** |

### 已知债务仍需保留边界

- D2-21：真 WebView2 验收门缺失，本次 Playwright 不能替代。
- D2-22：固定 Linux 容器里宿主锚点内联盒有 2px 计算样式差异；像素门仍绿。
- D2-23：公开的 `DEFAULT_MOUNT_OPTIONS` 仍可变。
- D2-24：壳前端仍有 happy-dom 无法覆盖的真引擎盲区。
- D2-25：`mailto:` 被外链安全网关拒绝，属于待复核产品选择。
- M6：macOS 六项真机人工验收未执行；M7 签名、公证、正式发布未完成。

## 问题分级与建议

### P0：Windows 产品交付面不存在

不是“测试没跑”，而是 Windows 壳、bundle target、发布矩阵和真 WebView2 门尚未构建。
若目标包含 Windows 用户，这是当前最大阻塞项。应另开实施计划，不应在本次测试中临时补壳。

### P1：修复 npm 11 下的根构建入口

优先让 `npm run build` 在声明 `esbuild` 的 workspace 上下文运行，并增加相应回归。还应在
`packageManager`/CI matrix 之间作出明确选择：要么钉 npm，要么承诺并验证 npm 10/11 均可用。

### P1：处理两项 high 依赖告警

升级 `js-yaml` 与传递 `nanoid`，然后复跑完整单测、浏览器层、固定容器 L4 与分发门。

### P2：在开启长路径的 Windows 主机复测

本机环境结论已经足够明确，不建议为了压绿而在调试过程中修改注册表。后续应在
`LongPathsEnabled=1` 且 Git `core.longpaths=true` 的测试机上重复 5.2，再判断是否存在项目级问题。

### P2：完成真机验收与发布闭环

完成 macOS M6 六项人工清单；随后再决定 M7 Developer ID、公证、签名和首个 GitHub Release。

### P3：清理非阻塞工程告警

调查 Node `[DEP0190]` 的 `shell: true` 调用，消除 Playwright fixture 的无效动态导入警告，
并补根 README/开发环境版本说明，降低新机器上重复踩 npm 布局问题的概率。

## 最终判断

**Windows 上的核心引擎与 Playwright 浏览器层可以使用，本次没有发现渲染/逻辑缺陷；
失败项分别属于构建基建兼容性（npm 11）和机器长路径配置。项目尚不能宣称 Windows 验收或
Windows 可交付，因为真 WebView2 与 Windows 桌面壳均不存在。**
