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

/**
 * 等两侧的滚动位置**停稳**，而不只是「已经动过」。
 *
 * 这个区分是自激防护那条测试正确性的前提，也是它此前抖动的根因：
 * `waitForFunction(() => scroller.scrollTop > 0)` 在 scrollTop 刚变正的那一刻
 * 就返回，而那次程序性滚动可能还没沉降完（浏览器把 scroll 事件投递、
 * 回声守卫吃掉它、以及随之而来的一次布局，都还在后面）。于是紧接着采的
 * `first` 是**飞行途中**的一帧，300ms 后的 `second` 自然不同——
 * 测试报「自激」，实际是「在沉降完成前就开始观测」。
 *
 * 实测：串行、孤立、`--workers=1` 下 WebKit 仍然三次红一次（约 33%）。
 * 不是并发噪声——WebKit 的 scroll 事件投递时序与 Chromium 不同，更容易撞上。
 *
 * 「停稳」的判据取连续 3 次采样完全相同（间隔 50ms）。用连续多次而不是一次，
 * 是因为单次相同可能只是两帧之间恰好没变；自激的特征恰恰是**持续**漂移，
 * 连续 3 次不动能把它排除掉。
 *
 * ## 上界为什么是轮数而不是毫秒，以及为什么是 10
 *
 * 「等停稳」若无限等下去，就把「收敛得慢」和「压根不收敛」混成了一件事——
 * 而后者正是这条测试要抓的缺陷。所以要有上界。但上界不能拍脑袋。
 *
 * 实测（2026-08-11，本机，`--workers=1` 孤立跑，每档 5 次）：
 *
 * | 场景 | 引擎 | 到停稳耗时 |
 * |---|---|---|
 * | 健康（回声守卫在） | Chromium | 105 / 107 / 107 / 107 / 106 ms |
 * | 健康（回声守卫在） | WebKit | 163 / 165 / 163 / 108 / 109 ms |
 * | **注入缺陷**（两处守卫的提前 return 都拆掉） | Chromium | **2635 ms** |
 *
 * 105ms 就是 `STABLE_SAMPLES × INTERVAL_MS` 的采样地板本身——健康态基本是
 * 「一进来就已经停了」；WebKit 的 163 是多耗了一轮。缺陷态 2635ms ≈ 50 轮。
 *
 * 判据取**轮数**而不是墙钟：轮数由两侧互推的往返次数决定，机器快慢基本不影响它
 * （机器慢时每个 50ms 窗口反而覆盖更多次往返，健康态仍贴着地板）。而墙钟会随
 * CI runner 的负载整体平移——这条分支已经为「用绝对墙钟数做阻塞门」栽过一次，
 * 见 `packages/element/test/rerender-perf.perf.ts` 里 C2 的记述。
 *
 * 健康态最多 3 轮，缺陷态约 50 轮。取 **10**：比健康态最坏值高 3.3 倍、
 * 比缺陷态低 5 倍，两边都有余量。
 *
 * ⚠️ 这条超时**是缺陷的表现，不是测试太急**。别靠加大 MAX_ROUNDS 让它变绿——
 * 真要动这个数，先把上表那三档重新量一遍。
 */
async function waitForScrollQuiescence(page: import('@playwright/test').Page): Promise<ScrollProbe> {
  const STABLE_SAMPLES = 3
  const INTERVAL_MS = 50
  const MAX_ROUNDS = 10

  let last = await probe(page)
  let stable = 1
  let rounds = 0
  while (stable < STABLE_SAMPLES) {
    if (rounds >= MAX_ROUNDS) {
      throw new Error(
        `滚动位置在 ${String(MAX_ROUNDS)} 轮采样（每轮 ${String(INTERVAL_MS)}ms）内没有停稳，` +
          `最后读数 scrollerTop=${String(last.scrollerTop)} contentTop=${String(last.contentTop)}。` +
          '健康态实测只要 2-3 轮（分布表见本函数注释）。持续漂移正是双向自激的特征——' +
          '这条失败是那个缺陷的表现，不是测试太急，不要靠加大 MAX_ROUNDS 让它变绿。',
      )
    }
    rounds += 1
    await page.waitForTimeout(INTERVAL_MS)
    const next = await probe(page)
    stable = next.scrollerTop === last.scrollerTop && next.contentTop === last.contentTop ? stable + 1 : 1
    last = next
  }
  return last
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
    // 若两侧在互相反弹（自激），这个值会持续漂移；真实回声防护下它应该在
    // 编辑器那次程序性滚动派发的 scroll 事件被 fromEditor() 的回声守卫吃掉
    // 之后，稳定下来不再变化。
    //
    // 分两步：先等它**停稳**（waitForScrollQuiescence，见该函数的注释——
    // 直接在「已经动过」之后立刻采样会把飞行途中的一帧当成基线，那正是这条
    // 测试此前 33% 假红的原因），再开一个观测窗看它会不会重新动起来。
    // 自激不是「沉降慢」，是**收敛不了**——停稳之后就不该再动。
    const settled = await waitForScrollQuiescence(page)
    await page.waitForTimeout(300)
    const after = await probe(page)
    expect(after).toEqual(settled)
  })
})
