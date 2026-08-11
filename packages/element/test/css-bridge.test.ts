import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BRIDGED_VARIABLES, CSS_BRIDGE_DARK, CSS_BRIDGE_LIGHT } from '../src/css-bridge.js'
import { ELEMENT_CSS } from '../src/styles.js'

const require_ = createRequire(import.meta.url)
// 不用 `new URL('../scripts/...', import.meta.url)`：happy-dom（§0 A2，本包
// environment）的全局 URL 会把相对路径解析成它自己伪造的 http: location，而不是
// 这个测试文件的 file: 位置（本仓库其余 test/*.ts 已多次记录过这个坑，见
// html-anchors.test.ts / leak.test.ts / styles.test.ts 等文件头的同款注释）。
// 全程走 node:path 才能拿到真实文件系统路径。
const TEST_DIR = dirname(fileURLToPath(import.meta.url))
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

/**
 * 抓的是 base/dark/light 三段里的**每一条声明**，不只是自定义属性。
 *
 * 评审 Important 1：早先这里（与生成脚本一样）只匹配 `--*`，漏了两个媒体块里
 * 各恰好一条的非自定义属性声明——`color-scheme: dark` / `color-scheme: light`。
 * 这条测试与生成脚本共享同一条「只看 `--*`」的假设，是写检查与被检查物同源的
 * 盲区：生成脚本漏抬 color-scheme 时，这里因为用的是同一个过滤条件，一样
 * 看不出来。改成不分是否 `--` 前缀、抓每一条声明，两条断言从「每个变量都有桥」
 * 扩成「源媒体块里的每一条声明都出现在产物里」，才不会再有这个盲区。
 *
 * `[\w-]+` 而非 `[a-zA-Z-]+`：自定义属性名里常见数字（`--base-size-16` 这类），
 * 少了 `\w` 的数字支持会把它们静默漏掉——这是这条正则本身在改写过程中踩过的坑，
 * 就是 Important 1 描述的那类「盲区」的一个具体例子，如实记在这里。
 */
// 提成命名常量只是为了下面 B6 那条「与生成脚本逐字同步」的守卫测试能读到
// `.source`/`.flags`——declarationsOf() 本身的解析逻辑仍然独立于生成脚本，
// 没有把任何函数体搬过来共享。
const DECLARATION_REGEX = /^\s*([\w-]+)\s*:\s*([^;]+);/gm
function declarationsOf(text: string): Decl[] {
  return [...text.matchAll(DECLARATION_REGEX)].map((m) => ({
    name: m[1]!,
    value: m[2]!.trim(),
  }))
}
function isCustomProperty(name: string): boolean {
  return name.startsWith('--')
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

/** 只取自定义属性那部分——`--readit-*` 桥只针对它们，`color-scheme` 这类普通属性不桥。 */
function customPropertiesOf(merged: Map<string, string>): Map<string, string> {
  return new Map([...merged].filter(([name]) => isCustomProperty(name)))
}
const lightCustom = customPropertiesOf(lightExpected)
const darkCustom = customPropertiesOf(darkExpected)

/**
 * SPEC §9.2：「对外只开两个覆写通道——`--readit-*` 自定义属性与 `::part()`。」
 *
 * 这一层守的是第一个通道**真的存在且完整**。完整性是要紧的：漏掉一个变量，
 * 宿主就会遇到「其他颜色都能改，唯独这一个改不动」，而那种半通的 API 比没有更难用。
 * 所以断言是「上游声明的每一个变量都有桥」，不是「有一些桥」。
 */
describe('--readit-* 覆写通道', () => {
  it('上游合并版每一段声明的每一条都出现在产物里——自定义属性走桥，其余原样抄一份', () => {
    // 评审 Important 1 扩的范围：不再只查 --* 有没有桥，连 color-scheme 这类
    // 非自定义属性也要求「原样出现在产物里」——它不需要桥，但必须在场，否则
    // theme: 'dark' 下浏览器原生控件（任务列表复选框、<pre> 滚动条、表单控件）
    // 会按浅色渲染，这正是 Important 1 抓到的那次真实回退。
    expect(lightExpected.size, 'light 侧应合并出大量声明').toBeGreaterThan(20)
    expect(darkExpected.size, 'dark 侧应合并出大量声明').toBeGreaterThan(20)
    // 反空断言：这条测试要真的覆盖到非自定义属性，而不是巧合地全是 --*。
    expect([...lightExpected.keys()].some((n) => !isCustomProperty(n)), '语料失真：上游合并版里应该有非自定义属性声明（color-scheme）').toBe(true)
    expect([...darkExpected.keys()].some((n) => !isCustomProperty(n))).toBe(true)

    const checkPresence = (expected: Map<string, string>, bridge: string, label: string): void => {
      const missing = [...expected.keys()].filter((name) => {
        if (isCustomProperty(name)) return !bridge.includes(`${name}:`)
        // 非自定义属性原样抄一份：`  color-scheme: dark;` 逐字出现，不带 var()。
        return !bridge.includes(`${name}: ${expected.get(name)!};`)
      })
      expect(missing, `${label} 缺了这些声明`).toEqual([])
    }
    checkPresence(lightExpected, CSS_BRIDGE_LIGHT, 'CSS_BRIDGE_LIGHT')
    checkPresence(darkExpected, CSS_BRIDGE_DARK, 'CSS_BRIDGE_DARK')
  })

  it('color-scheme 具体核一遍：不是桥、是原样声明，且明暗各自的值正确', () => {
    // 上一条断言用的是通用逻辑，这条钉死这个具体值，防止「missing 列表恰好是空的
    // 但内容其实错了」这种通用断言测不出的形态（比如 color-scheme 被错误地也套上
    // 了 var(--readit-...) 包装——那样上一条的非自定义属性分支就不会命中它，
    // 但它也不会出现在自定义属性分支要求的 var() 形态里，两头都会漏判）。
    expect(CSS_BRIDGE_LIGHT).toContain('  color-scheme: light;')
    expect(CSS_BRIDGE_DARK).toContain('  color-scheme: dark;')
    expect(CSS_BRIDGE_LIGHT).not.toMatch(/color-scheme:\s*var\(/)
    expect(CSS_BRIDGE_DARK).not.toMatch(/color-scheme:\s*var\(/)
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
    // 只比自定义属性（lightCustom/darkCustom）——color-scheme 不生成桥，
    // 没有 fallback 可比，上一条测试已经单独核过它。
    //
    // fallback 本身可能是另一个 var(...) 调用（比如
    // `--focus-outlineColor: var(--readit-focus-outline-color, var(--borderColor-accent-emphasis));`），
    // 所以不能用 `[^)]+` 这种见第一个右括号就停的写法去抓值——那会把嵌套 var()
    // 自带的右括号当成外层 var() 的收尾，截断成 `var(--borderColor-accent-emphasis`
    // 少一个右括号。改成逐行按「每条声明独占一行、以 `);` 收尾」的已知格式解析，
    // `.*` 贪婪匹配 + `\);$` 锚定行尾，会自然吃掉嵌套 var() 自己的右括号。
    for (const [expected, bridge] of [
      [lightCustom, CSS_BRIDGE_LIGHT],
      [darkCustom, CSS_BRIDGE_DARK],
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
    // 明暗两侧合并后的自定义属性名集合应完全等于 BRIDGED_VARIABLES（互相包含）——
    // 不含 color-scheme，它不是桥。
    const expectedNames = new Set([...lightCustom.keys(), ...darkCustom.keys()].map((n) => readitNameOf(n)))
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

  /**
   * B6（docs/plans/2026-08-08-plan2-debt.md 批次 8 派单）：这份 `declarationsOf()`
   * 与 `scripts/gen-theme-css.ts` 的 `declarations()` 是**故意**手工同步的两份
   * 独立实现（文件头部注释：不 import 生成脚本，否则它自己的 bug 会在这里被同一套
   * 逻辑再犯一遍，测不出来——「检查依赖被检查物」的同源盲区）。但两份独立不等于
   * 没有校验：正则字面量本该逐字相同，若将来只改了其中一处（比如给某类声明加了
   * 排除条件），这条测试要能报警，而不是安静地继续用两套不同的解析规则各测各的。
   *
   * 只读 `gen-theme-css.ts` 的**源码文本**（`readFileSync`），不 `import` 它——
   * 那个脚本在模块顶层有 `writeFileSync` 副作用（生成 `css-bridge.ts` /
   * `theme-css.ts`），import 会把两份产物文件当场重写一遍，这不是这条测试该做的事。
   */
  it('与生成脚本 declarations() 的正则字面量逐字同步（防将来只改一处）', () => {
    const genScriptSource = readFileSync(join(TEST_DIR, '..', 'scripts', 'gen-theme-css.ts'), 'utf8')
    const literal = `/${DECLARATION_REGEX.source}/${DECLARATION_REGEX.flags}`
    expect(
      genScriptSource.includes(literal),
      `gen-theme-css.ts 的 declarations() 里应该逐字出现 ${literal}——` +
        '若这条断言红了，说明两份手工同步的正则已经分岔，先看是哪一边改漏了',
    ).toBe(true)
  })
})
