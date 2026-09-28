export interface WatchedDocumentChange {
  readonly generation: number
  readonly path: string
}

export interface WatchedDocumentReloader {
  handle(change: Pick<WatchedDocumentChange, 'generation'>): void
  destroy(): void
}

/**
 * 外部修改的去抖。按 generation 认文档，不按路径：多标签下同一个文件可以开在两个标签里
 * （多标签设计 D5），各自的 generation 不同；标签内跳转之后，晚到的旧 generation 事件也
 * 会被这里挡掉。
 */
export function createWatchedDocumentReloader(
  currentGeneration: () => number | null,
  reload: (generation: number) => Promise<void>,
  reportError: (error: unknown) => void,
  delayMs = 80,
): WatchedDocumentReloader {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingGeneration: number | null = null

  return {
    handle(change): void {
      if (change.generation !== currentGeneration()) return
      pendingGeneration = change.generation
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        const generation = pendingGeneration
        timer = null
        pendingGeneration = null
        if (generation === null || generation !== currentGeneration()) return
        void reload(generation).catch(reportError)
      }, delayMs)
    },

    destroy(): void {
      if (timer !== null) clearTimeout(timer)
      timer = null
      pendingGeneration = null
    },
  }
}
