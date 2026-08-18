export interface FindShortcutHandle {
  find(): unknown
}

export type FindShortcutPlatform = 'macos' | 'windows'

function detectShortcutPlatform(view: Window): FindShortcutPlatform {
  return /^(Mac|iPhone|iPad)/.test(view.navigator.platform) ? 'macos' : 'windows'
}

/**
 * The native layer disables WebView2 browser accelerators on Windows so this capture listener
 * can make the document-model finder the sole owner of Control+F. macOS keeps its existing
 * Meta+F chord, including the explicit Control exclusion.
 */
export function connectFindShortcut(
  view: Window,
  currentHandle: () => FindShortcutHandle | null,
  platform: FindShortcutPlatform = detectShortcutPlatform(view),
): () => void {
  const onKeydown = (event: KeyboardEvent): void => {
    const hasPlatformModifier =
      platform === 'macos'
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey
    if (
      event.key.toLowerCase() !== 'f' ||
      !hasPlatformModifier ||
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
