# Windows 侧验证方案

给在 Windows 机器上工作的 agent。**保持克制——大部分自动化面已由 CI 的 `windows-latest` job
覆盖，这份方案只做 CI 做不到的事。** 重做 CI 已经证明的东西不产生信息，还会制造
「我们验过 Windows 了」的错觉。

**现状（2026-08-14）**：仓库有 8 个包
（`core` / `element` / `editor` / `find` / `highlight` / `math` / `mermaid` / `readit`）
外加一个 Tauri 桌面壳。M0–M5 已交付，M6 的自动化部分已交付。

> ⚠️ **这份文档于 2026-08-14 重写。** 上一版写于 2026-08-08，当时仓库只有两个纯 Node 包，
> 文末写着「浏览器 element —— M3，尚未开工」「编辑器与 IME —— M4，尚未开工」。
> 那三条**已经全部交付**，文档却一直没跟上，比现实落后了三个里程碑，
> 期间任何照它行事的人都会被误导。这次一并订正。

---

## 0. 先读这一段：Windows 上现在能验什么、不能验什么

| | 状态 |
|---|---|
| **引擎与库**（8 个包） | ✅ 可验。跨平台，`npm test` 在 Windows CI 上每次推送都跑。 |
| **浏览器层**（L3b：element / editor / find / mermaid） | 🟡 **可验，但从未在 Windows 上跑过**。CI 只在 Linux 容器里跑它们。这是本次最大的新增面。 |
| **视觉层**（L4） | ❌ 不要在 Windows 上跑。基线只在固定 Linux 容器里生成（SPEC §13.2），Windows 的字体栈不同，比对必然红且没有信息量。 |
| **桌面壳** | ❌ **Windows 上没有壳可测——不是没测，是没建。** `shell/src-tauri/tauri.conf.json` 只有 macOS 段（`minimumSystemVersion: 14.0`），没有 `windows` 配置、没有 `bundle.targets`，发布 workflow 也只跑 macOS。 |

**看到「测一下 Windows 上的双击关联 / `readit://` / 更新器」这类要求，回一句
「Windows 壳尚未构建」即可，不要尝试自己补一个 Tauri Windows 配置去跑。**

---

## 1. 先决条件

```powershell
node --version    # 需要 v22+
npm --version
git --version
```

Node 低于 22 直接停，报告版本号——不要自己升级。

**不需要 Rust / cargo。** 壳的 Rust 侧不参与本次验证；`npm install` 只装
`@tauri-apps/api` 与 `@tauri-apps/cli` 这两个 JS 包。

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

## 4. 浏览器层：从未在 Windows 上跑过（本次重点）

CI 只在 `mcr.microsoft.com/playwright:v1.62.1-noble` 这个 Linux 容器里跑 L3b。
**Windows 上一次都没跑过**，这是本次最有信息量的一块。

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
- **真正的 WebView2 仍然零覆盖**（SPEC §13.2 要求「验收门必须包含真 WebView2 里的一次运行」，
  记为 D2-21）。本次验不了它——没有 Windows 壳。**不要用 Playwright 的 Chromium 冒充它**。

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

## 判断
Windows 上引擎与浏览器层是否可用；失败项是**测试基建**问题还是**渲染/逻辑**缺陷
```

**最后一行是最要紧的。** 计划一在 Windows CI 上失败过 6 个文件，但那**全部是测试基建**
（`new URL().pathname` 在 Windows 上给出 `/D:/...` 导致重复盘符、行尾转换），
**渲染输出本身在 Windows 上是一致的**。请把这两类分开判断，不要把基建问题报成引擎缺陷。

**同样重要的反向纪律**：不要把「跑通了 Playwright 的 Chromium」写成「Windows 验证通过」。
真正的 Windows 引擎是 WebView2，本次覆盖不到它——**这一条要在报告里明说**。

---

## 7. 明确不在本次范围

| 项 | 原因 |
|---|---|
| **桌面壳的一切**（双击关联、单实例、`readit://`、文件监听、更新器、Cmd/Ctrl+F） | **Windows 壳尚未构建**，见 §0。不是「没测」，是「没有」。 |
| **真 WebView2 冒烟** | 需要 Windows 壳。SPEC §13.2 要求它，记为 D2-21，仍开着。 |
| **L4 视觉回归** | 基线只在固定 Linux 容器里生成，Windows 上跑没有信息量。 |
| **性能与内存基线** | 归 M6，且需要壳。 |
| **签名与分发** | 归 M7。Windows 侧 Azure Trusted Signing 对个人不开放，是预算与辖区问题，不是工程问题。 |

看到这些相关要求，回一句「尚未实现 / 不在本次范围」即可，**不要尝试自己补**。

---

## 8. 做完之后

把报告交回。若 §4 的浏览器层在 Windows 上全绿，那是一条**新信息**——
它此前从未被验证过；若有失败，请按 §6 最后一段把基建与缺陷分开判断。

**下一步的 Windows 工作不是继续测，是构建 Windows 壳**（`tauri.conf.json` 的
`bundle.targets` 与 `windows` 段、argv 处理、Ctrl+F 与 WebView2 内置查找栏的取舍）。
那三件 SPEC §10.1 与 §11.3 都已写明做法，届时另开一份计划。
