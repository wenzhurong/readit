import { describe, expect, it, vi } from 'vitest'
import { connectEditShortcuts } from '../src/edit-shortcuts.js'

describe('edit shortcuts', () => {
  it.each([
    ['1', 'read'],
    ['2', 'source'],
    ['3', 'split'],
  ] as const)('maps Ctrl/%s to %s mode', (key, mode) => {
    const setMode = vi.fn()
    const stop = connectEditShortcuts(window, { setMode, save: vi.fn(), open: vi.fn(), closeTab: vi.fn() })
    const event = new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true })
    window.dispatchEvent(event)
    expect(setMode).toHaveBeenCalledWith(mode)
    expect(event.defaultPrevented).toBe(true)
    stop()
  })

  it('captures Ctrl+S but ignores unmodified, shifted, repeated, and already handled keys', () => {
    const save = vi.fn()
    const stop = connectEditShortcuts(window, { setMode: vi.fn(), save, open: vi.fn(), closeTab: vi.fn() })
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

  it('Ctrl+O opens and Ctrl+W closes the tab; holding Ctrl+W does not close tab after tab', () => {
    const open = vi.fn()
    const closeTab = vi.fn()
    const stop = connectEditShortcuts(window, { setMode: vi.fn(), save: vi.fn(), open, closeTab })
    const openEvent = new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, cancelable: true })
    window.dispatchEvent(openEvent)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, cancelable: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, repeat: true, cancelable: true }))
    expect({ open: open.mock.calls.length, closeTab: closeTab.mock.calls.length, prevented: openEvent.defaultPrevented }).toEqual({
      open: 1,
      closeTab: 1,
      prevented: true,
    })
    stop()
  })
})
