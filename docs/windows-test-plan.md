# Windows 侧测试方案

给在 Windows 机器上工作的 agent。**保持简短——大部分自动化面已由 CI 的 `windows-latest` job 覆盖，
这份方案只做 CI 做不到的事。**

现状（2026-08-08）：仓库只有 `packages/core` 与 `packages/math` 两个纯 Node 包。
**没有桌面壳、没有浏览器 element、没有编辑器**（那些是 M3/M4/M6）。
所以现在能测的就是引擎本身在 Windows 上跑不跑得对。

---

## 一、先决条件

```powershell
node --version    # 需要 v22+
npm --version
git --version
```

Node 低于 22 直接停，报告版本号即可——不要自己升级。

---

## 二、基本验证（三条命令）

```powershell
git clone https://github.com/wenzhurong/readit.git
cd readit
npm install
npm test
npm run typecheck
```

**期望**：`npm test` 全绿，`npm run typecheck` exit 0。

> 若在 2026-08-08 之后仍看到失败，先看第三节——那两类问题在该日期已修，
> 重现说明修复不完整，值得报。

---

## 三、CI 已发现并修复的两类问题（回归检查点）

如果这两类**又出现**，那是回归，请原样报告错误文本。

**① 路径出现重复盘符** `D:\D:\a\...` 或 `C:\C:\Users\...`

症状形如：
```
Error: Cannot find module 'D:\D:\a\readit\readit\packages\math\test\worker\render-hash.ts'
Error: ENOENT: no such file or directory, scandir 'D:\D:\...\test\corpus\'
```
根因是用 `new URL(import.meta.url).pathname` 取路径——在 Windows 上它给出
`/D:/a/...`（带前导斜杠），拼接后就成了 `D:\D:\...`。正确写法是 `fileURLToPath()`。

**② CRLF 导致字节比对失败**

症状是断言里期望值带 `\r\n` 而实际是 `\n`（或反过来）：
```
expected '...</p>\n<p>...' to be '...</p>\r\n<p>...'
```
根因是 Windows 的 git 默认 `core.autocrlf=true`，把夹具文件检出成 CRLF。
仓库根的 `.gitattributes` 应当阻止这件事。检查它存在：

```powershell
Get-Content .gitattributes
git config core.autocrlf          # 你的机器上的设置，记下来一起报
```

---

## 四、CI 覆盖不到、只有真机能测的四件事

CI 跑在 `D:\a\readit\readit` 这种干净短路径上。真实开发机不是。
**这四条是这份方案存在的理由。**

### 4.1 路径里有空格或非 ASCII

```powershell
mkdir "C:\Users\$env:USERNAME\我的 项目"
cd "C:\Users\$env:USERNAME\我的 项目"
git clone https://github.com/wenzhurong/readit.git
cd readit; npm install; npm test
```

**为什么**：`execFileSync` 起子进程、语料目录遍历、fixture 读取都会经过路径拼接。
空格与非 ASCII 是最常见的两种破绽。

### 4.2 超长路径（Windows MAX_PATH = 260）

```powershell
# 造一个深目录再 clone 进去
$deep = "C:\" + ("aaaaaaaaaa\" * 20)
mkdir $deep -Force; cd $deep
git clone https://github.com/wenzhurong/readit.git
cd readit; npm install; npm test
```

**为什么**：`node_modules` 加上语料目录层级很容易撞到 260。
若失败，同时报告 `git config core.longpaths` 与系统是否启用了 LongPathsEnabled。

### 4.3 `core.autocrlf` 的三种设置

```powershell
foreach ($v in @("true","input","false")) {
  git config --global core.autocrlf $v
  # 重新 clone 到不同目录，跑 npm test
}
```

**为什么**：`.gitattributes` 应当让这三种设置**结果一致**。
如果只有某一种能过，`.gitattributes` 写得不够。

### 4.4 大小写不敏感的文件系统

```powershell
npm test 2>&1 | Select-String -Pattern "ENOENT|cannot find"
```

**为什么**：Windows 文件系统大小写不敏感，Linux 敏感。
一处 `require('./Foo.js')` 而文件实为 `foo.js`，在 Windows 与 macOS 上都能过、
在 Linux CI 上会炸——反过来，两个只差大小写的语料文件在 Windows 上会互相覆盖。
CI 的 ubuntu job 覆盖了前者，这里查后者。

---

## 五、报告格式

一份简短的 markdown 就行：

```
## 环境
Node / npm / git 版本；OS build；core.autocrlf 设置；仓库所在完整路径

## 基本验证
npm test        → 通过 / 失败（失败则贴 Test Files 与 Tests 两行汇总）
npm run typecheck → exit code

## 第三节的两类回归
① 重复盘符   → 未出现 / 出现（贴完整错误行）
② CRLF       → 未出现 / 出现（贴 expected/actual 的差异片段）

## 第四节四项
4.1 空格与非 ASCII 路径  → 通过 / 失败 + 错误
4.2 超长路径             → 通过 / 失败 + 错误
4.3 autocrlf 三种设置    → 三种是否一致
4.4 大小写               → 有无 ENOENT

## 判断
引擎在 Windows 上是否可用；若不可用，是引擎问题还是测试基建问题
```

**最后一行是最要紧的。** 计划一在 Windows CI 上失败过 6 个文件，
但那全部是测试基建（路径解析、行尾），**渲染输出本身在 Windows 上是一致的**。
请把这两类分开判断，不要把基建问题报成引擎缺陷。

---

## 六、明确不在本次范围

- 桌面壳、安装包、文件关联、`readit://` 协议 —— M6，尚未开工
- 浏览器 element / Shadow DOM —— M3，尚未开工
- 编辑器与 IME —— M4，尚未开工
- 性能与内存基线 —— M6 再做

看到这些相关的需求，回一句「尚未实现」即可，不要尝试补。
