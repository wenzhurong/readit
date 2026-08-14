const PROTOCOL_BASE = 'readit://localhost/'

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/
const RESOURCE_ATTRIBUTES = [
  ['img', 'src'],
  ['source', 'src'],
  ['audio', 'src'],
  ['video', 'src'],
  ['video', 'poster'],
] as const

export function toReaditResourceUrl(raw: string): string | null {
  const value = raw.trim()
  if (
    value === '' ||
    value.startsWith('#') ||
    value.startsWith('?') ||
    value.startsWith('//') ||
    SCHEME.test(value)
  ) {
    return null
  }

  const suffixIndex = value.search(/[?#]/)
  const rawPath = suffixIndex === -1 ? value : value.slice(0, suffixIndex)
  const suffix = suffixIndex === -1 ? '' : value.slice(suffixIndex)
  const normalized = rawPath.replaceAll('\\', '/')
  if (normalized.startsWith('//') || /[\0-\x1f]/.test(normalized)) return null

  const encoded: string[] = []
  for (const rawSegment of normalized.replace(/^\//, '').split('/')) {
    let segment: string
    try {
      segment = decodeURIComponent(rawSegment)
    } catch {
      return null
    }
    if (segment === '' || segment === '.') continue
    if (
      segment === '..' ||
      (segment.length === 2 && /^[a-zA-Z]:$/.test(segment)) ||
      segment.includes('/') ||
      segment.includes('\\')
    ) {
      return null
    }
    encoded.push(encodeURIComponent(segment))
  }
  return encoded.length === 0 ? null : `${PROTOCOL_BASE}${encoded.join('/')}${suffix}`
}

export function rewriteLocalResources(root: ParentNode): void {
  for (const [selector, attribute] of RESOURCE_ATTRIBUTES) {
    const elements = [...root.querySelectorAll<HTMLElement>(`${selector}[${attribute}]`)]
    if (root instanceof HTMLElement && root.matches(`${selector}[${attribute}]`)) {
      elements.unshift(root)
    }
    for (const element of elements) {
      const raw = element.getAttribute(attribute)
      if (raw === null) continue
      const local = toReaditResourceUrl(raw)
      if (local !== null) element.setAttribute(attribute, local)
    }
  }
}

export function observeLocalResources(host: HTMLElement): () => void {
  const root = host.shadowRoot
  if (root === null) return () => {}
  rewriteLocalResources(root)

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement) rewriteLocalResources(node)
      }
    }
  })
  observer.observe(root, { childList: true, subtree: true })
  return () => observer.disconnect()
}

export { PROTOCOL_BASE }
