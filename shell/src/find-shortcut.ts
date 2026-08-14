export interface FindShortcutHandle {
  find(): unknown
}

export function connectFindShortcut(
  view: Window,
  currentHandle: () => FindShortcutHandle | null,
): () => void {
  const onKeydown = (event: KeyboardEvent): void => {
    if (
      event.key.toLowerCase() !== 'f' ||
      !event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    ) {
      return
    }
    const handle = currentHandle()
    if (handle === null) return

    // Window capture runs before the event reaches the element's Shadow DOM
    // or CodeMirror. This makes the document-model finder the sole Cmd+F owner.
    event.preventDefault()
    event.stopPropagation()
    handle.find()
  }

  view.addEventListener('keydown', onKeydown, true)
  return () => view.removeEventListener('keydown', onKeydown, true)
}
