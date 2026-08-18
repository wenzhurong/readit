/**
 * 生成 M6 真机手工验收用的夹具（跨平台）。
 *
 *   npm run acceptance:fixtures            # 写到 <home>/readit-acceptance
 *   npm run acceptance:fixtures -- <目录>  # 写到指定目录
 *
 * 为什么入库而不是临时手造：macOS 那一轮（2026-08-17）的夹具是临时生成的，结果是
 * 两个平台没法逐项对照，而且我自己在夹具里造过两个缺陷（`sentinel` 计数被说明文字
 * 污染、mermaid 标签的引号多转义一层），两次都先被误当成产品缺陷。**夹具是被测
 * 对象的一部分，它得和被测对象一样可复现。**
 *
 * 结果记到 `docs/plans/2026-08-13-m6-manual-acceptance.md`（唯一一份清单），
 * Windows 的操作步骤见 `docs/plans/2026-08-18-windows-acceptance-runbook.md`。
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ---------- 最小 PNG 编码器：纯色 + 深色边框，肉眼一眼能判断有没有真的出图 ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, crc])
}

function png(width: number, height: number, rgb: readonly [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolor
  const raw = Buffer.alloc(height * (1 + width * 3))
  let cursor = 0
  for (let y = 0; y < height; y++) {
    raw[cursor++] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const edge = x < 5 || y < 5 || x >= width - 5 || y >= height - 5
      const [r, g, b] = edge ? ([32, 32, 40] as const) : rgb
      raw[cursor++] = r
      raw[cursor++] = g
      raw[cursor++] = b
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- 目标目录 ----------
// 不用 Desktop：Windows 上它可能被 OneDrive 重定向，路径不可预测。
const target = process.argv[2] ?? join(homedir(), 'readit-acceptance')
rmSync(target, { recursive: true, force: true })
mkdirSync(join(target, 'img'), { recursive: true })

// 显式 LF：夹具在两个平台上必须逐字节一致，否则跨平台结果不可比。
const write = (name: string, body: string): void =>
  writeFileSync(join(target, name), body.replaceAll('\r\n', '\n'), 'utf8')

writeFileSync(join(target, 'blue.png'), png(220, 130, [40, 110, 235]))
writeFileSync(join(target, 'img', 'red.png'), png(220, 130, [220, 55, 55]))
// 空格 + 非 ASCII 文件名：两个平台都合法，两个平台都值得测
writeFileSync(join(target, 'img', '绿 色.png'), png(220, 130, [40, 175, 95]))

const F = '```'

// ===== 第 1 / 2 项：双击关联 + 单实例路由 =====
write(
  'doc-a.md',
  `# 文档 A

这是 **A**（扩展名 \`.md\`）。第 1 项与第 2 项都用它。

## 相对图片

同目录：

![蓝色方块](blue.png)

子目录：

![红色方块](img/red.png)

**期望**：两个彩色方块（蓝、红），各带深色边框。破图图标或空白即为失败。

### 附加观察（不影响勾选，但请记结果）

尖括号目标、含空格与非 ASCII 文件名：

![绿色方块](<img/绿 色.png>)

百分号转义、指向同一个文件：

![绿色方块（转义）](img/%E7%BB%BF%20%E8%89%B2.png)

两条 GitHub 上都能出图。主图正常而这两条不出，单独记录，不据此判第 1 项失败。

## 同目录 Markdown 链接

- [→ 文档 B（\`.markdown\` 扩展名）](doc-b.markdown)
- [→ 文档 C](doc-c.md)
`,
)

write(
  'doc-b.markdown',
  `# 文档 B

这是 **B**，扩展名 \`.markdown\`。第 1 项要求两种扩展名由**同一个应用**关联。

![红色方块](img/red.png)

**期望**：一个红色方块；内容对得上「文档 B」，不是空白文档。

- [→ 文档 A](doc-a.md)
- [→ 文档 C](doc-c.md)
`,
)

write(
  'doc-c.md',
  `# 文档 C

这是 **C**。第 2 项的第三跳。

![蓝色方块](blue.png)

- [→ 文档 A](doc-a.md)
- [→ 文档 B](doc-b.markdown)

第 2 项期望：A → B → C 之后，后退依次回到 B、A；前进依次回到 B、C；全程只有一个实例。
`,
)

// ===== 第 3 项：查找 =====
// 说明文字一律不放进这个文件——macOS 那轮就是被说明里的词污染了计数。
const filler = (n: number): string =>
  Array.from(
    { length: n },
    (_, i) =>
      `${i + 1}. 填充行，用来把后面的命中推到首屏之外。窗口默认 960×720，` +
      '这些行必须足够多，否则「命中位于首屏之外」这个条件不成立。',
  ).join('\n')

write(
  'find-test.md',
  `# 查找测试文档

本文件**只**包含被标记的命中，没有任何说明文字——说明在 runbook 里。
这样查找栏显示的计数就等于标记数。

命中 ①：sentinel

命中 ②：sentinel

${filler(45)}

命中 ③：sentinel　（这一处应当在首屏之外）

${filler(45)}

命中 ④：sentinel

命中 ⑤⑥：同一行两个 —— sentinel 与 sentinel
`,
)

// ===== 第 4 项：文件监听 =====
write(
  'watch-test.md',
  `# 文件监听测试 — 版本 0

**当前版本：0（初始）**

这份文件会被改写两次：先「临时文件 + rename」（原子保存），再「普通原地写入」。
两次都应刷新到最新内容。改写命令见 runbook。
`,
)

// ===== 第 5 项：Mermaid =====
write(
  'mermaid-test.md',
  `# Mermaid 真机测试

四张图，每张下面写了期望，逐张对照。

## 1. 基本 flowchart

${F}mermaid
flowchart TD
    A[开始] --> B{判断}
    B -->|是| C[处理]
    B -->|否| D[跳过]
    C --> E[结束]
    D --> E
${F}

**期望**：五个节点、箭头连通，中文标签完整可读，无明显错位。

## 2. 长标签

${F}mermaid
flowchart LR
    L1["这是一个刻意写得很长的节点标签，用来观察真引擎里的文本测量与换行是否正确，如果测量走的是错误的字体或错误的行高，框会包不住字"]
    L2["短"]
    L1 --> L2
${F}

**期望**：长文本被框**包住**，不溢出、不被裁掉。
（macOS 侧 2026-08-17 在这里抓到过缺陷：测量钉死 line-height:normal 而渲染继承 1.5，
低估约 30%，多行标签在节点边框处被切。已修，这一张是它的回归检查。）

## 3. HTML label + classDef（护栏的靶子）

${F}mermaid
flowchart TD
    H1["<span style="opacity:0.25;filter:blur(3px)">行内样式：半透明 + 模糊</span>"]
    H2["<b>加粗</b> 与 <i>斜体</i>"]
    H1 --> H2
    classDef risky opacity:0.3
    class H2 risky
${F}

**期望**：

- **H1**（行内 opacity + blur）：文字**清晰、不透明、在框内**——护栏剥掉了这两个属性。
- **H2**（classDef opacity）：**整个节点半透明是对的**（作者的样式意图，classDef 也命中
  foreignObject 这个 SVG 元素，不在护栏范围内）。要看的是**标签在自己的框里**。

macOS 侧 2026-08-17 在这里抓到过缺陷：classDef 编译成注入 SVG 的 \`<style>\` 规则，
而护栏只摘行内声明，于是标签被画到未变换的原点上（WebKit bug 23113 的症状）。已修。
**WebView2 是 Chromium 系，未必复现同一症状，但护栏该生效仍要生效。**

## 4. 语法错误

${F}mermaid
flowchart TD
    A[未闭合的括号 --> B
    这一行根本不是合法语法 @#$%
${F}

**期望**：显示错误态，**并保留 Phase A 源码**（能看到上面那段原始文本），不是白屏。
`,
)

// ===== 第 6 项：体积 / 启动 / 内存 =====
write(
  'plain.md',
  `# 普通文档（稳态内存基准）

**刻意不含数学、不含语法高亮、不含 Mermaid**，用来测稳态常驻内存。
清单明确禁止拿压力读数冒充稳态。

- 列表项一
- 列表项二

> 引用块。

| 列 A | 列 B |
|---|---|
| 1 | 2 |

${Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 段填充正文，让文档有真实体量而不引入任何大件。`).join('\n\n')}
`,
)

const bigCode = Array.from(
  { length: 120 },
  (_, i) => `  const value${i} = compute(${i}, { retries: ${i % 5}, label: 'row-${i}' })`,
).join('\n')

write(
  'stress.md',
  `# 压力场景

数学 + 语法高亮 + Mermaid 三个大件在本文件里。

⚠️ **第四个大件（CodeMirror 编辑器）在桌面壳里够不着**——壳没有模式切换入口，见台账
D2-28。所以这里的读数是**三大件**，记录时不能写成四大件。

## 1. 数学（MathJax）

行内： $e^{i\\pi} + 1 = 0$，以及 $\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$。

> 注意第一个 \`$\` 前面是**半角空格**。若写成全角冒号紧贴 \`$\`，按 SPEC §8 规则 R2
> （开启符左侧只接受 null / 四个 ASCII 空白 / \`(\`，所有非 ASCII 含 CJK 一律拒绝）
> 它**不该**渲染成数学——那是正确行为，不是缺陷。

块级：

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
\\qquad
\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}^{-1}
= \\frac{1}{ad-bc}\\begin{bmatrix} d & -b \\\\ -c & a \\end{bmatrix}
$$

## 2. 语法高亮

${F}typescript
${bigCode}
${F}

**期望**：\`const\` 深红、变量名蓝、字符串深蓝——完整的 github-light 配色。
全是同一个深灰即为失败（macOS 侧 2026-08-17 抓到过：壳调
\`createShikiHighlighter()\` 不传 langs，空语言集，所有围栏静默不高亮。已修）。

## 3. Mermaid

${F}mermaid
flowchart LR
    A[输入] --> B[解析]
    B --> C[渲染]
    C --> D[输出]
    B --> E[缓存]
    E --> C
${F}
`,
)

// ---------- 汇总 ----------
const listing: string[] = []
for (const name of readdirSync(target).sort()) {
  const full = join(target, name)
  if (statSync(full).isDirectory()) {
    for (const inner of readdirSync(full).sort()) {
      listing.push(`  ${name}/${inner}  (${statSync(join(full, inner)).size} B)`)
    }
  } else {
    listing.push(`  ${name}  (${statSync(full).size} B)`)
  }
}
console.log(`夹具已生成：${target}\n${listing.join('\n')}`)

// 自检：第 3 项的计数必须等于标记数，否则验收会误报
const findText = readdirSync(target).includes('find-test.md')
  ? (await import('node:fs')).readFileSync(join(target, 'find-test.md'), 'utf8')
  : ''
const hits = (findText.match(/sentinel/g) ?? []).length
console.log(`\nfind-test.md 的 sentinel 命中数：${hits}${hits === 6 ? ' ✓' : ' ✗ 应为 6'}`)
if (hits !== 6) process.exitCode = 1
