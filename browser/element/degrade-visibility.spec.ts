import { expect, test, type Page } from '../support/harness.js'

/**
 * §0.1 G4「降级必须可见」的两条落点，批次 7 评审用临时探针在 Chromium/WebKit 上
 * 都实测通过、跑完即删——当时没有留下测试守住它（见 batch-7-report.md「顾虑」
 * 第 1 条、docs/plans/2026-08-08-plan2-debt.md 的批次 8 派单）。这里把它们钉成
 * 永久测试：
 *
 *  1. `:host([data-readit-pending])::after` 角标——不仅要「有 pending 时可见」，
 *     还要「没有 pending 时确实不出现」，后一半不能省，否则前一半是恒真断言
 *     （比如角标选择器写成裸 `[data-readit-pending]`，语义上永远选不中任何东西，
 *     `content` 也会读成 `'none'`，但那种「不出现」是选择器写错的不出现，不是
 *     「没有降级就不显示」的正确不出现——批次 5→17 之间就真的踩过这个坑，见
 *     base-css.ts 头部注释）。
 *  2. 编辑器加载失败的可见回落（`.readit-source-fallback`）——用
 *     `page.route(...).abort()` 真掐断网络，不是 mock 一个会抛错的函数，
 *     且组件不能留在半初始化的壳里：`getValue`/`setValue`/`setMode` 之后仍要能用。
 */

async function pendingAfterStyle(page: Page, hostId: string): Promise<{ content: string; width: string; height: string; position: string }> {
  return await page.evaluate((id) => {
    const host = document.getElementById(id)
    if (host === null) throw new Error(`fixture: no host #${id}`)
    const style = getComputedStyle(host, '::after')
    return { content: style.content, width: style.width, height: style.height, position: style.position }
  }, hostId)
}

test.describe('降级角标真的渲染（§0.1 G4）', () => {
  test('有 pending 能力时角标可见有盒子，没有 pending 时确实不出现', async ({ page }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)

    // #a：一份带围栏代码块的文档 + 一个永不 resolve 的 loadHighlighter——
    // 用「永不完成」而不是「真的等网络」，是为了让 pending 状态在整个断言窗口内
    // 确定性地保持住，不用跟异步加载的完成时间赛跑（对照 D2-17 诊断时踩过的坑：
    // 默认 math 加载器是真实异步的，读快照的时机不同会看到不同状态）。
    await page.evaluate(() => {
      window.readitFixture.mount('a', {
        value: '```js\nconst x = 1;\n```\n',
        mode: 'read',
        loadHighlighter: () => new Promise(() => {}),
      })
    })
    await page.waitForFunction(() => document.getElementById('a')?.dataset['readitPending'] === 'highlight')

    const pending = await pendingAfterStyle(page, 'a')
    expect(pending.content, '::after content 在有 pending 时不是 none').not.toBe('none')
    expect(pending.position, '::after position').toBe('absolute')
    expect(pending.width, '::after width（源码里显式写的 6px，不是 0）').toBe('6px')
    expect(pending.height, '::after height').toBe('6px')

    // #b：没有任何围栏代码块、没有数学、没有传 loadHighlighter 的普通文档——
    // needsHighlight/needsMath 都是 false，data-readit-pending 从一开始就不该
    // 出现。这一半不能省：它是恒真断言的唯一防线（若选择器写错、角标永远选不中
    // 任何真实元素，这一半会跟上一半同时"通过"，测不出选择器坏了）。
    await page.evaluate(() => {
      window.readitFixture.mount('b', { value: '# just a heading\n\nplain paragraph.\n', mode: 'read' })
    })
    await page.waitForSelector('#b')
    expect(await page.evaluate(() => document.getElementById('b')?.hasAttribute('data-readit-pending'))).toBe(false)
    const clean = await pendingAfterStyle(page, 'b')
    expect(clean.content, '没有 pending 时 ::after content 必须是 none').toBe('none')
  })
})

test.describe('编辑器加载失败的可见回落（§0.1 G4 / §12）', () => {
  test('真掐断网络后：只读回落可见、非零盒子、文本正确，组件未留在半初始化的壳里', async ({ page }) => {
    // 真掐断，不是 mock 一个会抛错的函数——这条测试要证明的是「网络层真实失败时
    // 这条 catch 路径确实会跑」，而不是「我们自己写的桩函数按预期抛了」。
    await page.route('**/codemirror-*.js', (route) => route.abort())

    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    const original = 'line one\nline two\n'
    const id = await page.evaluate(
      (value) => window.readitFixture.mount('a', { value, mode: 'source' }),
      original,
    )

    const fallback = page.locator('#a').locator('pre.readit-source-fallback')
    await expect(fallback).toBeVisible()
    expect(await fallback.getAttribute('data-editor')).toBe('unavailable')
    await expect(fallback).toHaveText(original)
    const box = await fallback.boundingBox()
    expect(box, '回落 <pre> 必须有真实渲染盒子，不是 display:none 的死元素').not.toBeNull()
    expect(box?.width ?? 0).toBeGreaterThan(0)
    expect(box?.height ?? 0).toBeGreaterThan(0)

    // 组件没有留在半初始化的壳里：getValue/setValue/setMode 三个方法仍然可用，
    // 不抛、不挂起、状态确实按调用生效——这是「回落」与「组件死掉」的分界线。
    expect(await page.evaluate((hid) => window.readitFixture.get(hid).getValue(), id)).toBe(original)

    const updated = 'replaced content\n'
    await page.evaluate(([hid, value]) => window.readitFixture.get(hid).setValue(value), [id, updated] as const)
    expect(await page.evaluate((hid) => window.readitFixture.get(hid).getValue(), id)).toBe(updated)

    // setMode 在编辑器持续不可用（route 仍在拦截）时反复切换不应该抛出或卡死——
    // 这正是「组件没有卡在半初始化状态」的另一半证据：read 能正常显示预览，
    // 切回 source 会再次尝试加载、再次失败、再次落到同一条回落路径，而不是
    // 停在某个中间态。
    await page.evaluate((hid) => window.readitFixture.get(hid).setMode('read'), id)
    expect(await page.evaluate(() => document.getElementById('a')?.shadowRoot?.querySelector('.readit-source')?.hasAttribute('hidden'))).toBe(true)

    await page.evaluate((hid) => window.readitFixture.get(hid).setMode('source'), id)
    await expect(fallback).toBeVisible()
    await expect(fallback).toHaveText(updated)
  })
})
