import type { Mode } from 'readit/element'

export interface EditShortcutHandlers {
  setMode(mode: Extract<Mode, 'read' | 'source' | 'split'>): void
  save(): void
}

/** Windows-only at the call site; macOS gets the same commands from the native menu. */
export function connectEditShortcuts(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  handlers: EditShortcutHandlers,
): () => void {
  const onKeyDown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent) || event.defaultPrevented || event.repeat) return
    if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return
    const action = event.key.toLowerCase()
    const mode = action === '1' ? 'read' : action === '2' ? 'source' : action === '3' ? 'split' : null
    if (mode !== null) {
      event.preventDefault()
      handlers.setMode(mode)
      return
    }
    if (action === 's') {
      event.preventDefault()
      handlers.save()
    }
  }
  target.addEventListener('keydown', onKeyDown, { capture: true })
  return () => target.removeEventListener('keydown', onKeyDown, { capture: true })
}
