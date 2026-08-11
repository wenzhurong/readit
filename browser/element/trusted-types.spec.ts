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
 * 评审 Important 3：`set-html.ts` 的 `EXTRA_ELEMENTS`/`EXTRA_ATTRIBUTES` 此前只在
 * `set-html.test.ts` 里对着**桩** `Sanitizer` 验证「配置里写了这些名字」——桩证明不了
 * 真实浏览器的 Sanitizer 会照单接受配置里写的东西，而这整批加法存在的理由，正是
 * 「配置以为放行、浏览器实际还是剥掉」这种沉默失败（`title` 与全局属性重复、
 * `data-component`/`data-snippet-clipboard-copy-content` 与 `dataAttributes: true`
 * 重复，两次都是构造期直接抛 `Invalid Sanitizer configuration`，而不是「配置写了但
 * 没生效」这种更隐蔽的失败——但两者都只有跑真浏览器才现形）。真浏览器里此前只钉住
 * 了 `id`（navigation.spec.ts 的 #slug 用例）与 `rel`（外链用例），`<img>`/`<input>`/
 * `<details>`/两个自定义元素、`class`、`data-line` 从未在真浏览器里核过。
 *
 * 语料覆盖表格、任务列表、图片、`<details>`（原始 HTML 直通）——`data-line` 由
 * M4 滚动同步承重，缺了它那条 M4 才要用的能力现在就在真浏览器里悄悄坏掉，等到
 * M4 才会被发现，那时候排查会更难。
 */
test('第 1 级注入后，EXTRA_ELEMENTS/EXTRA_ATTRIBUTES 覆盖的元素与属性一个不少', async ({ page }) => {
  const doc = [
    '# Heading',
    '',
    'A paragraph.',
    '',
    // 相对路径：egressGuard 的离线守卫只放行 127.0.0.1/localhost，一张指向
    // 外部主机的绝对 URL 会被当成真实的图片请求拦下、判成「破坏离线约束」而
    // 让这条测试因为无关的理由变红。相对路径解析到 fixture server 自己
    // （同源，404 也没关系）——这里要测的是 <img>/src 有没有活下来，不是图片
    // 真的能不能显示。
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
  ].join('\n')

  await page.goto('/host.html')
  await mountDoc(page, 'a', { value: doc, mode: 'read' })

  const seen = await page.evaluate(() => {
    const root = document.getElementById('a')?.shadowRoot
    if (root === null || root === undefined) throw new Error('no shadow root')
    // 标题旁 GitHub 形状的锚点是紧跟 <h1> 的兄弟 <a id="user-content-…">，
    // id 不在 <h1> 自己身上——见 packages/core/src/rules/*（clobber.ts）的输出形状。
    const anchor = root.querySelector('.anchor')
    const para = root.querySelector('p[data-line]')
    const img = root.querySelector('img')
    const table = root.querySelector('table')
    const checkboxes = [...root.querySelectorAll('input[type=checkbox]')]
    const details = root.querySelector('details')
    const summary = root.querySelector('summary')
    return {
      anchorId: anchor?.id ?? null,
      anchorClass: anchor?.getAttribute('class') ?? null,
      dataLine: para?.getAttribute('data-line') ?? null,
      imgSrc: img?.getAttribute('src') ?? null,
      tableExists: table !== null,
      checkboxCount: checkboxes.length,
      checkboxTypes: checkboxes.map((c) => c.getAttribute('type')),
      checkedStates: checkboxes.map((c) => c.hasAttribute('checked')),
      detailsExists: details !== null,
      summaryText: summary?.textContent ?? null,
    }
  })

  // id：标题旁 GitHub 形状的锚点（clobber 前缀 user-content-）。
  expect(seen.anchorId).toBe('user-content-heading')
  // class：Phase A 自己生成的结构标记，从不经过 hast-util-sanitize。
  expect(seen.anchorClass).toBe('anchor')
  // data-line：M4 滚动同步的承重物，走 dataAttributes: true 那个整体开关。
  expect(seen.dataLine).not.toBeNull()
  // <img>：默认 Sanitizer 完全不认识这个元素，是最初发现问题时最直观的那一个。
  expect(seen.imgSrc).toBe('./no-such-image.png')
  // <table>：本来就在浏览器默认允许名单里，这里是回归覆盖，不是新发现的缺口。
  expect(seen.tableExists).toBe(true)
  // <input type=checkbox>：任务列表清单，两个复选框，勾选状态各异。
  expect(seen.checkboxCount).toBe(2)
  expect(seen.checkboxTypes).toEqual(['checkbox', 'checkbox'])
  expect(seen.checkedStates).toEqual([true, false])
  // <details>/<summary>：用户原始 HTML 直通，默认名单里没有，会被整个剥掉。
  expect(seen.detailsExists).toBe(true)
  expect(seen.summaryText).toBe('more')
})
