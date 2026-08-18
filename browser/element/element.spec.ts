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

test('onChange 只报告真实编辑，程序化写值与切模式不报告', async ({ page }) => {
  await page.goto('/host.html')
  const id = await mountDoc(page, 'a', { value: DOC, mode: 'source', theme: 'light' })
  const editor = page.locator('#a .cm-content')
  await expect(editor).toBeVisible()

  // **必须用真键盘，不能用 locator.fill()。** 2026-08-18 实测：`.cm-content` 是
  // CodeMirror 的 contenteditable，`fill()` 在 WebKit 上是**空操作**——文档内容原样
  // 不变（domText 仍是挂载值），于是 onChange 不触发也是正确的，测试却会红成
  // 「功能坏了」。Chromium 上 fill() 恰好能改到，所以这个差异只在 WebKit 显形。
  //
  // 仓库里既有的编辑器输入走 CDP `Input.insertText`（browser/editor/ime.spec.ts），
  // 那是 Chromium 独有的——GAP-IME-WEBKIT 就是这么来的。真键盘是三个引擎都有、
  // 且最接近真实用户编辑的那条路。
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('X')
  await expect
    .poll(async () => await page.evaluate(() => window.readitFixture.changes.at(-1) ?? null))
    .toBe('X')

  // 逐键触发，所以这里钉「程序化操作**没有再加**任何一条」，而不是钉总数等于 1。
  const afterEdit = await page.evaluate(() => window.readitFixture.changes.length)
  expect(afterEdit).toBeGreaterThan(0)

  await page.evaluate((handle) => {
    const mounted = window.readitFixture.get(handle)
    mounted.setValue('# Programmatic\n')
    mounted.setMode('split')
    mounted.setMode('read')
    mounted.setMode('source')
    mounted.setTheme('dark')
  }, id)
  expect(await page.evaluate(() => window.readitFixture.changes.length)).toBe(afterEdit)
})

/**
 * Task 18（批次 5 返工，见 batch-5-report.md）端到端验证：SPEC §9.2 说对外
 * 只开两个覆写通道之一是 `--readit-*`。这条不是 css-bridge.test.ts 那种字符串层
 * 断言（"桥接代码里出现了 var(--readit-x, ...)"）——它要的是「宿主在 :host 之外
 * 设一个 `--readit-*` 变量，真的会改变真实浏览器里渲染出来的颜色」这条完整链路：
 * :host([data-theme=...]) 声明 → 继承进 shadow 树 → RULES 用 var(--fgColor-default)
 * 消费 → 最终 computed style。任何一环接错都会让这条测试红，而不会让
 * css-bridge.test.ts 的字符串断言有反应。
 */
test('宿主用 --readit-* 变量能覆写颜色，不设时保持上游默认值', async ({ page }) => {
  await page.goto('/host.html')
  await page.evaluate(() => {
    const host = document.getElementById('a')
    if (host === null) throw new Error('no #a')
    // 覆写点在宿主元素自己身上，跟 :host([data-theme="light"]) 同一层——
    // 不是往 document.documentElement 或某个全局 :root 上写。
    host.style.setProperty('--readit-fg-color-default', 'rgb(255, 0, 0)')
  })
  await mountDoc(page, 'a', { value: DOC, mode: 'read', theme: 'light' })
  const overridden = await page.evaluate(() => {
    const h1 = document.getElementById('a')?.shadowRoot?.querySelector('h1')
    if (h1 === null || h1 === undefined) throw new Error('no rendered heading')
    return getComputedStyle(h1).color
  })
  expect(overridden).toBe('rgb(255, 0, 0)')

  // 反空对照：另一个没有设置 --readit-fg-color-default 的实例必须落回上游默认值
  // （github-markdown-css 5.9.0 浅色主题的 --fgColor-default: #1f2328 = rgb(31, 35, 40)），
  // 不是碰巧也变红——否则上面那条断言可能只是「颜色反正总会变」的假阳性。
  await mountDoc(page, 'b', { value: DOC, mode: 'read', theme: 'light' })
  const notOverridden = await page.evaluate(() => {
    const h1 = document.getElementById('b')?.shadowRoot?.querySelector('h1')
    if (h1 === null || h1 === undefined) throw new Error('no rendered heading')
    return getComputedStyle(h1).color
  })
  expect(notOverridden).toBe('rgb(31, 35, 40)')
  expect(notOverridden).not.toBe(overridden)
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

/**
 * 终审发现：这条循环此前全程只用 `mode: 'read'`，压根没切到编辑器模式——
 * 跟 `packages/element/test/leak.test.ts` 的同一批发现是同一个漏洞形状，只是
 * 在真机层面重犯了一遍。修法是让循环也过 split/source，并且编辑器档真的
 * `waitFor` 到 CodeMirror 建出来再 destroy（不 await 就 destroy 等于从未给过
 * 它泄漏的机会）。
 *
 * 这里不会重犯 `leak.test.ts` 那条撞见的问题（CM6 自己 contentDOM 上的
 * ~20 个原生事件从不被显式 `removeEventListener`，会把裸探针的「listeners
 * 归零」淹没）：`INSTRUMENT`（harness.ts）从设计时就只数 `window`/
 * `document`/`MediaQueryList` 三层，shadow 树内部节点（CodeMirror 的
 * contentDOM 正是这一层）本来就不数（harness.ts 的注释：「随树一起死，数了
 * 只是噪声」）。CodeMirror 6.43.8 自己在这三层里注册的东西——
 * `DOMObserver.addWindowListeners()` 的 window resize/beforeprint/scroll +
 * document.selectionchange，`resizeScroll`（一个 `ResizeObserver`）——都在它
 * 自己的 `destroy()`（`removeWindowListeners()`/`resizeScroll.disconnect()`）
 * 里显式清理（node_modules/@codemirror/view/dist/index.js 源码读过），所以
 * 「50 次之后归零」在这三层上是真实、可达的不变量，不是又一次「测不到真东西
 * 的断言」。
 */
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

  // 第二条反空断言，专测编辑器模式：证明 split 挂载确实产生了仪表看得见的东西
  // （上面那条只覆盖了 read，从未证明过编辑器模式下仪表不是恰好全部记零）。
  const beforeEditor = await readLeaks(page)
  const editorId = await page.evaluate(
    (v) => window.readitFixture.mount('a', { value: v, mode: 'split' }),
    DOC,
  )
  await page.waitForFunction(() => document.getElementById('a')?.shadowRoot?.querySelector('.cm-content') != null)
  const duringEditor = await readLeaks(page)
  expect(
    sum(duringEditor),
    'split 模式挂载没有产生任何被仪表看见的监听器或 observer；仪表本身可能不足以覆盖编辑器模式',
  ).toBeGreaterThan(sum(beforeEditor))
  await page.evaluate((h) => { window.readitFixture.destroy(h) }, editorId)

  const baseline = await readLeaks(page)
  await page.evaluate(async (v) => {
    const waitFor = (check: () => boolean, timeoutMs = 5000): Promise<void> =>
      new Promise((resolve) => {
        const start = Date.now()
        const tick = (): void => {
          if (check() || Date.now() - start > timeoutMs) {
            resolve()
            return
          }
          setTimeout(tick, 10)
        }
        tick()
      })
    const modes = ['read', 'split', 'source'] as const
    for (let i = 0; i < 50; i += 1) {
      const mode = modes[i % modes.length]
      const h = window.readitFixture.mount('a', { value: v, mode, theme: 'auto' })
      if (mode !== 'read') {
        await waitFor(() => document.getElementById('a')?.shadowRoot?.querySelector('.cm-content') != null)
      }
      window.readitFixture.destroy(h)
    }
  }, DOC)
  expect(await readLeaks(page)).toEqual(baseline)
})
