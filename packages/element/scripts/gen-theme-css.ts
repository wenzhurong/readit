/**
 * 从 github-markdown-css 生成两样东西：
 *
 *   1. `../src/css-bridge.ts`——`--readit-*` 覆写通道（SPEC §9.2 两个对外通道之一）。
 *   2. `../src/styles/theme-css.ts`——冻结成 JS 字符串的运行时主题样式表。
 *
 * 一个脚本、一次解析，两份产物：两者都来自同一棵解析出的声明表，不会各自
 * 独立解析同一份上游文件后悄悄分岔。
 *
 * ## 源文件从「两个单主题文件」换成「合并版」——为什么，以及这不是走回 SPEC 否掉的老路
 *
 * 批次 2 起草时用的是 `github-markdown-light.css` / `github-markdown-dark.css`
 * （单主题文件）：SPEC §9.2 要求用它们，因为合并版 `github-markdown.css` 的 dark
 * 规则包在 `@media (prefers-color-scheme: dark)` 里，在浅色系统上无论放哪都不
 * 生效——那条判断到现在依然对，`LIGHT_CSS`/`DARK_CSS` 最终产物仍然不含任何
 * `@media (prefers-color-scheme` 文本，见下方与 `theme-css.test.ts` 的断言。
 *
 * 但批次 5 做 `--readit-*` 覆写通道时发现：单主题文件里颜色是**内联死的**
 * （`color: #1f2328`），一个自定义属性都不声明——没有变量可桥。变量只存在于
 * 合并版里：一个不分主题的基础块（11 个，如 `--base-size-16`）+ 一个 dark 媒体块
 * （50 个）+ 一个 light 媒体块（50 个），后面跟着不再声明任何自定义属性、纯
 * `var()` 引用的规则体（127 行往后，`.markdown-body { ... }` 到文件结尾）。
 *
 * 这次的做法不是「把两个媒体块的选择器名字改一改、规则还留在 `@media` 里」——
 * 那样在浅色系统上确实还是不生效，SPEC 否掉的正是这个。这次是**把两个媒体块
 * 整个搬出 `@media`**，重新发成 `:host([data-theme="light"])` /
 * `:host([data-theme="dark"])`（数据属性选择器，不依赖 `prefers-color-scheme`，
 * 由 kernel.ts 的 `createThemeController` 写在宿主元素上），规则体原样保留、
 * 全程 `var()` 引用不变——运行时到底哪张表生效，仍然只由 kernel.ts 的
 * `setTheme()`/`applyStyles()` 二选一决定（`LIGHT_CSS`/`DARK_CSS` 各自完整
 * 自洽，`:host([data-theme=...])` 选择器只是保证「即使两张都在场」也不会互相
 * 干扰——这是 ELEMENT_CSS 那份「构建产物里到底打包了什么」的场景，见 styles.ts）。
 *
 * ## 顺序：上游规则 → 变量块（含桥）→ readit 自有规则
 *
 * `LIGHT_CSS`/`DARK_CSS` 各自内部都是「规则体在前，变量块在后」。`ELEMENT_CSS`
 * （styles.ts）= `[LIGHT_CSS, DARK_CSS, BASE_CSS].join('\n')`，代码不用改——
 * 拍平之后读到的顺序是「规则体、浅色变量块、规则体（第二份，DARK_CSS 自己的）、
 * 深色变量块、BASE_CSS」。规则体出现两次不是笔误：`LIGHT_CSS`/`DARK_CSS` 各自
 * 必须是自洽、可独立 adopt 的完整样式表（kernel.ts 的 `applyStyles()` 一次只
 * `setStyles()` 其中一张 + `BASE_CSS`，见 kernel.ts 顶部注释「只 adopt 当前
 * 主题这一张」），这条约束批次 5 没有改，两张表就不可能共用同一份规则体文本而
 * 不重复。
 *
 * ## 桥接的形状
 *
 * 上游 `--fgColor-default: #1f2328;` 重写成
 * `--fgColor-default: var(--readit-fg-color-default, #1f2328);`——不设
 * `--readit-*` 时行为逐字不变，设了就覆盖。命名映射：去掉 `--`、驼峰转连字符
 * 小写、加 `--readit-` 前缀。
 *
 * ## light DOM 逃生舱：浅色块的选择器是两个，不是一个
 *
 * `:host()` 只在 shadow 树内部有意义，light DOM 逃生舱（`shadow:false`）压根
 * 没有 shadow root，`:host(...)` 在那里什么都不匹配。`LIGHT_DOM_CSS`
 * （styles.ts）继续是 `[LIGHT_CSS, BASE_CSS].join('\n')`——之所以代码也不用
 * 改，是因为浅色变量块的选择器从生成的第一天就是
 * `:host([data-theme="light"]), .markdown-body`（两个选择器一个规则），后者在
 * light DOM 与 shadow DOM 里都能命中（shadow 树内部 `.markdown-body` 是
 * kernel.ts 给 content 节点直接打的类，见 A8）。深色块只需要
 * `:host([data-theme="dark"])`——LIGHT_DOM_CSS 明确是浅色逃生舱默认值，
 * 深色切换本来就要宿主自己接线（这条既有行为本批不变）。两个选择器共用同一份
 * 声明表生成，不会出现「shadow 那份改了、light DOM 那份忘了改」的分叉。
 *
 * 跑法：npm run gen:theme-css -w @readit/element
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require_ = createRequire(import.meta.url)
const pkgJsonPath = require_.resolve('github-markdown-css/package.json')
const pkgDir = dirname(pkgJsonPath)
const version = (JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { version: string }).version

const merged = readFileSync(join(pkgDir, 'github-markdown.css'), 'utf8')

const DARK_MARK = '@media (prefers-color-scheme: dark) {'
const LIGHT_MARK = '@media (prefers-color-scheme: light) {'

function fail(reason: string): never {
  throw new Error(
    `readit: github-markdown.css@${version} 的结构跟生成脚本假设的不一样——${reason}。` +
      '这个脚本按字符串边界切出 base/dark/light/规则体四段，上游一改格式就会切错，' +
      '所以在这里显式报错而不是生成一份悄悄错误的产物。',
  )
}

const darkAt = merged.indexOf(DARK_MARK)
const lightAt = darkAt < 0 ? -1 : merged.indexOf(LIGHT_MARK, darkAt)
if (darkAt < 0) fail('找不到 dark 媒体块')
if (lightAt < 0) fail('找不到 dark 块之后的 light 媒体块')

const rulesAt = merged.indexOf('\n\n.markdown-body {', lightAt)
if (rulesAt < 0) fail('找不到 light 块之后、规则体开头的 .markdown-body {')

const base = merged.slice(0, darkAt)
const darkBlock = merged.slice(darkAt, lightAt)
const lightBlock = merged.slice(lightAt, rulesAt)
const rules = merged.slice(rulesAt).trim()

if (rules.includes('@media (prefers-color-scheme')) {
  fail('切出来的"规则体"里还有 @media (prefers-color-scheme —— 提取边界算错了')
}
if (/^\s*(--[a-zA-Z][\w-]*)\s*:/m.test(rules)) {
  fail('切出来的"规则体"里还声明着自定义属性——本该已经全部落在 base/dark/light 三段里')
}

interface Decl {
  readonly name: string
  readonly value: string
}

/**
 * 抓的是「base/dark/light 三段里出现的每一条声明」，不是「每一条自定义属性」——
 * 这两个媒体块里各恰好还有一条**非**自定义属性声明：`color-scheme: dark` /
 * `color-scheme: light`（`github-markdown.css:14-125`，逐行核过，有且仅有这两条）。
 *
 * 评审 Important 1 抓到的回退：早先这里只匹配 `--*`，`color-scheme` 被漏抬，
 * `theme: 'dark'` 下浏览器原生控件（任务列表复选框、`<pre>` 滚动条、表单控件）
 * 仍按浅色渲染——相对换源文件之前（单主题文件原文自带 color-scheme）是一次
 * 行为回退，而且两条桥接断言测不出来，因为它们与这里共享同一条「只看 `--*`」
 * 的假设，是写检查与被检查物同源的盲区。改成不分是否 `--` 前缀、抓这三段里的
 * 每一条声明，才不会在上游未来又加别的非自定义属性声明时重蹈覆辙。
 */
function declarations(text: string): Decl[] {
  // `[\w-]+`，不是 `[a-zA-Z-]+`：自定义属性名里常见数字（--base-size-16 这类），
  // 少了 `\w` 会把它们静默漏掉——这一版写正确之前，规则体自己在生成时就先炸出过
  // base 块从 11 条掉到 6 条的差异，靠下面几行 fail() 与实测比对抓出来的。
  return [...text.matchAll(/^\s*([\w-]+)\s*:\s*([^;]+);/gm)].map((m) => ({
    name: m[1]!,
    value: m[2]!.trim(),
  }))
}

/** 只有自定义属性（`--` 开头）才需要 `--readit-*` 桥；`color-scheme` 这类普通
 * CSS 属性原样抄一份，不生成覆写点——SPEC §9.2 的桥接通道本来就是给自定义
 * 属性开的，`color-scheme` 不是宿主要覆写的东西。 */
function isCustomProperty(name: string): boolean {
  return name.startsWith('--')
}

/** `--fgColor-default` → `--readit-fg-color-default`；`--color-prettylights-syntax-comment`
 * 本来就是连字符小写，只加前缀。 */
function readitName(cssVar: string): string {
  const bare = cssVar.slice(2)
  const kebab = bare.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  return `--readit-${kebab}`
}

/** base ++ 主题专属，同名后者覆盖前者——跟 CSS「同一条规则里后面的声明赢」同构。 */
function mergeTheme(baseDecls: readonly Decl[], themeDecls: readonly Decl[]): Decl[] {
  const byName = new Map<string, Decl>()
  for (const d of [...baseDecls, ...themeDecls]) byName.set(d.name, d)
  return [...byName.values()]
}

/** 自定义属性走桥（`var(--readit-X, 原值)`），普通属性原样抄一份（如 `color-scheme`）。 */
function bridgeBody(decls: readonly Decl[]): string {
  return decls
    .map((d) => (isCustomProperty(d.name) ? `  ${d.name}: var(${readitName(d.name)}, ${d.value});` : `  ${d.name}: ${d.value};`))
    .join('\n')
}

const baseDecls = declarations(base)
const darkDecls = declarations(darkBlock)
const lightDecls = declarations(lightBlock)

if (baseDecls.length === 0) fail('基础块（不分主题的那个 .markdown-body { ... }）一条声明都没解析到')
if (darkDecls.length === 0) fail('dark 媒体块一条声明都没解析到')
if (lightDecls.length === 0) fail('light 媒体块一条声明都没解析到')
// color-scheme 是目前唯一已知的非自定义属性声明；若上游哪天连它也去掉了，
// 这里显式报错而不是悄悄生成一份缺失 color-scheme 的产物。
if (!darkDecls.some((d) => d.name === 'color-scheme')) fail('dark 媒体块里没有 color-scheme 声明——生成脚本假设的上游结构变了')
if (!lightDecls.some((d) => d.name === 'color-scheme')) fail('light 媒体块里没有 color-scheme 声明——生成脚本假设的上游结构变了')

const darkMerged = mergeTheme(baseDecls, darkDecls)
const lightMerged = mergeTheme(baseDecls, lightDecls)

const CSS_BRIDGE_LIGHT = `:host([data-theme="light"]), .markdown-body {\n${bridgeBody(lightMerged)}\n}`
const CSS_BRIDGE_DARK = `:host([data-theme="dark"]) {\n${bridgeBody(darkMerged)}\n}`

// 只数自定义属性——color-scheme 原样抄了一份，但它不是桥（没有 --readit-color-scheme
// 这种东西，宿主也不该有覆写它的诉求，SPEC §9.2 的桥接通道是给自定义属性开的）。
const BRIDGED_VARIABLES = [...new Set([...lightMerged, ...darkMerged].filter((d) => isCustomProperty(d.name)).map((d) => readitName(d.name)))].sort()

const cssBridgeSource = `// @generated by scripts/gen-theme-css.ts —— 不要手改。
// 源：github-markdown-css@${version} 的合并版 github-markdown.css（media 块抬出来之后）
// 重新生成：npm run gen:theme-css -w @readit/element
//
// SPEC §9.2 的两个对外覆写通道之一。上游把自定义属性声明在 .markdown-body 自己身上，
// 宿主在 :host 上设同名变量会被这条更具体的声明盖掉——所以把每条自定义属性声明
// 重写成 var(--readit-X, 原值)：宿主有了覆写点，不设时行为逐字不变。
//
// 这两个块里还各带一条非自定义属性声明（color-scheme: dark / light）——它原样
// 抄了一份，不生成桥（SPEC §9.2 的桥接通道是给自定义属性开的，color-scheme
// 不是宿主要覆写的东西），但**必须**跟着变量块一起搬出 @media，否则 shadow
// 内容里浏览器原生控件（任务列表复选框、<pre> 滚动条、表单控件）在 dark 主题下
// 仍会按浅色渲染——这是评审 Important 1 抓到的一次真实回退，见
// batch-5-report.md「Important 1」一节。

export const CSS_BRIDGE_LIGHT = ${JSON.stringify(CSS_BRIDGE_LIGHT)}

export const CSS_BRIDGE_DARK = ${JSON.stringify(CSS_BRIDGE_DARK)}

/** 宿主可覆写的全部变量名（60 个：50 个明暗各异 + 10 个明暗共享的基础变量），供文档与自查使用。 */
export const BRIDGED_VARIABLES: readonly string[] = Object.freeze(${JSON.stringify(BRIDGED_VARIABLES, null, 2)})
`
writeFileSync(new URL('../src/css-bridge.ts', import.meta.url), cssBridgeSource)

const LIGHT_CSS = `${rules}\n\n${CSS_BRIDGE_LIGHT}\n`
const DARK_CSS = `${rules}\n\n${CSS_BRIDGE_DARK}\n`

const themeCssSource = `// @generated by scripts/gen-theme-css.ts —— 不要手改。
// 源：github-markdown-css@${version}（合并版 github-markdown.css，media 块抬出来之后）
// 重新生成：npm run gen:theme-css -w @readit/element

import { CSS_BRIDGE_DARK, CSS_BRIDGE_LIGHT } from '../css-bridge.js'

export const THEME_CSS_VERSION = ${JSON.stringify(version)}

// 上游规则体：主题无关，全程用 var(--x) 引用自定义属性，明暗两份共用同一份文本。
const RULES = ${JSON.stringify(rules)}

// 顺序：上游规则 → 变量块（含 --readit-* 桥）。LIGHT_CSS/DARK_CSS 各自必须是
// 自洽的完整样式表——kernel.ts 的 applyStyles() 一次只 setStyles() 其中一张 +
// BASE_CSS，见该文件顶部注释；这条约束决定了规则体不能只在其中一张里出现一次。
export const LIGHT_CSS = \`\${RULES}\\n\\n\${CSS_BRIDGE_LIGHT}\\n\`
export const DARK_CSS = \`\${RULES}\\n\\n\${CSS_BRIDGE_DARK}\\n\`

export const LIGHT_CSS_BYTES = ${Buffer.byteLength(LIGHT_CSS, 'utf8')}
export const DARK_CSS_BYTES = ${Buffer.byteLength(DARK_CSS, 'utf8')}
`
writeFileSync(new URL('../src/styles/theme-css.ts', import.meta.url), themeCssSource)

process.stdout.write(
  `css-bridge.ts: ${BRIDGED_VARIABLES.length} bridged variables\n` +
    `theme-css.ts: light ${Buffer.byteLength(LIGHT_CSS, 'utf8')} B, dark ${Buffer.byteLength(DARK_CSS, 'utf8')} B\n`,
)
