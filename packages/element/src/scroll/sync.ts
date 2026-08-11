import { collectAnchors, lineToTop, topToLine, type Anchor, type MeasureTop } from './anchors.js'

/**
 * 滚动同步只需要编辑器的两个方法。结构化地声明它，而不是
 * `import type { Editor } from '@readit/editor'`——P1 给 element → editor
 * 留的只有动态 import 一条边，这里不必为了两个方法去加一条静态边。
 * @readit/editor 的 Editor 在结构上满足它。
 */
export interface ScrollSource {
  topLine(): number
  scrollToLine(line: number): void
}

export interface ScrollSyncOptions {
  source: ScrollSource
  /** 预览侧的滚动容器。 */
  preview: HTMLElement
  /** 预览内容根，锚点都在它的子树里。 */
  content: Element
  measure: MeasureTop
  contentHeight(): number
  lineCount(): number
}

export interface ScrollSync {
  /** 编辑器滚到了 topLine，把预览推过去。 */
  fromEditor(topLine: number): void
  /** 预览被滚了，把编辑器推过去。 */
  fromPreview(): void
  /** 内容重渲后作废锚点缓存。 */
  invalidate(): void
  destroy(): void
}

export function createScrollSync(opts: ScrollSyncOptions): ScrollSync {
  let cache: Anchor[] | null = null
  let destroyed = false
  /**
   * 反自激不用定时器也不用标志位，用「记住自己刚推出去的值」：
   * 滚动事件是异步的，同步开关关不住它；而由我们造成的那一次事件，
   * 带回来的值一定等于我们刚写进去的值。
   */
  let pushedToPreview: number | null = null
  let pushedToEditor: number | null = null

  const anchors = (): Anchor[] => {
    cache ??= collectAnchors(opts.content, opts.measure)
    return cache
  }

  return {
    fromEditor(topLine) {
      if (destroyed) return
      if (pushedToEditor !== null && pushedToEditor === topLine) {
        pushedToEditor = null
        return
      }
      const top = lineToTop(anchors(), topLine, opts.contentHeight(), opts.lineCount())
      pushedToPreview = top
      opts.preview.scrollTop = top
    },
    fromPreview() {
      if (destroyed) return
      const top = opts.preview.scrollTop
      if (pushedToPreview !== null && pushedToPreview === top) {
        pushedToPreview = null
        return
      }
      const line = topToLine(anchors(), top, opts.contentHeight(), opts.lineCount())
      pushedToEditor = line
      opts.source.scrollToLine(line)
    },
    invalidate() {
      cache = null
    },
    destroy() {
      destroyed = true
      cache = null
    },
  }
}
