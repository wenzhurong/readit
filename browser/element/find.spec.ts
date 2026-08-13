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
