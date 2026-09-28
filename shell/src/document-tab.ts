import type { MountHandle, MountOptions } from 'readit/element'
import type { DocumentPayload, ShellBackend } from './backend.js'
import { normalizeDocumentPath } from './document-path.js'
import type { ShellMode } from './mode-switch.js'
import { observeLocalResources } from './resources.js'
import {
  createSaveState,
  type ConflictDecision,
  type LeaveDecision,
  type SaveStateSnapshot,
} from './save-state.js'
import { createWatchedDocumentReloader } from './watch-reload.js'

export interface DocumentTabDeps {
  readonly backend: Pick<ShellBackend, 'openDocument' | 'closeDocument' | 'saveDocument' | 'readDocument'>
  /** 所有标签宿主的容器（#reader）。 */
  readonly container: HTMLElement
  /** 壳给每个标签的公共挂载选项（breaks、懒加载器……），见 main.ts。 */
  readonly mountDefaults: Partial<MountOptions>
  mount(host: HTMLElement, options: Partial<MountOptions>): MountHandle
  /** 该 generation 的资源地址前缀，形如 `readit://localhost/7/`。 */
  resourceBase(generation: number): string
  waitForComposition(): Promise<void>
  /** 标签内跳转遇到未保存修改时问用户。 */
  askToNavigate(): Promise<LeaveDecision>
  changed(tab: DocumentTab): void
  conflictChanged(tab: DocumentTab): void
  reportError(error: unknown): void
}

export interface DocumentTab {
  readonly id: number
  readonly host: HTMLElement
  readonly handle: MountHandle
  path(): string
  generation(): number
  mode(): ShellMode
  snapshot(): SaveStateSnapshot
  setActive(active: boolean): void
  setMode(mode: ShellMode): void
  save(): Promise<boolean>
  resolveConflict(decision: ConflictDecision): void
  prepareToLeave(decision: LeaveDecision): Promise<boolean>
  whenSavesSettle(): Promise<void>
  /** Rust 报告某个 generation 的文件在磁盘上变了。不是本标签当前的 generation 就忽略。 */
  diskChanged(generation: number): void
  /** 拆掉挂载与宿主，并把 generation 交还 Rust。调用方负责先裁决未保存修改、等保存落定。 */
  destroy(): void
}

let nextTabId = 1

/**
 * 一个标签：一个宿主元素、一次 mount()、一份保存状态机、一套外部修改去抖。
 *
 * 原先 main.ts 里的单文档逻辑按标签实例化到这里，main.ts 只剩接线。标签内跳转（文档里的
 * 相对链接）换的是同一个标签里的文档：先打开新的，成功后再把旧 generation 交还 Rust；
 * 失败则旧文档原样保留，并把错误交给元素显示。
 */
export function createDocumentTab(
  deps: DocumentTabDeps,
  first: DocumentPayload,
  mode: ShellMode,
): DocumentTab {
  const id = nextTabId++
  const host = deps.container.ownerDocument.createElement('div')
  host.className = 'document-tab'
  host.dataset['tabId'] = String(id)
  deps.container.append(host)

  let generation = first.generation
  let path = first.path
  let currentMode = mode
  let tab: DocumentTab | null = null
  let navigationTail: Promise<void> = Promise.resolve()

  const saveState = createSaveState({
    write: (content, target) => deps.backend.saveDocument(content, target),
    applyValue: (value) => handle.setValue(value),
    // 构造期间状态机会先报一次状态，那时标签对象还不存在。
    stateChanged: () => {
      if (tab !== null) deps.changed(tab)
    },
    conflictChanged: () => {
      if (tab !== null) deps.conflictChanged(tab)
    },
    reportError: deps.reportError,
  })

  const navigate = (target: string): Promise<void> => {
    const next = navigationTail.then(async () => {
      await deps.waitForComposition()
      if (saveState.snapshot().dirty) {
        const decision = await deps.askToNavigate()
        if (!(await saveState.prepareToLeave(decision))) return
      }
      // 选了「放弃」时，一次手动保存可能还在路上：让旧 generation 先写完再换文档。
      await saveState.whenSavesSettle()
      const payload = await deps.backend.openDocument(target)
      const previous = generation
      // 先换 generation 再 setValue：新内容插进 DOM 时，资源改写要取到新前缀。
      generation = payload.generation
      path = payload.path
      handle.setValue(payload.source)
      saveState.load(payload)
      void deps.backend.closeDocument(previous).catch(deps.reportError)
    })
    navigationTail = next.catch(() => {})
    return next
  }

  const handle = deps.mount(host, {
    ...deps.mountDefaults,
    value: first.source,
    mode,
    baseUrl: normalizeDocumentPath(first.path),
    onNavigate: (target) => navigate(target),
    onChange: (value) => saveState.userChanged(value),
  })
  const stopResources = observeLocalResources(host, () => deps.resourceBase(generation))
  const reloader = createWatchedDocumentReloader(
    () => generation,
    async (target) => {
      await deps.waitForComposition()
      const source = await deps.backend.readDocument(target)
      if (generation !== target) return
      saveState.diskChanged(source)
    },
    deps.reportError,
  )
  saveState.load(first)

  const created: DocumentTab = {
    id,
    host,
    handle,
    path: () => path,
    generation: () => generation,
    mode: () => currentMode,
    snapshot: () => saveState.snapshot(),
    setActive(active) {
      host.classList.toggle('is-active', active)
      // 非当前标签保留排版，但不可交互、不进无障碍树（多标签设计 §4）。
      host.inert = !active
    },
    setMode(next) {
      currentMode = next
      handle.setMode(next)
    },
    save: () => saveState.save(),
    resolveConflict: (decision) => saveState.resolveConflict(decision),
    prepareToLeave: (decision) => saveState.prepareToLeave(decision),
    whenSavesSettle: () => saveState.whenSavesSettle(),
    diskChanged: (target) => reloader.handle({ generation: target }),
    destroy() {
      reloader.destroy()
      stopResources()
      handle.destroy()
      host.remove()
      void deps.backend.closeDocument(generation).catch(deps.reportError)
    },
  }
  tab = created
  created.setActive(false)
  return created
}
