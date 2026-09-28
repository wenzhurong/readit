import type { DocumentPayload, ShellBackend } from './backend.js'
import { documentFileName } from './document-path.js'
import type { DocumentTab } from './document-tab.js'
import type { LeaveKind } from './leave-prompt.js'
import type { ShellMode } from './mode-switch.js'
import type { LeaveDecision } from './save-state.js'
import { cycleTab, neighborAfterClose } from './tabs.js'

export interface TabSessionDeps {
  readonly backend: Pick<ShellBackend, 'openDocument' | 'closeDocument' | 'cancelLeave' | 'completeLeave'>
  createTab(payload: DocumentPayload, mode: ShellMode): DocumentTab
  askToLeave(kind: Exclude<LeaveKind, 'navigate'>, documentName: string): Promise<LeaveDecision>
  waitForComposition(): Promise<void>
  /** 标签集合、当前标签或模式变了：重画标签栏、标题、提示条、模式按钮。 */
  render(): void
}

export interface TabSession {
  tabs(): readonly DocumentTab[]
  active(): DocumentTab | null
  /** 没有标签时模式按钮显示的模式，也是下一个新标签的模式。 */
  idleMode(): ShellMode
  /** 系统入口与「打开…」：新开一个标签；已经开着的（规范化路径相同）就切过去。 */
  openPath(path: string): Promise<void>
  activate(tab: DocumentTab): void
  cycle(delta: 1 | -1): void
  closeTab(tab: DocumentTab): Promise<void>
  /** 原生关窗 / 退出：逐个裁决带 ● 的标签，全部放行后才告诉 Rust。 */
  leave(kind: 'close' | 'exit'): Promise<void>
  setMode(mode: ShellMode): void
  diskChanged(generation: number): void
}

/**
 * 多标签的编排。纯逻辑：DOM 与 Rust 都经依赖注入，单测里全部替身（多标签设计 §3.6）。
 *
 * 关标签与关窗 / 退出都会弹离开提示，还会改动标签列表，所以两类流程排成一队：前一个
 * 没走完，后一个不开始。
 */
export function createTabSession(deps: TabSessionDeps): TabSession {
  let tabs: DocumentTab[] = []
  let current: DocumentTab | null = null
  let lastMode: ShellMode = 'read'
  let leaveTail: Promise<void> = Promise.resolve()

  const queue = (work: () => Promise<void>): Promise<void> => {
    const next = leaveTail.then(work)
    leaveTail = next.catch(() => {})
    return next
  }

  const activate = (tab: DocumentTab): void => {
    if (current === tab) return
    current?.setActive(false)
    current = tab
    lastMode = tab.mode()
    tab.setActive(true)
    deps.render()
  }

  const remove = (tab: DocumentTab, next: DocumentTab | null): void => {
    tabs = tabs.filter((candidate) => candidate !== tab)
    tab.destroy()
    if (current === tab) current = null
    if (next !== null && next !== current && tabs.includes(next)) activate(next)
    else deps.render()
  }

  return {
    tabs: () => tabs,
    active: () => current,
    idleMode: () => lastMode,

    async openPath(path) {
      const payload = await deps.backend.openDocument(path)
      const existing = tabs.find((tab) => tab.path() === payload.path)
      if (existing !== undefined) {
        // 已经开着：切过去。刚才为了拿到规范化路径登记的那一份，立刻交还。
        await deps.backend.closeDocument(payload.generation)
        activate(existing)
        return
      }
      const tab = deps.createTab(payload, current?.mode() ?? lastMode)
      tabs = [...tabs, tab]
      activate(tab)
    },

    activate,

    cycle(delta) {
      if (current === null) return
      const next = cycleTab(tabs, current, delta)
      if (next !== null) activate(next)
    },

    closeTab(tab) {
      return queue(async () => {
        if (!tabs.includes(tab)) return
        await deps.waitForComposition()
        const previous = current
        if (tab.snapshot().dirty) {
          activate(tab)
          const decision = await deps.askToLeave('close-tab', documentFileName(tab.path()))
          if (!(await tab.prepareToLeave(decision))) {
            if (previous !== null && tabs.includes(previous)) activate(previous)
            return
          }
        }
        await tab.whenSavesSettle()
        const next = previous !== null && previous !== tab ? previous : neighborAfterClose(tabs, tab)
        remove(tab, next)
        if (tabs.length === 0) await deps.backend.completeLeave('close')
      })
    },

    leave(kind) {
      return queue(async () => {
        await deps.waitForComposition()
        for (const tab of [...tabs]) {
          if (!tab.snapshot().dirty) continue
          activate(tab)
          const decision = await deps.askToLeave(kind, documentFileName(tab.path()))
          if (!(await tab.prepareToLeave(decision))) {
            await deps.backend.cancelLeave()
            return
          }
        }
        await Promise.all(tabs.map((tab) => tab.whenSavesSettle()))
        await deps.backend.completeLeave(kind)
      })
    },

    setMode(mode) {
      lastMode = mode
      current?.setMode(mode)
      deps.render()
    },

    diskChanged(generation) {
      tabs.find((tab) => tab.generation() === generation)?.diskChanged(generation)
    },
  }
}
