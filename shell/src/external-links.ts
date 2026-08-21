const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/

export interface ExternalLinkActions {
  openExternal(url: string): Promise<void>
  showFeedback(message: string): void
}

function normalizedHref(raw: string): string {
  // URL parsing removes ASCII tab/newline characters. Normalize them before
  // deciding whether a link has a scheme so whitespace cannot bypass the gate.
  return raw.trim().replace(/[\t\n\r]/g, '')
}

function externalCandidate(href: string): boolean {
  if (href.startsWith('//')) return true
  const scheme = SCHEME.exec(href)?.[1]
  // Keep this boundary aligned with @readit/element's classifyHref: a one-letter
  // prefix is a Windows drive (C:/...), not an external URL scheme.
  return scheme !== undefined && scheme.length >= 2
}

export function allowedWebUrl(raw: string): string | null {
  const href = normalizedHref(raw)
  if (!externalCandidate(href)) return null
  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function closestAnchor(event: Event): HTMLAnchorElement | null {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLAnchorElement) return node
  }
  return null
}

export function connectExternalLinks(host: HTMLElement, actions: ExternalLinkActions): () => void {
  const onClick = (event: Event): void => {
    const anchor = closestAnchor(event)
    if (anchor === null) return
    const raw = anchor.getAttribute('href')
    if (raw === null) return
    const href = normalizedHref(raw)
    if (!externalCandidate(href)) return

    // Capture before element's own bubble listener and before WebView default
    // navigation. The event may continue bubbling, but defaultPrevented tells
    // the element that the shell has taken ownership.
    event.preventDefault()
    const allowed = allowedWebUrl(href)
    if (allowed === null) {
      actions.showFeedback(`已阻止不受支持的外部链接：${href}`)
      return
    }
    void actions.openExternal(allowed).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error)
      actions.showFeedback(`无法在系统浏览器中打开链接：${detail}`)
    })
  }

  host.addEventListener('click', onClick, true)
  return () => host.removeEventListener('click', onClick, true)
}
