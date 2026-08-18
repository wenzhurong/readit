import { describe, expect, it, vi } from 'vitest'
import { connectFindShortcut } from '../src/find-shortcut.js'

function keydown(init: KeyboardEventInit): KeyboardEvent {
  const input = document.createElement('input')
  document.body.append(input)
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'f',
    ...init,
  })
  input.dispatchEvent(event)
  input.remove()
  return event
}

describe('platform find-shortcut bridge', () => {
  it('captures Meta+F before the focused document surface and opens the current handle', () => {
    const find = vi.fn()
    let downstream = 0
    const onDocumentKeydown = (): void => {
      downstream += 1
    }
    document.addEventListener('keydown', onDocumentKeydown)
    const stop = connectFindShortcut(window, () => ({ find }), 'macos')

    const event = keydown({ metaKey: true })

    expect([find.mock.calls.length, event.defaultPrevented, downstream]).toEqual([1, true, 0])
    stop()
    document.removeEventListener('keydown', onDocumentKeydown)
  })

  it('repeats find() so an already-open bar can refocus and select its query', () => {
    const find = vi.fn()
    const stop = connectFindShortcut(window, () => ({ find }), 'macos')

    keydown({ metaKey: true })
    keydown({ metaKey: true })

    expect(find.mock.calls.length).toBe(2)
    stop()
  })

  it('leaves non-Cmd+F chords and the no-document state untouched', () => {
    const find = vi.fn()
    const stop = connectFindShortcut(window, () => ({ find }), 'macos')
    const events = [
      keydown({ ctrlKey: true }),
      keydown({ metaKey: true, shiftKey: true }),
      keydown({ metaKey: true, key: 'g' }),
    ]
    stop()
    const stopWithoutDocument = connectFindShortcut(window, () => null, 'macos')
    events.push(keydown({ metaKey: true }))

    expect({ calls: find.mock.calls.length, prevented: events.map((event) => event.defaultPrevented) }).toEqual({
      calls: 0,
      prevented: [false, false, false, false],
    })
    stopWithoutDocument()
  })

  it('removes the capture listener on teardown', () => {
    const find = vi.fn()
    const stop = connectFindShortcut(window, () => ({ find }), 'macos')
    stop()

    const event = keydown({ metaKey: true })

    expect([find.mock.calls.length, event.defaultPrevented]).toEqual([0, false])
  })

  it('captures Control+F on Windows without stealing Meta+F', () => {
    const find = vi.fn()
    const stop = connectFindShortcut(window, () => ({ find }), 'windows')

    const control = keydown({ ctrlKey: true })
    const meta = keydown({ metaKey: true })

    expect({ calls: find.mock.calls.length, control: control.defaultPrevented, meta: meta.defaultPrevented }).toEqual({
      calls: 1,
      control: true,
      meta: false,
    })
    stop()
  })
})
