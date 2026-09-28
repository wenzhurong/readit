export interface TabShortcutHandlers {
  next(): void
  previous(): void
}

/** Ctrl+Tab / Ctrl+Shift+Tab 切标签，两个平台一样（macOS 上 ⌘ 不参与，⌘Tab 归系统）。 */
export function connectTabShortcuts(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  handlers: TabShortcutHandlers,
): () => void {
  const onKeyDown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent) || event.defaultPrevented) return
    if (event.key !== 'Tab' || !event.ctrlKey || event.metaKey || event.altKey) return
    event.preventDefault()
    if (event.shiftKey) handlers.previous()
    else handlers.next()
  }
  target.addEventListener('keydown', onKeyDown, { capture: true })
  return () => target.removeEventListener('keydown', onKeyDown, { capture: true })
}
