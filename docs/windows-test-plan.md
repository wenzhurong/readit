# Windows 侧验证方案

给在 Windows 机器上工作的 agent。**保持克制——大部分自动化面已由 CI 的 `windows-latest` job
覆盖，这份方案只做 CI 做不到的事。** 重做 CI 已经证明的东西不产生信息，还会制造
「我们验过 Windows 了」的错觉。

**现状（2026-08-18）**：仓库有 8 个包
（`core` / `element` / `editor` / `find` / `highlight` / `math` / `mermaid` / `readit`）
外加一个可产出 NSIS 的 Tauri 桌面壳。M0–M5 已交付；M6 的 macOS 真机验收已执行，
Windows 壳实现和自动化已落地，但真 WebView2 六项验收仍未执行。

> ⚠️ **这份文档于 2026-08-14 重写。** 上一版写于 2026-08-08，当时仓库只有两个纯 Node 包，
> 文末写着「浏览器 element —— M3，尚未开工」「编辑器与 IME —— M4，尚未开工」。
> 那三条**已经全部交付**，文档却一直没跟上，比现实落后了三个里程碑，
> 期间任何照它行事的人都会被误导。这次一并订正。

---

## 0. 先读这一段：Windows 上现在能验什么、不能验什么

| | 状态 |
|---|---|
| **引擎与库**（8 个包） | ✅ 可验。跨平台，`npm test` 在 Windows CI 上每次推送都跑。 |
| **浏览器层**（L3b：element / editor / find / mermaid） | ✅ Windows 侧已跑过 Chromium/WebKit；Chromium 仍只是 WebView2 的代理信号。 |
| **视觉层**（L4） | ❌ 不要在 Windows 上跑。基线只在固定 Linux 容器里生成（SPEC §13.2），Windows 的字体栈不同，比对必然红且没有信息量。 |
| **桌面壳** | 🟡 **已构建、尚未完成真窗口验收。** 可生成当前用户 NSIS，具备非劫持文件关联、单实例 argv、`readit://`、文件监听、Ctrl+F 和桌面发布矩阵；当前受控会话在创建 WebView2 窗口时被系统错误 5 拒绝。 |

**不要再回复「Windows 壳尚未构建」。** 壳已经存在；相关任务应运行本文件 §5.5 与
`docs/plans/2026-08-13-m6-manual-acceptance.md`，并把无法取得真 WebView2 窗口的情况记为
环境阻塞或未执行，不能退回“没有实现”的旧口径。

---

## 1. 先决条件

```powershell
node --version    # 需要 v22+
npm --version
git --version
```

Node 低于 22 直接停，报告版本号——不要自己升级。

只跑 §3–§5.4 的库/浏览器验证不需要 Rust。要构建或验收桌面壳，还需要 Rust stable、
Visual Studio Build Tools（Desktop development with C++）和系统 WebView2 Runtime；
正式发布矩阵使用 `x86_64-pc-windows-msvc`，不要把本地 GNU 便携构建冒充发布工具链。

---

## 2. CI 已经证明了什么——不要重做

`.github/workflows/test.yml` 的 `unit` job **每次推送都在 `windows-latest` 上跑 `npm test`**，
且当前是绿的。所以下面这些**已经被证明**，不需要你再验一遍：

- 全部 vitest 套件（含 8 个包与壳前端的单测）在 Windows 上通过
- 路径解析、行尾、大小写这三类**在 CI 那条干净短路径上**没有问题

**你的价值不在重跑，在于 CI 跑不到的条件**：真实开发机的长路径、带空格与非 ASCII
的目录、不同的 `core.autocrlf`、以及**真浏览器引擎**。

---

## 3. 基本验证

```powershell
git clone https://github.com/wenzhurong/readit.git
cd readit
npm install
npm test
npm run typecheck
```

**期望**：`npm test` 全绿（当前基线 **2844 通过 / 86 文件 / 0 失败**，以你 clone 到的
提交为准，数字可能已增长）；`npm run typecheck` exit 0。

> ⚠️ `npm run typecheck` **会先跑一次构建**（`npm run build`，约 5 秒）。这是有意的：
> 壳的前端 import 的是发布外观包 `readit/element`，它解析到 `packages/readit/dist` 的
> `.d.ts`，而 dist 是 gitignored 的。少了构建，干净 clone 上必报
> `TS2307 Cannot find module 'readit/element'`。**看到这条错说明构建没跑成，不是类型缺陷。**

---

## 4. 浏览器层：已跑过，必要时复核

CI 仍只在 `mcr.microsoft.com/playwright:v1.62.1-noble` Linux 容器里跑 L3b；但
2026-08-14 已在 Windows 真机跑过同一浏览器层。重新运行有回归价值，不再是首次覆盖。

```powershell
npx playwright install chromium webkit
npm run test:browser                                    # element-chromium + element-webkit
npx playwright test --project=editor-chromium --project=editor-webkit

# 可选、advisory：Firefox 不是任何出货壳的引擎（设计 §7.2），红了记录即可、不阻塞
npx playwright install firefox
npx playwright test --project=element-firefox
```

**期望**：与 Linux 上一致。参考基线：macOS 本机跑上面全部五个 project 是
**118 通过 / 6 具名跳过 / 0 失败**；只跑前两条命令数字会小一些。
那 6 条具名跳过是设计内的（IME 在 WebKit 上的 `GAP-IME-WEBKIT` 等），**不是失败**。

### ⚠️ 关于引擎选择，有一件事要想清楚

**Windows 上真正要紧的引擎是 WebView2（Chromium 系），不是 WebKit。**
Playwright 在 Windows 上确实能跑 WebKit，但那是一个**没有任何真实 Windows 用户会用的构建**
——Safari 不在 Windows 上发行。所以：

- **`element-chromium` / `editor-chromium` 的结果最有价值**：同属 Chromium 系，
  能抓到 Windows 特有的路径、字体、渲染差异，而未来的 Windows 壳正是跑在 WebView2 上。
- `element-webkit` 的结果**只作参考**：红了值得报，但它不代表任何 Windows 用户的体验。
- **真正的 WebView2 验收仍为零**（SPEC §13.2 要求「验收门必须包含真 WebView2 里的一次运行」，
  记为 D2-21）。现在缺的不是壳，而是一次不受桌面沙箱阻塞的真实窗口执行。
  **不要用 Playwright 的 Chromium 或单元测试冒充它**。

**不要跑 `npm run test:visual`**（L4）。基线是 Linux 容器里生成的，Windows 字体栈不同，
必然全红且无信息量。同理 `npm run visual:baseline` 需要 bash + docker，不适用。

---

## 5. 只有真机能测的四件事

CI 跑在 `D:\a\readit\readit` 这种干净短路径上。真实开发机不是。
**这四条是这份方案存在的理由。**

### 5.1 路径里有空格或非 ASCII

```powershell
mkdir "C:\Users\$env:USERNAME\我的 项目"
cd "C:\Users\$env:USERNAME\我的 项目"
git clone https://github.com/wenzhurong/readit.git
cd readit; npm install; npm test
```

**为什么**：`execFileSync` 起子进程、语料目录遍历、fixture 读取都会经过路径拼接。
空格与非 ASCII 是最常见的两种破绽。**这次还多了一层**：`npm run typecheck` 会跑构建，
而构建要写 `packages/readit/dist`——路径异常在写入侧同样会暴露。

### 5.2 超长路径（Windows MAX_PATH = 260）

```powershell
$deep = "C:\" + ("aaaaaaaaaa\" * 20)
mkdir $deep -Force; cd $deep
git clone https://github.com/wenzhurong/readit.git
cd readit; npm install; npm test
```

**为什么**：`node_modules` 加上语料目录层级很容易撞到 260。
**现在比上一版更容易撞**：包从 2 个涨到 8 个，还多了 `packages/readit/dist` 里
**425 个** shiki 语言 chunk（2026-08-14 实测）。若失败，同时报告 `git config core.longpaths`
与系统是否启用了 LongPathsEnabled。

### 5.3 `core.autocrlf` 的三种设置

```powershell
foreach ($v in @("true","input","false")) {
  git config --global core.autocrlf $v
  # 重新 clone 到不同目录，跑 npm test
}
```

**为什么**：仓库根的 `.gitattributes` 是 `* -text`（全仓禁用行尾转换），
应当让这三种设置**结果一致**。如果只有某一种能过，那条 `.gitattributes` 写得不够。

⚠️ **语料里有两个故意包含 CR 的对抗性文件**（karlcow 语料的 `EOL-CR.md`、`EOL-CR+LF.md`）。
它们**必须**保持原样的 CR——如果某种 autocrlf 设置把它们改写了，那正是这条要抓的东西。

### 5.4 大小写不敏感的文件系统

```powershell
npm test 2>&1 | Select-String -Pattern "ENOENT|cannot find"
```

**为什么**：Windows 文件系统大小写不敏感，Linux 敏感。一处 `require('./Foo.js')` 而文件
实为 `foo.js`，在 Windows 与 macOS 上都能过、在 Linux CI 上会炸；反过来，两个只差
大小写的语料文件在 Windows 上会互相覆盖。CI 的 ubuntu job 覆盖前者，这里查后者。

### 5.5 真 WebView2 桌面壳

```powershell
npm run build
npm run tauri --workspace=readit-shell-frontend -- build --bundles nsis `
  --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

**分步操作手册见 `docs/plans/2026-08-18-windows-acceptance-runbook.md`。**
那份文件给出六项在 Windows 上的逐条操作、判据、以及五条「已知会被误当成缺陷的东西」；
夹具用 `npm run acceptance:fixtures` 生成（与 macOS 侧同一套，结果才可比）。

这里只留三条硬约束：

1. **直接执行安装目录里的 `readit-shell.exe <绝对路径>`**，不要用会绕过第二进程的
   启动器替代——否则测不到 single-instance。
2. **结果写回 `docs/plans/2026-08-13-m6-manual-acceptance.md` 的 Windows 列**，
   不要新建第二份清单。
3. 若程序在前端加载前被企业策略或测试沙箱拒绝，贴出系统错误并记「未执行」；
   **只有看到真实 readit WebView2 窗口并完成操作，才能写「通过」**。

---

## 6. 报告格式

```
## 环境
Node / npm / git 版本；OS build；core.autocrlf 设置；仓库完整路径；clone 到的提交 SHA

## 第 3 节 基本验证
npm test          → 通过 / 失败（贴 Test Files 与 Tests 两行汇总）
npm run typecheck → exit code

## 第 4 节 浏览器层（本次重点）
element-chromium  → 通过 / 失败（失败贴用例名与断言）
element-webkit    → 通过 / 失败（标注：仅作参考，非 Windows 出货引擎）
editor-chromium / editor-webkit → 同上

## 第 5 节 四项
5.1 空格与非 ASCII 路径 → 通过 / 失败 + 错误
5.2 超长路径            → 通过 / 失败 + 错误（附 longpaths 设置）
5.3 autocrlf 三种设置   → 三种是否一致；两个 CR 语料文件是否被改写
5.4 大小写              → 有无 ENOENT

## 第 5.5 节 真 WebView2 壳
六项清单逐项结果；三种文件关联起始状态；WebView2 Runtime 版本；NSIS/安装体积；
哪些是窗口证据、哪些只是自动化证据

## 判断
Windows 上引擎与浏览器层是否可用；失败项是**测试基建**问题还是**渲染/逻辑**缺陷
```

**最后一行是最要紧的。** 计划一在 Windows CI 上失败过 6 个文件，但那**全部是测试基建**
（`new URL().pathname` 在 Windows 上给出 `/D:/...` 导致重复盘符、行尾转换），
**渲染输出本身在 Windows 上是一致的**。请把这两类分开判断，不要把基建问题报成引擎缺陷。

**同样重要的反向纪律**：不要把「跑通了 Playwright 的 Chromium」写成「Windows 验证通过」。
真正的 Windows 引擎是 WebView2；若 §5.5 没完成，**这一条要在报告里明说**。

---

## 7. 明确不在本次范围

| 项 | 原因 |
|---|---|
| **L4 视觉回归** | 基线只在固定 Linux 容器里生成，Windows 上跑没有信息量。 |
| **OS 代码签名与 SmartScreen 信任** | 归 M7。Windows 侧 Azure Trusted Signing 对个人的辖区限制是预算/资格问题，不是本轮工程项。 |
| **干净 Win10 且无 WebView2 的安装行为** | 只有具备该环境时才测；当前 `downloadBootstrapper` 设计需要联网，不能用已有 Runtime 的主机代替。 |

桌面壳、真 WebView2、性能和 updater 已经属于本计划范围，不得再列进这张排除表。

---

## 8. 做完之后

把报告交回。若 §4 的浏览器层在 Windows 上全绿，那是一条**新信息**——
它此前从未被验证过；若有失败，请按 §6 最后一段把基建与缺陷分开判断。

**下一步的 Windows 工作是补齐普通交互式会话里的真 WebView2 六项验收**，再实跑一次
`release desktop` 草稿发布，核对 `latest.json` 同时包含 macOS 与 Windows 的签名条目。
实现过程与受阻证据见 `docs/plans/2026-08-17-windows-shell-report.md`。
