import type { Editor, EditorOptions } from './types.js'

/**
 * 软换行会让「视觉行」与「源码行」不再一一对应，而 topLine()/scrollToLine()
 * 的契约说的是**源码行**。plain 档因此强制 wrap="off"：这不是样式偏好，
 * 是让滚动同步在这一档有定义。CodeMirror 档不需要这条——它的 posAtCoords()
 * 把视觉坐标映回文档位置，软换行不影响行号。
 */
const WRAP = 'off'

/**
 * getComputedStyle(...).lineHeight 有两种拿不到数字的情况：值是 'normal'，
 * 或宿主环境根本没有排版（离线单元测试）。这时用常量兜底，让 topLine()
 * 仍然是确定的全序函数，而不是 NaN。
 */
export const FALLBACK_LINE_HEIGHT = 20

/** 纯函数，供离线单元测试直接钉住行数学。 */
export function topLineFromScroll(scrollTop: number, lineHeight: number, lineCount: number): number {
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return 0
  if (!Number.isFinite(scrollTop)) return 0
  const raw = Math.floor(scrollTop / lineHeight)
  const max = Math.max(lineCount - 1, 0)
  return Math.min(Math.max(raw, 0), max)
}

export function createPlainEditor(opts: EditorOptions): Editor {
  const doc = opts.parent.ownerDocument
  const ta = doc.createElement('textarea')
  ta.className = 'readit-plain-editor'
  ta.setAttribute('wrap', WRAP)
  ta.spellcheck = false
  ta.value = opts.value
  opts.parent.append(ta)

  let composing = false
  let deferred: string | null = null
  let destroyed = false

  const lineCount = (): number => ta.value.split('\n').length

  const lineHeight = (): number => {
    const view = doc.defaultView
    if (view === null) return FALLBACK_LINE_HEIGHT
    const parsed = Number.parseFloat(view.getComputedStyle(ta).lineHeight)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_LINE_HEIGHT
  }

  const currentTopLine = (): number => topLineFromScroll(ta.scrollTop, lineHeight(), lineCount())

  const onInput = (): void => {
    opts.onChange(ta.value)
  }
  const onScrollEvent = (): void => {
    opts.onScroll(currentTopLine())
  }
  const onCompositionStart = (): void => {
    composing = true
  }
  const onCompositionEnd = (): void => {
    composing = false
    if (deferred !== null) {
      ta.value = deferred
      deferred = null
    }
  }

  ta.addEventListener('input', onInput)
  ta.addEventListener('scroll', onScrollEvent)
  ta.addEventListener('compositionstart', onCompositionStart)
  ta.addEventListener('compositionend', onCompositionEnd)

  return {
    setValue(value) {
      // 组合期间写 textarea.value 会把输入法的预编辑串连同状态一起冲掉。
      // 攒着，compositionend 再落地——丢弃比推迟更糟，那是静默的数据丢失。
      if (composing) {
        deferred = value
        return
      }
      if (ta.value !== value) ta.value = value
    },
    getValue() {
      return ta.value
    },
    focus() {
      ta.focus()
    },
    topLine() {
      return currentTopLine()
    },
    scrollToLine(line) {
      const clamped = Math.min(Math.max(line, 0), Math.max(lineCount() - 1, 0))
      ta.scrollTop = clamped * lineHeight()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      ta.removeEventListener('input', onInput)
      ta.removeEventListener('scroll', onScrollEvent)
      ta.removeEventListener('compositionstart', onCompositionStart)
      ta.removeEventListener('compositionend', onCompositionEnd)
      ta.remove()
    },
  }
}
