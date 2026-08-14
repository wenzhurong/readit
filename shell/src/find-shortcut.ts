export interface FindShortcutHandle {
  find(): unknown
}

/**
 * ⚠️ **macOS 专用的和弦。** 这里硬编码 Meta+F 并显式排除 Ctrl，是因为当前壳只交付 macOS
 * （Windows 侧已被用户推迟）。做 Windows 时这里要分平台，而且不是简单换成 Ctrl+F：
 * SPEC §11.3 第 8 点写明 **Ctrl+F 会被 WebView2 的内置查找栏吃掉**（那个栏本身是好用的、
 * 也认 shadow DOM），所以届时要在「让原生栏赢」和「让壳禁用浏览器加速键」之间选，
 * 而后者需要 wry 层补丁——Tauri 已不再导出 `browser_accelerator_keys`。
 */
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
