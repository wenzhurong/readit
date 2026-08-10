import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDisposers } from '../src/disposers.js'
import { createThemeController, readColorScheme, resolveTheme } from '../src/theme.js'

/**
 * 主题解析用注入进来的 view 测，不测 happy-dom 的 getComputedStyle——
 * 被测的是「light dark / normal / 空串各该判成什么」这段逻辑，而不是某个
 * DOM 实现的 CSS 支持度。真实 computed color-scheme 归 L3b-element。
 */
class FakeMediaQueryList extends EventTarget {
  constructor(public matches: boolean) {
    super()
  }
  change(matches: boolean): void {
    this.matches = matches
    this.dispatchEvent(new Event('change'))
  }
}

function fakeView(colorScheme: string, mql: FakeMediaQueryList): Window {
  return {
    getComputedStyle: () => ({ colorScheme }) as CSSStyleDeclaration,
    matchMedia: () => mql as unknown as MediaQueryList,
  } as unknown as Window
}

let host: HTMLElement

beforeEach(() => {
  host = document.createElement('div')
})

describe('readColorScheme', () => {
  it.each([
    ['dark', 'dark'],
    ['light', 'light'],
    ['only dark', 'dark'],
    ['DARK', 'dark'],
  ])('color-scheme:%s 判成 %s', (raw, want) => {
    expect(readColorScheme(host, fakeView(raw, new FakeMediaQueryList(false)))).toBe(want)
  })

  it.each([['normal'], [''], ['light dark'], ['dark light']])(
    'color-scheme:%j 交给 prefers-color-scheme 定夺',
    (raw) => {
      expect(readColorScheme(host, fakeView(raw, new FakeMediaQueryList(false)))).toBeNull()
    },
  )
})

describe('resolveTheme', () => {
  it('显式 light/dark 压过一切', () => {
    const view = fakeView('dark', new FakeMediaQueryList(true))
    expect(resolveTheme('light', host, view)).toBe('light')
    expect(resolveTheme('dark', host, view)).toBe('dark')
  })

  it('auto 优先读 color-scheme', () => {
    expect(resolveTheme('auto', host, fakeView('dark', new FakeMediaQueryList(false)))).toBe('dark')
  })

  it('auto 在 color-scheme 未定时回落 prefers-color-scheme', () => {
    expect(resolveTheme('auto', host, fakeView('normal', new FakeMediaQueryList(true)))).toBe('dark')
    expect(resolveTheme('auto', host, fakeView('normal', new FakeMediaQueryList(false)))).toBe('light')
  })
})

describe('createThemeController', () => {
  it('把解析结果写在宿主的 data-theme 上，destroy 时撤掉', () => {
    const disposers = createDisposers()
    const controller = createThemeController(
      host,
      fakeView('normal', new FakeMediaQueryList(false)),
      'auto',
      () => {},
      disposers,
    )
    expect(controller.resolved).toBe('light')
    expect(host.getAttribute('data-theme')).toBe('light')
    disposers.disposeAll()
    expect(host.getAttribute('data-theme')).toBeNull()
  })

  it('系统主题变化时重解析，并只在结果真的变了才回调', () => {
    const mql = new FakeMediaQueryList(false)
    const onResolved = vi.fn()
    const disposers = createDisposers()
    createThemeController(host, fakeView('normal', mql), 'auto', onResolved, disposers)

    mql.change(true)
    expect(onResolved).toHaveBeenCalledExactlyOnceWith('dark')
    expect(host.getAttribute('data-theme')).toBe('dark')

    mql.change(true)
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  it('theme 不是 auto 时忽略系统主题变化', () => {
    const mql = new FakeMediaQueryList(false)
    const onResolved = vi.fn()
    const disposers = createDisposers()
    const controller = createThemeController(host, fakeView('normal', mql), 'auto', onResolved, disposers)
    controller.set('light')
    onResolved.mockClear()
    mql.change(true)
    expect(onResolved).not.toHaveBeenCalled()
    expect(controller.resolved).toBe('light')
  })

  it('disposeAll 之后不再收系统主题变化', () => {
    const mql = new FakeMediaQueryList(false)
    const onResolved = vi.fn()
    const disposers = createDisposers()
    createThemeController(host, fakeView('normal', mql), 'auto', onResolved, disposers)
    disposers.disposeAll()
    mql.change(true)
    expect(onResolved).not.toHaveBeenCalled()
    expect(disposers.size).toBe(0)
  })
})
