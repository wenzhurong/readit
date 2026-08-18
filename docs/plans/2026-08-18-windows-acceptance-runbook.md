# Windows 真机验收操作手册

**日期**：2026-08-18　**执行环境**：一台普通的、可交互的 Windows 桌面会话

## 这份文件是什么，不是什么

| | |
|---|---|
| **是** | 六项验收在 **Windows 上怎么操作**的分步手册 |
| **不是** | 另一份验收清单。**唯一的清单是 `2026-08-13-m6-manual-acceptance.md`，结果记回那一份**（它已经有 macOS/Windows 两列） |
| **不是** | 环境与工具链的验证方案。那是 `docs/windows-test-plan.md`，§3/§4/§5.1–5.4 先跑完 |

**为什么单独写**：`windows-test-plan.md` §5.5 只有一段「完整执行六项清单」，没有步骤；
而 M6 清单里的操作描述是 macOS 口径（Finder 双击、Cmd+F）。这份文件补的就是中间那层。

## 为什么这一轮特别值得认真做

macOS 那一轮（2026-08-17）**抓出四个真缺陷**：出货应用里语法高亮从未生效、Mermaid 长
标签被节点框裁掉、图层护栏被 `classDef` 绕过、查找命中不滚进视野。

**四个在库层、Rust 层、happy-dom 层乃至 Playwright 层都是绿的。** 上一轮 Windows 交付
（`2026-08-17-windows-shell-report.md`）也已经把自动化面做得很足——**正因为如此，真窗口
里剩下的东西才是自动化结构上够不到的那些。请以同样的怀疑度对待 Windows 侧的绿。**

---

## 1. 准备

### 1.1 生成夹具

两个平台用**同一套**夹具，结果才可比：

```powershell
npm install
npm run acceptance:fixtures
```

默认写到 `%USERPROFILE%\readit-acceptance`（不用桌面：Windows 上它可能被 OneDrive
重定向）。要换目录：`npm run acceptance:fixtures -- D:\some\dir`。

脚本末尾会自检 `find-test.md` 里 `sentinel` 恰好 6 次。**这个自检不是装饰**：macOS
那轮我第一版夹具被说明文字污染成 8 次，差点把正常行为报成计数缺陷。

### 1.2 构建并安装

```powershell
npm run build
npm run tauri --workspace=readit-shell-frontend -- build --bundles nsis `
  --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

产物在 `shell\src-tauri\target\release\bundle\nsis\`。**记录安装包体积**，安装后**记录
安装目录体积**（第 6 项要）。装的是 currentUser 模式，不需要管理员。

同时记录 **WebView2 Runtime 版本**（设置 → 应用 → 已安装的应用，搜 WebView2）。

---

## 2. 六项的 Windows 操作

### 第 1 项 · 双击 Markdown 文件

⚠️ **先做这一步，它本身就是测试内容**：安装器**只把 readit 加入「打开方式」列表，
不会抢默认程序**（这是刻意的产品策略，见台账与 SPEC §15 第 9 点）。所以装完之后直接
双击 `.md`，打开的**很可能不是 readit**——**这不是缺陷，是设计**。

1. 设置 → 应用 → 默认应用 → 搜 `.md` → 选 readit；`.markdown` 单独再来一次
   （**Windows 上两种扩展名不像 macOS 那样共享同一个 UTI，要分别设**）
2. 资源管理器里双击 `doc-a.md`
3. 退出，双击 `doc-b.markdown`

**判据**

- [ ] 两次都由 readit 打开
- [ ] `doc-a.md` 里有**两个彩色方块**（蓝、红），不是破图图标或空白
- [ ] `doc-b.markdown` 里有一个红色方块
- [ ] 窗口标题是**文件名**，不是完整路径、更不能出现 `\\?\` 前缀
      （这一条专门盯 W4 的路径归一化）

**附加观察**（不影响勾选）：`doc-a.md` 底部两张绿色方块，分别用尖括号目标（含空格 +
中文文件名）与百分号转义引用同一个文件。GitHub 上两种都能出图。

### 第 2 项 · 单实例路由与前进后退

⚠️ **必须直接执行安装后的 exe 并带参数**：

```powershell
& "$env:LOCALAPPDATA\readit\readit-shell.exe" "$env:USERPROFILE\readit-acceptance\doc-c.md"
```

（路径按实际安装位置改。）**不要用任何"启动器"或快捷方式代替**——macOS 那轮的教训：
`open -a` 由系统直接激活既有应用、根本不起第二个进程，测不到 single-instance 插件。

1. 保持 readit 开着 `doc-a.md`（A）
2. 资源管理器双击 `doc-b.markdown`（B）
3. 跑上面那条命令（C）
4. 试前进后退：**`Alt+←` / `Alt+→`**

**判据**

- [ ] 任务管理器里始终只有**一个** `readit-shell.exe` 主进程
- [ ] 第 3 步的命令**返回了**（第二个进程转发完 argv 就该自己退出）
- [ ] 既有窗口被显示并聚焦，B、C 依次进入同一窗口
- [ ] 后退依次回到 B、A；前进依次回到 B、C

> macOS 侧记录过一个前提：前进/后退的监听挂在**元素宿主上而不是 window**，而壳从不
> 主动聚焦元素。**如果按键没反应，先在文档区域点一下再按，并把「是否必须先点」记下来**
> ——这本身是一条发现。

### 第 3 项 · Ctrl+F（Windows 上是 Ctrl 不是 Meta）

打开 `find-test.md`。`sentinel` 恰好 **6 处**，③④⑤⑥ 在首屏之外。

1. 按 `Ctrl+F` → 输入 `sentinel`
2. 反复 `Enter` 走完一圈；`Shift+Enter` 反向；界面前后按钮再走一遍
3. `Escape`

**判据**

- [ ] `Ctrl+F` 唤起的是 **readit 自己的查找栏**，不是 WebView2 的内置查找栏
- [ ] 计数显示 **6**，当前序号从 1 开始
- [ ] 当前命中**滚进视野**——③④⑤⑥ 在首屏外，这条是重点
      （macOS 那轮这里抓到过缺陷：滚动容器被钉死成内容面板，而阅读模式下它根本不是
      滚动容器。已修，这是回归检查）
- [ ] 末尾再按 Enter **循环回第 1 处**，反向同理
- [ ] 查找栏开着时再按 `Ctrl+F`：重新聚焦并全选输入框，不是关掉、不是开第二个
- [ ] `Escape` 关闭并清高亮，文档内容与排版没被破坏

**W3 的连带影响也要验**（这是方案 B 的已知代价，写进过 SPEC §11.3）：
`AreBrowserAcceleratorKeysEnabled=false` 关掉的是**整组**浏览器加速键。

- [ ] `Ctrl+P` 不再唤起 WebView2 的打印
- [ ] `Ctrl+R` 不再重载页面（这一条本来就该关掉）
- [ ] `F12` 不再唤起开发者工具

三条都属于**预期行为**，不是缺陷；**但如果其中任何一条仍然生效，说明那次设置没落地**。

### 第 4 项 · 原子保存文件监听

readit 打开 `watch-test.md` 并保持窗口可见，另开一个 PowerShell：

```powershell
$f = "$env:USERPROFILE\readit-acceptance\watch-test.md"

# ① 临时文件 + rename（原子保存，多数编辑器的方式）
$tmp = "$f.tmp"
"# 文件监听测试 — 版本 1`n`n**当前版本：1**`n`n方式：临时文件 + rename" |
  Set-Content -Path $tmp -Encoding utf8
Move-Item -Force $tmp $f

# 看一眼窗口，再执行 ②

# ② 普通原地写入
"# 文件监听测试 — 版本 2`n`n**当前版本：2**`n`n方式：普通原地写入" |
  Set-Content -Path $f -Encoding utf8
```

**判据**

- [ ] 两次改写 readit 都刷新到最新内容（标题变成「版本 1」「版本 2」）
- [ ] 第一次（rename）之后**监听没丢**——这条最容易坏
- [ ] 没有读到半写入的残缺内容
- [ ] 没有反复刷新闪烁（静置后看任务管理器 CPU 应回落到接近 0）

> 已知边界（不影响判定，见台账 **D2-29**）：沉降只有前端 80ms 防抖，Rust 侧是裸
> `notify` 无 debouncer。首末字节跨度超过 80ms 的写入可能被读到中间态，写完会自行纠正。
> 这个竞态一般情况下不可修——原子保存存在的理由正是消除它。

### 第 5 项 · 真 WebView2 里的 Mermaid

打开 `mermaid-test.md`，四张图逐张对照（期望写在每张图下面）。

- [ ] 第 1 张：五节点连通，中文标签完整
- [ ] 第 2 张：长文本被框**包住**，不溢出不裁切
- [ ] 第 3 张：H1 清晰不透明在框内；H2 整体半透明但**标签在自己框里**
- [ ] 第 4 张：错误态 + **保留原始源码**，不是白屏

> 第 2、3 张是 macOS 那轮两个缺陷的回归检查。**WebView2 是 Chromium 系，未必复现
> WebKit bug 23113 的错位症状**——但护栏该生效仍要生效，H1 不该是半透明或模糊的。

**记录 WebView2 Runtime 版本**，并说明它与 Edge 通道的关系（Evergreen 会自动更新，
所以这一项的结论有时效性）。

### 第 6 项 · 体积、冷启动、稳态内存

体积在 §1.2 已记。下面两条的命令**控制端没有在 Windows 上验证过**，写出意图，
跑不通就按意图改，**并在报告里写明你实际用的是什么**。

**冷启动 ×5**（思路：轮询主窗口句柄出现为止，对应 macOS 侧用 `CGWindowList` 的做法）

```powershell
$exe = "$env:LOCALAPPDATA\readit\readit-shell.exe"
$doc = "$env:USERPROFILE\readit-acceptance\plain.md"
1..5 | ForEach-Object {
  Get-Process readit-shell -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 2
  $sw = [Diagnostics.Stopwatch]::StartNew()
  Start-Process $exe -ArgumentList $doc
  while (-not (Get-Process readit-shell -ErrorAction SilentlyContinue |
                Where-Object MainWindowHandle -ne 0)) { Start-Sleep -Milliseconds 5 }
  $sw.Stop()
  "$_`t$($sw.ElapsedMilliseconds) ms"
}
```

**稳态内存**（`plain.md` 静置 60s；WebView2 会另起 `msedgewebview2.exe` 若干，
必须一并计入，做法与 macOS 侧「启动前后进程集合求差」同理）

```powershell
$before = (Get-Process msedgewebview2 -ErrorAction SilentlyContinue).Id
Start-Process $exe -ArgumentList $doc
Start-Sleep -Seconds 60
$new = (Get-Process msedgewebview2 -ErrorAction SilentlyContinue |
         Where-Object { $_.Id -notin $before })
@(Get-Process readit-shell) + $new |
  Select-Object Name, Id, @{n='MB';e={[math]::Round($_.WorkingSet64/1MB,1)}} |
  Format-Table; ($(@(Get-Process readit-shell) + $new) |
  Measure-Object WorkingSet64 -Sum).Sum / 1MB
```

**判据**：分别列出安装包体积、安装后体积、5 次冷启动与中位数、`plain.md` 稳态内存、
`stress.md` 压力内存。**不要自行宣称「性能通过」**——预算尚无裁决，清单明确禁止。

⚠️ **压力场景是三个大件不是四个。** 壳没有模式切换入口，CodeMirror 用户够不着
（台账 **D2-28**）。记录时必须写成三大件。

macOS 侧对照数字：dmg 7.7 MB / `.app` 18 MB；冷启动中位 459 ms（最冷 1093）；
稳态 112.3 MB / 压力 172.4 MB（口径：`footprint` 的 phys_footprint）。
**Windows 的 `WorkingSet64` 与它不是同一口径，不要直接比大小**，各自记各自的。

---

## 3. Windows 独有的三项（六项之外）

### 3.1 文件关联的三种起始状态

上一轮因沙箱拦截 HKCU 写入而未执行。三种各测一次：

| 起始状态 | 期望 |
|---|---|
| `.md` 无默认程序 | 安装后 readit 出现在「打开方式」列表里；**不自动成为默认** |
| `.md` 已归别的程序（如 VS Code） | 既有默认**不被改动**；readit 只是多一个候选 |
| 全新 Windows 用户配置 | 同第一种 |

再加一条：**卸载后**，`.md` 的「打开方式」里 readit 消失，**而别的应用的条目一个都不少**。

安装器只写 `HKCU\Software\Classes\readit.md` 与两个扩展名下的 `OpenWithProgids`，
**不碰 `UserChoice`**（它有哈希保护，强改是在和 OS 的反劫持机制对抗）。可用
`reg query` 核对实际写了什么。

### 3.2 没有 WebView2 Runtime 的干净机器

`webviewInstallMode` 选的是 `downloadBootstrapper`（安装包小，装机时联网下载）。

- [ ] 干净 Win10（无 WebView2 Runtime）上安装：能自动装上运行时并正常启动
- [ ] **断网**情况下安装：失败信息是否可理解？装了一半的状态是什么？

第二条尤其要记——它是 `downloadBootstrapper` 这个取舍的真实代价。

### 3.3 长路径（台账 D2-27）

D2-27 记着 Windows 长路径**仍未测量**（不是通过）。若你的机器
`LongPathsEnabled=1` 且 git `core.longpaths=true`，跑一遍 `windows-test-plan.md` §5.2
就能把它还清。**不要为了压绿去改注册表然后不声明。**

---

## 4. 已知会被误当成缺陷的东西

macOS 那轮踩过的，别再踩一次：

1. **装完不自动成为默认程序** —— 设计如此（反劫持），见第 1 项。
2. **`Ctrl+P` / `Ctrl+R` / `F12` 失效** —— W3 方案 B 的已知代价，写进过 SPEC §11.3。
3. **`stress.md` 里第一个行内数学不渲染** —— 若你把它改成全角标点紧贴 `$`，按
   SPEC §8 规则 R2（开启符左侧只接受 null / 四个 ASCII 空白 / `(`，**所有非 ASCII
   含 CJK 一律拒绝**）它就**不该**渲染。夹具里已经用半角空格避开，但值得知道。
4. **第 3 张 mermaid 的 H2 节点整体半透明** —— 那是作者 `classDef` 的意图，护栏只管
   `foreignObject` 里的 HTML。要看的是标签**在不在自己的框里**。
5. **Playwright 的 Chromium 全绿** —— **不等于 WebView2 通过**。报告里必须分开写。

---

## 5. 结果记到哪

- **六项结果**：写回 `docs/plans/2026-08-13-m6-manual-acceptance.md` 的 Windows 列，
  **逐项写口径不只是打勾**（照 macOS 侧那一份的形状）。**不要新建第二份清单。**
- **§3 的三项与过程细节**：追加到 `docs/plans/2026-08-17-windows-shell-report.md`。
- **台账**：`D2-21`（真引擎验收门）按结果更新；`D2-27` 若跑了长路径就还清。
- **README**：里程碑行与「已知缺口」里的 Windows 口径按结果改。

**报告里必须分开写的两件事**（这是本项目 ≥10 次记录的失效模式）：

1. 哪些结论来自**你实际操作了真 WebView2 窗口**，哪些来自自动化测试或阅读文档
2. 哪些是 Playwright Chromium 的信号，哪些是真 WebView2 的信号

**任何一项因环境受阻，记「未执行」并贴系统错误——不要记成「通过」，也不要记成「失败」。**
上一轮报告在这一点上做得很好，请保持。
