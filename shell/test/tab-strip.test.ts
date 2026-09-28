import { afterEach, describe, expect, it } from 'vitest'
import { connectTabStrip, type TabView } from '../src/tab-strip.js'

const VIEWS: readonly TabView[] = [
  { id: 1, label: 'a.md', path: '/docs/a.md', dirty: false, conflict: false },
  { id: 2, label: 'b.md', path: '/docs/b.md', dirty: true, conflict: true },
]

function strip() {
  const root = document.createElement('nav')
  root.innerHTML = '<div role="tablist"></div><button type="button" data-action="open">+</button>'
  document.body.append(root)
  const calls = { activate: [] as number[], close: [] as number[], open: 0 }
  const handle = connectTabStrip(root, {
    activate: (id) => calls.activate.push(id),
    close: (id) => calls.close.push(id),
    open: () => {
      calls.open += 1
    },
    shortcutModifier: 'Ctrl+',
  })
  handle.render(VIEWS, 1)
  const tab = (id: number): HTMLElement => {
    const found = root.querySelector<HTMLElement>(`[role="tab"][data-tab-id="${id}"]`)
    if (found === null) throw new Error(`no tab ${id}`)
    return found
  }
  return { root, calls, handle, tab }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('tab strip', () => {
  it('renders one tab per view with its label, dirty marker, selection, path and conflict marker', () => {
    const { root } = strip()
    const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) => ({
      label: tab.querySelector('.tab-label')?.textContent,
      selected: tab.getAttribute('aria-selected'),
      title: tab.title,
      conflict: tab.dataset['conflict'] ?? null,
      tabIndex: tab.tabIndex,
    }))
    expect(tabs).toEqual([
      { label: 'a.md', selected: 'true', title: '/docs/a.md', conflict: null, tabIndex: 0 },
      { label: '● b.md', selected: 'false', title: '/docs/b.md', conflict: 'true', tabIndex: -1 },
    ])
  })

  it('clicking a tab activates it; clicking its × closes it without activating', () => {
    const { tab, calls } = strip()
    tab(2).querySelector<HTMLElement>('.tab-label')?.click()
    tab(1).querySelector<HTMLButtonElement>('.tab-close')?.click()
    expect({ activate: calls.activate, close: calls.close }).toEqual({ activate: [2], close: [1] })
  })

  it('middle-click closes a tab', () => {
    const { tab, calls } = strip()
    const event = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true })
    tab(2).dispatchEvent(event)
    expect({ close: calls.close, prevented: event.defaultPrevented }).toEqual({ close: [2], prevented: true })
  })

  it('Enter and Space on a focused tab activate it', () => {
    const { tab, calls } = strip()
    tab(2).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    tab(1).dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    expect(calls.activate).toEqual([2, 1])
  })

  it('the + button opens, and its tooltip teaches the shortcut', () => {
    const { root, calls } = strip()
    const open = root.querySelector<HTMLButtonElement>('[data-action="open"]')
    open?.click()
    expect({ open: calls.open, title: open?.title }).toEqual({ open: 1, title: '打开…（Ctrl+O）' })
  })

  it('re-rendering replaces the tabs', () => {
    const { root, handle } = strip()
    handle.render([{ id: 3, label: 'c.md', path: '/c.md', dirty: false, conflict: false }], 3)
    expect([...root.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute('data-tab-id'))).toEqual(['3'])
  })

  it('destroy stops listening', () => {
    const { tab, calls, handle } = strip()
    handle.destroy()
    tab(2).querySelector<HTMLElement>('.tab-label')?.click()
    expect(calls.activate).toEqual([])
  })
})
