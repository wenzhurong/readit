import type { Mode } from 'readit/element'

export type ShellMode = Extract<Mode, 'read' | 'source' | 'split'>

/** 按钮顺序与 CmdOrCtrl+1/2/3 一一对应，标题里的数字直接由下标推出。 */
const MODES: ReadonlyArray<readonly [ShellMode, string]> = [
  ['read', '阅读'],
  ['source', '源码'],
  ['split', '分栏'],
]

export interface ModeSwitchOptions {
  /** 用户点了某个模式。壳自己去做 setMode，本模块不碰文档。 */
  onSelect(mode: ShellMode): void
  /** 快捷键前缀：macOS 是 `⌘`，Windows 是 `Ctrl`。只用于 title 提示。 */
  readonly shortcutModifier: string
}

export interface ModeSwitchHandle {
  /** 由壳在模式真正变更后调用——按钮只反映状态，不自己决定状态。 */
  setMode(mode: ShellMode): void
  destroy(): void
}

/**
 * 桌面壳左上角的模式切换控件。
 *
 * ⚠️ 为什么需要它：在 **Windows 上编辑功能此前完全无从发现**。`build_menu` 是
 * `#[cfg(target_os = "macos")]`，Windows 根本没有应用菜单；`index.html` 里也没有任何
 * 模式控件，唯一入口是 `Ctrl+1/2/3`——不读 README 就不可能知道这个阅读器能编辑。
 * 台账 D2-28 记的是「够不着」，2026-08-18 靠菜单与快捷键还清了**可达性**，
 * 但**可发现性**一直没有解决。这个控件补的是后者。
 *
 * 按钮只发意图、不改状态：点击调 `onSelect`，真正的模式由壳统一裁决后回调 `setMode()`。
 * 这样菜单、快捷键、按钮三条入口共用同一条真相，不会各自记一份。
 */
export function connectModeSwitch(root: HTMLElement, options: ModeSwitchOptions): ModeSwitchHandle {
  const entries: Array<{ readonly mode: ShellMode; readonly button: HTMLButtonElement }> = []
  const listeners: Array<() => void> = []

  MODES.forEach(([mode, label], index) => {
    const button = root.querySelector<HTMLButtonElement>(`button[data-mode="${mode}"]`)
    // 大声失败：控件缺一个按钮就等于少一个入口，而少入口正是这个模块要修的问题。
    if (button === null) throw new Error(`readit shell is missing the ${mode} mode button`)
    button.title = `${label}模式（${options.shortcutModifier}${index + 1}）`
    const onClick = (): void => options.onSelect(mode)
    button.addEventListener('click', onClick)
    listeners.push(() => button.removeEventListener('click', onClick))
    entries.push({ mode, button })
  })

  return {
    setMode(mode) {
      for (const entry of entries) {
        entry.button.setAttribute('aria-pressed', String(entry.mode === mode))
      }
    },
    destroy() {
      for (const stop of listeners) stop()
    },
  }
}
