import { describe, expect, it, vi } from 'vitest'
import type { DocumentPayload } from '../src/backend.js'
import type { DocumentTab } from '../src/document-tab.js'
import type { ShellMode } from '../src/mode-switch.js'
import type { LeaveDecision } from '../src/save-state.js'
import { createTabSession, type TabSessionDeps } from '../src/tab-session.js'

interface FakeTab extends DocumentTab {
  dirty: boolean
  active: boolean
  destroyed: boolean
  readonly modes: ShellMode[]
  readonly decisions: LeaveDecision[]
  readonly diskChanges: number[]
  whenSavesSettle(): Promise<void>
}

let ids = 0

function fakeTab(payload: DocumentPayload, mode: ShellMode): FakeTab {
  const tab: FakeTab = {
    id: (ids += 1),
    host: document.createElement('div'),
    handle: {
      setValue: () => {},
      getValue: () => '',
      setMode: () => {},
      setTheme: () => {},
      find: () => {
        throw new Error('not used here')
      },
      destroy: () => {},
    },
    dirty: false,
    active: false,
    destroyed: false,
    modes: [mode],
    decisions: [],
    diskChanges: [],
    path: () => payload.path,
    generation: () => payload.generation,
    mode: () => tab.modes.at(-1) ?? mode,
    snapshot: () => ({
      path: payload.path,
      generation: payload.generation,
      currentValue: '',
      savedValue: '',
      observedDiskValue: '',
      dirty: tab.dirty,
      saving: false,
      conflictValue: null,
    }),
    setActive: (active) => {
      tab.active = active
    },
    setMode: (next) => {
      tab.modes.push(next)
    },
    focus: () => {},
    save: async () => true,
    resolveConflict: () => {},
    prepareToLeave: async (decision) => {
      tab.decisions.push(decision)
      if (!tab.dirty) return true
      if (decision === 'cancel') return false
      tab.dirty = false
      return true
    },
    whenSavesSettle: async () => {},
    diskChanged: (generation) => {
      tab.diskChanges.push(generation)
    },
    destroy: () => {
      tab.destroyed = true
    },
  }
  return tab
}

/** 可以由测试逐个放行的离开提示。 */
function promptQueue() {
  const waiting: Array<{ kind: string; name: string; answer: (decision: LeaveDecision) => void }> = []
  const asked: Array<{ kind: string; name: string }> = []
  const ask: TabSessionDeps['askToLeave'] = (kind, name) =>
    new Promise((answer) => {
      asked.push({ kind, name })
      waiting.push({ kind, name, answer })
    })
  const answer = async (decision: LeaveDecision): Promise<void> => {
    for (let i = 0; i < 10 && waiting.length === 0; i += 1) await Promise.resolve()
    const next = waiting.shift()
    if (next === undefined) throw new Error('no prompt is waiting')
    next.answer(decision)
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
  }
  return { ask, answer, asked }
}

function harness() {
  const created: FakeTab[] = []
  let generation = 0
  const backend = {
    // 模拟 Rust 的规范化：'/./' 折叠掉。
    openDocument: vi.fn(async (path: string): Promise<DocumentPayload> => ({
      path: path.replace('/./', '/'),
      source: '',
      generation: (generation += 1),
    })),
    closeDocument: vi.fn(async (_generation: number) => {}),
    cancelLeave: vi.fn(async () => {}),
    completeLeave: vi.fn(async (_kind: 'close' | 'exit') => {}),
  }
  const prompts = promptQueue()
  const render = vi.fn()
  const session = createTabSession({
    backend,
    createTab: (payload, mode) => {
      const tab = fakeTab(payload, mode)
      created.push(tab)
      return tab
    },
    askToLeave: prompts.ask,
    waitForComposition: async () => {},
    render,
  })
  const tab = (index: number): FakeTab => {
    const found = created[index]
    if (found === undefined) throw new Error(`no tab #${index}`)
    return found
  }
  return { session, created, tab, backend, prompts, render }
}

describe('tab session', () => {
  it('opens each path as a new tab at the end, activates it, and inherits the active mode', async () => {
    const { session, created } = harness()
    await session.openPath('/docs/a.md')
    session.setMode('split')
    await session.openPath('/docs/b.md')

    expect({
      order: session.tabs().map((t) => t.path()),
      active: session.active()?.path(),
      modeOfB: created[1]?.mode(),
      flags: created.map((t) => t.active),
    }).toEqual({
      order: ['/docs/a.md', '/docs/b.md'],
      active: '/docs/b.md',
      modeOfB: 'split',
      flags: [false, true],
    })
  })

  it('reopening an open file activates it and releases the extra generation', async () => {
    // 评审关注第 1 条。
    const { session, backend } = harness()
    await session.openPath('/docs/a.md')
    await session.openPath('/docs/b.md')
    await session.openPath('/docs/./a.md')
    await session.openPath('/docs/a.md')

    expect({
      order: session.tabs().map((t) => t.path()),
      active: session.active()?.path(),
      released: backend.closeDocument.mock.calls,
    }).toEqual({
      order: ['/docs/a.md', '/docs/b.md'],
      active: '/docs/a.md',
      released: [[3], [4]],
    })
  })

  it('closing the active clean tab activates its right neighbour, else the left one', async () => {
    const { session, tab } = harness()
    await session.openPath('/a.md')
    await session.openPath('/b.md')
    await session.openPath('/c.md')
    session.activate(tab(1))

    await session.closeTab(tab(1))
    const afterFirst = session.active()?.path()
    await session.closeTab(tab(2))

    expect({ afterFirst, afterSecond: session.active()?.path(), destroyed: [tab(1).destroyed, tab(2).destroyed] }).toEqual({
      afterFirst: '/c.md',
      afterSecond: '/a.md',
      destroyed: [true, true],
    })
  })

  it('closing a background clean tab keeps the active one', async () => {
    const { session, tab } = harness()
    await session.openPath('/a.md')
    await session.openPath('/b.md')

    await session.closeTab(tab(0))

    expect({ order: session.tabs().map((t) => t.path()), active: session.active()?.path() }).toEqual({
      order: ['/b.md'],
      active: '/b.md',
    })
  })

  it('asks before closing a dirty tab; cancel keeps it and goes back to the tab you were on', async () => {
    const { session, tab, prompts } = harness()
    await session.openPath('/docs/a.md')
    await session.openPath('/docs/b.md')
    tab(0).dirty = true

    const closing = session.closeTab(tab(0))
    await prompts.answer('cancel')
    await closing

    expect({ asked: prompts.asked, destroyed: tab(0).destroyed, active: session.active()?.path() }).toEqual({
      asked: [{ kind: 'close-tab', name: 'a.md' }],
      destroyed: false,
      active: '/docs/b.md',
    })
  })

  it('discarding closes the dirty tab', async () => {
    const { session, tab, prompts } = harness()
    await session.openPath('/docs/a.md')
    await session.openPath('/docs/b.md')
    tab(0).dirty = true

    const closing = session.closeTab(tab(0))
    await prompts.answer('discard')
    await closing

    expect({ decisions: tab(0).decisions, destroyed: tab(0).destroyed, active: session.active()?.path() }).toEqual({
      decisions: ['discard'],
      destroyed: true,
      active: '/docs/b.md',
    })
  })

  it('waits for an in-flight save before releasing the tab', async () => {
    // 评审关注第 2 条：⌘S 之后立刻 ⌘W。
    const { session, tab } = harness()
    await session.openPath('/a.md')
    await session.openPath('/b.md')
    let release = (): void => {}
    tab(0).whenSavesSettle = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })

    const closing = session.closeTab(tab(0))
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    const beforeSettle = tab(0).destroyed
    release()
    await closing

    expect({ beforeSettle, afterSettle: tab(0).destroyed }).toEqual({ beforeSettle: false, afterSettle: true })
  })

  it('closing the last tab closes the window', async () => {
    const { session, tab, backend } = harness()
    await session.openPath('/a.md')

    await session.closeTab(tab(0))

    expect({ tabs: session.tabs().length, completed: backend.completeLeave.mock.calls }).toEqual({
      tabs: 0,
      completed: [['close']],
    })
  })

  it('closing the window asks for each dirty tab in order; cancel on any aborts the whole close', async () => {
    const { session, tab, prompts, backend } = harness()
    await session.openPath('/docs/a.md')
    await session.openPath('/docs/b.md')
    await session.openPath('/docs/c.md')
    tab(0).dirty = true
    tab(2).dirty = true

    const leaving = session.leave('close')
    await prompts.answer('discard')
    await prompts.answer('cancel')
    await leaving

    expect({
      asked: prompts.asked,
      cancelled: backend.cancelLeave.mock.calls.length,
      completed: backend.completeLeave.mock.calls.length,
      tabs: session.tabs().length,
    }).toEqual({
      asked: [
        { kind: 'close', name: 'a.md' },
        { kind: 'close', name: 'c.md' },
      ],
      cancelled: 1,
      completed: 0,
      tabs: 3,
    })
  })

  it('exits once every dirty tab is resolved and every save has settled', async () => {
    const { session, tab, prompts, backend } = harness()
    await session.openPath('/docs/a.md')
    await session.openPath('/docs/b.md')
    tab(1).dirty = true
    const settled: string[] = []
    tab(0).whenSavesSettle = async () => {
      settled.push('a')
    }
    tab(1).whenSavesSettle = async () => {
      settled.push('b')
    }

    const leaving = session.leave('exit')
    await prompts.answer('save')
    await leaving

    expect({ settled: settled.sort(), completed: backend.completeLeave.mock.calls }).toEqual({
      settled: ['a', 'b'],
      completed: [['exit']],
    })
  })

  it('leaves at once when nothing is dirty', async () => {
    const { session, prompts, backend } = harness()
    await session.openPath('/a.md')

    await session.leave('close')

    expect({ asked: prompts.asked.length, completed: backend.completeLeave.mock.calls }).toEqual({
      asked: 0,
      completed: [['close']],
    })
  })

  it('a window close requested while a close-tab prompt is open waits for that prompt', async () => {
    // 评审关注第 5 条。
    const { session, tab, prompts, backend } = harness()
    await session.openPath('/docs/a.md')
    await session.openPath('/docs/b.md')
    tab(0).dirty = true

    const closing = session.closeTab(tab(0))
    const leaving = session.leave('close')
    await prompts.answer('discard')
    await Promise.all([closing, leaving])

    expect({ asked: prompts.asked, completed: backend.completeLeave.mock.calls }).toEqual({
      asked: [{ kind: 'close-tab', name: 'a.md' }],
      completed: [['close']],
    })
  })

  it('routes external changes by generation and ignores unknown ones', async () => {
    // 评审关注第 3 条。
    const { session, tab } = harness()
    await session.openPath('/a.md')
    await session.openPath('/b.md')

    session.diskChanged(2)
    session.diskChanged(99)

    expect([tab(0).diskChanges, tab(1).diskChanges]).toEqual([[], [2]])
  })

  it('cycles through tabs in both directions', async () => {
    const { session } = harness()
    await session.openPath('/a.md')
    await session.openPath('/b.md')

    session.cycle(1)
    const forward = session.active()?.path()
    session.cycle(-1)

    expect([forward, session.active()?.path()]).toEqual(['/a.md', '/b.md'])
  })

  it('a mode chosen with no tab open becomes the mode of the next tab', async () => {
    const { session, created } = harness()
    session.setMode('source')
    await session.openPath('/a.md')

    expect([session.idleMode(), created[0]?.mode()]).toEqual(['source', 'source'])
  })
})
