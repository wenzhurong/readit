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

test('#slug 由元素自己搭桥，不动 document 的 fragment', async ({ page, browserName }) => {
  // 已知缺陷（L3b-element 发现，非本任务范围，见 batch-5-report.md「Trusted Types /
  // Sanitizer 发现」一节）：packages/element/src/set-html.ts 的第 1 级把 HTML 交给
  // 浏览器原生 Element.setHTML()，但没有传 sanitizer 配置——浏览器落到自己的默认
  // Sanitizer 允许名单，那份名单**不认识 `id` 属性**（也不认识 `class`/`data-*`/
  // `<img>`/`<input>` 等 Phase A 的 hast-util-sanitize 明确放行的东西）。于是标题旁
  // GitHub 形状的 `id="user-content-…"` 铆点在写入真实 DOM 的这一步被剥掉，#slug 桥接
  // 拿不到目标元素。实测（本文件撰写时）Chromium 151 与 Firefox 153 都已实现原生
  // setHTML()，只有 WebKit 还没有——WebKit 落到第 2 级 Trusted Types/DOMPurify，
  // 默认允许名单宽松得多，不受影响。这也是为什么 packages/element/test/navigate.test.ts
  // （happy-dom，三个引擎都没有 setHTML）测不出来：happy-dom 走的是第 3 级 innerHTML。
  test.fail(browserName !== 'webkit', '已知缺陷：Chromium/Firefox 的 Element.setHTML() 默认 Sanitizer 剥掉了 id 属性，需要 element 一侧显式传 sanitizer 配置修复，不在本批范围内')

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

test('外部 http(s) 链接不被拦截，且带 GitHub 形状的 rel 与 target=_blank', async ({ page, browserName }) => {
  // 同上一条测试的已知缺陷：core 的 rawshape.ts 在 sanitize 之后把 rel="nofollow" 重新
  // 写回了 HTML 字符串，但原生 setHTML() 的默认 Sanitizer 不认识 <a> 的 rel 属性
  // （只放行 href/hreflang/type），把它连同 id 一起剥掉。navigate.ts 的 decorateLinks()
  // 是在 DOM 节点上事后 setAttribute('rel', …)，只能在「剥剩的」rel 基础上追加
  // noopener/noreferrer，补不回已经丢失的 nofollow。target=_blank 同样是 decorateLinks()
  // 事后写的，不受影响，所以只有 rel 这一条会红。WebKit 没有原生 setHTML()，不受影响。
  test.fail(browserName !== 'webkit', '已知缺陷：Chromium/Firefox 的 Element.setHTML() 默认 Sanitizer 剥掉了 <a> 的 rel 属性，需要 element 一侧显式传 sanitizer 配置修复，不在本批范围内')

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
