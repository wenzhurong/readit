/** Convert native Windows paths into the slash form used by the web navigation model. */
export function normalizeDocumentPath(path: string): string {
  if (path.startsWith('\\\\?\\UNC\\')) return `\\\\${path.slice(8)}`
  const withoutExtendedPrefix = path.startsWith('\\\\?\\') ? path.slice(4) : path
  return withoutExtendedPrefix.replaceAll('\\', '/')
}

export function documentFileName(path: string): string {
  const parts = normalizeDocumentPath(path).split(/[\\/]/)
  return parts.pop() || 'readit'
}

/**
 * 原生窗口标题。
 *
 * ⚠️ 只设 `document.title` 在桌面壳里是**看不见**的：Tauri 的原生窗口标题不跟随
 * webview 的文档标题，必须显式调 `setTitle()`。2026-08-18 真机实测，打开文档与编辑
 * 变脏之后标题栏都一直是「readit」，文件名与 ● 脏标记从来没出现过——而 M6 手工验收
 * 第 7 项操作 A 明写「编辑后标题出现 `●`」。
 */
export function documentWindowTitle(path: string | null, dirty: boolean): string {
  if (path === null) return 'readit'
  return `${dirty ? '● ' : ''}${documentFileName(path)} — readit`
}
