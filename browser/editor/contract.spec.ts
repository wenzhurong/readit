import { expect, mountDoc, test } from '../support/harness.js'

/**
 * L3b-editor：两个 Editor 实现在真浏览器里跑同一张 P2 契约表
 * （packages/editor/test/contract.ts）。plain 档已经在 vitest/happy-dom 里
 * 跑过一遍（Task 13）；codemirror 档需要真实排版（posAtCoords、
 * getBoundingClientRect），happy-dom 不提供，只有这里能跑——不补上这一半，
 * 「两个实现才算验证过一个抽象」这句话就只兑现了一半（批次 6 报告的原话）。
 *
 * plain 档跑全部 7 条；codemirror 档跑 6 条——「组合期间的 setValue 被推迟」
 * 那一条被 contract.ts 的 supportsSyntheticComposition 开关排除在外：
 * CodeMirror 6 的 view.composing 只在真的观察到一次组合期间的文本变更时才
 * 置真，`dispatchEvent()` 派发的合成 CompositionEvent 驱动不了它（这是本批
 * 在真浏览器里跑通这张表时才实测到的，contract.ts 顶部有完整推导）。那条行为
 * 没有被跳过不测——挪到了下面 ime.spec.ts 里用 CDP 的 Input.imeSetComposition
 * 真实驱动，比合成事件更严格，不是自我肯定。
 */
test.describe('L3b-editor：两个实现共用同一张 P2 契约表', () => {
  test('plain 档满足 P2 的 Editor 契约（7 条）', async ({ page }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    const failures = await page.evaluate(async () => window.readitFixture.runEditorContract('plain'))
    expect(failures).toEqual([])
  })

  test('codemirror 档满足 P2 的 Editor 契约（6/7 条，组合期推迟改由 ime.spec.ts 用真实 CDP 验证）', async ({
    page,
  }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    const failures = await page.evaluate(async () => window.readitFixture.runEditorContract('codemirror'))
    expect(failures).toEqual([])
  })

  test('CodeMirror 真的挂在 shadow root 里，样式也注进去了', async ({ page }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    await mountDoc(page, 'a', { value: '# hi\n\npara\n', mode: 'source' })
    await page.waitForSelector('#a')
    const found = await page.evaluate(async () => {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        const root = document.getElementById('a')?.shadowRoot
        const cm = root?.querySelector('.cm-content')
        if (root != null && cm != null) {
          return { inShadow: true, sheets: root.adoptedStyleSheets.length + root.querySelectorAll('style').length }
        }
        await new Promise((r) => setTimeout(r, 20))
      }
      return { inShadow: false, sheets: 0 }
    })
    expect(found.inShadow).toBe(true)
    // BASE_CSS/主题表两张（adoptedStyleSheets，见 kernel.ts applyStyles()）——
    // CodeMirror 自己的样式走 style-mod，在 WebKit < 16.4 等不支持
    // adoptedStyleSheets 的引擎上落到 <style> 标签，两种形态都该 > 0。
    expect(found.sheets).toBeGreaterThan(0)
  })

  test('source 模式下预览窗格隐藏，split 模式下两个窗格都在', async ({ page }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    const id = await mountDoc(page, 'a', { value: '# hi\n', mode: 'source' })
    const sourceOnly = await page.evaluate(() => {
      const root = document.getElementById('a')?.shadowRoot
      const content = root?.querySelector('.markdown-body') as HTMLElement | null | undefined
      const source = root?.querySelector('.readit-source') as HTMLElement | null | undefined
      return { contentHidden: content?.hidden, sourceHidden: source?.hidden }
    })
    expect(sourceOnly).toEqual({ contentHidden: true, sourceHidden: false })

    await page.evaluate((h) => window.readitFixture.get(h).setMode('split'), id)
    await page.waitForFunction(() => {
      const root = document.getElementById('a')?.shadowRoot
      return root?.querySelector('.cm-content') != null
    })
    const split = await page.evaluate(() => {
      const root = document.getElementById('a')?.shadowRoot
      const content = root?.querySelector('.markdown-body') as HTMLElement | null | undefined
      const source = root?.querySelector('.readit-source') as HTMLElement | null | undefined
      return { contentHidden: content?.hidden, sourceHidden: source?.hidden }
    })
    expect(split).toEqual({ contentHidden: false, sourceHidden: false })
  })
})
