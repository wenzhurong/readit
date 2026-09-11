import { expect, mountDoc, test, type Page } from '../support/harness.js'

const LONG_TEXT = `# 行宽\n\n${'word '.repeat(400)}\n`

interface Measurement {
  hostWidth: number
  contentWidth: number
  leftGap: number
  rightGap: number
}

async function measure(page: Page): Promise<Measurement> {
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

/** 被替换掉的旧写法：行宽封顶在 M，单侧留白 =（宿主宽 − M）/ 2。 */
const CAPPED = (m: number): string =>
  `#a::part(content){box-sizing:border-box;max-width:${m}px;margin-inline:auto;}`

/** 壳现在的写法（styles.css 用的是 calc(50% + var(--readit-shell-measure) / 2)）。 */
const HALVED = (m: number): string =>
  `#a::part(content){box-sizing:border-box;max-width:calc(50% + ${m}px / 2);margin-inline:auto;}`

async function measureWith(
  page: Page,
  opts: { readonly rule: string; readonly hostWidth: number; readonly mode?: 'read' | 'split' },
): Promise<Measurement> {
  await page.goto('/host.html')
  await page.waitForFunction(() => window.readitFixture !== undefined)
  // 显式钉宿主宽度，而不是靠视口：页面出竖直滚动条时 Chromium 的 ICB 会窄几个像素，
  // 那几个像素会让下面这些整数期望值全部错位（WebKit 的叠加式滚动条又不会）。
  await page.evaluate((w) => {
    document.getElementById('a')!.style.width = `${w}px`
  }, opts.hostWidth)
  await page.addStyleTag({ content: opts.rule })
  await mountDoc(page, 'a', { value: LONG_TEXT, mode: opts.mode ?? 'read' })
  return await measure(page)
}

/**
 * 留白减半那条式子本身。2026-09-11：原来的 `max-width: measure` 留白过大，改成
 * `max-width: calc(50% + measure/2)`，于是单侧留白从（宿主宽 − measure）/ 2 变成 / 4。
 *
 * 这里验的是**算术在真引擎里成立**，而不是把 CSS 文本抄一遍：同一个宿主宽度下新写法的
 * 留白正好是旧写法的一半，且「随宿主变宽而变宽」「窄宿主照常占满」两条都没被顺手改掉。
 * 用的 M 是本文件自选的，不是壳里那个 52rem —— 这条验式子的性质，壳当前挑的那个数由
 * shell/test/styles.test.ts 守。
 */
test.describe('两侧留白减半：calc(50% + M/2) 与 max-width:M 的对照', () => {
  const M = 300
  const WIDE = 1000
  const NARROW = 260

  test('宽宿主下留白正好是原来的一半，且仍然两侧相等', async ({ page }) => {
    const capped = await measureWith(page, { rule: CAPPED(M), hostWidth: WIDE })
    const halved = await measureWith(page, { rule: HALVED(M), hostWidth: WIDE })

    // 前提自检：基线那条必须真的在留白，否则"减半"没有东西可减。
    expect(capped.hostWidth).toBeCloseTo(WIDE, 0)
    expect(capped.contentWidth).toBeCloseTo(M, 0)
    expect(capped.leftGap).toBeCloseTo((WIDE - M) / 2, 0)

    expect(halved.contentWidth).toBeCloseTo(WIDE / 2 + M / 2, 0)
    expect(halved.leftGap).toBeCloseTo((WIDE - M) / 4, 0)
    // 这条才是这次改动的实质。
    expect(halved.leftGap * 2).toBeCloseTo(capped.leftGap, 0)
    // 居中没在减半的过程中丢掉。
    expect(Math.abs(halved.leftGap - halved.rightGap)).toBeLessThan(2)
  })

  test('留白仍然随宿主变宽而变宽 —— 不是被换成了一个写死的定值', async ({ page }) => {
    // 「把 measure 调大到 72rem」那种做法会在这条上露馅：定值的留白同样会变，但
    // 变的幅度不是（宿主宽 − M）/ 4，下面两个点会同时对不上。
    const narrower = await measureWith(page, { rule: HALVED(M), hostWidth: 700 })
    const wider = await measureWith(page, { rule: HALVED(M), hostWidth: WIDE })

    expect(narrower.leftGap).toBeCloseTo((700 - M) / 4, 0)
    expect(wider.leftGap).toBeCloseTo((WIDE - M) / 4, 0)
    expect(wider.leftGap).toBeGreaterThan(narrower.leftGap + 50)
  })

  test('宿主窄于 M 时照常占满 —— 与旧写法逐像素一致', async ({ page }) => {
    // 减半不该动到临界点：宿主窄于 M 时 calc 给出的上限大于 100%，根本不起约束。
    const capped = await measureWith(page, { rule: CAPPED(M), hostWidth: NARROW })
    const halved = await measureWith(page, { rule: HALVED(M), hostWidth: NARROW })

    expect(capped.leftGap).toBeLessThan(1)
    expect(halved.leftGap).toBeLessThan(1)
    expect(halved.contentWidth).toBeCloseTo(capped.contentWidth, 0)
    expect(halved.contentWidth).toBeCloseTo(NARROW, 0)
  })

  test('壳的实际写法：变量声明在宿主上，再在 ::part 规则里参与 calc 的除法', async ({ page }) => {
    // 上面几条注入的是字面量 `300px / 2`，壳里那条是 `var(--readit-shell-measure) / 2`，
    // 多出两步：自定义属性跨 shadow 边界继承到 part 上，以及 var() 代换出来的记号参与
    // calc 的除法。任一步在某个引擎上不成立，整条 max-width 会失效回落到 none——表现是
    // 留白**静悄悄地归零**，没有任何报错。所以这一步单独验，不靠字面量那几条顺带覆盖。
    const m = await measureWith(page, {
      rule:
        `#a{--readit-shell-measure:${M}px;}` +
        '#a::part(content){box-sizing:border-box;' +
        'max-width:calc(50% + var(--readit-shell-measure) / 2);margin-inline:auto;}',
      hostWidth: WIDE,
    })

    expect(m.contentWidth).toBeCloseTo(WIDE / 2 + M / 2, 0)
    expect(m.leftGap).toBeCloseTo((WIDE - M) / 4, 0)
    expect(Math.abs(m.leftGap - m.rightGap)).toBeLessThan(2)
  })

  test('分栏模式下 50% 按窗格解析，于是每个窗格各自减半', async ({ page }) => {
    // 有判别力的一条：百分比的包含块若是整个宿主（1000），预览侧算出的上限是 650、
    // 比窗格宽 500 还大，留白会归零；只有包含块是**网格区域**（500）才得到 400 与 50。
    // styles.css 那段注释里"每个窗格各自减半"的依据就是这条，不是读规范读出来的。
    const capped = await measureWith(page, { rule: CAPPED(M), hostWidth: WIDE, mode: 'split' })
    const halved = await measureWith(page, { rule: HALVED(M), hostWidth: WIDE, mode: 'split' })
    const pane = WIDE / 2

    expect(capped.contentWidth).toBeCloseTo(M, 0)
    expect(capped.rightGap).toBeCloseTo((pane - M) / 2, 0)
    expect(halved.contentWidth).toBeCloseTo(pane / 2 + M / 2, 0)
    expect(halved.rightGap).toBeCloseTo((pane - M) / 4, 0)
    expect(halved.rightGap * 2).toBeCloseTo(capped.rightGap, 0)
  })
})
