import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineReadit, DEFAULT_TAG } from '../src/index.js'

let mounted: HTMLElement[] = []

function attach(tag: string, attrs: Record<string, string>, text: string): HTMLElement {
  const el = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value)
  el.textContent = text
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

afterEach(() => {
  for (const el of mounted) el.remove()
  mounted = []
})

describe('defineReadit', () => {
  it('默认注册 readit-view', () => {
    defineReadit()
    expect(DEFAULT_TAG).toBe('readit-view')
    expect(customElements.get('readit-view')).toBeTypeOf('function')
  })

  /** 自动注册会让同页两个版本抛不可恢复的 NotSupportedError（SPEC §9.3）。 */
  it('重复调用是空操作，不抛 NotSupportedError', () => {
    defineReadit()
    expect(() => defineReadit()).not.toThrow()
  })

  it('可以用别的标签名，且两个标签名各自是独立的类', () => {
    defineReadit('readit-a')
    defineReadit('readit-b')
    expect(customElements.get('readit-a')).not.toBe(customElements.get('readit-b'))
  })

  it('连上 DOM 时用轻 DOM 里的源码当初始值，并把它清掉', () => {
    defineReadit('readit-c1')
    const el = attach('readit-c1', {}, '\n      # From light DOM\n    ')
    expect(el.shadowRoot?.querySelector('h1')?.textContent).toBe('From light DOM')
    expect(el.childNodes).toHaveLength(0)
  })

  it('mode / theme 属性是活的', () => {
    defineReadit('readit-c2')
    const el = attach('readit-c2', { mode: 'split' }, '# t\n')
    expect(el.shadowRoot?.querySelector('.readit-root')?.getAttribute('data-mode')).toBe('split')
    el.setAttribute('mode', 'read')
    expect(el.shadowRoot?.querySelector('.readit-root')?.getAttribute('data-mode')).toBe('read')
    el.setAttribute('theme', 'dark')
    expect(el.getAttribute('data-theme')).toBe('dark')
  })

  it('shadow="false" 走逃生舱', () => {
    defineReadit('readit-c3')
    const el = attach('readit-c3', { shadow: 'false' }, '# t\n')
    expect(el.shadowRoot).toBeNull()
    expect(el.querySelector('.markdown-body h1')).not.toBeNull()
  })

  it('非法的 mode 值回落并 warn，而不是静默当成 read', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    defineReadit('readit-c4')
    const el = attach('readit-c4', { mode: 'nope' }, '# t\n')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mode="nope"'))
    expect(el.shadowRoot?.querySelector('.readit-root')?.getAttribute('data-mode')).toBe('read')
    warn.mockRestore()
  })

  it('从 DOM 摘下来会 destroy，再挂回去保留当前值', () => {
    defineReadit('readit-c5')
    const el = attach('readit-c5', {}, '# t\n')
    ;(el as HTMLElement & { value: string }).value = '# changed\n'
    el.remove()
    expect(el.shadowRoot?.childNodes).toHaveLength(0)
    document.body.appendChild(el)
    expect(el.shadowRoot?.querySelector('h1')?.textContent).toBe('changed')
  })

  it('value 属性读写走内核', () => {
    defineReadit('readit-c6')
    const el = attach('readit-c6', {}, '# t\n') as HTMLElement & { value: string }
    expect(el.value).toBe('# t\n')
    el.value = '# v2\n'
    expect(el.shadowRoot?.querySelector('h1')?.textContent).toBe('v2')
  })
})
