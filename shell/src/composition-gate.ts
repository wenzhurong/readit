export interface CompositionGate {
  wait(): Promise<void>
  destroy(): void
}

/**
 * Prevents shell-level writes/navigation from racing an IME pre-edit. Composition events cross
 * the open shadow boundary, so the shell can guard the editor without expanding element's public
 * API. The zero-delay task after compositionend lets the editor consume the committed DOM change;
 * it is an event-loop ordering boundary, not a guessed suppression window.
 */
export function createCompositionGate(
  target: Pick<HTMLElement, 'addEventListener' | 'removeEventListener'>,
  settle: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
): CompositionGate {
  let composing = false
  let destroyed = false
  let waiters: Array<() => void> = []

  const finish = (): void => {
    const pending = waiters
    waiters = []
    for (const resolve of pending) resolve()
  }
  const onStart = (): void => {
    if (!destroyed) composing = true
  }
  const onEnd = (): void => {
    if (destroyed) return
    composing = false
    void settle()
      .catch(() => {})
      .then(() => {
        if (!composing) finish()
      })
  }
  target.addEventListener('compositionstart', onStart, { capture: true })
  target.addEventListener('compositionend', onEnd, { capture: true })

  return {
    wait(): Promise<void> {
      if (destroyed || !composing) return Promise.resolve()
      return new Promise((resolve) => waiters.push(resolve))
    },

    destroy(): void {
      if (destroyed) return
      destroyed = true
      composing = false
      target.removeEventListener('compositionstart', onStart, { capture: true })
      target.removeEventListener('compositionend', onEnd, { capture: true })
      finish()
    },
  }
}
