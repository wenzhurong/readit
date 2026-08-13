import { expect, test, type Page } from '../support/harness.js'

const VALID = [
  '```mermaid',
  'flowchart LR',
  '  A[Source] --> B{Render?}',
  '  B -->|yes| C[Safe SVG]',
  '  B -->|no| D[Readable fallback]',
  '```',
  '',
].join('\n')

async function mountMermaid(page: Page, value: string): Promise<string> {
  return await page.evaluate(
    (markdown) => window.readitFixture.mountWithMermaid('a', { value: markdown, mode: 'read' }),
    value,
  )
}

test.describe('Mermaid hydration', () => {
  test('lazy chunk 到货后在 shadow root 内生成可见 SVG 并执行 bindFunctions', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    await mountMermaid(page, VALID)

    await page.waitForFunction(() =>
      document.getElementById('a')?.shadowRoot
        ?.querySelector('.highlight-source-mermaid')
        ?.getAttribute('data-readit-mermaid-state') === 'ready',
    )
    const structure = await page.evaluate(() => {
      const host = document.getElementById('a')
      const root = host?.shadowRoot
      const diagram = root?.querySelector<HTMLElement>('.highlight-source-mermaid') ?? null
      const svg = diagram?.querySelector<SVGSVGElement>('svg') ?? null
      const box = svg?.getBoundingClientRect()
      return {
        pending: host?.getAttribute('data-readit-pending'),
        state: diagram?.dataset['readitMermaidState'],
        bound: diagram?.dataset['readitMermaidBound'],
        part: diagram?.getAttribute('part'),
        svgCount: diagram?.querySelectorAll('svg').length ?? 0,
        nodeCount: diagram?.querySelectorAll('g.node').length ?? 0,
        nodeLabels: [...(diagram?.querySelectorAll<SVGGElement>('g.node') ?? [])]
          .map((node) => node.textContent?.trim() ?? ''),
        edgeCount: diagram?.querySelectorAll('path.flowchart-link').length ?? 0,
        width: box?.width ?? 0,
        height: box?.height ?? 0,
        sourceStillPresent: diagram?.querySelector('pre') !== null,
      }
    })

    expect(structure).toMatchObject({
      pending: null,
      state: 'ready',
      bound: 'true',
      part: 'mermaid',
      svgCount: 1,
      sourceStillPresent: false,
    })
    expect(structure.nodeCount).toBeGreaterThanOrEqual(4)
    expect(structure.nodeLabels).toEqual(['Source', 'Render?', 'Safe SVG', 'Readable fallback'])
    expect(structure.edgeCount).toBeGreaterThanOrEqual(3)
    expect(structure.width).toBeGreaterThan(100)
    expect(structure.height).toBeGreaterThan(50)
    expect(pageErrors).toEqual([])
  })

  test('真截断 Mermaid chunk 时 Phase A 源码与 pending 可见，组件仍可用', async ({ page }) => {
    let blockedChunks = 0
    await page.route('**/load-mermaid-*.js', (route) => {
      blockedChunks += 1
      return route.abort()
    })
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    const id = await mountMermaid(page, VALID)
    await page.waitForFunction(() => document.getElementById('a')?.dataset['readitPending'] === 'mermaid')

    const fallback = await page.evaluate(() => {
      const diagram = document.getElementById('a')?.shadowRoot
        ?.querySelector<HTMLElement>('.highlight-source-mermaid') ?? null
      const pre = diagram?.querySelector('pre') ?? null
      const box = pre?.getBoundingClientRect()
      return {
        source: pre?.textContent,
        svg: diagram?.querySelector('svg') !== null,
        width: box?.width ?? 0,
        height: box?.height ?? 0,
      }
    })
    expect(blockedChunks).toBe(1)
    expect(fallback.source).toContain('flowchart LR')
    expect(fallback.svg).toBe(false)
    expect(fallback.width).toBeGreaterThan(100)
    expect(fallback.height).toBeGreaterThan(20)

    const next = '# Still alive\n'
    await page.evaluate(([handle, value]) => window.readitFixture.get(handle).setValue(value), [id, next] as const)
    expect(await page.evaluate((handle) => window.readitFixture.get(handle).getValue(), id)).toBe(next)
    expect(await page.evaluate(() =>
      document.getElementById('a')?.shadowRoot?.querySelector('h1')?.textContent,
    )).toBe('Still alive')
  })

  test('语法错误显示具名错误态与原始源码，不产生未捕获异常', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    await mountMermaid(page, '```mermaid\nflowchart LR\nA[[[ --> ???\n```\n')
    await page.waitForFunction(() =>
      document.getElementById('a')?.shadowRoot
        ?.querySelector('.highlight-source-mermaid')
        ?.getAttribute('data-readit-mermaid-state') === 'error',
    )

    const state = await page.evaluate(() => {
      const diagram = document.getElementById('a')?.shadowRoot
        ?.querySelector<HTMLElement>('.highlight-source-mermaid') ?? null
      const alert = diagram?.querySelector<HTMLElement>('.readit-mermaid-error') ?? null
      const box = alert?.getBoundingClientRect()
      return {
        source: diagram?.querySelector('pre')?.textContent,
        role: alert?.getAttribute('role'),
        message: alert?.textContent,
        visible: (box?.width ?? 0) > 0 && (box?.height ?? 0) > 0,
        pending: document.getElementById('a')?.getAttribute('data-readit-pending'),
      }
    })
    expect(state.source).toContain('A[[[ --> ???')
    expect(state.role).toBe('alert')
    expect(state.message).toContain('Mermaid 图表无法渲染')
    expect(state.visible).toBe(true)
    expect(state.pending).toBeNull()
    expect(pageErrors).toEqual([])
  })
})
