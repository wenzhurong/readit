import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
 * `handle.setMode()`（对外公共句柄，types.ts）返回 void，内部 `panes.setMode()`
 * 却是 async——建 CodeMirror 要 `await import('@readit/editor')` →
 * `await import('./codemirror.js')` → `new EditorView(...)`，之后才执行
 * `view.contentDOM.addEventListener('compositionend', applyDeferred)`
 * （packages/editor/src/codemirror.ts:71）。轮询真实 DOM 直到编辑器落地，
 * 不猜一个固定时长——跟 mount.test.ts:16 同一个理由、同一个实现。
 */
async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

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
  /**
   * 终审用插桩实测证实：这条循环此前两次 `setMode()` 都没 await，紧跟着同步
   * `destroy()`——CodeMirror 的构造函数从未跑完，`codemirror.ts:71` 的
   * `addEventListener('compositionend', …)` 从未发生，探针连"泄漏发生的机会"
   * 都没给到（在那一行插桩过：50 次循环里一次都没打印）。
   *
   * 修法：`setMode('split')` 之后轮询 `.cm-editor` 出现（跟 mount.test.ts:159
   * 同一个手法），让每一轮都真的建出 CodeMirror。
   *
   * ## 为什么这条断言不再是「listeners 也归零」
   *
   * 让循环真的建出 CodeMirror 之后，探针立刻抓到一批此前从未见过的东西：
   * `@codemirror/view` 6.43.8 自己的 `InputState.ensureHandlers()` 在
   * `contentDOM` 上直接注册了 ~20 个原生事件（beforeinput/blur/keydown/
   * mousedown/touchstart/wheel/……），而 `InputState.destroy()`
   * （node_modules/@codemirror/view/dist/index.js 实测读过）**只 destroy()
   * 了 `mouseSelection` 一项，从不为这批 `ensureHandlers()` 注册的类型调用
   * `removeEventListener`**——这是 CM6 自己的既有设计，不是这个仓库能改、
   * 该改的地方：它依赖「`view.destroy()` 里的 `this.dom.remove()` 把整棵
   * `contentDOM` 子树连同这些监听器的闭包一起变得不可达，交给 GC」，跟这个
   * 仓库自己的 `browser/support/harness.ts`（INSTRUMENT 注释：「shadow 树
   * 内部节点上的监听器随树一起死，数它们只会制造噪声」）是同一个原则——只是
   * 那份浏览器仪表在设计时就直接把 shadow 树内部节点排除在外，这份探针
   * （leak-probe.ts）当初没有做这个排除，因为在这个 bug 修之前，从来没有一条
   * 测试真的建出过 CodeMirror 去触发它。
   *
   * 用同一个裸探针对「真建出的 CodeMirror」断言 `listeners === 0` 因此是
   * 结构上不可能满足的——不管这个包自己的代码对不对，`compositionend` 之外
   * 的十几种原生事件类型必然留下配不上对的 add。这不是本次要守的缺口：
   * SPEC §9.4 与这次终审真正点名的，是 `codemirror.ts` **自己**加的那一个
   * `compositionend` 监听器（第 71 行）有没有配对拆掉（第 99 行）——那条精确
   * 到这一次调用、不受 CM6 自己噪声干扰的断言在下面单独钉（真的删掉
   * `codemirror.ts:99` 会让它变红，见该测试的注释）。这里继续断言
   * `resizeObservers`/`mutationObservers` 归零：CM6 自己的
   * `DOMObserver.destroy()`（同一份源码读过）对这两类、以及 window/document
   * 级别的 resize/scroll/selectionchange，都做了显式 disconnect/
   * removeEventListener（那些是跨实例共享的长命目标，CM6 自己也不敢指望
   * GC，做法与 harness.ts 的分层完全一致），这两个字段留在这里断言是真实
   * 有效的护栏，不是摆设。
   */
  it('挂 50 次真实 CodeMirror，ResizeObserver/MutationObserver 归零', async () => {
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
      await waitFor(() => host.shadowRoot?.querySelector('.cm-editor') != null)
      handle.setTheme('dark')
      handle.setValue(`# ${i}\n`)
      handle.setMode('read')
      handle.destroy()
    }
    expect(probe.counts().resizeObservers).toBe(0)
    expect(probe.counts().mutationObservers).toBe(0)
    host.remove()
  })

  /**
   * SPEC §9.4「destroy() 必须拆掉 CodeMirror view」，精确到 `codemirror.ts`
   * 自己加的那一个监听器。上面那条证明了为什么不能用裸探针的「listeners 也
   * 归零」——CM6 自己的 ~20 个原生事件类型会把这唯一在意的一个淹没。这里换一个
   * 不受那批噪声干扰的判据：`contentDOM` 上 `compositionend` 类型的监听器，
   * 编辑器建出来时必然有两个——CM6 自己那个（`InputState.ensureHandlers()`
   * 注册的 `handleEvent`，永远不会被移除，上面那条注释验证过）+
   * `codemirror.ts:71` 加的 `applyDeferred`；`destroy()` 只可能拆掉后者，
   * 前者不受这个包控制、也不该由这个包去够。所以「拆没拆对」的判据是
   * **destroy() 前后这个数必须严格减少**（不用假设一个具体基线，不耦合
   * CM6 未来版本内部实现细节的具体数字）。
   *
   * 已实测验证这条护栏真会响：临时删掉 `codemirror.ts:99` 的
   * `removeEventListener` 一行，这条测试从绿变红（每一轮 `before === after`，
   * `after` 不再比 `before` 少 1）；改回来后复测又变绿——见
   * final-fix-report.md ① 的命令与输出。
   *
   * 注意 `before` 不是每轮都等于 2：CM6 自己那份永远不被移除，target 换成
   * 新的 contentDOM 之后旧 target 的条目还留在探针的账本里，所以 `before`
   * 会随轮次单调增长（第 i 轮大约是 i + 1）。断言不假设一个绝对基线，只咬住
   * 「这一轮 destroy() 让计数恰好少 1」这个相对不变量——多退（少 1 以上）或
   * 少退（不少）都算错。
   */
  it('destroy() 拆掉自己加的 compositionend 监听器（连续 50 轮，每轮都验证净减 1）', async () => {
    probe = installLeakProbe(window)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const compositionendCount = (): number =>
      (probe?.describe() ?? []).filter((entry) => entry.endsWith('#compositionend')).length
    for (let i = 0; i < 50; i += 1) {
      const handle = mount(host, { value: DOC, mode: 'source' })
      await waitFor(() => host.shadowRoot?.querySelector('.cm-editor') != null)
      const before = compositionendCount()
      handle.destroy()
      const after = compositionendCount()
      expect(after, `第 ${i} 轮：destroy() 必须让 compositionend 计数恰好少 1（before=${before}）`).toBe(
        before - 1,
      )
    }
    host.remove()
  })

  /**
   * 上面那条按数量做差分；这条独立用 vi.spyOn 直接钉住调用本身——destroy()
   * 期间真的对 `contentDOM` 发起过一次 `removeEventListener('compositionend',
   * …)` 调用，跟「探针记的账最终减了 1」是两条独立证据，一条测调用发生了没有，
   * 一条测调用的净效果对不对。
   */
  it('destroy() 真的调用了 contentDOM.removeEventListener("compositionend", …)', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const handle = mount(host, { value: DOC, mode: 'source' })
    await waitFor(() => host.shadowRoot?.querySelector('.cm-content') != null)
    const contentDOM = host.shadowRoot?.querySelector('.cm-content')
    if (contentDOM === null || contentDOM === undefined) throw new Error('编辑器没建出来，探针没有目标')
    const removeSpy = vi.spyOn(contentDOM, 'removeEventListener')
    handle.destroy()
    expect(removeSpy.mock.calls.some(([type]) => type === 'compositionend')).toBe(true)
    host.remove()
  })

  /**
   * 前几条在 destroy() 之前先 setMode('read')/直接 destroy()。这条独立钉住
   * SPEC §9.4 逐字要求的时刻：编辑器仍然挂载着，destroy() 是唯一拆它的入口
   * （不是 teardownEditor() 先在 setMode('read') 里拆过一轮）。
   */
  it('destroy() 在 CodeMirror 仍挂载时调用也要拆干净', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const handle = mount(host, { value: DOC, mode: 'source' })
    await waitFor(() => host.shadowRoot?.querySelector('.cm-editor') != null)
    expect(host.shadowRoot?.querySelector('.cm-editor')).not.toBeNull()
    const contentDOM = host.shadowRoot?.querySelector('.cm-content')
    if (contentDOM === null || contentDOM === undefined) throw new Error('编辑器没建出来，探针没有目标')
    const removeSpy = vi.spyOn(contentDOM, 'removeEventListener')
    handle.destroy()
    expect(removeSpy.mock.calls.some(([type]) => type === 'compositionend')).toBe(true)
    expect(host.shadowRoot?.querySelector('.cm-editor')).toBeNull()
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
