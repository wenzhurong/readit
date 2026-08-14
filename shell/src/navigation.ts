/** Route an OS-level open through the element's existing click/history contract. */
export function routeDocumentOpen(host: HTMLElement, path: string): void {
  const anchor = host.ownerDocument.createElement('a')
  anchor.hidden = true
  anchor.setAttribute('href', path)
  host.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
  }
}
