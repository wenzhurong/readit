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

describe('Cmd+F shell bridge', () => {
  it('captures Meta+F before the focused document surface and opens the current handle', () => {
    const find = vi.fn()
    let downstream = 0
    const onDocumentKeydown = (): void => {
      downstream += 1
    }
    document.addEventListener('keydown', onDocumentKeydown)
    const stop = connectFindShortcut(window, () => ({ find }))

    const event = keydown({ metaKey: true })

    expect([find.mock.calls.length, event.defaultPrevented, downstream]).toEqual([1, true, 0])
    stop()
    document.removeEventListener('keydown', onDocumentKeydown)
  })

  it('repeats find() so an already-open bar can refocus and select its query', () => {
    const find = vi.fn()
    const stop = connectFindShortcut(window, () => ({ find }))

    keydown({ metaKey: true })
    keydown({ metaKey: true })

    expect(find.mock.calls.length).toBe(2)
    stop()
  })

  it('leaves non-Cmd+F chords and the no-document state untouched', () => {
    const find = vi.fn()
    const stop = connectFindShortcut(window, () => ({ find }))
    const events = [
      keydown({ ctrlKey: true }),
      keydown({ metaKey: true, shiftKey: true }),
      keydown({ metaKey: true, key: 'g' }),
    ]
    stop()
    const stopWithoutDocument = connectFindShortcut(window, () => null)
    events.push(keydown({ metaKey: true }))

    expect({ calls: find.mock.calls.length, prevented: events.map((event) => event.defaultPrevented) }).toEqual({
      calls: 0,
      prevented: [false, false, false, false],
    })
    stopWithoutDocument()
  })

  it('removes the capture listener on teardown', () => {
    const find = vi.fn()
    const stop = connectFindShortcut(window, () => ({ find }))
    stop()

    const event = keydown({ metaKey: true })

    expect([find.mock.calls.length, event.defaultPrevented]).toEqual([0, false])
  })
})
