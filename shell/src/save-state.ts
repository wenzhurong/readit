export interface SaveDocumentRef {
  readonly path: string
  readonly source: string
  readonly generation: number
}

export interface SaveStateSnapshot {
  readonly path: string | null
  readonly generation: number | null
  readonly currentValue: string
  readonly savedValue: string
  readonly observedDiskValue: string
  readonly dirty: boolean
  readonly saving: boolean
  readonly conflictValue: string | null
}

export type ConflictDecision = 'use-disk' | 'keep-mine'
export type LeaveDecision = 'save' | 'discard' | 'cancel'

export interface SaveStateDependencies {
  write(content: string, generation: number): Promise<void>
  applyValue(value: string): void
  stateChanged(state: SaveStateSnapshot): void
  conflictChanged(value: string | null): void
  reportError(error: unknown): void
}

export interface SaveStateController {
  load(document: SaveDocumentRef): void
  userChanged(value: string): void
  save(): Promise<boolean>
  diskChanged(value: string): void
  resolveConflict(decision: ConflictDecision): void
  prepareToLeave(decision: LeaveDecision): Promise<boolean>
  whenSavesSettle(): Promise<void>
  snapshot(): SaveStateSnapshot
}

interface MutableState {
  path: string | null
  generation: number | null
  currentValue: string
  savedValue: string
  observedDiskValue: string
  dirty: boolean
  conflictValue: string | null
  dismissedDiskValue: string | null
}

export function createSaveState(deps: SaveStateDependencies): SaveStateController {
  const state: MutableState = {
    path: null,
    generation: null,
    currentValue: '',
    savedValue: '',
    observedDiskValue: '',
    dirty: false,
    conflictValue: null,
    dismissedDiskValue: null,
  }
  const savingByGeneration = new Map<number, number>()
  const expectedWritesByGeneration = new Map<number, Map<string, number>>()
  let saveTail: Promise<void> = Promise.resolve()

  const snapshot = (): SaveStateSnapshot => ({
    path: state.path,
    generation: state.generation,
    currentValue: state.currentValue,
    savedValue: state.savedValue,
    observedDiskValue: state.observedDiskValue,
    dirty: state.dirty,
    saving: state.generation !== null && (savingByGeneration.get(state.generation) ?? 0) > 0,
    conflictValue: state.conflictValue,
  })

  const announceState = (): void => deps.stateChanged(snapshot())
  const setConflict = (value: string | null): void => {
    if (state.conflictValue === value) return
    state.conflictValue = value
    deps.conflictChanged(value)
  }
  const recomputeDirty = (): void => {
    state.dirty = state.currentValue !== state.savedValue
  }
  const trackSaving = (generation: number, delta: 1 | -1): void => {
    const next = (savingByGeneration.get(generation) ?? 0) + delta
    if (next === 0) savingByGeneration.delete(generation)
    else savingByGeneration.set(generation, next)
    if (state.generation === generation) announceState()
  }
  const trackExpectedWrite = (generation: number, value: string, delta: 1 | -1): void => {
    let values = expectedWritesByGeneration.get(generation)
    if (values === undefined) {
      if (delta === -1) return
      values = new Map()
      expectedWritesByGeneration.set(generation, values)
    }
    const next = (values.get(value) ?? 0) + delta
    if (next === 0) values.delete(value)
    else values.set(value, next)
    if (values.size === 0) expectedWritesByGeneration.delete(generation)
  }

  const controller: SaveStateController = {
    load(document): void {
      state.path = document.path
      state.generation = document.generation
      state.currentValue = document.source
      state.savedValue = document.source
      state.observedDiskValue = document.source
      state.dirty = false
      state.dismissedDiskValue = null
      setConflict(null)
      announceState()
    },

    userChanged(value): void {
      if (state.generation === null) return
      state.currentValue = value
      recomputeDirty()
      announceState()
    },

    save(): Promise<boolean> {
      const generation = state.generation
      if (generation === null) {
        const error = new Error('cannot save: no Markdown document is open')
        deps.reportError(error)
        return Promise.resolve(false)
      }
      const value = state.currentValue
      trackSaving(generation, 1)

      const result = saveTail.then(async () => {
        const observedAtStart = state.generation === generation ? state.observedDiskValue : ''
        trackExpectedWrite(generation, value, 1)
        try {
          await deps.write(value, generation)
          if (state.generation === generation) {
            // This is the snapshot that reached disk, not necessarily the value the user is
            // looking at now. Editing while the IPC is in flight must therefore stay dirty.
            state.savedValue = value
            // A conflict already observed when Save started has now been overwritten. Preserve a
            // different value observed while the write was in flight: that one happened later.
            if (state.observedDiskValue === observedAtStart || state.observedDiskValue === value) {
              state.observedDiskValue = value
              state.dismissedDiskValue = null
              setConflict(null)
            } else {
              // The watcher read a different value after Rust released the save lock. That value
              // is the actual disk baseline now, so keeping our current text must remain dirty.
              state.savedValue = state.observedDiskValue
              if (state.currentValue === state.observedDiskValue) setConflict(null)
            }
            recomputeDirty()
            announceState()
          }
          return true
        } catch (error) {
          if (state.generation === generation) deps.reportError(error)
          return false
        } finally {
          trackExpectedWrite(generation, value, -1)
          trackSaving(generation, -1)
        }
      })
      saveTail = result.then(() => undefined, () => undefined)
      return result
    },

    diskChanged(value): void {
      if (state.generation === null) return
      state.observedDiskValue = value

      if (value === state.currentValue) {
        // The bytes visible in the editor are now on disk, whether written by readit or by an
        // external tool. No setValue call is needed, but the document is no longer dirty.
        state.savedValue = value
        state.dismissedDiskValue = null
        setConflict(null)
        recomputeDirty()
        announceState()
        return
      }

      if (value === state.savedValue) {
        // A delayed watcher echo from our most recent completed save. The user may already have
        // typed a newer value; keep that newer value dirty without manufacturing a conflict.
        setConflict(null)
        announceState()
        return
      }

      if ((expectedWritesByGeneration.get(state.generation)?.get(value) ?? 0) > 0) {
        // The filesystem notification can beat resolution of the IPC promise even though the
        // atomic replacement has already happened. A requested snapshot is deterministic evidence
        // of our own write; do not flash an external-conflict prompt while the response is in flight.
        setConflict(null)
        announceState()
        return
      }

      if (!state.dirty) {
        state.currentValue = value
        state.savedValue = value
        state.dismissedDiskValue = null
        setConflict(null)
        deps.applyValue(value)
        recomputeDirty()
        announceState()
        return
      }

      if (state.dismissedDiskValue === value) {
        announceState()
        return
      }
      setConflict(value)
      announceState()
    },

    resolveConflict(decision): void {
      const value = state.conflictValue
      if (value === null) return
      if (decision === 'use-disk') {
        state.currentValue = value
        state.savedValue = value
        state.observedDiskValue = value
        state.dismissedDiskValue = null
        setConflict(null)
        deps.applyValue(value)
        recomputeDirty()
      } else {
        state.dismissedDiskValue = value
        state.observedDiskValue = value
        setConflict(null)
        state.savedValue = value
        recomputeDirty()
      }
      announceState()
    },

    async prepareToLeave(decision): Promise<boolean> {
      if (!state.dirty) return true
      if (decision === 'cancel') return false
      if (decision === 'discard') return true
      const saved = await controller.save()
      // If the user kept typing while the save was in flight, the snapshot that reached disk is
      // valid but the current editor value is still dirty. Do not navigate or close over it.
      return saved && !state.dirty
    },

    async whenSavesSettle(): Promise<void> {
      await saveTail
    },

    snapshot,
  }

  announceState()
  return controller
}
