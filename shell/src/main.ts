import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { mount, type MountOptions } from 'readit/element'
import './styles.css'
import { createTauriBackend } from './backend.js'
import { createHighlighterLoader, createMermaidLoader } from './loaders.js'
import { documentResourceBase, resourceProtocolBase } from './resources.js'
import type { WatchedDocumentChange } from './watch-reload.js'
import { connectUpdateNotice } from './updates.js'
import { connectExternalLinks } from './external-links.js'
import { connectModifierClicks } from './modifier-clicks.js'
import { connectFindShortcut } from './find-shortcut.js'
import { connectEditShortcuts } from './edit-shortcuts.js'
import { connectTabShortcuts } from './tab-shortcuts.js'
import { createCompositionGate } from './composition-gate.js'
import { createLeavePrompt } from './leave-prompt.js'
import { connectModeSwitch, type ShellMode } from './mode-switch.js'
import { connectDraggable, createStoredPosition } from './draggable.js'
import { connectTabStrip } from './tab-strip.js'
import { createDocumentTab, type DocumentTab } from './document-tab.js'
import { createTabSession } from './tab-session.js'
import { tabLabels } from './tabs.js'
import { documentWindowTitle } from './document-path.js'

interface ModeEventPayload {
  readonly mode: ShellMode
}

interface LeaveEventPayload {
  readonly kind: 'close' | 'exit'
}

const DOCUMENTS_PENDING_EVENT = 'readit-documents-pending'
const DOCUMENT_CHANGED_EVENT = 'readit-document-changed'
const MODE_EVENT = 'readit-set-mode'
const SAVE_EVENT = 'readit-save-requested'
const LEAVE_EVENT = 'readit-leave-requested'
const OPEN_EVENT = 'readit-open-requested'
const CLOSE_TAB_EVENT = 'readit-close-tab-requested'

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

const reader = requireElement('#reader')
const tabStripRoot = requireElement('#tab-strip')
const emptyState = requireElement('#empty-state')
const notice = requireElement('#notice')
const noticeMessage = requireElement('#notice-message')
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
const compositionGate = createCompositionGate(reader)
const backend = createTauriBackend(invoke)
const protocolBase = resourceProtocolBase(navigator.userAgent)
const isWindows = navigator.userAgent.includes('Windows')
const stopListening: Array<() => void> = []
let stopUpdateNotice: (() => void) | null = null

function displayError(error: unknown): void {
  noticeMessage.textContent = error instanceof Error ? error.message : String(error)
  notice.hidden = false
}

requireButton('#notice-dismiss').addEventListener('click', () => {
  notice.hidden = true
})

// SPEC §9.4: the desktop shell reads authored local files, whose editors conventionally
// render soft line breaks. The reusable element keeps its GitHub-compatible breaks: false
// default; only the shell deliberately opts into the local-editor convention.
const MOUNT_DEFAULTS: Partial<MountOptions> = {
  breaks: true,
  emojiBase: '/emoji/',
  loadHighlighter: createHighlighterLoader(),
  loadMermaid: createMermaidLoader(),
}

const session = createTabSession({
  backend,
  createTab: (payload, mode) =>
    createDocumentTab(
      {
        backend,
        container: reader,
        mountDefaults: MOUNT_DEFAULTS,
        mount,
        resourceBase: (generation) => documentResourceBase(protocolBase, generation),
        waitForComposition: () => compositionGate.wait(),
        askToNavigate: () => leavePrompt.request('navigate'),
        changed: () => render(),
        conflictChanged: (tab) => {
          render()
          if (tab === session.active() && tab.snapshot().conflictValue !== null) keepMine.focus()
        },
        reportError: displayError,
      },
      payload,
      mode,
    ),
  askToLeave: (kind, name) => leavePrompt.request(kind, name),
  waitForComposition: () => compositionGate.wait(),
  render: () => render(),
})

function withTab(id: number, action: (tab: DocumentTab) => void): void {
  const tab = session.tabs().find((candidate) => candidate.id === id)
  if (tab !== undefined) action(tab)
}

const tabStrip = connectTabStrip(tabStripRoot, {
  activate: (id, source) =>
    withTab(id, (tab) => {
      session.activate(tab)
      // 鼠标点了标签就把焦点交给文档；键盘在标签栏里走时留在标签栏（tab-strip 自己放回去）。
      if (source === 'pointer') tab.focus()
    }),
  close: (id) => withTab(id, (tab) => void session.closeTab(tab).catch(displayError)),
  open: () => requestOpen(),
  shortcutModifier: isWindows ? 'Ctrl+' : '\u2318',
})

const stopExternalLinks = connectExternalLinks(reader, {
  openExternal: (url) => invoke('open_external', { url }),
  showFeedback: (message) => displayError(new Error(message)),
})
// 必须在外链拦截之后接：两个都是捕获阶段监听，外链的修饰键点击仍归 external-links.ts。
const stopModifierClicks = connectModifierClicks(reader)
const stopFindShortcut = connectFindShortcut(window, () => session.active()?.handle ?? null)

const modeSwitchRoot = requireElement('#mode-switch')

const modeSwitch = connectModeSwitch(modeSwitchRoot, {
  onSelect: (mode) => setShellMode(mode),
  shortcutModifier: isWindows ? 'Ctrl+' : '\u2318',
})

// 存档写不进去（隐私模式、被策略禁用）不该让控件不可用，所以取不到就当没有存档。
function optionalLocalStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const stopModeSwitchDrag = connectDraggable(modeSwitchRoot, {
  store: createStoredPosition('readit:mode-switch-position', optionalLocalStorage()),
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
  // 拖动范围在标签栏以下，别把标签盖住。
  topInset: () => tabStripRoot.getBoundingClientRect().height,
})

let shownTitle = ''
let shownMode: ShellMode | null = null

function renderTitle(active: DocumentTab | null): void {
  let title = documentWindowTitle(null, false)
  if (active !== null) {
    const state = active.snapshot()
    title = documentWindowTitle(state.path, state.dirty)
  }
  if (title === shownTitle) return
  shownTitle = title
  document.title = title
  // 原生标题栏不跟随 document.title，必须显式设。理由见 documentWindowTitle。
  void getCurrentWindow().setTitle(title).catch(displayError)
}

function renderDocumentState(active: DocumentTab | null): void {
  const state = active?.snapshot() ?? null
  documentState.hidden = state === null || (!state.dirty && !state.saving)
  documentState.textContent =
    state === null
      ? ''
      : state.saving
        ? state.dirty
          ? '正在保存；仍有未保存修改'
          : '正在保存…'
        : state.dirty
          ? '未保存'
          : ''
}

function render(): void {
  const tabs = session.tabs()
  const active = session.active()
  const labels = tabLabels(tabs.map((tab) => tab.path()))
  tabStrip.render(
    tabs.map((tab, index) => {
      const state = tab.snapshot()
      return {
        id: tab.id,
        label: labels[index] ?? '',
        path: tab.path(),
        dirty: state.dirty,
        // 当前标签的冲突直接弹提示条；标签上的标记只给后台标签。
        conflict: tab !== active && state.conflictValue !== null,
      }
    }),
    active?.id ?? null,
  )
  emptyState.hidden = tabs.length > 0
  renderTitle(active)
  renderDocumentState(active)
  conflict.hidden = active === null || active.snapshot().conflictValue === null
  // 焦点落空（body）或困在已变成后台的旧标签里时，交给当前标签——关标签、离开提示答完之后都会
  // 这样。原先 Ctrl+Tab 之后焦点留在 inert 的旧标签里，敲的字全丢（第 2 批评审 Important 3）。
  const focused = document.activeElement
  const stranded =
    focused === null ||
    focused === document.body ||
    (focused instanceof HTMLElement &&
      focused.classList.contains('document-tab') &&
      focused !== active?.host)
  if (stranded) active?.focus()
  const mode = active?.mode() ?? session.idleMode()
  if (mode !== shownMode) {
    shownMode = mode
    // 菜单、快捷键、按钮三条入口共用这一条真相；按钮只反映结果，不自己记状态。
    modeSwitch.setMode(mode)
    void backend.setModeMenu(mode).catch(displayError)
  }
}

function setShellMode(mode: ShellMode): void {
  void compositionGate
    .wait()
    .then(() => session.setMode(mode))
    .catch(displayError)
}

function requestSave(): void {
  const active = session.active()
  if (active === null) return
  void compositionGate.wait().then(() => active.save())
}

function requestOpen(): void {
  void backend.openDialog(session.active()?.generation() ?? null).catch(displayError)
}

function requestCloseTab(): void {
  const active = session.active()
  // 空状态下没有标签可关：⌘/Ctrl+W 直接关窗（多标签设计 §2.5）。
  if (active === null) void backend.completeLeave('close').catch(displayError)
  else void session.closeTab(active).catch(displayError)
}

const stopEditShortcuts = isWindows
  ? connectEditShortcuts(window, {
      setMode: setShellMode,
      save: requestSave,
      open: requestOpen,
      closeTab: requestCloseTab,
    })
  : (): void => {}
const stopTabShortcuts = connectTabShortcuts(window, {
  next: () => {
    session.cycle(1)
    session.active()?.focus()
  },
  previous: () => {
    session.cycle(-1)
    session.active()?.focus()
  },
})

useDisk.addEventListener('click', () => session.active()?.resolveConflict('use-disk'))
keepMine.addEventListener('click', () => session.active()?.resolveConflict('keep-mine'))
requireButton('#empty-open').addEventListener('click', requestOpen)

let draining = false
let drainAgain = false

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
        const path = await backend.takePendingPath()
        if (path === null) break
        // 一份打不开不该挡住队列里后面的文件。
        await session.openPath(path).catch(displayError)
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
      session.diskChanged(event.payload.generation)
    }),
    await listen<ModeEventPayload>(MODE_EVENT, (event) => setShellMode(event.payload.mode)),
    await listen(SAVE_EVENT, requestSave),
    await listen(OPEN_EVENT, requestOpen),
    await listen(CLOSE_TAB_EVENT, requestCloseTab),
    await listen<LeaveEventPayload>(LEAVE_EVENT, (event) => {
      void session.leave(event.payload.kind).catch(async (error: unknown) => {
        displayError(error)
        await backend.cancelLeave().catch(displayError)
      })
    }),
  )
  // Native close/quit interception is enabled only after every corresponding listener exists.
  await invoke('frontend_ready')
  render()
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
  stopUpdateNotice?.()
  stopExternalLinks()
  stopModifierClicks()
  stopFindShortcut()
  stopEditShortcuts()
  stopTabShortcuts()
  compositionGate.destroy()
  stopModeSwitchDrag()
  modeSwitch.destroy()
  tabStrip.destroy()
  leavePrompt.destroy()
  for (const tab of session.tabs()) tab.handle.destroy()
})
