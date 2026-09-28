import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWatchedDocumentReloader } from '../src/watch-reload.js'

describe('createWatchedDocumentReloader', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores other generations and coalesces bursts for the current one', async () => {
    vi.useFakeTimers()
    let current: number | null = 7
    const reload = vi.fn(async (_generation: number) => {})
    const reportError = vi.fn()
    const reloader = createWatchedDocumentReloader(() => current, reload, reportError, 80)

    reloader.handle({ generation: 6 })
    reloader.handle({ generation: 7 })
    reloader.handle({ generation: 7 })
    await vi.advanceTimersByTimeAsync(79)
    expect(reload).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(reload.mock.calls).toEqual([[7]])
    expect(reportError).not.toHaveBeenCalled()

    current = 8
    reloader.destroy()
  })

  it('drops a pending reload once the document has moved to another generation', async () => {
    // 评审关注第 3 条：事件晚到时，标签已经在标签内跳到了别的文档。
    vi.useFakeTimers()
    let current: number | null = 7
    const reload = vi.fn(async (_generation: number) => {})
    const reloader = createWatchedDocumentReloader(() => current, reload, vi.fn(), 80)

    reloader.handle({ generation: 7 })
    current = 8
    await vi.advanceTimersByTimeAsync(80)

    expect(reload).not.toHaveBeenCalled()
    reloader.destroy()
  })

  it('stays quiet when a reload fails after the document moved to another generation', async () => {
    // 评审关注第 3 条：读盘在途时标签被关掉（或在标签内跳走），Rust 回「generation 不在表里」。
    // 那个错误已经没人关心，不该弹出来。
    vi.useFakeTimers()
    let current: number | null = 7
    const reportError = vi.fn()
    const reload = vi.fn(async (_generation: number) => {
      current = null
      throw new Error('cannot reload: document generation 7 is not open')
    })
    const reloader = createWatchedDocumentReloader(() => current, reload, reportError, 80)

    reloader.handle({ generation: 7 })
    await vi.advanceTimersByTimeAsync(80)
    for (let i = 0; i < 5; i += 1) await Promise.resolve()

    expect({ reloads: reload.mock.calls.length, reported: reportError.mock.calls.length }).toEqual({
      reloads: 1,
      reported: 0,
    })
    reloader.destroy()
  })

  it('still reports a failed reload for the document that is still current', async () => {
    vi.useFakeTimers()
    const reportError = vi.fn()
    const failure = new Error('cannot read /docs/a.md: permission denied')
    const reloader = createWatchedDocumentReloader(
      () => 7,
      async () => {
        throw failure
      },
      reportError,
      80,
    )

    reloader.handle({ generation: 7 })
    await vi.advanceTimersByTimeAsync(80)
    for (let i = 0; i < 5; i += 1) await Promise.resolve()

    expect(reportError.mock.calls).toEqual([[failure]])
    reloader.destroy()
  })

  it('cancels a pending reload when destroyed', async () => {
    vi.useFakeTimers()
    const reload = vi.fn(async (_generation: number) => {})
    const reloader = createWatchedDocumentReloader(() => 7, reload, vi.fn(), 80)

    reloader.handle({ generation: 7 })
    reloader.destroy()
    await vi.advanceTimersByTimeAsync(80)

    expect(reload).not.toHaveBeenCalled()
  })
})
