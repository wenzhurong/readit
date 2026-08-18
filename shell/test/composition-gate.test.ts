import { describe, expect, it, vi } from 'vitest'
import { createCompositionGate } from '../src/composition-gate.js'

describe('composition gate', () => {
  it('waits for compositionend and the editor settlement boundary', async () => {
    const host = document.createElement('div')
    const settle = vi.fn(async () => {})
    const gate = createCompositionGate(host, settle)
    host.dispatchEvent(new CompositionEvent('compositionstart'))
    let passed = false
    const waiting = gate.wait().then(() => { passed = true })
    await Promise.resolve()
    expect(passed).toBe(false)

    host.dispatchEvent(new CompositionEvent('compositionend'))
    await waiting
    expect(settle).toHaveBeenCalledTimes(1)
    expect(passed).toBe(true)
    gate.destroy()
  })

  it('does not delay ordinary operations and releases a waiter during teardown', async () => {
    const host = document.createElement('div')
    const gate = createCompositionGate(host, async () => {})
    await expect(gate.wait()).resolves.toBeUndefined()
    host.dispatchEvent(new CompositionEvent('compositionstart'))
    const waiting = gate.wait()
    gate.destroy()
    await expect(waiting).resolves.toBeUndefined()
  })
})
