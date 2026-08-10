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
