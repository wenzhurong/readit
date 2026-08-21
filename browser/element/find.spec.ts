import { expect, test } from '../support/harness.js'

const BASIC = '# Find\n\nAlpha beta alpha.\n'

test.describe('mount().find', () => {
  test('Custom Highlight 主路径不改 shadowRoot.innerHTML，且前后导航有当前项', async ({ page }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    const id = await page.evaluate((value) => window.readitFixture.mount('a', { value, mode: 'read' }), BASIC)
    const before = await page.evaluate(() => document.getElementById('a')?.shadowRoot?.innerHTML)

    const state = await page.evaluate((handle) => {
      const result = window.readitFixture.get(handle).find('alpha')
      const css = CSS as typeof CSS & { highlights: Map<string, Set<AbstractRange>> }
      const all = css.highlights.get('readit-find')
      const current = css.highlights.get('readit-find-current')
      return {
        result,
        supported: 'highlights' in CSS,
        all: all?.size ?? 0,
        current: current?.size ?? 0,
        currentText: current === undefined ? '' : [...current][0]?.toString(),
      }
    }, id)
    const after = await page.evaluate(() => document.getElementById('a')?.shadowRoot?.innerHTML)

    expect(state).toEqual({
      result: { query: 'alpha', total: 2, current: 1 },
      supported: true,
      all: 2,
      current: 1,
      currentText: 'Alpha',
    })
    expect(after).toBe(before)
    expect(await page.evaluate((handle) => window.readitFixture.get(handle).find('alpha'), id)).toEqual({
      query: 'alpha', total: 2, current: 2,
    })
  })

  // 2026-08-17 M6 真机验收：Enter / Shift+Enter / 界面按钮都能移动当前命中，
  // 但视口从不跟随。真引擎实测（无头 WebKit 复现）：
  //
  //   content(.readit-pane-content)  overflowY:auto  scrollHeight 16051 = clientHeight 16051
  //   .readit-root / BODY            visible         16051 = 16051
  //   HTML                           visible         scrollHeight 16051, clientHeight 768  ← 真滚动容器
  //
  // 也就是说自然文档流布局下（桌面壳与本夹具宿主都是这样），面板会撑满内容高度、
  // 根本不是滚动容器，滚的是 document。而 revealRange 既把 scrollTop 写给了它，
  // 又拿它的边界盒当视口去做判据 —— 两个分支都不进，函数什么都不做。
  //
  // 断言写成「命中最终落在视口内」而不是「某个元素的 scrollTop 变了」：前者是用户
  // 能看见的那件事，且不预设哪个元素该滚——正是这个预设导致了缺陷。
  const OFFSCREEN_DOC = `# Find scroll\n\n${Array.from(
    { length: 400 },
    (_, i) => (i === 350 ? `line ${i} UNIQUE_OFFSCREEN_NEEDLE` : `line ${i}`),
  ).join('\n\n')}\n`

  async function needleVisibility(page: import('@playwright/test').Page, id: string) {
    return await page.evaluate((handle) => {
      const result = window.readitFixture.get(handle).find('UNIQUE_OFFSCREEN_NEEDLE')
      const css = CSS as typeof CSS & { highlights: Map<string, Set<AbstractRange>> }
      // CSS.highlights 存的是 AbstractRange；实际放进去的是 Range，只有它有几何。
      const range = [...(css.highlights.get('readit-find-current') ?? [])][0] as Range | undefined
      const rect = range?.getBoundingClientRect()
      if (rect === undefined) return { result, rect: null, visible: false }
      // 视口内：整个命中都在 0..innerHeight 之间。
      // 1px 是亚像素容差，不是放水：revealRange 走的是**最小滚动**语义，命中会正好
      // 贴到视口边缘，于是 bottom 与 innerHeight 只差零点几个像素——Chromium 恰好落在
      // 里面，WebKit 恰好落在外面。容差之外的任何量都会让这条断言重新变红。
      const EPSILON = 1
      const visible = rect.top >= -EPSILON && rect.bottom <= window.innerHeight + EPSILON
      return {
        result,
        rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom) },
        innerHeight: window.innerHeight,
        visible,
      }
    }, id)
  }

  test('阅读模式・页面流布局：首屏外的命中要滚进视野（此时滚的是 document）', async ({ page }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    const id = await page.evaluate(
      (value) => window.readitFixture.mount('a', { value, mode: 'read' }),
      OFFSCREEN_DOC,
    )
    const seen = await needleVisibility(page, id)
    expect(seen.result).toEqual({ query: 'UNIQUE_OFFSCREEN_NEEDLE', total: 1, current: 1 })
    expect(seen).toMatchObject({ visible: true })
  })

  test('阅读模式・受限高度宿主：命中要滚进视野（此时滚的是面板自己）', async ({ page }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    // 给宿主一个确定高度，面板就成了真正的溢出滚动盒——这是另一种配置，
    // 原实现只在这一种下成立。两种都要守住。
    await page.evaluate(() => {
      document.getElementById('a')!.style.height = '300px'
    })
    const id = await page.evaluate(
      (value) => window.readitFixture.mount('a', { value, mode: 'read' }),
      OFFSCREEN_DOC,
    )
    const seen = await needleVisibility(page, id)
    expect(seen.result).toEqual({ query: 'UNIQUE_OFFSCREEN_NEEDLE', total: 1, current: 1 })
    expect(seen).toMatchObject({ visible: true })
  })

  test('源码模式在 CodeMirror 视口外命中，靠文档模型定位并滚动', async ({ page }) => {
    const lines = Array.from({ length: 420 }, (_, index) =>
      index === 370 ? `line ${index} UNIQUE_OFFSCREEN_NEEDLE` : `line ${index}`,
    )
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    await page.evaluate(() => { document.getElementById('a')!.style.height = '220px' })
    const id = await page.evaluate(
      (value) => window.readitFixture.mount('a', { value, mode: 'source' }),
      lines.join('\n'),
    )
    await page.waitForFunction(() => document.querySelector('#a')?.shadowRoot?.querySelector('.cm-editor') !== null)

    const before = await page.evaluate(() => {
      const root = document.getElementById('a')?.shadowRoot
      const scroller = root?.querySelector<HTMLElement>('.cm-scroller')
      return {
        renderedNeedle: root?.querySelector('.cm-content')?.textContent?.includes('UNIQUE_OFFSCREEN_NEEDLE'),
        scrollTop: scroller?.scrollTop ?? -1,
      }
    })
    expect(before.renderedNeedle).toBe(false)
    expect(before.scrollTop).toBe(0)

    expect(await page.evaluate(
      (handle) => window.readitFixture.get(handle).find('UNIQUE_OFFSCREEN_NEEDLE'),
      id,
    )).toEqual({ query: 'UNIQUE_OFFSCREEN_NEEDLE', total: 1, current: 1 })
    await expect.poll(async () => await page.evaluate(() =>
      document.getElementById('a')?.shadowRoot?.querySelector<HTMLElement>('.cm-scroller')?.scrollTop ?? 0,
    )).toBeGreaterThan(0)
  })

  test('删除 CSS.highlights 会逼出可见且可逆的 mark 降级', async ({ page }) => {
    await page.addInitScript(() => {
      Reflect.deleteProperty(CSS, 'highlights')
      Reflect.deleteProperty(window, 'Highlight')
    })
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    const id = await page.evaluate((value) => window.readitFixture.mount('a', { value, mode: 'read' }), BASIC)
    const before = await page.evaluate(() =>
      document.getElementById('a')?.shadowRoot?.querySelector('.markdown-body')?.innerHTML,
    )

    expect(await page.evaluate((handle) => window.readitFixture.get(handle).find('alpha'), id)).toEqual({
      query: 'alpha', total: 2, current: 1,
    })
    const fallback = await page.evaluate(() => {
      const root = document.getElementById('a')?.shadowRoot
      const marks = [...(root?.querySelectorAll<HTMLElement>('mark[data-readit-find]') ?? [])]
      const box = marks[0]?.getBoundingClientRect()
      return {
        supported: 'highlights' in CSS,
        count: marks.length,
        current: root?.querySelectorAll('mark[data-readit-find-current]').length,
        visible: (box?.width ?? 0) > 0 && (box?.height ?? 0) > 0,
      }
    })
    expect(fallback).toEqual({ supported: false, count: 2, current: 1, visible: true })

    await page.evaluate((handle) => window.readitFixture.get(handle).find(''), id)
    expect(await page.evaluate(() =>
      document.getElementById('a')?.shadowRoot?.querySelector('.markdown-body')?.innerHTML,
    )).toBe(before)
  })

  test('无参 find 打开可见的嵌套 UI 并聚焦输入框', async ({ page }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    const id = await page.evaluate((value) => window.readitFixture.mount('a', { value, mode: 'read' }), BASIC)
    await page.evaluate((handle) => window.readitFixture.get(handle).find(), id)

    const ui = await page.evaluate(() => {
      const owner = document.getElementById('a')
      const uiHost = owner?.shadowRoot?.querySelector<HTMLElement>('.readit-find-ui-host')
      const input = uiHost?.shadowRoot?.querySelector<HTMLInputElement>('input')
      const box = uiHost?.getBoundingClientRect()
      return {
        open: owner?.dataset['readitFindOpen'],
        focused: uiHost?.shadowRoot?.activeElement === input,
        visible: (box?.width ?? 0) > 0 && (box?.height ?? 0) > 0,
      }
    })
    expect(ui).toEqual({ open: 'true', focused: true, visible: true })
  })

  test('宿主选择 fixed 后，长文档查找栏在命中滚动期间留在视口且按钮可用', async ({ page }) => {
    const value = Array.from({ length: 260 }, (_, index) =>
      index === 245 ? `paragraph ${index} VIEWPORT_NEEDLE` : `paragraph ${index}`,
    ).join('\n\n')
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    const id = await page.evaluate((source) => {
      const host = document.getElementById('a')!
      host.style.setProperty('--readit-find-position', 'fixed')
      return window.readitFixture.mount('a', { value: source, mode: 'read' })
    }, value)

    await page.evaluate((handle) => window.readitFixture.get(handle).find('VIEWPORT_NEEDLE'), id)
    const before = await page.evaluate(() => {
      const host = document.getElementById('a')!
      const uiHost = host.shadowRoot!.querySelector<HTMLElement>('.readit-find-ui-host')!
      const rect = uiHost.getBoundingClientRect()
      return { top: rect.top, right: rect.right, bottom: rect.bottom, height: innerHeight }
    })
    expect(before.top).toBeGreaterThanOrEqual(0)
    expect(before.bottom).toBeLessThanOrEqual(before.height)

    await page.evaluate(() => {
      const host = document.getElementById('a')!
      const uiHost = host.shadowRoot!.querySelector<HTMLElement>('.readit-find-ui-host')!
      uiHost.shadowRoot!.querySelector<HTMLButtonElement>('[data-find-previous]')!.click()
    })
    expect(await page.evaluate((handle) => window.readitFixture.get(handle).find(), id)).toEqual({
      query: 'VIEWPORT_NEEDLE', total: 1, current: 1,
    })
  })

  test('Mermaid 水合后活动查询改绑到新 SVG 文本节点', async ({ page }) => {
    const markdown = '```mermaid\nflowchart LR\nA[Markdown source] --> B[Safe SVG]\n```\n'
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    const id = await page.evaluate(
      (value) => window.readitFixture.mountWithMermaid('a', { value, mode: 'read' }),
      markdown,
    )
    expect(await page.evaluate((handle) => window.readitFixture.get(handle).find('Markdown source'), id)).toEqual({
      query: 'Markdown source', total: 1, current: 1,
    })
    await page.waitForFunction(() =>
      document.getElementById('a')?.shadowRoot
        ?.querySelector('.highlight-source-mermaid')
        ?.getAttribute('data-readit-mermaid-state') === 'ready',
    )

    const rebound = await page.evaluate(() => {
      const css = CSS as typeof CSS & { highlights: Map<string, Set<Range>> }
      const ranges = [...(css.highlights.get('readit-find') ?? [])]
      return {
        count: ranges.length,
        text: ranges[0]?.toString(),
        connected: ranges[0]?.startContainer.isConnected,
      }
    })
    expect(rebound).toEqual({ count: 1, text: 'Markdown source', connected: true })
  })
})
