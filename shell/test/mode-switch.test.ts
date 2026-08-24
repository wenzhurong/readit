import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectModeSwitch, type ShellMode } from '../src/mode-switch.js'

function makeRoot(modes: readonly string[] = ['read', 'source', 'split']): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = modes
    .map((mode) => `<button type="button" data-mode="${mode}" aria-pressed="false"></button>`)
    .join('')
  document.body.append(root)
  return root
}

const pressed = (root: HTMLElement): Record<string, string | null> =>
  Object.fromEntries(
    [...root.querySelectorAll<HTMLButtonElement>('button[data-mode]')].map((button) => [
      button.dataset.mode ?? '',
      button.getAttribute('aria-pressed'),
    ]),
  )

describe('桌面壳的模式切换按钮', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('点击把模式意图交给壳，三个按钮各报各的', () => {
    const root = makeRoot()
    const onSelect = vi.fn<(mode: ShellMode) => void>()
    connectModeSwitch(root, { onSelect, shortcutModifier: '⌘' })

    for (const mode of ['read', 'source', 'split']) {
      root.querySelector<HTMLButtonElement>(`button[data-mode="${mode}"]`)!.click()
    }

    expect(onSelect.mock.calls.flat()).toEqual(['read', 'source', 'split'])
  })

  it('点击本身不改变按钮状态 —— 状态只能由壳回灌', () => {
    // 承重断言。菜单、快捷键、按钮是三条入口，若按钮自己也记一份状态，
    // 从菜单或快捷键切换时按钮就会与真实模式脱节。
    const root = makeRoot()
    const handle = connectModeSwitch(root, { onSelect: () => {}, shortcutModifier: '⌘' })
    handle.setMode('read')

    root.querySelector<HTMLButtonElement>('button[data-mode="split"]')!.click()

    expect(pressed(root)).toEqual({ read: 'true', source: 'false', split: 'false' })
  })

  it('setMode() 只让一个按钮处于按下态', () => {
    const root = makeRoot()
    const handle = connectModeSwitch(root, { onSelect: () => {}, shortcutModifier: '⌘' })

    handle.setMode('source')
    const afterSource = pressed(root)
    handle.setMode('split')

    expect({ afterSource, afterSplit: pressed(root) }).toEqual({
      afterSource: { read: 'false', source: 'true', split: 'false' },
      afterSplit: { read: 'false', source: 'false', split: 'true' },
    })
  })

  it('title 带上本平台的快捷键，编号与 CmdOrCtrl+1/2/3 对齐', () => {
    const mac = makeRoot()
    connectModeSwitch(mac, { onSelect: () => {}, shortcutModifier: '⌘' })
    const win = makeRoot()
    connectModeSwitch(win, { onSelect: () => {}, shortcutModifier: 'Ctrl+' })

    expect({
      mac: [...mac.querySelectorAll('button')].map((b) => b.title),
      win: [...win.querySelectorAll('button')].map((b) => b.title),
    }).toEqual({
      mac: ['阅读模式（⌘1）', '源码模式（⌘2）', '分栏模式（⌘3）'],
      win: ['阅读模式（Ctrl+1）', '源码模式（Ctrl+2）', '分栏模式（Ctrl+3）'],
    })
  })

  it('destroy() 之后点击不再上报', () => {
    const root = makeRoot()
    const onSelect = vi.fn<(mode: ShellMode) => void>()
    const handle = connectModeSwitch(root, { onSelect, shortcutModifier: '⌘' })

    handle.destroy()
    root.querySelector<HTMLButtonElement>('button[data-mode="source"]')!.click()

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('缺按钮时大声失败 —— 少一个按钮就是少一条入口，正是本控件要修的问题', () => {
    const root = makeRoot(['read', 'source'])
    expect(() => connectModeSwitch(root, { onSelect: () => {}, shortcutModifier: '⌘' })).toThrow(
      /split/,
    )
  })
})
