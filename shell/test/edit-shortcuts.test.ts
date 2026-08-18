import { describe, expect, it, vi } from 'vitest'
import { connectEditShortcuts } from '../src/edit-shortcuts.js'

describe('edit shortcuts', () => {
  it.each([
    ['1', 'read'],
    ['2', 'source'],
    ['3', 'split'],
  ] as const)('maps Ctrl/%s to %s mode', (key, mode) => {
    const setMode = vi.fn()
    const stop = connectEditShortcuts(window, { setMode, save: vi.fn() })
    const event = new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true })
    window.dispatchEvent(event)
    expect(setMode).toHaveBeenCalledWith(mode)
    expect(event.defaultPrevented).toBe(true)
    stop()
  })

  it('captures Ctrl+S but ignores unmodified, shifted, repeated, and already handled keys', () => {
    const save = vi.fn()
    const stop = connectEditShortcuts(window, { setMode: vi.fn(), save })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, repeat: true }))
    const handled = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })
    handled.preventDefault()
    window.dispatchEvent(handled)
    expect(save).not.toHaveBeenCalled()

    const real = new KeyboardEvent('keydown', { key: 'S', ctrlKey: true, cancelable: true })
    window.dispatchEvent(real)
    expect(save).toHaveBeenCalledTimes(1)
    expect(real.defaultPrevented).toBe(true)
    stop()
  })
})
