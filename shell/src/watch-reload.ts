export interface WatchedDocumentChange {
  readonly path: string
}

export interface WatchedDocumentReloader {
  handle(change: WatchedDocumentChange): void
  destroy(): void
}

export function createWatchedDocumentReloader(
  currentPath: () => string | null,
  reload: (path: string) => Promise<void>,
  reportError: (error: unknown) => void,
  delayMs = 80,
): WatchedDocumentReloader {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingPath: string | null = null

  return {
    handle(change): void {
      if (change.path !== currentPath()) return
      pendingPath = change.path
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        const path = pendingPath
        timer = null
        pendingPath = null
        if (path === null || path !== currentPath()) return
        void reload(path).catch(reportError)
      }, delayMs)
    },

    destroy(): void {
      if (timer !== null) clearTimeout(timer)
      timer = null
      pendingPath = null
    },
  }
}
