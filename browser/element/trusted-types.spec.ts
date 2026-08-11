import { expect, mountDoc, test } from '../support/harness.js'

const DOC = '# Enterprise\n\nA <em>raw</em> HTML fragment and a paragraph.\n'

/**
 * /trusted-types.html 由 fixture server（browser/fixtures/headers.json）带上
 * `require-trusted-types-for 'script'` 响应头——真 CSP，不是单元层的桩测。
 * §0.1 G3：这两个场景此前两组互相指望，谁都没做；归 Task 11。
 */
test('企业 CSP 下渲染成功（Element.setHTML 在场，走第 1 级）', async ({ page }) => {
  await page.goto('/trusted-types.html')
  await mountDoc(page, 'a', { value: DOC, mode: 'read' })

  expect(await page.evaluate(() => document.getElementById('a')?.shadowRoot?.querySelector('h1')?.textContent)).toBe('Enterprise')
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([])
})

test('企业 CSP 下渲染成功（Element.setHTML 缺席，逼出第 2 级 Trusted Types 策略）', async ({ page, browserName }) => {
  // 删掉第 1 级，否则在带 setHTML 的 Chromium 上第 2 级永远不会被执行到——那等于这一级没写。
  await page.addInitScript(() => {
    Reflect.deleteProperty(Element.prototype, 'setHTML')
  })
  await page.goto('/trusted-types.html')
  expect(await page.evaluate(() => 'setHTML' in Element.prototype)).toBe(false)

  await mountDoc(page, 'a', { value: DOC, mode: 'read' })

  expect(await page.evaluate(() => document.getElementById('a')?.shadowRoot?.querySelector('h1')?.textContent)).toBe('Enterprise')
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([])

  if (browserName === 'chromium') {
    // 只有 Chromium 真的实现了 Trusted Types。它在场时，走 innerHTML 会硬抛，
    // 上面两条断言就会以「内容缺失 + 有 violation」的形式一起红。
    // TS 5.9 的 lib.dom.d.ts 还没有 Trusted Types 类型（同 set-html.ts 的 readEnv()
    // 用 `'trustedTypes' in window` 而非属性访问的理由），这里用同样的窄化取值方式。
    expect(
      await page.evaluate(() => typeof (window as unknown as { trustedTypes?: unknown }).trustedTypes),
    ).toBe('object')
  }
})

/**
 * 评审 Important 3（定向复审后二次修复——第一版声称「一个不少」但结构上测不出
 * `markdown-accessiblity-table`/`math-renderer` 这两个自定义元素：语料没有数学语法，
 * `math-renderer` 从未出现在输出里；`seen` 只 `querySelector('table')`，从不查
 * 自定义元素标签本身——浏览器对未知元素是 unwrap（保留子节点、只丢外层标签，见
 * set-html.ts 里 `replaceWithChildrenElements`/`removeElements` 两个独立字段的
 * 注释），所以即便这两个自定义元素被从 `EXTRA_ELEMENTS` 删掉，内层 `<table>`
 * 照样存在，断言照绿——「标题声称的比测试验证的多」，计划一里为这类问题栽过
 * 五次，这是计划二的第二次）：
 *
 * `set-html.ts` 的 `EXTRA_ELEMENTS`/`EXTRA_ATTRIBUTES` 此前只在 `set-html.test.ts`
 * 里对着**桩** `Sanitizer` 验证「配置里写了这些名字」——桩证明不了真实浏览器的
 * Sanitizer 会照单接受配置里写的东西，而这整批加法存在的理由，正是「配置以为
 * 放行、浏览器实际还是剥掉」这种沉默失败（`title` 与全局属性重复、
 * `data-component`/`data-snippet-clipboard-copy-content` 与 `dataAttributes: true`
 * 重复，两次都是构造期直接抛 `Invalid Sanitizer configuration`，而不是「配置写了
 * 但没生效」这种更隐蔽的失败——但两者都只有跑真浏览器才现形）。
 *
 * 语料现在覆盖 `EXTRA_ELEMENTS` 全部 6 个（img、input、details、summary、
 * markdown-accessiblity-table、math-renderer）与 `EXTRA_ATTRIBUTES` 全部 9 个
 * （id、class、style、target、rel、aria-hidden、aria-label、aria-describedby、
 * version）——`seen` 里每一项都直接查对应的标签/属性本身，不查它们包着的内容。
 * `data-line` 走 `dataAttributes: true` 那个整体开关，M4 滚动同步承重。
 *
 * 只在走第 1 级（原生 `Element.setHTML()`）的引擎上跑：`EXTRA_ELEMENTS`/
 * `EXTRA_ATTRIBUTES` 是 `buildTier1Sanitizer()` 专属的配置，只对第 1 级有意义。
 * WebKit 没有原生 `setHTML()`，在 `/host.html`（无 CSP）上也会选中第 2 级
 * （`hasTrustedTypes` 为真，`selectTier()` 落到 `trusted-types`），这条测试在
 * WebKit 上测的会是 DOMPurify 的默认配置，不是这份 Sanitizer 配置——写这条测试
 * 时才发现：DOMPurify 的默认配置**同样**不认识 `<markdown-accessiblity-table>`
 * 这类自定义元素（`DOMPurify.sanitize('<markdown-accessiblity-table>…')` 会把
 * 外层标签整个 unwrap 掉），这是与本次修复无关的另一个潜在缺口，不在这次改动
 * 范围内（本次改动范围明确限定在这一个文件），如实记在这里、记进
 * batch-5-report.md，留给以后专门处理，不在这条测试里顺手"修"掉去让它变绿。
 */
test('第 1 级注入后，EXTRA_ELEMENTS 与 EXTRA_ATTRIBUTES 逐项都在场（不查内容，查标签/属性本身）', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'EXTRA_ELEMENTS/EXTRA_ATTRIBUTES 只对第 1 级（原生 setHTML）有意义；WebKit 没有它，走的是第 2 级 DOMPurify，测的是另一套配置')

  const doc = [
    '# Heading',
    '',
    'A paragraph.',
    '',
    'Some inline math $x^2$ here.',
    '',
    // 相对路径：egressGuard 的离线守卫只放行 127.0.0.1/localhost，一张指向
    // 外部主机的绝对 URL 会被当成真实的图片请求拦下、判成「破坏离线约束」而
    // 让这条测试因为无关的理由变红。相对路径解析到 fixture server 自己
    // （同源，404 也没关系）——这里要测的是 <img>/src 有没有活下来，不是图片
    // 真的能不能显示。渲染出的图片是段落里唯一内容，会被 core 自动包一层
    // <a target="_blank" rel="noopener noreferrer">，这正好覆盖 target/rel/style
    // 三个原本没有真浏览器证据的属性。
    '![alt text](./no-such-image.png)',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '- [x] done',
    '- [ ] todo',
    '',
    '<details><summary>more</summary>body</details>',
    '',
    // 脚注是 aria-describedby 唯一的出处（footnote.ts）——EXTRA_ATTRIBUTES 里
    // 除了它，其余 8 个都能被上面的语料覆盖到。
    'Footnote reference.[^1]',
    '',
    '[^1]: footnote text',
    '',
  ].join('\n')

  await page.goto('/host.html')
  await mountDoc(page, 'a', { value: doc, mode: 'read' })

  const seen = await page.evaluate(() => {
    const root = document.getElementById('a')?.shadowRoot
    if (root === null || root === undefined) throw new Error('no shadow root')
    // 标题旁 GitHub 形状的锚点是紧跟 <h1> 的兄弟 <a id="user-content-…">，
    // id 不在 <h1> 自己身上——见 packages/core/src/rules/*（clobber.ts）的输出形状。
    const anchor = root.querySelector('.anchor')
    const octicon = root.querySelector('svg.octicon')
    const para = root.querySelector('p[data-line]')
    const img = root.querySelector('img')
    const imgLink = img?.closest('a') ?? null
    const table = root.querySelector('table')
    const customTable = root.querySelector('markdown-accessiblity-table')
    const mathRenderer = root.querySelector('math-renderer')
    const checkboxes = [...root.querySelectorAll('input[type=checkbox]')]
    const details = root.querySelector('details')
    const summary = root.querySelector('summary')
    const footnoteRef = root.querySelector('[data-footnote-ref]')
    return {
      // EXTRA_ELEMENTS：六个都直接查标签本身存不存在。
      imgExists: img !== null,
      inputExists: checkboxes.length > 0,
      detailsExists: details !== null,
      summaryExists: summary !== null,
      customTableExists: customTable !== null,
      customTableWrapsTable: customTable?.querySelector('table') === table && table !== null,
      mathRendererExists: mathRenderer !== null,
      mathRendererText: mathRenderer?.textContent ?? null,
      // EXTRA_ATTRIBUTES：九个逐一查。
      anchorId: anchor?.id ?? null, // id
      anchorClass: anchor?.getAttribute('class') ?? null, // class
      mathRendererStyle: mathRenderer?.getAttribute('style') ?? null, // style
      imgLinkTarget: imgLink?.getAttribute('target') ?? null, // target
      imgLinkRel: imgLink?.getAttribute('rel') ?? null, // rel
      octiconAriaHidden: octicon?.getAttribute('aria-hidden') ?? null, // aria-hidden
      anchorAriaLabel: anchor?.getAttribute('aria-label') ?? null, // aria-label
      footnoteRefAriaDescribedby: footnoteRef?.getAttribute('aria-describedby') ?? null, // aria-describedby
      octiconVersion: octicon?.getAttribute('version') ?? null, // version
      // 顺手覆盖：data-line（dataAttributes 整体开关）、table 本体、复选框的
      // disabled/checked（不只是"存在"，勾选状态各异要能分辨出来）。
      dataLine: para?.getAttribute('data-line') ?? null,
      tableExists: table !== null,
      checkboxCount: checkboxes.length,
      checkboxTypes: checkboxes.map((c) => c.getAttribute('type')),
      checkedStates: checkboxes.map((c) => c.hasAttribute('checked')),
      disabledStates: checkboxes.map((c) => c.hasAttribute('disabled')),
      summaryText: summary?.textContent ?? null,
    }
  })

  // ---- EXTRA_ELEMENTS：六个都要直接在场，查标签本身，不是查它们包着的内容 ----
  expect(seen.imgExists, '<img>').toBe(true)
  expect(seen.inputExists, '<input>').toBe(true)
  expect(seen.detailsExists, '<details>').toBe(true)
  expect(seen.summaryExists, '<summary>').toBe(true)
  // 浏览器对未知标签是 unwrap（丢外层、留内容）——只查 <table> 存在测不出
  // <markdown-accessiblity-table> 被删掉，必须直接查这个标签本身，并且确认
  // 它确实包着那个 <table>（不是查到了一个不相干的自定义标签）。
  expect(seen.customTableExists, '<markdown-accessiblity-table>').toBe(true)
  expect(seen.customTableWrapsTable, '<markdown-accessiblity-table> 应该包着 <table>').toBe(true)
  expect(seen.mathRendererExists, '<math-renderer>').toBe(true)
  expect(seen.mathRendererText).toBe('$x^2$')

  // ---- EXTRA_ATTRIBUTES：九个逐一核对 ----
  expect(seen.anchorId, 'id').toBe('user-content-heading')
  expect(seen.anchorClass, 'class').toBe('anchor')
  expect(seen.mathRendererStyle, 'style').toBe('display: inline-block')
  expect(seen.imgLinkTarget, 'target').toBe('_blank')
  expect(seen.imgLinkRel, 'rel').toBe('noopener noreferrer')
  expect(seen.octiconAriaHidden, 'aria-hidden').toBe('true')
  expect(seen.anchorAriaLabel, 'aria-label').toBe('Permalink: Heading')
  expect(seen.footnoteRefAriaDescribedby, 'aria-describedby').toBe('footnote-label')
  expect(seen.octiconVersion, 'version').toBe('1.1')

  // ---- 顺手覆盖 ----
  expect(seen.dataLine, 'data-line').not.toBeNull()
  expect(seen.tableExists).toBe(true)
  expect(seen.checkboxCount).toBe(2)
  expect(seen.checkboxTypes).toEqual(['checkbox', 'checkbox'])
  expect(seen.checkedStates).toEqual([true, false])
  expect(seen.disabledStates, 'disabled').toEqual([true, true])
  expect(seen.summaryText).toBe('more')
})
