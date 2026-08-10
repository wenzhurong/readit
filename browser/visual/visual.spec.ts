import { expect, test } from '../support/harness.js'
import { HOSTS, SHOTS } from '../support/shots.js'
import { assertBaselineHost, assertFontsPinned, loadShot } from '../support/visual.js'

// §0 A9 之后 visual-chromium 是唯一一个 testDir 指向 browser/visual 的 project，
// 所以这些用例不会被别的 project 收进去跑——不再需要像任务书草稿那样用
// test.skip(testInfo.project.name !== 'chromium', …) 自己再判一遍。testDir 分流
// 本身就是那道闸（见 playwright.config.ts 与 test/browser-wiring.test.ts）。
for (const shot of SHOTS) {
  for (const host of HOSTS) {
    test(`${shot.name} · ${host} host`, async ({ page }, testInfo) => {
      assertBaselineHost(testInfo)

      await page.goto(`/${host}.html`)
      const target = await loadShot(page, shot)
      await assertFontsPinned(page, shot.instances === 2 ? 'c' : 'a')

      await expect(page.locator(target)).toHaveScreenshot(`${shot.name}.png`)
    })
  }
}
