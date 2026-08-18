import { describe, expect, it, vi } from 'vitest'
import {
  createSaveState,
  type SaveStateDependencies,
  type SaveStateSnapshot,
} from '../src/save-state.js'

const FIRST = { path: '/docs/first.md', source: 'first', generation: 1 }

function deferred<T = void>(): {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function setup(overrides: Partial<SaveStateDependencies> = {}) {
  const states: SaveStateSnapshot[] = []
  const applyValue = vi.fn()
  const conflictChanged = vi.fn()
  const reportError = vi.fn()
  const write = vi.fn(async () => {})
  const controller = createSaveState({
    write,
    applyValue,
    stateChanged: (state) => states.push(state),
    conflictChanged,
    reportError,
    ...overrides,
  })
  controller.load(FIRST)
  return { controller, states, applyValue, conflictChanged, reportError, write }
}

describe('save state', () => {
  it('loads a clean baseline and only user edits make it dirty', () => {
    const { controller } = setup()
    expect(controller.snapshot()).toMatchObject({
      path: FIRST.path,
      generation: FIRST.generation,
      currentValue: 'first',
      savedValue: 'first',
      dirty: false,
    })

    controller.userChanged('edited')
    expect(controller.snapshot()).toMatchObject({ currentValue: 'edited', dirty: true })
  })

  it('saving A while the user edits to B records A as saved and leaves B dirty', async () => {
    const gate = deferred<void>()
    const { controller } = setup({ write: vi.fn(() => gate.promise) })
    controller.userChanged('A')
    const saving = controller.save()
    controller.userChanged('B')

    gate.resolve()
    expect(await saving).toBe(true)
    expect(controller.snapshot()).toMatchObject({
      currentValue: 'B',
      savedValue: 'A',
      dirty: true,
      saving: false,
    })
  })

  it('serializes repeated saves so an older completion cannot win', async () => {
    const first = deferred<void>()
    const second = deferred<void>()
    const write = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const { controller } = setup({ write })
    controller.userChanged('A')
    const saveA = controller.save()
    controller.userChanged('B')
    const saveB = controller.save()
    await Promise.resolve()
    expect(write).toHaveBeenCalledTimes(1)

    first.resolve()
    expect(await saveA).toBe(true)
    await Promise.resolve()
    expect(write).toHaveBeenNthCalledWith(2, 'B', 1)
    expect(controller.snapshot().dirty).toBe(true)

    second.resolve()
    expect(await saveB).toBe(true)
    expect(controller.snapshot()).toMatchObject({ savedValue: 'B', dirty: false })
  })

  it('keeps dirty state and reports a failed save', async () => {
    const error = new Error('disk full')
    const { controller, reportError } = setup({ write: vi.fn(async () => { throw error }) })
    controller.userChanged('edited')

    expect(await controller.save()).toBe(false)
    expect(controller.snapshot().dirty).toBe(true)
    expect(reportError).toHaveBeenCalledWith(error)
  })

  it('applies a changed disk value only while clean', () => {
    const { controller, applyValue } = setup()
    controller.diskChanged('external')

    expect(applyValue).toHaveBeenCalledWith('external')
    expect(controller.snapshot()).toMatchObject({
      currentValue: 'external',
      savedValue: 'external',
      observedDiskValue: 'external',
      dirty: false,
    })
  })

  it('deduplicates a rejected conflict and retains the newest disk value', () => {
    const { controller, conflictChanged } = setup()
    controller.userChanged('mine')
    controller.diskChanged('disk A')
    controller.diskChanged('disk A')
    expect(conflictChanged).toHaveBeenCalledTimes(1)

    controller.diskChanged('disk B')
    expect(conflictChanged).toHaveBeenLastCalledWith('disk B')
    controller.resolveConflict('keep-mine')
    controller.diskChanged('disk B')

    expect(conflictChanged.mock.calls.filter(([value]) => value === 'disk B')).toHaveLength(1)
    expect(controller.snapshot()).toMatchObject({
      currentValue: 'mine',
      observedDiskValue: 'disk B',
      dirty: true,
      conflictValue: null,
    })
  })

  it('using the disk version applies the latest conflict and clears dirty', () => {
    const { controller, applyValue } = setup()
    controller.userChanged('mine')
    controller.diskChanged('disk A')
    controller.diskChanged('disk B')
    controller.resolveConflict('use-disk')

    expect(applyValue).toHaveBeenCalledWith('disk B')
    expect(controller.snapshot()).toMatchObject({
      currentValue: 'disk B',
      savedValue: 'disk B',
      dirty: false,
      conflictValue: null,
    })
  })

  it('a successful save overwrites and clears the conflict that existed when it started', async () => {
    const { controller, conflictChanged } = setup()
    controller.userChanged('mine')
    controller.diskChanged('external')
    expect(controller.snapshot().conflictValue).toBe('external')

    await controller.save()

    expect(conflictChanged).toHaveBeenLastCalledWith(null)
    expect(controller.snapshot()).toMatchObject({
      currentValue: 'mine',
      savedValue: 'mine',
      observedDiskValue: 'mine',
      dirty: false,
      conflictValue: null,
    })
  })

  it('preserves a newer external value observed while saving as a real conflict', async () => {
    const gate = deferred<void>()
    const { controller } = setup({ write: vi.fn(() => gate.promise) })
    controller.userChanged('save snapshot')
    const saving = controller.save()
    await Promise.resolve()
    controller.userChanged('new local edit')
    controller.diskChanged('new external edit')
    gate.resolve()

    expect(await saving).toBe(true)
    expect(controller.snapshot()).toMatchObject({
      currentValue: 'new local edit',
      savedValue: 'new external edit',
      observedDiskValue: 'new external edit',
      dirty: true,
      conflictValue: 'new external edit',
    })
  })

  it('ignores a save watcher echo even when the event beats the save response', async () => {
    const gate = deferred<void>()
    const { controller, conflictChanged } = setup({ write: vi.fn(() => gate.promise) })
    controller.userChanged('saved A')
    const saving = controller.save()
    await Promise.resolve()
    controller.userChanged('new B')
    controller.diskChanged('saved A')

    expect(conflictChanged).not.toHaveBeenCalledWith('saved A')
    expect(controller.snapshot()).toMatchObject({ currentValue: 'new B', dirty: true })
    gate.resolve()
    expect(await saving).toBe(true)
    expect(controller.snapshot()).toMatchObject({ savedValue: 'saved A', dirty: true })
  })

  it('does not let an old generation completion change a newly loaded document', async () => {
    const gate = deferred<void>()
    const { controller } = setup({ write: vi.fn(() => gate.promise) })
    controller.userChanged('old edit')
    const saving = controller.save()
    controller.load({ path: '/docs/second.md', source: 'second', generation: 2 })

    gate.resolve()
    expect(await saving).toBe(true)
    expect(controller.snapshot()).toMatchObject({
      path: '/docs/second.md',
      currentValue: 'second',
      savedValue: 'second',
      dirty: false,
    })
  })

  it('requires save/discard/cancel semantics before leaving a dirty document', async () => {
    const { controller, write } = setup()
    controller.userChanged('edited')

    expect(await controller.prepareToLeave('cancel')).toBe(false)
    expect(await controller.prepareToLeave('discard')).toBe(true)
    expect(write).not.toHaveBeenCalled()
    expect(await controller.prepareToLeave('save')).toBe(true)
    expect(write).toHaveBeenCalledWith('edited', 1)
  })

  it('does not leave if the user types again while save-and-continue is in flight', async () => {
    const gate = deferred<void>()
    const { controller } = setup({ write: vi.fn(() => gate.promise) })
    controller.userChanged('save snapshot')
    const leaving = controller.prepareToLeave('save')
    controller.userChanged('newer unsaved text')
    gate.resolve()

    expect(await leaving).toBe(false)
    expect(controller.snapshot()).toMatchObject({
      savedValue: 'save snapshot',
      currentValue: 'newer unsaved text',
      dirty: true,
    })
  })
})
