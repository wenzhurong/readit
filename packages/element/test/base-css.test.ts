import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BASE_CSS } from '../src/styles/base-css.js'

/**
 * D2-20 的守卫：**敌意表设了什么继承属性，`.readit-root` 就必须重置什么。**
 *
 * 这条测试存在的理由，是 D2-20 这个缺陷本身的成因不是「忘了写五行 CSS」，
 * 而是**清单由做声明的人自己选定**——这条分支上同一种失效已经发作过至少七次
 * （见 docs/plans/2026-08-08-plan2-debt.md 末节）。D2-20 自己就是第八次：
 *
 *   - 债务条目记的是「五项继承属性没重置」。那五项抄自
 *     browser/support/visual.ts 的 PROPS 采样表。
 *   - 而 PROPS **漏了 font-variant-numeric**，敌意表却一直设着它。
 *     计算样式探针看不见它，截图看得见（code-and-tables 里那个 42 会变等宽数字）。
 *   - 修的时候又减错一次：以为 line-height / color / font-family 已被
 *     github-markdown-css 挡住，其实 gmc 只管 .markdown-body **内部**，
 *     而 shadow 树里还有错误面板、源码窗格、回落 <pre>。
 *
 * 所以这里不再写死一张清单，而是**从敌意表自己反推**：往
 * browser/fixtures/css/hostile-extra.css 的 `*` 规则里加一条继承属性，
 * 却不在 base-css.ts 的 .readit-root 里重置它，这条测试就红。
 *
 * 它不替代 browser/element/hostile-isolation.spec.ts（那条在真浏览器里比
 * 两个宿主的 computed style，是最终判据）。这条是**更早、更便宜**的一道：
 * 它在 vitest 里就能说出「你少重置了哪一个属性名」，而不必等真机跑完再去读 diff。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const HOSTILE_CSS = join(HERE, '..', '..', '..', 'browser', 'fixtures', 'css', 'hostile-extra.css')

/** 敌意表里那条 `* { … }` 规则体——它打的全部是继承属性，这是那个文件自己的设计声明。 */
function hostileUniversalDeclarations(css: string): string[] {
  const match = /(?:^|\n)\*\s*\{([\s\S]*?)\}/.exec(css)
  if (match === null) throw new Error('hostile-extra.css 里找不到 `*` 规则——它的形状变了，先看那个文件')
  const body = match[1] ?? ''
  return [...body.matchAll(/(?:^|\n)\s*([a-z-]+)\s*:/g)].map((m) => m[1] ?? '').filter((n) => n !== '')
}

/** `.readit-root { … }` 的规则体。取第一条，即那个不带属性选择器的基础规则。 */
function readitRootDeclarations(css: string): string[] {
  const match = /\n\.readit-root\s*\{([\s\S]*?)\}/.exec(css)
  if (match === null) throw new Error('BASE_CSS 里找不到 .readit-root 规则')
  const body = match[1] ?? ''
  return [...body.matchAll(/(?:^|\n|;)\s*([a-z-]+)\s*:/g)].map((m) => m[1] ?? '').filter((n) => n !== '')
}

describe('D2-20：敌意宿主的继承属性在 .readit-root 上逐项被重置', () => {
  const hostile = hostileUniversalDeclarations(readFileSync(HOSTILE_CSS, 'utf8'))
  const reset = new Set(readitRootDeclarations(BASE_CSS))

  it('敌意表确实还在设继承属性——否则下面那条是空断言', () => {
    // 与 hostile-isolation.spec.ts 第一条同一个理由：先证明敌意 fixture 真的敌意。
    expect(hostile.length, 'hostile-extra.css 的 `*` 规则空了').toBeGreaterThanOrEqual(9)
    expect(hostile).toContain('font-variant-numeric')
  })

  it.each(
    // 逐条列出来而不是塞进一个循环断言：红的时候要一眼看出少的是哪个属性名。
    hostileUniversalDeclarations(readFileSync(HOSTILE_CSS, 'utf8')),
  )('.readit-root 重置了 %s', (prop) => {
    expect(
      reset.has(prop),
      `hostile-extra.css 的 \`*\` 规则设了 ${prop}（继承属性，会穿过 shadow 边界），` +
        '而 base-css.ts 的 .readit-root 没有重置它。加一条重置——不要从敌意表里删掉它，' +
        '那等于把验收线改窄来换绿灯。',
    ).toBe(true)
  })

  it('重置挂在 .readit-root 而不是 :host —— 挂 :host 会被宿主的 !important 压过', () => {
    // CSS Scoping 的跨树层叠：普通声明外层树赢、important 声明内层树赢。
    // 挂 :host 就得写 !important 才压得住宿主的 `* { … !important }`，
    // 那是军备竞赛；.readit-root 在 shadow 树内部，宿主的 `*` 够不到它。
    const hostRule = /\n:host\s*\{([\s\S]*?)\}/.exec(BASE_CSS)?.[1] ?? ''
    for (const prop of hostile) {
      expect(hostRule, `:host 不该承担 ${prop} 的重置`).not.toContain(`${prop}:`)
    }
  })
})
