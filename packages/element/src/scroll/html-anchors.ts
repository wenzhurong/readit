export const LINE_ATTR = 'data-line'
/** 本文件补上去的锚点，与 Phase A 真发的 data-line 区分开。 */
export const SYNTHETIC_ATTR = 'data-line-synthetic'
/** 数不齐、走了折叠回落的那一段。降级要留痕，L3b 的断言看得见它。 */
export const COLLAPSED_ATTR = 'data-line-collapsed'

export interface HtmlBlock {
  /** 0 基起始行 */
  line: number
  /** 从起始行到下一空行前的最后一行（含内部换行） */
  source: string
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
/**
 * 只认「以开标签起头」。闭标签（</details>）与注释（<!-- -->）产不出顶层
 * 元素，把它们算成候选只会让间隙里的分配整体前移。
 */
const OPEN_TAG = /^ {0,3}<[A-Za-z]/

export function scanHtmlBlocks(src: string): HtmlBlock[] {
  const lines = src.split('\n')
  const out: HtmlBlock[] = []
  let fence: string | null = null
  let prevBlank = true
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const m = FENCE.exec(line)
    const marker = m?.[1]
    if (fence !== null) {
      if (marker !== undefined && marker.charAt(0) === fence.charAt(0) && marker.length >= fence.length) {
        fence = null
      }
      prevBlank = false
      continue
    }
    if (marker !== undefined) {
      fence = marker
      prevBlank = false
      continue
    }
    const blank = line.trim() === ''
    if (prevBlank && !blank && OPEN_TAG.test(line)) {
      let end = i
      while (end + 1 < lines.length && (lines[end + 1] ?? '').trim() !== '') end++
      out.push({ line: i, source: lines.slice(i, end + 1).join('\n') })
    }
    prevBlank = blank
  }
  return out
}

/**
 * 数一段原生 HTML 源码会产出几个顶层元素。
 *
 * 用 DOMParser 而不是给某个真实节点写 innerHTML：解析出来的是一份完全独立、
 * 从未挂上任何文档树的 Document，不发资源请求、不跑脚本——往游离 <div> 或
 * <template> 上写 innerHTML，浏览器仍会去取里面 <img> 的 src，那是一条真实的
 * 出网路径，而这个项目的离线约束不许它存在。
 *
 * 这也是 test/set-html-usage.test.ts 那道「packages/element/src 下只有
 * set-html.ts 能出现 innerHTML=」AST 守卫官方承认测不到、因而特意放行的写法
 * （见该文件头「已知仍然测不到的」一节，点名 `new DOMParser().parseFromString`）：
 * 这里的用途是离线计数，不是把不可信内容渲染进真实可见的 DOM，属于那道守卫
 * 本来就不打算管、也管不到的另一类调用图，不是绕过它的取巧。
 */
function countTopLevelElements(doc: Document, html: string): number {
  const view = doc.defaultView
  if (view === null) return 0
  const parsed = new view.DOMParser().parseFromString(html, 'text/html')
  return parsed.body.children.length
}

function readLine(el: Element): number | null {
  const raw = el.getAttribute(LINE_ATTR)
  if (raw === null) return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/** 顶层节点自己的行号，或它子树里第一个带行号的后代的行号。 */
function anchorLineOf(el: Element): number | null {
  const own = readLine(el)
  if (own !== null) return own
  const inner = el.querySelector(`[${LINE_ATTR}]`)
  return inner === null ? null : readLine(inner)
}

function stamp(el: Element, line: number): void {
  el.setAttribute(LINE_ATTR, String(line))
  el.setAttribute(SYNTHETIC_ATTR, '')
}

function assignRun(doc: Document, run: readonly Element[], gap: readonly HtmlBlock[]): number {
  if (run.length === 0 || gap.length === 0) return 0
  const counts = gap.map((b) => countTopLevelElements(doc, b.source))
  const total = counts.reduce((a, b) => a + b, 0)

  if (total === run.length) {
    let k = 0
    let left = counts[0] ?? 0
    for (const node of run) {
      while (left === 0 && k < gap.length - 1) {
        k++
        left = counts[k] ?? 0
      }
      stamp(node, gap[k]?.line ?? 0)
      left--
    }
    return run.length
  }

  for (const node of run) {
    stamp(node, gap[0]?.line ?? 0)
    node.setAttribute(COLLAPSED_ATTR, '')
  }
  return run.length
}

/**
 * 给缺锚点的顶层节点补 data-line，返回补了几个。
 *
 * 为什么必须在这一侧做：sourceline.ts 会给 html_block token 打 data-line，
 * 但 markdown-it 的 html_block 渲染器只发 token.content、忽略 attrs，那个属性
 * 算出来就被丢掉。改 Phase A 会动 56/68 那条保真度基线，代价远大于收益；
 * 而且原生 HTML 块可能是注释或半截闭标签，根本没有能挂属性的地方。
 *
 * 算法：真锚点把顶层序列切成若干「间隙」，每个间隙里按 scanHtmlBlocks 给出的
 * 块起始行与「该块产几个顶层元素」的计数逐个分配；数不齐就整段折叠到间隙的
 * 第一个块。任何情况下合成的行号都严格落在两个真锚点之间，序列因此单调。
 */
export function synthesizeHtmlAnchors(content: Element, src: string): number {
  const doc = content.ownerDocument
  const known = new Set<number>()
  for (const el of content.querySelectorAll(`[${LINE_ATTR}]`)) {
    const n = readLine(el)
    if (n !== null) known.add(n)
  }

  const blocks = scanHtmlBlocks(src).filter((b) => !known.has(b.line))
  if (blocks.length === 0) return 0

  const tops = [...content.children]
  let stamped = 0
  let i = 0
  let lo = -1
  while (i < tops.length) {
    const here = tops[i]
    if (here === undefined) break
    const line = anchorLineOf(here)
    if (line !== null) {
      lo = line
      i++
      continue
    }
    let j = i
    for (; j < tops.length; j++) {
      const node = tops[j]
      if (node === undefined || anchorLineOf(node) !== null) break
    }
    const nextNode = tops[j]
    const hi = nextNode === undefined ? Number.POSITIVE_INFINITY : (anchorLineOf(nextNode) ?? Number.POSITIVE_INFINITY)
    stamped += assignRun(
      doc,
      tops.slice(i, j),
      blocks.filter((b) => b.line > lo && b.line < hi),
    )
    i = j
  }
  return stamped
}
