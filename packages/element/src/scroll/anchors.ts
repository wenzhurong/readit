import { LINE_ATTR } from './html-anchors.js'

export interface Anchor {
  readonly line: number
  readonly top: number
}

/**
 * 量一个元素在预览滚动容器里的纵向偏移。做成注入的，因为离线单元测试环境
 * 没有排版（offsetTop 恒为 0），而滚动同步的算术必须能离线证伪。
 * 真实实现见 sync.ts 的调用方：`(el) => (el as HTMLElement).offsetTop`。
 */
export type MeasureTop = (el: Element) => number

export function collectAnchors(content: Element, measure: MeasureTop): Anchor[] {
  const raw: Anchor[] = []
  for (const el of content.querySelectorAll(`[${LINE_ATTR}]`)) {
    const n = Number(el.getAttribute(LINE_ATTR))
    if (!Number.isInteger(n) || n < 0) continue
    raw.push({ line: n, top: measure(el) })
  }
  raw.sort((a, b) => a.top - b.top || a.line - b.line)

  const out: Anchor[] = []
  for (const a of raw) {
    const last = out[out.length - 1]
    if (last === undefined) {
      out.push(a)
      continue
    }
    if (a.top === last.top) continue
    // 行号单调不减是这层唯一不可让的性质：一处倒挂会让插值算出负的滚动量。
    out.push({ line: Math.max(a.line, last.line), top: a.top })
  }
  return out
}

/** 源码行 → 预览区滚动偏移。 */
export function lineToTop(
  anchors: readonly Anchor[],
  line: number,
  contentHeight: number,
  lineCount: number,
): number {
  const first = anchors[0]
  const last = anchors[anchors.length - 1]
  if (first === undefined || last === undefined) return 0
  if (line <= first.line) return first.top
  if (line >= last.line) {
    const span = Math.max(lineCount - 1 - last.line, 1)
    const t = Math.min((line - last.line) / span, 1)
    return last.top + t * Math.max(contentHeight - last.top, 0)
  }
  for (let i = 1; i < anchors.length; i++) {
    const b = anchors[i]
    const a = anchors[i - 1]
    if (b === undefined || a === undefined) break
    if (b.line < line) continue
    if (b.line === a.line) return a.top
    const t = (line - a.line) / (b.line - a.line)
    return a.top + t * (b.top - a.top)
  }
  return last.top
}

/** 预览区滚动偏移 → 源码行。lineToTop 的逆。 */
export function topToLine(
  anchors: readonly Anchor[],
  top: number,
  contentHeight: number,
  lineCount: number,
): number {
  const first = anchors[0]
  const last = anchors[anchors.length - 1]
  if (first === undefined || last === undefined) return 0
  if (top <= first.top) return first.line
  if (top >= last.top) {
    const span = Math.max(contentHeight - last.top, 1)
    const t = Math.min((top - last.top) / span, 1)
    return Math.round(last.line + t * Math.max(lineCount - 1 - last.line, 0))
  }
  for (let i = 1; i < anchors.length; i++) {
    const b = anchors[i]
    const a = anchors[i - 1]
    if (b === undefined || a === undefined) break
    if (b.top < top) continue
    if (b.top === a.top) return a.line
    const t = (top - a.top) / (b.top - a.top)
    return Math.round(a.line + t * (b.line - a.line))
  }
  return last.line
}
