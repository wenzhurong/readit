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
