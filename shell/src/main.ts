import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { mount, type MountHandle } from 'readit/element'
import './styles.css'
import { routeDocumentOpen } from './navigation.js'
import { observeLocalResources } from './resources.js'

interface DocumentPayload {
  readonly path: string
  readonly source: string
}

const DOCUMENTS_PENDING_EVENT = 'readit-documents-pending'

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (element === null) throw new Error(`readit shell is missing ${selector}`)
  return element
}

const host = requireElement('#reader')
const status = requireElement('#status')

let handle: MountHandle | null = null
let stopObservingResources: (() => void) | null = null
let navigationTail: Promise<void> = Promise.resolve()
let draining = false
let drainAgain = false

function displayError(error: unknown): void {
  status.hidden = false
  status.dataset.kind = 'error'
  status.textContent = error instanceof Error ? error.message : String(error)
}

function showDocument(documentPayload: DocumentPayload): void {
  document.title = `${documentPayload.path.split('/').pop() ?? 'readit'} — readit`
  status.hidden = true
  status.removeAttribute('data-kind')
  if (handle !== null) {
    handle.setValue(documentPayload.source)
    return
  }

  handle = mount(host, {
    value: documentPayload.source,
    baseUrl: documentPayload.path,
    emojiBase: '/emoji/',
    loadHighlighter: async () => {
      const plugin = await import('readit/plugins/highlight')
      return plugin.createShikiHighlighter()
    },
    loadMermaid: async () => {
      const plugin = await import('readit/plugins/mermaid')
      return plugin.createMermaidRenderer()
    },
    onNavigate: (path) => queueNavigation(path),
  })
  stopObservingResources = observeLocalResources(host)
}

async function openAndShow(path: string): Promise<void> {
  showDocument(await invoke<DocumentPayload>('open_document', { path }))
}

function queueNavigation(path: string): Promise<void> {
  const next = navigationTail.then(() => openAndShow(path))
  navigationTail = next.catch(() => {})
  return next
}

async function drainPendingDocuments(): Promise<void> {
  if (draining) {
    drainAgain = true
    return
  }
  draining = true
  try {
    do {
      drainAgain = false
      for (;;) {
        const path = await invoke<string | null>('take_pending_path')
        if (path === null) break
        if (handle === null) await queueNavigation(path)
        else routeDocumentOpen(host, path)
      }
    } while (drainAgain)
  } finally {
    draining = false
  }
}

void (async () => {
  await listen(DOCUMENTS_PENDING_EVENT, () => {
    void drainPendingDocuments().catch(displayError)
  })
  await drainPendingDocuments()
})().catch(displayError)

window.addEventListener('beforeunload', () => {
  stopObservingResources?.()
  handle?.destroy()
})
