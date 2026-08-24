import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { mount, type Mode, type MountHandle } from 'readit/element'
import './styles.css'
import { createHighlighterLoader, createMermaidLoader } from './loaders.js'
import { routeDocumentOpen } from './navigation.js'
import { observeLocalResources, resourceProtocolBase } from './resources.js'
import {
  createWatchedDocumentReloader,
  type WatchedDocumentChange,
} from './watch-reload.js'
import { connectUpdateNotice } from './updates.js'
import { connectExternalLinks } from './external-links.js'
import { connectFindShortcut } from './find-shortcut.js'
import { connectEditShortcuts } from './edit-shortcuts.js'
import { createCompositionGate } from './composition-gate.js'
import { createLeavePrompt, type LeaveKind } from './leave-prompt.js'
import { connectModeSwitch } from './mode-switch.js'
import { createSaveState, type SaveDocumentRef, type SaveStateSnapshot } from './save-state.js'
import { documentWindowTitle, normalizeDocumentPath } from './document-path.js'

interface DocumentPayload extends SaveDocumentRef {}

interface ModeEventPayload {
  readonly mode: Extract<Mode, 'read' | 'source' | 'split'>
}

interface LeaveEventPayload {
  readonly kind: Extract<LeaveKind, 'close' | 'exit'>
}

const DOCUMENTS_PENDING_EVENT = 'readit-documents-pending'
const DOCUMENT_CHANGED_EVENT = 'readit-document-changed'
const MODE_EVENT = 'readit-set-mode'
const SAVE_EVENT = 'readit-save-requested'
const LEAVE_EVENT = 'readit-leave-requested'

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (element === null) throw new Error(`readit shell is missing ${selector}`)
  return element
}

function requireButton(selector: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(selector)
  if (element === null) throw new Error(`readit shell is missing ${selector}`)
  return element
}

const host = requireElement('#reader')
const status = requireElement('#status')
const documentState = requireElement('#document-state')
const conflict = requireElement('#conflict')
const useDisk = requireButton('#use-disk')
const keepMine = requireButton('#keep-mine')
const updateNotice = requireElement('#update')
const updateMessage = requireElement('#update-message')
const installUpdate = requireButton('#install-update')
const leavePrompt = createLeavePrompt({
  root: requireElement('#leave-prompt'),
  title: requireElement('#leave-title'),
  message: requireElement('#leave-message'),
  save: requireButton('#leave-save'),
  discard: requireButton('#leave-discard'),
  cancel: requireButton('#leave-cancel'),
})
const compositionGate = createCompositionGate(host)

let handle: MountHandle | null = null
let currentMode: Extract<Mode, 'read' | 'source' | 'split'> = 'read'
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

let shownTitle = ''

function renderSaveState(state: SaveStateSnapshot): void {
  const title = documentWindowTitle(state.path, state.dirty)
  if (title !== shownTitle) {
    shownTitle = title
    document.title = title
    // 原生标题栏不跟随 document.title，必须显式设。理由见 documentWindowTitle。
    void getCurrentWindow().setTitle(title).catch(displayError)
  }
  documentState.hidden = !state.dirty && !state.saving
  documentState.textContent = state.saving
    ? state.dirty ? '正在保存；仍有未保存修改' : '正在保存…'
    : state.dirty ? '未保存' : ''
}

const saveState = createSaveState({
  write: (content, generation) => invoke('save_document', { content, generation }),
  applyValue: (value) => handle?.setValue(value),
  stateChanged: renderSaveState,
  conflictChanged: (value) => {
    conflict.hidden = value === null
    if (value !== null) keepMine.focus()
  },
  reportError: displayError,
})

const stopExternalLinks = connectExternalLinks(host, {
  openExternal: (url) => invoke('open_external', { url }),
  showFeedback: (message) => displayError(new Error(message)),
})
const stopFindShortcut = connectFindShortcut(window, () => handle)

const isWindows = navigator.userAgent.includes('Windows')

const modeSwitch = connectModeSwitch(requireElement('#mode-switch'), {
  onSelect: (mode) => setShellMode(mode),
  shortcutModifier: isWindows ? 'Ctrl+' : '\u2318',
})

function setShellMode(mode: Extract<Mode, 'read' | 'source' | 'split'>): void {
  void compositionGate.wait().then(() => {
    currentMode = mode
    // 菜单、快捷键、按钮三条入口共用这一条真相；按钮只反映结果，不自己记状态。
    modeSwitch.setMode(mode)
    handle?.setMode(mode)
    return invoke('set_mode_menu', { mode })
  }).catch(displayError)
}

function requestSave(): void {
  void compositionGate.wait().then(() => saveState.save())
}

const stopEditShortcuts = isWindows
  ? connectEditShortcuts(window, { setMode: setShellMode, save: requestSave })
  : (): void => {}

useDisk.addEventListener('click', () => saveState.resolveConflict('use-disk'))
keepMine.addEventListener('click', () => saveState.resolveConflict('keep-mine'))

function showDocument(documentPayload: DocumentPayload): void {
  currentDocumentPath = documentPayload.path
  status.hidden = true
  status.removeAttribute('data-kind')
  if (handle !== null) {
    handle.setValue(documentPayload.source)
  } else {
    handle = mount(host, {
      value: documentPayload.source,
      mode: currentMode,
      baseUrl: normalizeDocumentPath(documentPayload.path),
      // SPEC §9.4: the desktop shell reads authored local files, whose editors conventionally
      // render soft line breaks. The reusable element keeps its GitHub-compatible breaks: false
      // default; only the shell deliberately opts into the local-editor convention.
      breaks: true,
      emojiBase: '/emoji/',
      loadHighlighter: createHighlighterLoader(),
      loadMermaid: createMermaidLoader(),
      onNavigate: (path) => queueNavigation(path),
      onChange: (value) => saveState.userChanged(value),
    })
    stopObservingResources = observeLocalResources(host, resourceProtocolBase(navigator.userAgent))
  }
  saveState.load(documentPayload)
}

async function openAndShow(path: string): Promise<void> {
  // A discarded navigation may happen while a manually-started save is still in flight. Let the
  // old generation finish before open_document publishes the next Rust authority.
  await saveState.whenSavesSettle()
  showDocument(await invoke<DocumentPayload>('open_document', { path }))
}

async function mayNavigate(): Promise<boolean> {
  await compositionGate.wait()
  if (!saveState.snapshot().dirty) return true
  const decision = await leavePrompt.request('navigate')
  return await saveState.prepareToLeave(decision)
}

function queueNavigation(path: string): Promise<void> {
  const next = navigationTail.then(async () => {
    if (!(await mayNavigate())) return
    await openAndShow(path)
  })
  navigationTail = next.catch(() => {})
  return next
}

const watchedDocumentReloader = createWatchedDocumentReloader(
  () => currentDocumentPath,
  async () => {
    await compositionGate.wait()
    const generation = saveState.snapshot().generation
    if (generation === null) return
    const source = await invoke<string>('read_current_document', { generation })
    if (saveState.snapshot().generation !== generation) return
    saveState.diskChanged(source)
  },
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

async function handleNativeLeave(kind: Extract<LeaveKind, 'close' | 'exit'>): Promise<void> {
  await compositionGate.wait()
  const decision = saveState.snapshot().dirty ? await leavePrompt.request(kind) : 'discard'
  const allowed = await saveState.prepareToLeave(decision)
  if (!allowed) {
    await invoke('cancel_leave')
    return
  }
  await saveState.whenSavesSettle()
  await invoke('complete_leave', { kind })
}

void (async () => {
  stopListening.push(
    await listen(DOCUMENTS_PENDING_EVENT, () => {
      void drainPendingDocuments().catch(displayError)
    }),
    await listen<WatchedDocumentChange>(DOCUMENT_CHANGED_EVENT, (event) => {
      watchedDocumentReloader.handle(event.payload)
    }),
    await listen<ModeEventPayload>(MODE_EVENT, (event) => setShellMode(event.payload.mode)),
    await listen(SAVE_EVENT, requestSave),
    await listen<LeaveEventPayload>(LEAVE_EVENT, (event) => {
      void handleNativeLeave(event.payload.kind).catch(async (error) => {
        displayError(error)
        await invoke('cancel_leave').catch(displayError)
      })
    }),
  )
  // Native close/quit interception is enabled only after every corresponding listener exists.
  await invoke('frontend_ready')
  modeSwitch.setMode(currentMode)
  await invoke('set_mode_menu', { mode: currentMode })
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
  stopEditShortcuts()
  compositionGate.destroy()
  modeSwitch.destroy()
  leavePrompt.destroy()
  stopObservingResources?.()
  handle?.destroy()
})
