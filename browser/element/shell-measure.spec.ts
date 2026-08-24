import { expect, mountDoc, test } from '../support/harness.js'

const LONG_TEXT = `# 行宽\n\n${'word '.repeat(400)}\n`

async function measure(page: import('@playwright/test').Page): Promise<{
  hostWidth: number
  contentWidth: number
  leftGap: number
  rightGap: number
}> {
  return await page.evaluate(() => {
    const host = document.getElementById('a')!
    const content = host.shadowRoot!.querySelector<HTMLElement>('.markdown-body')!
    const h = host.getBoundingClientRect()
    const c = content.getBoundingClientRect()
    return {
      hostWidth: h.width,
      contentWidth: c.width,
      leftGap: c.left - h.left,
      rightGap: h.right - c.right,
    }
  })
}

/**
 * 桌面壳靠 `#reader::part(content)` 给正文定行宽上限（styles.css）。这里验的是那条
 * 机理本身在真引擎里成立：**外层样式表能不能穿过 shadow 边界约束 part**，以及跨树
 * 层叠会不会被 shadow 内部的声明压回去。规范说外层树的普通声明赢，但这正是"读规范
 * 推断"与"引擎实测"该分开的地方——尤其 WebKit。
 */
test.describe('外层样式表通过 ::part(content) 定行宽', () => {
  test('宽窗口下正文被约束并居中，两侧留白相等', async ({ page }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    await page.addStyleTag({
      content: '#a::part(content){box-sizing:border-box;max-width:300px;margin-inline:auto;}',
    })
    await mountDoc(page, 'a', { value: LONG_TEXT, mode: 'read' })

    const m = await measure(page)
    // 前提自检：宿主必须真的比上限宽，否则"居中"这条断言无内容。
    expect(m.hostWidth).toBeGreaterThan(600)
    expect(m.contentWidth).toBeLessThanOrEqual(301)
    expect(Math.abs(m.leftGap - m.rightGap)).toBeLessThan(2)
    // 留白确实存在，而不是贴着左边。
    expect(m.leftGap).toBeGreaterThan(100)
  })

  test('不加那条规则时正文占满宿主 —— 否则上一条可能是别的原因造成的', async ({ page }) => {
    // 反空断言。少了它，「正文只有 300px」可以由「元素本身就渲染得很窄」满足。
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    await mountDoc(page, 'a', { value: LONG_TEXT, mode: 'read' })

    const m = await measure(page)
    expect(m.contentWidth).toBeGreaterThan(600)
    expect(m.leftGap).toBeLessThan(2)
  })
})
