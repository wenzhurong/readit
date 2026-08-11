import { addListener, type Disposers } from './disposers.js'
import type { Theme } from './types.js'

export type ResolvedTheme = 'light' | 'dark'

/**
 * `color-scheme` 是继承属性、跨 shadow 边界，所以宿主设在 :root、设在 .dark
 * 包装器上还是压根没设都工作（SPEC §9.2）。
 *
 * 没设时它的计算值是 `normal`，`light dark` 则表示两种都支持——这两种都不构成
 * 一个判定，交给 prefers-color-scheme。返回 null 表示「没判定」，不是「light」。
 */
export function readColorScheme(host: HTMLElement, view: Window): ResolvedTheme | null {
  let raw = ''
  try {
    raw = view.getComputedStyle(host).colorScheme
  } catch {
    raw = ''
  }
  const words = (raw ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '' && word !== 'only')
  const hasLight = words.includes('light')
  const hasDark = words.includes('dark')
  if (hasDark && !hasLight) return 'dark'
  if (hasLight && !hasDark) return 'light'
  return null
}

export function prefersDark(view: Window): boolean {
  if (typeof view.matchMedia !== 'function') return false
  return view.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(theme: Theme, host: HTMLElement, view: Window): ResolvedTheme {
  if (theme === 'light' || theme === 'dark') return theme
  return readColorScheme(host, view) ?? (prefersDark(view) ? 'dark' : 'light')
}

export interface ThemeController {
  readonly requested: Theme
  readonly resolved: ResolvedTheme
  set(theme: Theme): void
}

/**
 * 已知局限，写在这里而不是留给人发现：宿主在运行时改 `color-scheme`（例如给
 * :root 加 .dark 类）是观察不到的，CSS 没有这样的事件。宿主要么用 theme:'light'
 * /'dark' 显式驱动，要么在切换后再调一次 setTheme('auto')。系统主题变化则通过
 * prefers-color-scheme 的 matchMedia 收到。
 */
export function createThemeController(
  host: HTMLElement,
  view: Window,
  initial: Theme,
  onResolved: (resolved: ResolvedTheme) => void,
  disposers: Disposers,
): ThemeController {
  let requested = initial
  let resolved = resolveTheme(requested, host, view)

  const apply = (next: ResolvedTheme): void => {
    if (next === resolved) return
    resolved = next
    host.setAttribute('data-theme', resolved)
    onResolved(resolved)
  }

  host.setAttribute('data-theme', resolved)
  disposers.add(() => {
    host.removeAttribute('data-theme')
  })

  if (typeof view.matchMedia === 'function') {
    const mql = view.matchMedia('(prefers-color-scheme: dark)')
    addListener(disposers, mql, 'change', () => {
      if (requested === 'auto') apply(resolveTheme('auto', host, view))
    })
  }

  return {
    get requested(): Theme {
      return requested
    },
    get resolved(): ResolvedTheme {
      return resolved
    },
    set(theme: Theme): void {
      requested = theme
      apply(resolveTheme(theme, host, view))
    },
  }
}
