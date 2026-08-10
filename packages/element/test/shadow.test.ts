import { afterEach, describe, expect, it } from 'vitest'
import { createDisposers } from '../src/disposers.js'
import { createRoot } from '../src/shadow.js'

let hosts: HTMLElement[] = []

function makeHost(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  return host
}

afterEach(() => {
  for (const host of hosts) host.remove()
  hosts = []
})

describe('createRoot', () => {
  it('shadow:true 建 open shadow root，并在里面放 part="root" 的外层元素', () => {
    const host = makeHost()
    const ctx = createRoot(host, true, createDisposers())
    expect(host.shadowRoot).not.toBeNull()
    expect(host.shadowRoot?.mode).toBe('open')
    expect(ctx.container).toBe(host.shadowRoot)
    expect(ctx.root.getAttribute('part')).toBe('root')
    expect(ctx.root.parentNode).toBe(host.shadowRoot)
  })

  it('shadow:false 逃生舱直接用宿主自己当容器', () => {
    const host = makeHost()
    const ctx = createRoot(host, false, createDisposers())
    expect(host.shadowRoot).toBeNull()
    expect(ctx.container).toBe(host)
    expect(ctx.root.parentNode).toBe(host)
  })

  it('shadow 档走 adoptedStyleSheets，替换而不是追加', () => {
    const host = makeHost()
    const ctx = createRoot(host, true, createDisposers())
    expect(ctx.adopted).toBe(true)
    const shadow = host.shadowRoot
    if (shadow === null) throw new Error('unreachable')
    ctx.setStyles(['a{color:red}', 'b{color:blue}'])
    expect(shadow.adoptedStyleSheets).toHaveLength(2)
    ctx.setStyles(['c{color:green}'])
    expect(shadow.adoptedStyleSheets).toHaveLength(1)
    expect(shadow.querySelectorAll('style')).toHaveLength(0)
  })

  it('light DOM 档回落到单个 <style>，内容按给定顺序拼接', () => {
    const host = makeHost()
    const ctx = createRoot(host, false, createDisposers())
    expect(ctx.adopted).toBe(false)
    ctx.setStyles(['a{color:red}', 'b{color:blue}'])
    const styles = host.querySelectorAll('style[data-readit="styles"]')
    expect(styles).toHaveLength(1)
    expect(styles[0]?.textContent).toBe('a{color:red}\nb{color:blue}')
    ctx.setStyles(['c{color:green}'])
    expect(host.querySelectorAll('style[data-readit="styles"]')).toHaveLength(1)
    expect(host.querySelector('style[data-readit="styles"]')?.textContent).toBe('c{color:green}')
  })

  it('同一个宿主重复挂载不因 attachShadow 抛错', () => {
    const host = makeHost()
    const first = createDisposers()
    createRoot(host, true, first)
    first.disposeAll()
    expect(() => createRoot(host, true, createDisposers())).not.toThrow()
    expect(host.shadowRoot?.querySelectorAll('.readit-root')).toHaveLength(1)
  })

  /** SPEC §9.2：永不写 document.documentElement / document.body。 */
  it('从不碰 document 的样式表、head 或 documentElement', () => {
    const headBefore = document.head.innerHTML
    const docSheetsBefore = document.adoptedStyleSheets.length
    const host = makeHost()
    const ctx = createRoot(host, true, createDisposers())
    ctx.setStyles(['a{color:red}'])
    expect(document.head.innerHTML).toBe(headBefore)
    expect(document.adoptedStyleSheets).toHaveLength(docSheetsBefore)
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
    expect(document.documentElement.getAttribute('style')).toBeNull()
  })

  it('disposeAll 把外层元素、<style> 与 adoptedStyleSheets 全撤干净', () => {
    const host = makeHost()
    const disposers = createDisposers()
    const ctx = createRoot(host, true, disposers)
    ctx.setStyles(['a{color:red}'])
    disposers.disposeAll()
    expect(host.shadowRoot?.childNodes).toHaveLength(0)
    expect(host.shadowRoot?.adoptedStyleSheets).toHaveLength(0)
  })
})
