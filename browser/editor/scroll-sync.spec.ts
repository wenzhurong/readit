import { expect, mountDoc, test } from '../support/harness.js'

/**
 * L3b-editor：source.ts 里做的一切（collectAnchors 的插值算术、双向自激防护
 * 的回声守卫）在 vitest/happy-dom 里已经用注入的 measure() 验过（Task 16）。
 * 这里补的是那份验证够不到的那一半：真实排版下 CodeMirror 的 .cm-scroller
 * 与预览侧 .markdown-body 各自真的会因为程序性滚动而派发原生 scroll 事件，
 * 且这条链路经过 kernel.ts 真实接上的 offsetTop 测量、真实的 createScrollSync()
 * 之后仍然成立——这些都是 happy-dom（没有排版）永远测不到的。
 *
 * 文档需要长到两侧都真的可以滚动（BASE_CSS 的 .cm-editor { height: 100% }
 * 与 .readit-source textarea { height: 100% } 也是本批为此发现并补上的——
 * 没有它们 CodeMirror 的 .cm-scroller 的 scrollHeight 恒等于 clientHeight，
 * 永远进不了可滚动状态，滚动同步在 source/split 模式下会是一句空话）。
 */
const LONG_DOC = Array.from(
  { length: 150 },
  (_, i) => `## Heading ${String(i)}\n\npara ${String(i)} filler filler filler filler filler filler.\n`,
).join('\n')

interface ScrollProbe {
  scrollerTop: number
  contentTop: number
}

async function mountSplitWithHeight(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/host.html')
  await page.waitForFunction(() => window.readitFixture !== undefined)
  await page.evaluate(() => {
    const host = document.getElementById('a')
    if (host !== null) host.style.height = '400px'
  })
  const id = await mountDoc(page, 'a', { value: LONG_DOC, mode: 'split' })
  await page.waitForFunction(() => {
    const root = document.getElementById('a')?.shadowRoot
    const scroller = root?.querySelector('.cm-scroller') as HTMLElement | null | undefined
    return scroller != null && scroller.scrollHeight > scroller.clientHeight + 50
  })
  return id
}

async function probe(page: import('@playwright/test').Page): Promise<ScrollProbe> {
  return await page.evaluate(() => {
    const root = document.getElementById('a')?.shadowRoot
    const scroller = root?.querySelector('.cm-scroller') as HTMLElement
    const content = root?.querySelector('.markdown-body') as HTMLElement
    return { scrollerTop: scroller.scrollTop, contentTop: content.scrollTop }
  })
}

test.describe('L3b-editor：真实排版下的双向滚动同步', () => {
  test('编辑器滚动会把预览推到大致对应的位置', async ({ page }) => {
    await mountSplitWithHeight(page)
    const before = await probe(page)
    expect(before.contentTop).toBe(0)

    await page.evaluate(() => {
      const scroller = document.getElementById('a')?.shadowRoot?.querySelector('.cm-scroller') as HTMLElement
      scroller.scrollTop = scroller.scrollHeight * 0.6
    })
    // 滚动事件是异步派发的（浏览器按帧合批），给它一点真实时间落地。
    await page.waitForFunction(() => {
      const content = document.getElementById('a')?.shadowRoot?.querySelector('.markdown-body') as HTMLElement
      return content.scrollTop > 0
    })
    const after = await probe(page)
    expect(after.contentTop).toBeGreaterThan(before.contentTop)
  })

  test('预览滚动会把编辑器推到大致对应的位置', async ({ page }) => {
    await mountSplitWithHeight(page)
    const before = await probe(page)
    expect(before.scrollerTop).toBe(0)

    await page.evaluate(() => {
      const content = document.getElementById('a')?.shadowRoot?.querySelector('.markdown-body') as HTMLElement
      content.scrollTop = content.scrollHeight * 0.6
    })
    await page.waitForFunction(() => {
      const scroller = document.getElementById('a')?.shadowRoot?.querySelector('.cm-scroller') as HTMLElement
      return scroller.scrollTop > 0
    })
    const after = await probe(page)
    expect(after.scrollerTop).toBeGreaterThan(before.scrollerTop)
  })

  test('一次用户滚动只推一次——不会自己跟自己越推越远（双向自激防护）', async ({ page }) => {
    await mountSplitWithHeight(page)
    await page.evaluate(() => {
      const content = document.getElementById('a')?.shadowRoot?.querySelector('.markdown-body') as HTMLElement
      content.scrollTop = content.scrollHeight * 0.5
    })
    await page.waitForFunction(() => {
      const scroller = document.getElementById('a')?.shadowRoot?.querySelector('.cm-scroller') as HTMLElement
      return scroller.scrollTop > 0
    })
    // 若两侧在互相反弹（自激），这个值会在等待期间持续漂移；真实回声防护下
    // 它应该在编辑器那次程序性滚动派发的 scroll 事件被 fromEditor() 的
    // 回声守卫吃掉之后，稳定下来不再变化。
    const first = await probe(page)
    await page.waitForTimeout(300)
    const second = await probe(page)
    expect(second).toEqual(first)
  })
})
