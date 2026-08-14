import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWatchedDocumentReloader } from '../src/watch-reload.js'

describe('createWatchedDocumentReloader', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores stale paths and coalesces bursts for the current document', async () => {
    vi.useFakeTimers()
    let currentPath: string | null = '/docs/current.md'
    const reload = vi.fn(async () => {})
    const reportError = vi.fn()
    const reloader = createWatchedDocumentReloader(
      () => currentPath,
      reload,
      reportError,
      80,
    )

    reloader.handle({ path: '/docs/old.md' })
    reloader.handle({ path: '/docs/current.md' })
    reloader.handle({ path: '/docs/current.md' })
    await vi.advanceTimersByTimeAsync(79)
    expect(reload).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledWith('/docs/current.md')
    expect(reportError).not.toHaveBeenCalled()

    currentPath = '/docs/next.md'
    reloader.destroy()
  })

  it('cancels a pending reload when destroyed', async () => {
    vi.useFakeTimers()
    const reload = vi.fn(async () => {})
    const reloader = createWatchedDocumentReloader(
      () => '/docs/current.md',
      reload,
      vi.fn(),
      80,
    )

    reloader.handle({ path: '/docs/current.md' })
    reloader.destroy()
    await vi.advanceTimersByTimeAsync(80)

    expect(reload).not.toHaveBeenCalled()
  })
})
