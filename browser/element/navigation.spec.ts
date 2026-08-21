import { expect, mountDoc, test } from '../support/harness.js'

const FILLER = Array.from({ length: 80 }, (_, i) => `Filler paragraph number ${i}.`).join('\n\n')
const DOC = `[jump](#hello-world)\n\n${FILLER}\n\n# Hello World\n\nlanded\n`

test('相对 .md 链接被拦下并通过 onNavigate 上报', async ({ page }) => {
  await page.goto('/host.html')
  await mountDoc(page, 'a', { value: '[next](./other.md)\n', mode: 'read', baseUrl: '/docs/index.md' })

  const before = page.url()
  await page.evaluate(() => {
    const link = document.getElementById('a')?.shadowRoot?.querySelector('a')
    if (!(link instanceof HTMLAnchorElement)) throw new Error('no anchor rendered')
    link.click()
  })
  // resolveRelative('/docs/index.md', './other.md') 按 RFC 3986 §5.3 合并成 '/docs/other.md'
  // （baseDir 取到最后一个 '/' 为止，再拼相对段）——不是原样保留 './other.md'。
  // 与 packages/element/test/navigate.test.ts 里同一算法在 'docs/README.md' 基上的断言
  // （'docs/other.md'）同构，只是这里的 baseUrl 多了个前导 '/'。
  expect(await page.evaluate(() => window.readitFixture.navigations)).toEqual(['/docs/other.md'])
  expect(page.url()).toBe(before)
})

test('点击普通正文后 Alt+Left 能驱动组件历史，而不要求全局键盘监听', async ({ page }) => {
  await page.goto('/host.html')
  await page.waitForFunction(() => window.readitFixture !== undefined)
  await mountDoc(page, 'a', {
    value: '[next](./other.md)\n\nordinary paragraph\n',
    mode: 'read',
    baseUrl: 'docs/index.md',
  })
  await page.locator('#a a').click()
  await page.getByText('ordinary paragraph', { exact: true }).click()
  await page.keyboard.press('Alt+ArrowLeft')

  expect(await page.evaluate(() => window.readitFixture.navigations)).toEqual([
    'docs/other.md',
    'docs/index.md',
  ])
})

test('#slug 由元素自己搭桥，不动 document 的 fragment', async ({ page }) => {
  // 曾经的已知缺陷，已在本批修复：packages/element/src/set-html.ts 第 1 级原来
  // 把 HTML 交给浏览器原生 Element.setHTML() 却不传 sanitizer 配置，落到浏览器
  // 自己的默认允许名单——那份名单不认识 id 属性，标题旁 GitHub 形状的
  // `id="user-content-…"` 铆点会在写入真实 DOM 这一步被剥掉，Chromium/Firefox 上
  // #slug 桥接直接失效（WebKit 走第 2 级 Trusted Types/DOMPurify，默认名单宽松
  // 得多，从未受影响）。set-html.ts 现在给第 1 级配了一份「浏览器默认 + Phase A
  // 实测需要的补丁」的 Sanitizer（buildTier1Sanitizer()）。「修复前会红」不是
  // 推测：批次 5 报告记录了两次真实运行——固定这份测试代码不变，只把
  // set-html.ts 换成修复前的版本重跑，Chromium/Firefox 上真的红（缺 #user-content-
  // hello-world 这个锚点）；换回修复后的版本，同一份测试代码三个引擎都真的绿。
  await page.goto('/host.html')
  await mountDoc(page, 'a', { value: DOC, mode: 'read' })

  const topOf = async (): Promise<number> =>
    await page.evaluate(() => {
      const target = document.getElementById('a')?.shadowRoot?.querySelector('#user-content-hello-world')
      if (target === null || target === undefined) throw new Error('GitHub 形状的锚点 #user-content-hello-world 不存在')
      return target.getBoundingClientRect().top
    })

  const start = await topOf()
  await page.evaluate(() => {
    const link = document.getElementById('a')?.shadowRoot?.querySelector('a[href="#hello-world"]')
    if (!(link instanceof HTMLAnchorElement)) throw new Error('no #hello-world anchor')
    link.click()
  })
  await page.waitForFunction(
    (from: number) => {
      const t = document.getElementById('a')?.shadowRoot?.querySelector('#user-content-hello-world')
      return t !== null && t !== undefined && t.getBoundingClientRect().top < from - 50
    },
    start,
  )
  // fragment 本来就不跨 shadow 边界；如果 location.hash 变了，说明桥没搭，是浏览器在兜底。
  expect(await page.evaluate(() => window.location.hash)).toBe('')
  expect(await page.evaluate(() => window.readitFixture.navigations)).toEqual([])
})

test('外部 http(s) 链接不被拦截，且带 GitHub 形状的 rel 与 target=_blank', async ({ page }) => {
  // 同上一条测试，曾经的已知缺陷、已在本批修复：core 的 rawshape.ts 在 sanitize
  // 之后把 rel="nofollow" 重新写回了 HTML 字符串，但原来第 1 级的默认 Sanitizer
  // 不认识 <a> 的 rel 属性（只放行 href/hreflang/type），把它连同 id 一起剥掉。
  // navigate.ts 的 decorateLinks() 是在 DOM 节点上事后 setAttribute('rel', …)，
  // 曾经只能在「剥剩的」rel 基础上追加 noopener/noreferrer，补不回已经丢失的
  // nofollow。set-html.ts 的 EXTRA_ATTRIBUTES 现在显式放行了 rel，三个引擎都验证过。
  await page.goto('/host.html')
  await mountDoc(page, 'a', { value: '[ext](https://example.com/)\n', mode: 'read' })

  const attrs = await page.evaluate(() => {
    const link = document.getElementById('a')?.shadowRoot?.querySelector('a')
    if (!(link instanceof HTMLAnchorElement)) throw new Error('no anchor rendered')
    return { href: link.getAttribute('href'), rel: link.getAttribute('rel'), target: link.getAttribute('target') }
  })
  expect(attrs.href).toBe('https://example.com/')
  // navigate.ts 的 decorateLinks()：外链一律补 target="_blank"，并在既有 rel（core 渲染
  // 阶段已给非 GitHub 外链设的 "nofollow"）基础上追加 noopener/noreferrer——不是整个覆盖掉。
  // 这与既有单元测试 packages/element/test/navigate.test.ts:148-152 的断言同源。
  expect(attrs.rel?.split(' ').sort()).toEqual(['nofollow', 'noopener', 'noreferrer'])
  expect(attrs.target).toBe('_blank')
  expect(await page.evaluate(() => window.readitFixture.navigations)).toEqual([])
})
