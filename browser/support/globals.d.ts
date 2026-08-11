import type { ReaditFixtureApi } from '../fixtures/entry.js'

declare global {
  interface LeakCounters {
    listeners: number
    resizeObservers: number
    mutationObservers: number
  }

  interface Window {
    // §0 A9：统一全局名，见 browser/fixtures/entry.ts。
    readonly readitFixture: ReaditFixtureApi
    readonly __leaks: LeakCounters
    readonly __cspViolations: string[]
  }
}

export {}
