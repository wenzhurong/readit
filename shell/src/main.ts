import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { mount, type MountHandle } from 'readit/element'
import './styles.css'
import { createHighlighterLoader, createMermaidLoader } from './loaders.js'
import { routeDocumentOpen } from './navigation.js'
import { observeLocalResources } from './resources.js'
import {
  createWatchedDocumentReloader,
  type WatchedDocumentChange,
} from './watch-reload.js'
import { connectUpdateNotice } from './updates.js'
import { connectExternalLinks } from './external-links.js'
import { connectFindShortcut } from './find-shortcut.js'

interface DocumentPayload {
  readonly path: string
  readonly source: string
}

const DOCUMENTS_PENDING_EVENT = 'readit-documents-pending'
const DOCUMENT_CHANGED_EVENT = 'readit-document-changed'

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (element === null) throw new Error(`readit shell is missing ${selector}`)
  return element
}

const host = requireElement('#reader')
const status = requireElement('#status')
const updateNotice = requireElement('#update')
const updateMessage = requireElement('#update-message')
const installUpdate = requireElement('#install-update') as HTMLButtonElement

let handle: MountHandle | null = null
let stopObservingResources: (() => void) | null = null
let navigationTail: Promise<void> = Promise.resolve()
let draining = false
let drainAgain = false
let currentDocumentPath: string | null = null
const stopListening: Array<() => void> = []
let stopUpdateNotice: (() => void) | null = null

function displayError(error: unknown): void {
  status.hidden = false
  status.dataset.kind = 'error'
  status.textContent = error instanceof Error ? error.message : String(error)
}

const stopExternalLinks = connectExternalLinks(host, {
  openExternal: (url) => invoke('open_external', { url }),
  showFeedback: (message) => displayError(new Error(message)),
})
const stopFindShortcut = connectFindShortcut(window, () => handle)

function showDocument(documentPayload: DocumentPayload): void {
  currentDocumentPath = documentPayload.path
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
    loadHighlighter: createHighlighterLoader(),
    loadMermaid: createMermaidLoader(),
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

const watchedDocumentReloader = createWatchedDocumentReloader(
  () => currentDocumentPath,
  queueNavigation,
  displayError,
)

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
  stopListening.push(
    await listen(DOCUMENTS_PENDING_EVENT, () => {
      void drainPendingDocuments().catch(displayError)
    }),
    await listen<WatchedDocumentChange>(DOCUMENT_CHANGED_EVENT, (event) => {
      watchedDocumentReloader.handle(event.payload)
    }),
  )
  await drainPendingDocuments()
})().catch(displayError)

void connectUpdateNotice(
  {
    notice: updateNotice,
    message: updateMessage,
    button: installUpdate,
  },
  {
    check: () => invoke('check_for_update'),
    install: () => invoke('install_update'),
  },
).then((stop) => {
  stopUpdateNotice = stop
})

window.addEventListener('beforeunload', () => {
  for (const stop of stopListening) stop()
  watchedDocumentReloader.destroy()
  stopUpdateNotice?.()
  stopExternalLinks()
  stopFindShortcut()
  stopObservingResources?.()
  handle?.destroy()
})
