import { expect, mountDoc, test, type Page } from '../support/harness.js'

/**
 * 终审复审（D2-2x）：批次 8 重做的诊断（`sanitize-tier2.spec.ts`、
 * `trusted-types.spec.ts` 的 EXTRA_ELEMENTS 那条）对 readit 自己规则产生的
 * 标记覆盖得很好（表格、锚点、alert、任务列表、两种 emoji、数学降级、代码块、
 * 脚注、`<details>`）。但对另一个轴——**用户在 Markdown 里手写的原始 HTML**，
 * 即 Phase A 的 `hast-util-sanitize` 用 `defaultSchema` 放行的 53 个标签
 * （`@readit/core` 的 `sanitize.ts`）——批次 8 只抽样测过 `<details>`/
 * `<summary>` 一对，其余 51 个从未被诊断覆盖过。
 *
 * 这条测试对全部 53 个标签逐一实测：`sanitizeSurvivesTags()`
 * （`browser/fixtures/entry.ts`）用**真实生产配置**的 `setHtml()`
 * （`createSetHtml(readEnv())`，跟 kernel.ts 调用的是同一个函数，不是重新
 * 实现一遍消毒器接线去猜）逐个标签探测，哪一级生效由页面当前真实的
 * `Element.setHTML`/`trustedTypes` 决定——跟 `sanitize-tier2.spec.ts`/
 * `trusted-types.spec.ts` 同一个「Chromium 用 Reflect.deleteProperty 逼走
 * 第 1 级、WebKit 天然选中第 2 级」的做法。
 *
 * 诊断实测发现（完整输出见 final-fix-report.md ②）：第 1 级（浏览器原生
 * Sanitizer）53 个里有 8 个不认识——`details`/`img`/`input`/`summary` 早已在
 * `EXTRA_ELEMENTS` 里，新增的是 `picture`、`source`、`strike`、`tt`（跟本次
 * 终审已经手工核实过的反例逐一对上）。第 2 级（DOMPurify）裸默认配置对全部
 * 53 个标签都认识，不用补——两个发现都已经写进 `set-html.ts` 的
 * `EXTRA_ELEMENTS`/`TIER2_EXTRA_TAGS` 头部注释。
 */
const TAGS_53 = [
  'a', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'details', 'div', 'dl',
  'dt', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input',
  'ins', 'kbd', 'li', 'ol', 'p', 'picture', 'pre', 'q', 'rp', 'rt', 'ruby',
  's', 'samp', 'section', 'source', 'span', 'strike', 'strong', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
  'tt', 'ul', 'var',
] as const

async function survives(page: Page, tags: readonly string[]): Promise<Record<string, boolean>> {
  return await page.evaluate((t) => window.readitFixture.sanitizeSurvivesTags([...t]), tags)
}

test.describe('原始 HTML 53 个标签（hast-util-sanitize defaultSchema.tagNames）逐一存活（D2-2x）', () => {
  test('反空断言：探针本身分辨得出"不在名单里"，不是永远返回 true', async ({ page }) => {
    await page.goto('/host.html')
    const seen = await survives(page, ['not-a-real-tag-xyz'])
    expect(
      seen['not-a-real-tag-xyz'],
      '一个编造的标签名不该在任何一级消毒器下存活；如果这里是 true，说明探针本身坏了',
    ).toBe(false)
  })

  test('第 1 级（浏览器原生 Sanitizer + EXTRA_ELEMENTS）：53 个全部存活', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit 没有原生 setHTML，天然走第 2 级——见下一条')
    await page.goto('/host.html')
    expect(await page.evaluate(() => 'setHTML' in Element.prototype), '前提：这个引擎确实有原生 setHTML').toBe(true)
    const seen = await survives(page, TAGS_53)
    const failing = Object.entries(seen).filter(([, ok]) => !ok).map(([tag]) => tag)
    expect(failing, `第 1 级下没存活的标签：${failing.join(', ')}`).toEqual([])
  })

  test('第 2 级（DOMPurify）：53 个全部存活（Chromium 逼出第 2 级 + WebKit 天然）', async ({ page, browserName }) => {
    if (browserName === 'chromium') {
      // 不删掉的话第 2 级在 Chromium 上永远选不中（它有原生 setHTML）——同
      // sanitize-tier2.spec.ts/trusted-types.spec.ts 的既有做法。
      await page.addInitScript(() => {
        Reflect.deleteProperty(Element.prototype, 'setHTML')
      })
    }
    await page.goto('/host.html')
    expect(await page.evaluate(() => 'setHTML' in Element.prototype), '前提：这个引擎现在没有原生 setHTML，走的是第 2 级').toBe(false)
    const seen = await survives(page, TAGS_53)
    const failing = Object.entries(seen).filter(([, ok]) => !ok).map(([tag]) => tag)
    expect(failing, `第 2 级下没存活的标签：${failing.join(', ')}`).toEqual([])
  })

  /**
   * 上面两条证明「标签本身在场」；这条走完整 mount() → Phase A → setHtml()
   * 管线，用真实 Markdown 里的原始 HTML，确认新覆盖的 4 个标签不但标签在场，
   * 内容与关键属性也没被消毒器连带吞掉——尤其是 `<strike>` 这种「静默 unwrap」
   * 风险最高的场景（终审原文的反例：`<strike>old price</strike>` 一旦被
   * unwrap，删除线消失、文字保留、没有任何可见提示，违反 §12「降级必须
   * 可见」）：这里直接断言标签本身还在，而不只是文字还在。两个引擎各自天然
   * 选中的档位不同（Chromium 第 1 级、WebKit 第 2 级），两边都跑到，端到端
   * 覆盖两条接线各自独立的那一半。
   */
  test('端到端：新覆盖的 4 个标签经完整 mount() 管线仍保留标签本身（不是静默 unwrap 成纯文本）', async ({ page }) => {
    const doc = [
      '<picture><source srcset="./a.png" media="(min-width: 800px)"><img src="./b.png" alt="pic"></picture>',
      '',
      '<strike>old price</strike> <tt>monospace</tt>',
      '',
    ].join('\n')
    await page.goto('/host.html')
    await mountDoc(page, 'a', { value: doc, mode: 'read' })
    const seen = await page.evaluate(() => {
      const root = document.getElementById('a')?.shadowRoot
      if (root === null || root === undefined) throw new Error('no shadow root')
      const picture = root.querySelector('picture')
      const source = root.querySelector('picture source')
      const strike = root.querySelector('strike')
      const tt = root.querySelector('tt')
      return {
        pictureExists: picture !== null,
        sourceExists: source !== null,
        sourceSrcset: source?.getAttribute('srcset') ?? null,
        strikeExists: strike !== null,
        strikeText: strike?.textContent ?? null,
        ttExists: tt !== null,
        ttText: tt?.textContent ?? null,
      }
    })
    expect(seen.pictureExists, '<picture>').toBe(true)
    expect(seen.sourceExists, '<picture> 内的 <source>').toBe(true)
    expect(seen.sourceSrcset, 'source 的 srcset 属性').toBe('./a.png')
    expect(seen.strikeExists, '<strike> 标签本身必须在场，不能被静默 unwrap 成纯文本').toBe(true)
    expect(seen.strikeText).toBe('old price')
    expect(seen.ttExists, '<tt> 标签本身必须在场').toBe(true)
    expect(seen.ttText).toBe('monospace')
  })
})
