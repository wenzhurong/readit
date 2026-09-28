import { describe, expect, it, vi } from 'vitest'
import { connectTabShortcuts } from '../src/tab-shortcuts.js'

describe('tab shortcuts', () => {
  it('Ctrl+Tab goes to the next tab and Ctrl+Shift+Tab to the previous one', () => {
    const next = vi.fn()
    const previous = vi.fn()
    const stop = connectTabShortcuts(window, { next, previous })
    const forward = new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, cancelable: true })
    window.dispatchEvent(forward)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, shiftKey: true, cancelable: true }))
    expect({ next: next.mock.calls.length, previous: previous.mock.calls.length, prevented: forward.defaultPrevented }).toEqual({
      next: 1,
      previous: 1,
      prevented: true,
    })
    stop()
  })

  it('leaves plain Tab, Cmd+Tab and Alt+Ctrl+Tab alone', () => {
    const next = vi.fn()
    const stop = connectTabShortcuts(window, { next, previous: vi.fn() })
    for (const init of [{}, { metaKey: true }, { ctrlKey: true, metaKey: true }, { ctrlKey: true, altKey: true }]) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true, ...init }))
    }
    expect(next).not.toHaveBeenCalled()
    stop()
  })
})
