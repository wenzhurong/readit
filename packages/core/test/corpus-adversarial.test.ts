import { describe, expect, it } from 'vitest'
import { render } from '../src/index.js'
import { discoverKarlcow, readKarlcow } from './corpus-adversarial.js'
import { PATHOLOGICAL_CASES } from './corpus/adversarial/pathological.js'

/**
 * SPEC §13.3: adversarial is not part of the snapshotted corpus (see NON_SNAPSHOT_DIRS in
 * corpus-harness.ts) — it has no oracle fixture to diff against. Instead it is two gates:
 *  - a no-throw gate over the vendored karlcow/markdown-testsuite (MIT) inputs
 *  - a timing gate over the cmark-derived pathological (quadratic-blowup) generators
 *
 * The timing gate measures wall-clock elapsed time around a synchronous `render()` call rather
 * than forcibly aborting mid-call: `render` has no await points, so nothing short of a worker
 * thread could actually preempt a true infinite loop, and this codebase has no such harness. What
 * this DOES catch — turning a silent multi-second stall into a loud, specific test failure — is
 * exactly the class of regression the budget is guarding against. Drafting measured the slowest
 * pathological case at 56ms on a bare markdown-it; 1000ms leaves an order of magnitude of margin
 * before this is suspected of being flaky rather than a real regression.
 */
const TIMEOUT_BUDGET_MS = 1000

describe('adversarial: karlcow inputs render without throwing', () => {
  for (const name of discoverKarlcow()) {
    it(`does not throw on ${name}`, () => {
      const src = readKarlcow(name)
      expect(() => render(src)).not.toThrow()
    })
  }
})

describe('adversarial: cmark pathological inputs stay under the timing budget', () => {
  for (const pathologicalCase of PATHOLOGICAL_CASES) {
    it(`renders ${pathologicalCase.name} within ${TIMEOUT_BUDGET_MS}ms`, () => {
      const src = pathologicalCase.source()
      const start = performance.now()
      expect(() => render(src)).not.toThrow()
      const elapsed = performance.now() - start
      expect(elapsed, `${pathologicalCase.name} took ${elapsed.toFixed(1)}ms`).toBeLessThan(TIMEOUT_BUDGET_MS)
    })
  }
})
