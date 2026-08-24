import { expect, test } from '../support/harness.js'

/**
 * 桌面壳的模式控件在真引擎里的两条：拖得动，且拖完不会顺手切换模式。
 *
 * 为什么必须放这里而不是 happy-dom：那边 `getBoundingClientRect()` 恒为 0（没有排版），
 * 所以「控件真的移动了」测不出来；而「松手时浏览器补派的那一次 click」是引擎行为，
 * 合成事件里根本不存在——不吃掉它，从按钮上起手拖动就会在放手时切换模式。
 */
test.describe('shell mode switch', () => {
  test('从按钮上起手拖动：控件跟着走，且不会切换模式', async ({ page }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    await page.evaluate(() => window.readitFixture.connectShellModeSwitch())

    const before = await page.evaluate(() => window.readitFixture.shellModeSwitchState())
    // 故意按在按钮上：这正是最容易误触发切换的起手式。
    const box = await page.locator('#readit-mode-switch [data-mode="source"]').boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(260, 420, { steps: 24 })
    await page.mouse.up()

    const after = await page.evaluate(() => window.readitFixture.shellModeSwitchState())
    expect({
      moved: after.left !== before.left && after.top !== before.top,
      selections: after.selections,
    }).toEqual({ moved: true, selections: [] })
  })

  test('原地点击照常切换模式 —— 否则上一条只是证明按钮坏了', async ({ page }) => {
    // 反空断言。少了这条，「拖动时没有切换」可以由「按钮根本点不动」满足。
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    await page.evaluate(() => window.readitFixture.connectShellModeSwitch())

    await page.locator('#readit-mode-switch [data-mode="split"]').click()

    const state = await page.evaluate(() => window.readitFixture.shellModeSwitchState())
    expect(state.selections).toEqual(['split'])
  })

  test('拖到视口外会被拉回来，控件不会永久失联', async ({ page }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    await page.evaluate(() => window.readitFixture.connectShellModeSwitch())

    const box = await page.locator('#readit-mode-switch [data-mode="read"]').boundingBox()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(-500, -500, { steps: 20 })
    await page.mouse.up()

    const state = await page.evaluate(() => window.readitFixture.shellModeSwitchState())
    expect({ leftInside: state.left >= 0, topInside: state.top >= 0 }).toEqual({
      leftInside: true,
      topInside: true,
    })
  })

  test('窗口缩小把控件挤到边界外时，它被完整拉回而不是被压扁', async ({ page }) => {
    // 棘轮回归：压扁之后测到的宽度会变小，clamp 上界跟着变大，控件再也回不来。
    await page.setViewportSize({ width: 1200, height: 700 })
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    await page.evaluate(() => window.readitFixture.connectShellModeSwitch())

    const natural = (await page.evaluate(() => {
      const el = document.getElementById('readit-mode-switch')!
      return el.getBoundingClientRect().width
    })) as number
    expect(natural).toBeGreaterThan(60)

    // 先拖到最右边，再把窗口缩窄到那个位置之外。
    const box = await page.locator('#readit-mode-switch [data-mode="read"]').boundingBox()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(1100, 60, { steps: 20 })
    await page.mouse.up()
    await page.setViewportSize({ width: 420, height: 700 })

    // 轮询而不是立刻断言：resize 之后各引擎更新 innerWidth 与布局的时机不同。
    await expect
      .poll(async () =>
        await page.evaluate(() => {
          const el = document.getElementById('readit-mode-switch')!
          const r = el.getBoundingClientRect()
          return r.left >= 0 && r.right <= window.innerWidth
        }),
      )
      .toBe(true)

    const after = await page.evaluate(() => {
      const el = document.getElementById('readit-mode-switch')!
      return el.getBoundingClientRect().width
    })
    expect(Math.abs(after - natural)).toBeLessThan(1)
  })
})
