import { expect, test } from '../support/harness.js'
import { loadShot, sampleComputedStyles } from '../support/visual.js'
import { SHOTS } from '../support/shots.js'

const SHOT = SHOTS[0]
if (SHOT === undefined) throw new Error('SHOTS 为空')

test('敌意 fixture 本身确实是敌意的（否则下一条是空断言）', async ({ page }) => {
  await page.goto('/hostile.html')
  const probe = await page.evaluate(() => {
    const box = document.getElementById('probe-box')
    const heading = document.getElementById('probe-h1')
    const list = document.getElementById('probe-ul')
    const host = document.getElementById('a')
    if (box === null || heading === null || list === null || host === null) throw new Error('probe 元素缺失')
    return {
      boxSizing: getComputedStyle(box).boxSizing,
      headingMargin: getComputedStyle(heading).marginBlockStart,
      listPadding: getComputedStyle(list).paddingInlineStart,
      // 不用 <body> 的 computed fontFamily 探测 Reboot：hostile-extra.css 用
      // `* { font-family: cursive !important }` 通吃所有元素（这正是它「敌意」的
      // 部分），body 自然也不例外，那条探针测不出 Reboot 是否加载，只会测出
      // hostile-extra 自己生效了没有——这是两回事。改测 Reboot 在 :root 上定义的
      // CSS 自定义属性：hostile-extra 只动具体的 longhand 计算值，不碰自定义属性。
      bsBodyFont: getComputedStyle(document.documentElement).getPropertyValue('--bs-body-font-family'),
      hostLineHeight: getComputedStyle(host).lineHeight,
      hostTransform: getComputedStyle(host).textTransform,
    }
  })
  expect(probe.boxSizing, 'Tailwind Preflight 没生效').toBe('border-box')
  expect(probe.headingMargin, 'Tailwind Preflight 没生效').toBe('0px')
  // 不是 0px：Bootstrap Reboot 排在 Preflight 之后加载，显式把 <ul>/<ol> 的
  // padding-left 重新设成 2rem（Bootstrap 自己的既定设计，不是 Reboot 没生效）。
  // 32px = 2rem @ 16px 根字号，这条断言核的正是「两个 reset 叠在一起、后者压过前者」
  // 这个真实的层叠结果，而不是假装 Preflight 独占最终生效的那一份。
  expect(probe.listPadding, 'Bootstrap Reboot 的 ul/ol padding-left: 2rem 没生效').toBe('32px')
  expect(probe.bsBodyFont, 'Bootstrap Reboot 没生效').toContain('system-ui')
  // hostile-extra.css 打的是继承属性，而继承是穿过 shadow 边界的——挡住它的不是
  // Shadow DOM，是元素自己的 :host 重置。下一条测试就是那个重置的唯一证据。
  expect(probe.hostLineHeight, 'hostile-extra.css 没生效').toBe('48px')
  expect(probe.hostTransform, 'hostile-extra.css 没生效').toBe('uppercase')
})

test('敌意宿主下的 computed style 与干净宿主逐条相同', async ({ page }) => {
  // 已知缺陷（L3b-element 发现，非本任务范围，见 batch-5-report.md「:host 重置缺口」
  // 一节）：hostile-extra.css 在 letter-spacing / word-spacing / font-style /
  // text-align / text-transform 这几个继承属性上确实漏了进来。github-markdown-css
  // 只在 .markdown-body 自身显式设了 color / font-family / font-size / line-height /
  // word-wrap 这几项——这几项因为在 shadow 树内部被显式设定，正确挡住了继承；
  // 但上面那五项 github-markdown-css 从不设，所以它们没有「shadow 树内的显式值」
  // 可以截断继承链，落到从 shadow host 继承宿主页面的计算值。
  // packages/element/src/styles/base-css.ts 的 :host 规则目前只有 `display: block`，
  // 需要补一条更完整的重置（例如 `:host { all: initial; display: block; }`）才能
  // 把这条继承链在 shadow 边界上截断——这正是这条测试要证明「还没补」的地方。
  // 两个浏览器（Chromium 与 WebKit）表现一致，确认这是 CSS 层面的缺口，不是引擎差异。

  await page.goto('/visual.html')
  await loadShot(page, SHOT)
  const clean = await sampleComputedStyles(page, 'a')

  await page.goto('/hostile.html')
  await loadShot(page, SHOT)
  const hostile = await sampleComputedStyles(page, 'a')

  expect(hostile).toEqual(clean)
})
