import { expect, test, type Page } from '../support/harness.js'
import { forceTier2 } from '../support/tiers.js'

/**
 * D2-17（docs/plans/2026-08-08-plan2-debt.md）：第 2 级（DOMPurify）的允许名单
 * 从未对着 Phase A 的输出审过。第 1 级（`trusted-types.spec.ts`）做过「跑完整语料、
 * `DOMParser` 解析出期望集合、逐元素逐属性 diff 到零差异」的诊断，第 2 级
 * 一个配置都没传——`set-html.ts` 直接 `purify.sanitize(html, {RETURN_TRUSTED_TYPE: true})`。
 *
 * **这次诊断把第 1 级那次诊断在第 2 级重做一遍**，而不是只补批次 5 碰巧撞见的
 * `markdown-accessiblity-table` / `math-renderer` 两个名字——那正是本项目反复栽的坑
 * （「推断的广度由做推断的人选定时，它倾向于错」，见 docs/plans/2026-08-08-plan2-debt.md
 * 的第一节）。语料覆盖 frontmatter 表格、标题锚点 + Octicon、GFM alert + 第二个
 * Octicon、GFM 表格、任务列表、图片、**两种**emoji（自定义 PNG `<img class="emoji">`
 * 与 GitHub 的 `<g-emoji>` 包 unicode）、行内数学降级、围栏代码块的
 * `snippet-clipboard-content` 包装、脚注引用与回链、原始 HTML `<details>`。
 *
 * **必须在真浏览器里做**（`docs/plans/2026-08-08-plan2-debt.md` D2-17 的警告）：
 * happy-dom 20.11.2 下 `DOMPurify.sanitize('<script>b()</script>')` 原样返回
 * `<script>`，`isSupported` 还报 `true`——遍历行为不正常，任何差集都是假的。
 *
 * 两个引擎都跑：Chromium 用 `Reflect.deleteProperty` 逼走第 1 级（否则第 2 级永远
 * 不会在 Chromium 上被执行到），WebKit 天然选中第 2 级（无原生 `setHTML()`，
 * `hasTrustedTypes` 为真，见 `trusted-types.spec.ts` 的既有记录）。两个引擎共用
 * 同一个 DOMPurify 3.4.13，跑两个引擎不是测两套配置，是排除「这只是某个引擎自己
 * 的怪癖」这个混淆——两边结果理应一致。Firefox 走第 3 级（既无原生 setHTML 也无
 * trustedTypes），第 2 级配置对它没有意义，不测。
 */

const DOC = [
  '---',
  'title: demo',
  '---',
  '',
  '# Heading',
  '',
  '> [!NOTE]',
  '> a note',
  '',
  '| A | B |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '- [x] done',
  '- [ ] todo',
  '',
  '![alt](./img.png)',
  '',
  ':shipit: :airplane:',
  '',
  'Inline math $x^2$ here.',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  'Footnote.[^1]',
  '',
  '[^1]: note text',
  '',
  '<details><summary>more</summary>body</details>',
  '',
].join('\n')

interface Snapshot {
  frontmatterTableExists: boolean
  headingAnchorId: string | null
  headingAnchorAriaLabel: string | null
  headingOcticonExists: boolean
  headingOcticonViewBox: string | null
  headingOcticonVersion: string | null
  headingOcticonAriaHidden: string | null
  headingOcticonPathExists: boolean
  alertExists: boolean
  alertClass: string | null
  alertTitleText: string | null
  alertOcticonExists: boolean
  gfmTableWrapped: boolean
  gfmTableDataLine: string | null
  taskListCount: number
  taskListChecked: boolean[]
  taskListDisabled: boolean[]
  imageExists: boolean
  imageLinkTarget: string | null
  imageLinkRel: string | null
  customEmojiExists: boolean
  customEmojiSrc: string | null
  customEmojiAlign: string | null
  gEmojiExists: boolean
  gEmojiAlias: string | null
  gEmojiClass: string | null
  gEmojiText: string | null
  mathRendererExists: boolean
  mathRendererStyle: string | null
  mathRendererText: string | null
  codeBlockWrapperExists: boolean
  codeBlockWrapperClass: string | null
  codeBlockClipboardContent: string | null
  footnoteRefExists: boolean
  footnoteRefAriaDescribedby: string | null
  footnoteBackrefExists: boolean
  detailsExists: boolean
  summaryText: string | null
}

/** 宿主元素的 DOM id（不是 mount() 返回的内部 handle id）——shadow root 挂在它身上。 */
const HOST_ID = 'a'

/**
 * mount() 与读快照必须在**同一次** `page.evaluate()` 里完成，不能拆成
 * 「先 mount 等它落地、再另开一次 evaluate 读」两步。原因是真实的 mount() 语义：
 * `scan()` 判到 `needsMath` 后，`DEFAULT_LOADERS.math` 会立刻发起
 * `import('@readit/math')`（G4/data-readit-pending 那套降级管线，与本诊断无关的
 * 另一层能力），Phase A 的 `<math-renderer>$x^2$</math-renderer>` 只是**第一次
 * 同步 paint** 的产物——它会在数学包异步加载完成后被真实 MathJax SVG 顶替掉。
 * 拆成两步 evaluate 之间隔着一次 CDP 往返，足够让动态 import 落地（实测过：
 * 会看到完整的 MathJax `<svg>` 而不是降级元素），读到的就不是这次诊断要测的
 * 「Phase A 输出经第 2 级消毒后」的那个状态。合成一次 evaluate 后，
 * mount() 与读 DOM 在同一个同步 JS 执行轮次里完成，动态 import 的 promise
 * 回调不可能在期间插入执行——这是 JS 事件循环的保证，不是运气。
 */
async function mountAndSnapshot(page: Page): Promise<Snapshot> {
  await page.goto('/host.html')
  await page.waitForFunction(() => window.readitFixture !== undefined)
  return await page.evaluate(([doc, id]) => {
    window.readitFixture.mount('a', { value: doc, mode: 'read', emojiBase: './emoji/' })

    const root = document.getElementById(id)?.shadowRoot
    if (root === null || root === undefined) throw new Error(`fixture: no shadow root on #${id}`)

    const anchor = root.querySelector('.anchor')
    const octicons = [...root.querySelectorAll('svg.octicon')]
    const headingOcticon = octicons.find((s) => s.classList.contains('octicon-link')) ?? null
    const alert = root.querySelector('.markdown-alert')
    const alertOcticon = octicons.find((s) => s.classList.contains('octicon-info')) ?? null
    const alertTitle = root.querySelector('.markdown-alert-title')
    const customTable = root.querySelectorAll('markdown-accessiblity-table')
    const gfmTable = [...root.querySelectorAll('table')].find((t) => t.querySelector('th')?.textContent === 'A') ?? null
    const checkboxes = [...root.querySelectorAll('input[type=checkbox]')]
    const img = root.querySelector('img:not(.emoji)')
    const imgLink = img?.closest('a') ?? null
    const customEmoji = root.querySelector('img.emoji')
    const gEmoji = root.querySelector('g-emoji')
    const mathRenderer = root.querySelector('math-renderer')
    const codeWrapper = root.querySelector('.highlight-source-js')
    const footnoteRef = root.querySelector('[data-footnote-ref]')
    const footnoteBackref = root.querySelector('[data-footnote-backref]')
    const details = root.querySelector('details')
    const summary = root.querySelector('summary')

    return {
      frontmatterTableExists: customTable.length > 0 && customTable[0]?.querySelector('td')?.textContent === 'demo',
      headingAnchorId: anchor?.id ?? null,
      headingAnchorAriaLabel: anchor?.getAttribute('aria-label') ?? null,
      headingOcticonExists: headingOcticon !== null,
      headingOcticonViewBox: headingOcticon?.getAttribute('viewBox') ?? null,
      headingOcticonVersion: headingOcticon?.getAttribute('version') ?? null,
      headingOcticonAriaHidden: headingOcticon?.getAttribute('aria-hidden') ?? null,
      headingOcticonPathExists: headingOcticon?.querySelector('path') !== null,
      alertExists: alert !== null,
      alertClass: alert?.getAttribute('class') ?? null,
      alertTitleText: alertTitle?.textContent ?? null,
      alertOcticonExists: alertOcticon !== null,
      gfmTableWrapped: gfmTable?.closest('markdown-accessiblity-table') !== null,
      gfmTableDataLine: gfmTable?.getAttribute('data-line') ?? null,
      taskListCount: checkboxes.length,
      taskListChecked: checkboxes.map((c) => c.hasAttribute('checked')),
      taskListDisabled: checkboxes.map((c) => c.hasAttribute('disabled')),
      imageExists: img !== null,
      imageLinkTarget: imgLink?.getAttribute('target') ?? null,
      imageLinkRel: imgLink?.getAttribute('rel') ?? null,
      customEmojiExists: customEmoji !== null,
      customEmojiSrc: customEmoji?.getAttribute('src') ?? null,
      customEmojiAlign: customEmoji?.getAttribute('align') ?? null,
      gEmojiExists: gEmoji !== null,
      gEmojiAlias: gEmoji?.getAttribute('alias') ?? null,
      gEmojiClass: gEmoji?.getAttribute('class') ?? null,
      gEmojiText: gEmoji?.textContent ?? null,
      mathRendererExists: mathRenderer !== null,
      mathRendererStyle: mathRenderer?.getAttribute('style') ?? null,
      mathRendererText: mathRenderer?.textContent ?? null,
      codeBlockWrapperExists: codeWrapper !== null,
      codeBlockWrapperClass: codeWrapper?.getAttribute('class') ?? null,
      codeBlockClipboardContent: codeWrapper?.getAttribute('data-snippet-clipboard-copy-content') ?? null,
      footnoteRefExists: footnoteRef !== null,
      footnoteRefAriaDescribedby: footnoteRef?.getAttribute('aria-describedby') ?? null,
      footnoteBackrefExists: footnoteBackref !== null,
      detailsExists: details !== null,
      summaryText: summary?.textContent ?? null,
    }
  }, [DOC, HOST_ID] as const)
}

test.describe('第 2 级 DOMPurify 的允许名单对齐 Phase A 输出（D2-17）', () => {
  test.beforeEach(async ({ page }) => {
    // 这里原本有一条 `test.skip(browserName === 'firefox', 'Firefox 既无原生 setHTML
    // 也无 window.trustedTypes，走第 3 级…')`——**那两句都不成立**（2026-08-12 实测，
    // 能力矩阵见 browser/support/tiers.ts：Firefox 两样都有）。于是 D2-17 这条第 2 级
    // 诊断以一个站不住的理由静默跳过了一整个引擎。跳过已删除，三个引擎一视同仁地
    // 逼进第 2 级。
    await forceTier2(page)
  })

  test('两个引擎都真的落在第 2 级上（前提校验，不是这条诊断本身）', async ({ page }) => {
    await page.goto('/host.html')
    expect(await page.evaluate(() => 'setHTML' in Element.prototype)).toBe(false)
    expect(await page.evaluate(() => typeof (window as unknown as { trustedTypes?: unknown }).trustedTypes)).toBe('object')
  })

  test('Phase A 输出的每一类元素与属性，第 2 级消毒后仍然在场', async ({ page }) => {
    const seen = await mountAndSnapshot(page)

    // frontmatter：渲染成表格，同样套一层自定义元素
    expect(seen.frontmatterTableExists, 'frontmatter 表格').toBe(true)

    // 标题锚点 + 第一个 Octicon（heading.ts）
    expect(seen.headingAnchorId, '标题锚点 id').toBe('user-content-heading')
    expect(seen.headingAnchorAriaLabel, '标题锚点 aria-label').toBe('Permalink: Heading')
    expect(seen.headingOcticonExists, 'Octicon svg（标题）').toBe(true)
    expect(seen.headingOcticonViewBox, 'svg viewBox').toBe('0 0 16 16')
    expect(seen.headingOcticonVersion, 'svg version').toBe('1.1')
    expect(seen.headingOcticonAriaHidden, 'svg aria-hidden').toBe('true')
    expect(seen.headingOcticonPathExists, 'svg 内的 path').toBe(true)

    // GFM alert（alerts.ts）+ 第二个 Octicon，与标题锚点那个是不同图标名
    expect(seen.alertExists, 'markdown-alert').toBe(true)
    expect(seen.alertClass, 'alert class').toBe('markdown-alert markdown-alert-note')
    expect(seen.alertTitleText?.trim(), 'alert 标题文本').toBe('Note')
    expect(seen.alertOcticonExists, 'Octicon svg（alert）').toBe(true)

    // GFM 表格 + markdown-accessiblity-table 自定义元素（table.ts）
    expect(seen.gfmTableWrapped, 'GFM 表格被 markdown-accessiblity-table 包着').toBe(true)
    expect(seen.gfmTableDataLine, 'GFM 表格 data-line').not.toBeNull()

    // 任务列表（tasklist.ts）
    expect(seen.taskListCount, '任务列表复选框数量').toBe(2)
    expect(seen.taskListChecked, '勾选状态').toEqual([true, false])
    expect(seen.taskListDisabled, 'disabled 状态').toEqual([true, true])

    // 图片 + 外链装饰（rawshape.ts / decorate.ts）
    expect(seen.imageExists, '<img>').toBe(true)
    expect(seen.imageLinkTarget, 'target').toBe('_blank')
    expect(seen.imageLinkRel, 'rel').toBe('noopener noreferrer')

    // 两种 emoji（emoji.ts）——自定义 PNG 与 GitHub 的 <g-emoji> 都是 Phase A
    // 真实会发的形状，批次 5 的诊断只覆盖了前者。
    expect(seen.customEmojiExists, '自定义 PNG emoji <img class="emoji">').toBe(true)
    expect(seen.customEmojiSrc, '自定义 emoji src').toBe('./emoji/shipit.png')
    expect(seen.customEmojiAlign, '自定义 emoji align（legacy 属性）').toBe('absmiddle')
    expect(seen.gEmojiExists, '<g-emoji>（unicode emoji 的包装自定义元素）').toBe(true)
    expect(seen.gEmojiAlias, 'g-emoji alias').toBe('airplane')
    expect(seen.gEmojiClass, 'g-emoji class').toBe('g-emoji')
    expect(seen.gEmojiText?.trim(), 'g-emoji 文本').toBe('✈️')

    // 行内数学降级（math-inline.ts，未接数学渲染器）
    expect(seen.mathRendererExists, '<math-renderer>').toBe(true)
    expect(seen.mathRendererStyle, 'math-renderer style').toBe('display: inline-block')
    expect(seen.mathRendererText).toBe('$x^2$')

    // 围栏代码块的 clipboard 包装（codeblock.ts）
    expect(seen.codeBlockWrapperExists, '.highlight-source-js 包装 div').toBe(true)
    expect(seen.codeBlockWrapperClass).toContain('notranslate')
    expect(seen.codeBlockClipboardContent, 'data-snippet-clipboard-copy-content').toBe('const x = 1;')

    // 脚注引用与回链（footnote.ts）
    expect(seen.footnoteRefExists, '脚注引用').toBe(true)
    expect(seen.footnoteRefAriaDescribedby, 'aria-describedby').toBe('footnote-label')
    expect(seen.footnoteBackrefExists, '脚注回链').toBe(true)

    // 原始 HTML（allowDangerousHtml 之外、hast-util-sanitize 默认 schema 本就放行的
    // 标准标签，见 SPEC §6.1）
    expect(seen.detailsExists, '<details>').toBe(true)
    expect(seen.summaryText, '<summary> 文本').toBe('more')
  })
})
