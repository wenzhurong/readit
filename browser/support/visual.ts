import { existsSync } from 'node:fs'
import { expect, type Page, type TestInfo } from '@playwright/test'
import type { Shot } from './shots.js'

export const BASELINE_IMAGE = 'mcr.microsoft.com/playwright:v1.62.1-noble'

/** 官方镜像把浏览器装在这里；容器外不存在这个目录。 */
const CONTAINER_MARKER = '/ms-playwright'

/**
 * 写基线这条路必须在容器里。config 把 updateSnapshots 钉成 'none'，所以普通比对
 * 在任何机器上都放行；只有显式 --update-snapshots 才会走到这道闸。
 *
 * 这不是沙箱——存心绕过它很容易。它挡的是「在 macOS 上顺手 -u 了一把、生成一批
 * 用另一套字体栈渲的 PNG、提交、然后 CI 永远红」这条真实发生过无数次的路径。
 */
export function assertBaselineHost(testInfo: TestInfo): void {
  if (testInfo.config.updateSnapshots === 'none') return
  if (process.platform === 'linux' && existsSync(CONTAINER_MARKER)) return
  throw new Error(
    `L4 基线只能在 ${BASELINE_IMAGE} 里生成（SPEC §13）。\n` +
      `当前进程不在该镜像内（platform=${process.platform}）。请跑：npm run visual:baseline`,
  )
}

/** 挂好一条 shot 要的实例，返回该截图的 locator 选择器。 */
export async function loadShot(page: Page, shot: Shot): Promise<string> {
  const markdown = await page.evaluate(
    async (file: string) => await (await fetch(`/content/${file}`)).text(),
    shot.content,
  )

  if (shot.instances === 1) {
    await page.evaluate(
      ([value, theme]) => { window.readitFixture.mount('a', { value, mode: 'read', theme }) },
      [markdown, shot.theme] as const,
    )
    return '#a'
  }

  await page.evaluate((value: string) => {
    const pair = document.getElementById('pair')
    if (pair === null) throw new Error('no #pair')
    pair.style.display = 'flex'
    window.readitFixture.mount('c', { value, mode: 'read', theme: 'light' })
    window.readitFixture.mount('d', { value, mode: 'read', theme: 'dark' })
  }, markdown)
  return '#pair'
}

/**
 * 字体钉住了没有——量宽度，不看 computed 的 font-family 字符串。
 * getComputedStyle().fontFamily 返回的是**声明的整个栈**，"Noto Sans" 本来就在栈里，
 * 拿它做断言无论字体有没有加载都会通过。那是空断言。
 */
export async function assertFontsPinned(page: Page, hostId: string): Promise<void> {
  await page.evaluate(async () => { await document.fonts.ready })

  const m = await page.evaluate((id: string) => {
    const root = document.getElementById(id)?.shadowRoot ?? null
    if (root === null) throw new Error(`no shadow root on #${id}`)
    // 限定在 .markdown-body 内。这条断言的文案说的是「**正文**没有落在自托管的
    // Noto Sans 上」，而裸的 root.querySelector('p') 命中的是 shadow 树里的第一个
    // <p>——实测那是 .readit-error-title（错误面板的标题，界面外壳，不是正文）。
    // 同理 root.querySelector('pre') 会先撞上 .readit-source-fallback，那是编辑器
    // 加载失败时的回落框，也不是代码块。
    //
    // 它此前"通过"是个巧合：外壳元素没有自己的 font-family，一路继承到宿主页面，
    // 而两个视觉夹具页都加载 visual-fonts.css，于是继承下来的正好就是被钉住的字体。
    // D2-20 给 .readit-root 补上 font-family 之后这个巧合断了，断言当场红——
    // 红得对，但红在一个它本来就不该量的元素上。
    // 不是所有 shot 都有段落：code-and-tables 通篇是标题/表格/代码围栏/任务列表，
    // 一个 <p> 都没有。挑第一个真实存在的正文元素，而不是假定段落一定在。
    const para = root.querySelector('.markdown-body p, .markdown-body li, .markdown-body td, .markdown-body h1')
    const pre = root.querySelector('.markdown-body pre')
    if (para === null) throw new Error('渲染结果的 .markdown-body 里没有任何正文元素（p/li/td/h1）')

    // 探针 span 挂在 shadow root 本体上（不进 .readit-root），不挂在 document.body 上。
    // 敌意宿主的 hostile-extra.css 用 `* { font-family: cursive !important }` 通吃
    // light DOM 里的一切元素——包括我们临时插进 document.body 的测量用 span：!important
    // 的作者样式规则压得过内联样式，于是 body/want/other 三个测量值会一起被摁成同一个
    // 值，量出来的差恒为 0，这条断言反而先红在「探针本身失灵」上，量不到真正想测的
    // 东西。挂在 shadow root 上则两头都够不着：light DOM 的 `*` 选择器过不了 shadow
    // 边界，readit 自己 adopt 的样式表也没有裸 <span> 规则，探针因此只反映
    // font-family 这个字符串本身在这个环境里的宽度。
    const width = (family: string): number => {
      const span = document.createElement('span')
      span.textContent = 'MMMMMiiiii 0123456789 the quick brown fox'
      // 除 font-family 外，把所有会影响宽度的继承属性一并钉死。
      //
      // 探针 span 是**故意**挂在 shadow root 本体上、不进 .readit-root 的（理由见上），
      // 代价是它继承的是**宿主元素**的样式——敌意页上那包括 font-style: italic、
      // letter-spacing: 0.35em、word-spacing: 0.5em、text-transform: uppercase、
      // font-variant-numeric: tabular-nums。它们对两次测量本应对称、互相抵消，
      // 但 italic 不对称：'Noto Sans' 的斜体 face 是懒加载的，第一次 width() 调用
      // 触发加载、第二次才拿到真 face，于是同一个族名量出两个宽度。
      //
      // 实测（2026-08-12，本机 chromium，两个宿主页 × 5 张 shot）：
      //   kitchen-sink-*            visual 0    hostile 0       ← 正文本来就有斜体，face 已加载
      //   code-and-tables-*         visual 0    hostile 17.20   ← 正文无斜体
      //   alerts-and-footnotes-*    visual 0    hostile 17.20
      // 容器里同一现象给出 17.484375，与本机的 17.203125 同源、只差字体栅格化。
      //
      // 这条断言要问的是「族名解析到了哪个字体」，不是「宿主漏进来的排版属性是什么」，
      // 所以把后者钉死才是它本来的语义。
      span.style.cssText =
        'position:absolute;left:-9999px;top:0;white-space:pre;font-size:16px;font-weight:400;' +
        'font-style:normal;font-variant-numeric:normal;letter-spacing:normal;word-spacing:normal;' +
        `text-transform:none;font-family:${family}`
      root.appendChild(span)
      const w = span.getBoundingClientRect().width
      span.remove()
      return w
    }

    return {
      bodyUsed: width(getComputedStyle(para).fontFamily),
      bodyWant: width("'Noto Sans'"),
      bodyOther: width('serif'),
      monoUsed: pre === null ? null : width(getComputedStyle(pre).fontFamily),
      monoWant: width("'SFMono-Regular'"),
      monoOther: width('serif'),
    }
  }, hostId)

  expect(Math.abs(m.bodyUsed - m.bodyWant), '正文没有落在自托管的 Noto Sans 上').toBeLessThan(0.5)
  expect(Math.abs(m.bodyUsed - m.bodyOther), '量宽度这套探针本身失灵了').toBeGreaterThan(1)

  if (m.monoUsed !== null) {
    expect(
      Math.abs(m.monoUsed - m.monoWant),
      '围栏代码块没有落在自托管的等宽字体上；很可能是 ::part(code-block) 暴露在了 ' +
        '<pre> 的外层 wrapper 上，而 github-markdown-css 的 .markdown-body pre 又自己设了 ' +
        'font-family，于是从外面继承下来的那一份被顶掉了。把 part 挪到 <pre> 本体上。',
    ).toBeLessThan(0.5)
    expect(Math.abs(m.monoUsed - m.monoOther)).toBeGreaterThan(1)
  }
}

const SAMPLED = [
  'h1', 'h2', 'h3', 'p', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'th', 'td', 'hr', 'a',
] as const

const PROPS = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing',
  // fontVariantNumeric 是 2026-08-12 补的：hostile-extra.css 一直设着
  // `font-variant-numeric: tabular-nums !important`，而这张表漏了它，于是
  // D2-20 被记成「五项继承属性没重置」——实际是六项。计算样式探针看不见的那一项，
  // 截图看得见（code-and-tables 里那个 42 会变成等宽数字）。这张表的广度此前
  // 由写它的人自己选定，而它比敌意表窄；现在 base-css.test.ts 从 hostile-extra.css
  // 反推重置清单，这里补齐只是让两层探测的广度对齐。
  'fontVariantNumeric',
  // tab-size 与 text-size-adjust 是 2026-08-12 由 L4 的逐像素比对逼出来的：
  // 这张表当时是绿的，而像素比对是红的。两者都不在 hostile-extra.css 里——
  // 它们来自 Tailwind Preflight（敌意页加载、干净页不加载），都是继承属性，
  // 照样穿过 shadow 边界。已在 base-css.ts 的 .readit-root 上重置。
  'tabSize', 'textSizeAdjust',
  'textTransform', 'textAlign', 'direction', 'color', 'backgroundColor', 'boxSizing', 'listStyleType',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderLeftWidth', 'borderTopColor', 'borderLeftColor', 'borderRadius',
  'outlineWidth', 'outlineStyle',
] as const

/**
 * 逐条抽 computed style。这是「敌意宿主下渲染不变」在**非像素**层的表述，
 * 所以它跟着 L3b job 在 chromium 与 WebKit 上都跑——L4 因为 ≤12 张的预算只跑 chromium。
 */
export async function sampleComputedStyles(
  page: Page,
  hostId: string,
): Promise<Record<string, Record<string, string>>> {
  return await page.evaluate(
    ([id, tags, props]) => {
      const root = document.getElementById(id)?.shadowRoot ?? null
      if (root === null) throw new Error(`no shadow root on #${id}`)
      const out: Record<string, Record<string, string>> = {}
      for (const tag of tags) {
        const el = root.querySelector(tag)
        if (el === null) continue
        const cs = getComputedStyle(el)
        const one: Record<string, string> = {}
        for (const p of props) one[p] = cs.getPropertyValue(p) || String(Reflect.get(cs, p) ?? '')
        out[tag] = one
      }
      if (Object.keys(out).length === 0) throw new Error('一个采样元素都没命中；渲染可能是空的')
      return out
    },
    [hostId, SAMPLED, PROPS] as const,
  )
}
