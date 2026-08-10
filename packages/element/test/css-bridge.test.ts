import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { BRIDGED_VARIABLES, CSS_BRIDGE_DARK, CSS_BRIDGE_LIGHT } from '../src/css-bridge.js'
import { ELEMENT_CSS } from '../src/styles.js'

const require_ = createRequire(import.meta.url)
const upstream = readFileSync(require_.resolve('github-markdown-css/github-markdown.css'), 'utf8')

/**
 * 这个文件独立于生成脚本（scripts/gen-theme-css.ts）重新从上游合并版文件解析一遍
 * 期望值，不导入生成脚本的内部函数——否则生成脚本自己的 bug 会在这里被同一套
 * 逻辑再犯一遍，测不出来。
 *
 * 切分方式：不分主题的基础块（文件开头到第一个 @media）+ dark 媒体块 + light
 * 媒体块，与 scripts/gen-theme-css.ts 的注释描述一致，实测核对过（batch-5-report.md）。
 */
const darkAt = upstream.indexOf('@media (prefers-color-scheme: dark)')
const lightAt = upstream.indexOf('@media (prefers-color-scheme: light)', darkAt)
const rulesAt = upstream.indexOf('\n\n.markdown-body {', lightAt)
if (darkAt < 0 || lightAt < 0 || rulesAt < 0) {
  throw new Error('css-bridge.test.ts 的上游切分假设跟磁盘上的 github-markdown.css 对不上')
}
const baseText = upstream.slice(0, darkAt)
const darkText = upstream.slice(darkAt, lightAt)
const lightText = upstream.slice(lightAt, rulesAt)

interface Decl {
  name: string
  value: string
}
function declarationsOf(text: string): Decl[] {
  return [...text.matchAll(/^\s*(--[a-zA-Z][\w-]*)\s*:\s*([^;]+);/gm)].map((m) => ({
    name: m[1]!,
    value: m[2]!.trim(),
  }))
}
function readitNameOf(cssVar: string): string {
  const bare = cssVar.slice(2)
  const kebab = bare.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  return `--readit-${kebab}`
}
/** base ++ 主题专属，同名后者覆盖前者——与 CSS 层叠、生成脚本的 mergeTheme 同构。 */
function mergedTheme(themeText: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const d of declarationsOf(baseText)) map.set(d.name, d.value)
  for (const d of declarationsOf(themeText)) map.set(d.name, d.value)
  return map
}

const lightExpected = mergedTheme(lightText)
const darkExpected = mergedTheme(darkText)

/**
 * SPEC §9.2：「对外只开两个覆写通道——`--readit-*` 自定义属性与 `::part()`。」
 *
 * 这一层守的是第一个通道**真的存在且完整**。完整性是要紧的：漏掉一个变量，
 * 宿主就会遇到「其他颜色都能改，唯独这一个改不动」，而那种半通的 API 比没有更难用。
 * 所以断言是「上游声明的每一个变量都有桥」，不是「有一些桥」。
 */
describe('--readit-* 覆写通道', () => {
  it('上游合并版声明的每个自定义属性都有桥，明暗两份各一条，一个不漏', () => {
    expect(lightExpected.size, 'light 侧应合并出大量变量').toBeGreaterThan(20)
    expect(darkExpected.size, 'dark 侧应合并出大量变量').toBeGreaterThan(20)

    const missingLight = [...lightExpected.keys()].filter((name) => !CSS_BRIDGE_LIGHT.includes(`${name}:`))
    const missingDark = [...darkExpected.keys()].filter((name) => !CSS_BRIDGE_DARK.includes(`${name}:`))
    expect(missingLight, 'CSS_BRIDGE_LIGHT 有变量没有桥').toEqual([])
    expect(missingDark, 'CSS_BRIDGE_DARK 有变量没有桥').toEqual([])
  })

  it('每个桥都是 var(--readit-X, 原值) 的形式，不改默认行为', () => {
    // 抽查三个有代表性的：明暗共享的基础变量、明暗各异的前景色、语法高亮色。
    expect(CSS_BRIDGE_LIGHT).toMatch(/--base-size-16:\s*var\(--readit-base-size-16,\s*1rem\)/)
    expect(CSS_BRIDGE_LIGHT).toMatch(/--fgColor-default:\s*var\(--readit-fg-color-default,\s*#[0-9a-f]{3,8}\)/i)
    expect(CSS_BRIDGE_DARK).toMatch(
      /--color-prettylights-syntax-comment:\s*var\(--readit-color-prettylights-syntax-comment,/,
    )
  })

  it('不设 --readit-* 时，解析出的值与上游合并后的原值逐字相同（light 与 dark 分别核）', () => {
    // 桥接不得改变默认外观。对每个变量比对 fallback 与「base ++ 主题专属，
    // 后者覆盖前者」合并出来的值——不是跟单条 dark/light 块本身比，因为
    // 10 个明暗共享的基础变量（--base-size-* 等）只在基础块里声明一次。
    //
    // fallback 本身可能是另一个 var(...) 调用（比如
    // `--focus-outlineColor: var(--readit-focus-outline-color, var(--borderColor-accent-emphasis));`），
    // 所以不能用 `[^)]+` 这种见第一个右括号就停的写法去抓值——那会把嵌套 var()
    // 自带的右括号当成外层 var() 的收尾，截断成 `var(--borderColor-accent-emphasis`
    // 少一个右括号。改成逐行按「每条声明独占一行、以 `);` 收尾」的已知格式解析，
    // `.*` 贪婪匹配 + `\);$` 锚定行尾，会自然吃掉嵌套 var() 自己的右括号。
    for (const [expected, bridge] of [
      [lightExpected, CSS_BRIDGE_LIGHT],
      [darkExpected, CSS_BRIDGE_DARK],
    ] as const) {
      const bridged = [...bridge.matchAll(/^\s*(--[\w-]+):\s*var\(--readit-[\w-]+,\s*(.*)\);$/gm)]
      expect(bridged.length).toBe(expected.size)
      for (const [, name, fallback] of bridged) {
        expect(fallback, `${name} 的 fallback 与上游合并值不一致`).toBe(expected.get(name!))
      }
    }
  })

  it('BRIDGED_VARIABLES 与桥接表一致，可用于文档与宿主自查', () => {
    expect(BRIDGED_VARIABLES.length).toBeGreaterThan(20)
    for (const v of BRIDGED_VARIABLES) {
      expect(v.startsWith('--readit-'), `${v} 应以 --readit- 开头`).toBe(true)
    }
    expect(new Set(BRIDGED_VARIABLES).size, '不得有重复').toBe(BRIDGED_VARIABLES.length)
    // 明暗两侧合并后的变量名集合应完全等于 BRIDGED_VARIABLES（互相包含）。
    const expectedNames = new Set(
      [...lightExpected.keys(), ...darkExpected.keys()].map((n) => readitNameOf(n)),
    )
    expect(new Set(BRIDGED_VARIABLES)).toEqual(expectedNames)
  })

  it('桥接层已拼进 ELEMENT_CSS，且在上游规则体之后', () => {
    expect(ELEMENT_CSS).toContain('var(--readit-fg-color-default,')
    const upstreamMark = ELEMENT_CSS.indexOf('.markdown-body')
    const bridgeMark = ELEMENT_CSS.indexOf('var(--readit-fg-color-default,')
    expect(upstreamMark, 'ELEMENT_CSS 应含上游样式').toBeGreaterThanOrEqual(0)
    expect(bridgeMark, '桥接必须在上游规则体之后，否则读者会以为规则体也依赖桥接生效').toBeGreaterThan(upstreamMark)
  })

  it('LIGHT_DOM_CSS 里浅色变量块用的是 .markdown-body（也命中 :host），不是只在 shadow 场景生效的选择器', () => {
    // light DOM 逃生舱没有 shadow root，:host(...) 在那里什么都匹配不到。
    // 浅色变量块必须能在两种场景下都生效，深色则明确只服务 shadow 场景
    // （LIGHT_DOM_CSS 是纯浅色默认值，这一点批次 5 没有改）。
    expect(CSS_BRIDGE_LIGHT).toContain(':host([data-theme="light"]), .markdown-body {')
    expect(CSS_BRIDGE_DARK).not.toContain('.markdown-body {')
  })
})
