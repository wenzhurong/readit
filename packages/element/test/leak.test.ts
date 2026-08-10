import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { installLeakProbe, type LeakProbe } from './helpers/leak-probe.js'
import { defineReadit, mount } from '../src/index.js'
import { createKernel, resolveMountOptions } from '../src/kernel.js'

const DOC = '# T\n\n[rel](./b.md) [hash](#t) [ext](https://example.com)\n\n```js\nvar a = 1\n```\n'
const ZERO = { listeners: 0, resizeObservers: 0, mutationObservers: 0 }

let probe: LeakProbe | null = null

afterEach(() => {
  probe?.uninstall()
  probe = null
})

/**
 * 探针的自检。没有这一条，「50 次之后计数是 0」可能只是因为探针什么都没数到——
 * 一条测不到真东西的断言比没有断言更糟。
 */
describe('探针自检', () => {
  it('抓得到没拆的监听器', () => {
    probe = installLeakProbe(window)
    const el = document.createElement('div')
    const handler = (): void => {}
    el.addEventListener('click', handler)
    expect(probe.counts().listeners).toBe(1)
    expect(probe.describe()).toEqual(['HTMLDivElement#click'])
    el.removeEventListener('click', handler)
    expect(probe.counts()).toEqual(ZERO)
  })

  it('区分 capture 与 bubble 两次注册', () => {
    probe = installLeakProbe(window)
    const el = document.createElement('div')
    const handler = (): void => {}
    el.addEventListener('click', handler)
    el.addEventListener('click', handler, { capture: true })
    expect(probe.counts().listeners).toBe(2)
    el.removeEventListener('click', handler, { capture: true })
    expect(probe.counts().listeners).toBe(1)
  })

  it('抓得到没 disconnect 的 ResizeObserver 与 MutationObserver', () => {
    probe = installLeakProbe(window)
    const ro = new window.ResizeObserver(() => {})
    const mo = new window.MutationObserver(() => {})
    expect(probe.counts()).toEqual({ listeners: 0, resizeObservers: 1, mutationObservers: 1 })
    ro.disconnect()
    mo.disconnect()
    ro.disconnect()
    expect(probe.counts()).toEqual(ZERO)
  })

  /**
   * 评审 Important 4：window 自己是第三层，既不是 DOM 节点共享的那层也不是
   * MediaQueryList 那层——window.addEventListener 是它自己的 own property。
   * 现在 addListener() 没有任何调用点把 view 自己当 target（不是活洞），但
   * Task 13–17 的滚动同步一旦挂 window 的 resize，漏了这层会是假绿，先补上
   * 覆盖再补运行时代码，不倒过来。
   */
  it('也抓得到挂在 window 自己身上的监听器', () => {
    probe = installLeakProbe(window)
    const handler = (): void => {}
    window.addEventListener('resize', handler)
    expect(probe.counts().listeners).toBe(1)
    // window 在这个 happy-dom/vitest 组合下 constructor.name 读作 'Object'（不是
    // 'Window'）——populateGlobal 把 happy-dom 的 window 属性直接铺到 Node 的
    // globalThis 上，globalThis 自身的构造器没有被换成 Window，这是同一个已经
    // 记录过的环境识别问题（navigate.ts 顶部注释、Important 4 报告）的又一处
    // 表现，不是探针的新缺陷。
    expect(probe.describe()).toEqual(['Object#resize'])
    window.removeEventListener('resize', handler)
    expect(probe.counts()).toEqual(ZERO)
  })
})

describe('挂载/销毁 50 次', () => {
  it('监听器与观察器计数归零', () => {
    probe = installLeakProbe(window)
    const host = document.createElement('div')
    document.body.appendChild(host)
    for (let i = 0; i < 50; i += 1) {
      const handle = mount(host, {
        value: DOC,
        baseUrl: 'docs/a.md',
        theme: 'auto',
        onNavigate: (): void => {},
      })
      handle.setMode('split')
      handle.setTheme('dark')
      handle.setValue(`# ${i}\n`)
      handle.setMode('read')
      handle.destroy()
    }
    expect(probe.describe()).toEqual([])
    expect(probe.counts()).toEqual(ZERO)
    host.remove()
  })

  it('自定义元素连上/摘下 50 次同样归零', () => {
    probe = installLeakProbe(window)
    defineReadit('readit-leak')
    const el = document.createElement('readit-leak')
    el.textContent = DOC
    for (let i = 0; i < 50; i += 1) {
      document.body.appendChild(el)
      el.setAttribute('theme', i % 2 === 0 ? 'dark' : 'light')
      el.remove()
    }
    expect(probe.describe()).toEqual([])
    expect(probe.counts()).toEqual(ZERO)
  })

  it('销毁后容器空、宿主属性还原、登记项归零', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const kernel = createKernel(host, resolveMountOptions({ value: DOC }))
    expect(kernel.disposers.size).toBeGreaterThan(0)
    kernel.destroy()
    expect(kernel.disposers.size).toBe(0)
    expect(kernel.destroyed).toBe(true)
    expect(host.shadowRoot?.childNodes).toHaveLength(0)
    expect(host.shadowRoot?.adoptedStyleSheets).toHaveLength(0)
    expect(host.getAttribute('data-theme')).toBeNull()
    host.remove()
  })

  it('shadow:false 逃生舱销毁后不留自己的节点', () => {
    const host = document.createElement('div')
    host.appendChild(document.createTextNode('宿主原有的内容'))
    document.body.appendChild(host)
    const kernel = createKernel(host, resolveMountOptions({ value: DOC, shadow: false }))
    kernel.destroy()
    expect(host.querySelectorAll('.readit-root')).toHaveLength(0)
    expect(host.querySelectorAll('style[data-readit]')).toHaveLength(0)
    expect(host.textContent).toBe('宿主原有的内容')
    host.remove()
  })

  it('50 次循环没有把节点落在 document 上', () => {
    const before = document.body.childNodes.length
    for (let i = 0; i < 50; i += 1) {
      const host = document.createElement('div')
      document.body.appendChild(host)
      mount(host, { value: DOC }).destroy()
      host.remove()
    }
    expect(document.body.childNodes).toHaveLength(before)
    expect(document.head.querySelectorAll('style')).toHaveLength(0)
  })
})

/**
 * 结构约束：绕过 addListener 注册的监听器不会被 destroy() 拆掉，而上面那些循环
 * 只在漏掉的那条路径真的被走到时才红。这一条让「绕过」本身就红。
 */
describe('注册点唯一', () => {
  it('src/ 里除 disposers.ts 外没有直接调用 addEventListener', () => {
    // 不用 `fileURLToPath(new URL('../src', import.meta.url))`：happy-dom
    // （§0 A2，本包的 vitest environment）的全局 URL 构造器对「相对路径 +
    // file: base」解析有 bug——不管传进去的 base 是什么，结果的 scheme 总变成
    // 它自己伪造的 http: location，fileURLToPath 会抛
    // "The URL must be of scheme file"（在 test/navigate.test.ts 的实现里复现
    // 并记录过，见 packages/element/src/navigate.ts 顶部注释）。改用
    // dirname(fileURLToPath(import.meta.url)) + join 全程走 node:path，
    // 不经过全局 URL。
    const testDir = dirname(fileURLToPath(import.meta.url))
    const src = join(testDir, '..', 'src')
    const offenders: string[] = []
    for (const entry of readdirSync(src, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
      if (entry.name === 'disposers.ts') continue
      const file = join(entry.parentPath, entry.name)
      if (readFileSync(file, 'utf8').includes('.addEventListener(')) offenders.push(entry.name)
    }
    expect(offenders).toEqual([])
  })
})
