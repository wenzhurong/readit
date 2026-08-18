import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { detectLineEnding, withLineEnding, type LineEnding } from './line-endings.js'
import type { Editor, EditorOptions } from './types.js'

/**
 * 首个可见源码行。走 posAtCoords 而不是「scrollTop / 行高」：CodeMirror 的
 * 视口是虚拟化的，行高也不是常数（软换行、行内 widget），只有把视觉坐标交回
 * 给它、让它映射成文档位置才是对的。这也是 plain 档必须关软换行、而这一档
 * 不必的原因。
 */
function topLineOf(view: EditorView): number {
  const rect = view.scrollDOM.getBoundingClientRect()
  const pos = view.posAtCoords({ x: rect.left + 1, y: rect.top + 1 }, false)
  return view.state.doc.lineAt(pos).number - 1
}

export function createCodeMirrorEditor(opts: EditorOptions): Editor {
  let applying = false
  let deferred: string | null = null
  let destroyed = false
  // 文档内部一律以 LF 存放，行尾只在出口还原。见 line-endings.ts 的模块注释。
  let ending: LineEnding = detectLineEnding(opts.value)

  const view: EditorView = new EditorView({
    parent: opts.parent,
    // 官方支持 ShadowRoot；new EditorView({parent}) 本来也会自行推断，
    // 这里显式传是因为 P2 的 EditorOptions 里有它，别让两条信息各说各话。
    root: opts.root,
    state: EditorState.create({
      doc: withLineEnding(opts.value, '\n'),
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          // applying 为真时这次变更是 setValue 自己派的，不是用户输入。
          if (update.docChanged && !applying) opts.onChange(readValue())
        }),
        EditorView.domEventHandlers({
          scroll: () => {
            if (!destroyed) opts.onScroll(topLineOf(view))
          },
        }),
      ],
    }),
  })

  const readValue = (): string => withLineEnding(view.state.doc.toString(), ending)

  const applyDeferred = (): void => {
    if (deferred === null || view.composing) return
    const next = deferred
    deferred = null
    adopt(next)
  }

  // 换整份文档时行尾跟着这份新内容走：宿主可能拿磁盘上的另一版本覆盖当前文档
  // （桌面壳的「使用磁盘版本」），那一版的行尾未必与载入时相同。
  const adopt = (value: string): void => {
    ending = detectLineEnding(value)
    write(withLineEnding(value, '\n'))
  }

  const write = (value: string): void => {
    if (view.state.doc.toString() === value) return
    applying = true
    try {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    } finally {
      applying = false
    }
  }

  // view.composing 只在组合进行中为真；compositionend 之后把攒下的写入放行。
  view.contentDOM.addEventListener('compositionend', applyDeferred)

  return {
    setValue(value) {
      if (destroyed) return
      if (view.composing) {
        // 连行尾一起推迟：组合期间只记原始内容，compositionend 时才一并采纳，
        // 否则组合过程中的 getValue() 会拿旧正文配新行尾。
        deferred = value
        return
      }
      adopt(value)
    },
    getValue() {
      return readValue()
    },
    focus() {
      view.focus()
    },
    topLine() {
      return topLineOf(view)
    },
    scrollToLine(line) {
      const n = Math.min(Math.max(line + 1, 1), view.state.doc.lines)
      const info = view.state.doc.line(n)
      view.dispatch({ effects: EditorView.scrollIntoView(info.from, { y: 'start' }) })
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      view.contentDOM.removeEventListener('compositionend', applyDeferred)
      view.destroy()
    },
  }
}
