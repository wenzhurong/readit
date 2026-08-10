import { expect, mountDoc, readLeaks, test } from '../support/harness.js'

const DOC = '# Title\n\nHello **world**.\n'

test('挂进 open shadow root，light DOM 一个字都不写', async ({ page }) => {
  await page.goto('/host.html')
  await mountDoc(page, 'a', { value: DOC, mode: 'read' })

  const seen = await page.evaluate(() => {
    const host = document.getElementById('a')
    if (host === null) throw new Error('no #a')
    const root = host.shadowRoot
    return {
      mode: root === null ? null : root.mode,
      heading: root?.querySelector('h1')?.textContent ?? null,
      lightChildren: host.childElementCount,
      bodyStyle: document.body.getAttribute('style'),
      htmlStyle: document.documentElement.getAttribute('style'),
      htmlTheme: document.documentElement.getAttribute('data-theme'),
    }
  })

  expect(seen.mode).toBe('open')
  expect(seen.heading).toBe('Title')
  expect(seen.lightChildren).toBe(0)
  // 设计 §3.3：永不写 document.documentElement 或 document.body。
  expect(seen.bodyStyle).toBeNull()
  expect(seen.htmlStyle).toBeNull()
  expect(seen.htmlTheme).toBeNull()
})

test('setTheme 换的是自己的调色板，不是文档的', async ({ page }) => {
  await page.goto('/host.html')
  const id = await mountDoc(page, 'a', { value: DOC, mode: 'read', theme: 'light' })

  const readTheme = async (): Promise<{ attr: string | null; bg: string; doc: string | null }> =>
    await page.evaluate(() => {
      const host = document.getElementById('a')
      if (host === null) throw new Error('no #a')
      const root = host.shadowRoot
      if (root === null) throw new Error('no shadow root')
      const content = root.querySelector('h1')
      if (content === null) throw new Error('no rendered content')
      return {
        attr: host.getAttribute('data-theme'),
        bg: getComputedStyle(content).color,
        doc: document.documentElement.getAttribute('data-theme'),
      }
    })

  const light = await readTheme()
  await page.evaluate((h) => { window.readitFixture.get(h).setTheme('dark') }, id)
  const dark = await readTheme()

  expect(light.attr).toBe('light')
  expect(dark.attr).toBe('dark')
  expect(dark.bg).not.toBe(light.bg)
  expect(light.doc).toBeNull()
  expect(dark.doc).toBeNull()
})

test('同页两个实例互不干扰（同源样式表隔离的行为断言，不是像素）', async ({ page }) => {
  await page.goto('/host.html')
  const a = await mountDoc(page, 'a', { value: '# A\n\nalpha text\n', mode: 'read', theme: 'light' })
  await mountDoc(page, 'b', { value: '# B\n\nbeta text\n', mode: 'read', theme: 'dark' })

  const probe = async (): Promise<Record<string, string | null>> =>
    await page.evaluate(() => {
      const pick = (hostId: string): { title: string | null; line: string | null; color: string | null } => {
        const host = document.getElementById(hostId)
        const root = host?.shadowRoot ?? null
        const h1 = root?.querySelector('h1') ?? null
        if (h1 === null) return { title: null, line: null, color: null }
        const cs = getComputedStyle(h1)
        return { title: h1.textContent, line: cs.lineHeight, color: cs.color }
      }
      // 反空对照：一个从未被 readit 碰过的裸 div，它的行高是 UA 默认。
      const bare = document.createElement('h1')
      document.body.append(bare)
      const bareLine = getComputedStyle(bare).lineHeight
      bare.remove()
      const A = pick('a')
      const B = pick('b')
      return { aTitle: A.title, bTitle: B.title, aLine: A.line, bLine: B.line, aColor: A.color, bColor: B.color, bareLine }
    })

  const both = await probe()
  expect(both.aTitle).toBe('A')
  expect(both.bTitle).toBe('B')
  // 失败形态是「第二个 root 拿不到样式表」。所以必须显式断言 B 被样式化了，
  // 而不是只断言 A 和 B 不同——两个都没样式时它们也「不同」得很。
  expect(both.aLine).not.toBe(both.bareLine)
  expect(both.bLine).not.toBe(both.bareLine)
  expect(both.bLine).toBe(both.aLine)
  expect(both.bColor).not.toBe(both.aColor)

  // 拆掉 A 之后 B 必须完好——共享样式表被第一个 destroy() 收走是同一类 bug 的另一面。
  await page.evaluate((h) => { window.readitFixture.destroy(h) }, a)
  const after = await probe()
  expect(after.bTitle).toBe('B')
  expect(after.bLine).toBe(both.bLine)
  expect(after.bColor).toBe(both.bColor)
})

test('50 次挂载/销毁之后，监听器与 observer 全部归零', async ({ page }) => {
  await page.goto('/host.html')

  // 反空断言：仪表必须真的看见过东西，否则下面的 delta === 0 什么也没证明。
  const before = await readLeaks(page)
  const id = await mountDoc(page, 'a', { value: DOC, mode: 'read', theme: 'auto' })
  const during = await readLeaks(page)
  const sum = (c: { listeners: number; resizeObservers: number; mutationObservers: number }): number =>
    c.listeners + c.resizeObservers + c.mutationObservers
  expect(
    sum(during),
    '一次挂载没有产生任何被仪表看见的监听器或 observer；仪表本身可能已经失效',
  ).toBeGreaterThan(sum(before))
  await page.evaluate((h) => { window.readitFixture.destroy(h) }, id)

  const baseline = await readLeaks(page)
  await page.evaluate((v) => {
    for (let i = 0; i < 50; i += 1) {
      const h = window.readitFixture.mount('a', { value: v, mode: 'read', theme: 'auto' })
      window.readitFixture.destroy(h)
    }
  }, DOC)
  expect(await readLeaks(page)).toEqual(baseline)
})
