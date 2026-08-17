import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIND_CSS, createFindController, type FindResult } from '../src/controller.js'

class FakeHighlight {
  readonly ranges: readonly AbstractRange[]

  constructor(...ranges: AbstractRange[]) {
    this.ranges = ranges
  }
}

const registry = new Map<string, FakeHighlight>()
let originalCss: PropertyDescriptor | undefined
let originalHighlight: PropertyDescriptor | undefined

function enableCustomHighlights(): void {
  originalCss = Object.getOwnPropertyDescriptor(window, 'CSS')
  originalHighlight = Object.getOwnPropertyDescriptor(window, 'Highlight')
  const highlights = {
    set(name: string, value: FakeHighlight) {
      registry.set(name, value)
      return highlights
    },
    delete(name: string) {
      return registry.delete(name)
    },
  }
  Object.defineProperty(window, 'CSS', { configurable: true, value: { highlights } })
  Object.defineProperty(window, 'Highlight', { configurable: true, value: FakeHighlight })
}

function disableCustomHighlights(): void {
  originalCss = Object.getOwnPropertyDescriptor(window, 'CSS')
  originalHighlight = Object.getOwnPropertyDescriptor(window, 'Highlight')
  Object.defineProperty(window, 'CSS', { configurable: true, value: {} })
  Reflect.deleteProperty(window, 'Highlight')
}

function restoreCustomHighlights(): void {
  if (originalCss === undefined) Reflect.deleteProperty(window, 'CSS')
  else Object.defineProperty(window, 'CSS', originalCss)
  if (originalHighlight === undefined) Reflect.deleteProperty(window, 'Highlight')
  else Object.defineProperty(window, 'Highlight', originalHighlight)
}

function fixture(source: () => string | null = () => null) {
  const owner = document.createElement('div')
  const mount = document.createElement('div')
  const target = document.createElement('div')
  target.innerHTML = '<p>Alpha <em>beta</em> alpha</p>'
  mount.append(target)
  owner.append(mount)
  document.body.append(owner)
  const revealSource = vi.fn()
  const controller = createFindController({
    owner,
    mount,
    target: () => target,
    source,
    revealSource,
  })
  return { controller, mount, owner, revealSource, target }
}

beforeEach(() => {
  document.body.replaceChildren()
  registry.clear()
})

afterEach(() => {
  restoreCustomHighlights()
})

describe('Custom Highlight 主路径', () => {
  it('查找与前后导航只改高亮注册表，不改所属 shadow 内容的 innerHTML', () => {
    enableCustomHighlights()
    const { controller, mount } = fixture()
    const before = mount.innerHTML

    expect(controller.find('alpha')).toEqual<FindResult>({ query: 'alpha', total: 2, current: 1 })
    expect(registry.get('readit-find')?.ranges).toHaveLength(2)
    expect(registry.get('readit-find-current')?.ranges).toHaveLength(1)
    expect(mount.innerHTML).toBe(before)

    expect(controller.find('alpha')).toEqual<FindResult>({ query: 'alpha', total: 2, current: 2 })
    expect(controller.find('alpha', { direction: 'previous' })).toEqual<FindResult>({
      query: 'alpha', total: 2, current: 1,
    })
    expect(mount.innerHTML).toBe(before)
    controller.destroy()
  })

  it('多个实例向同名注册表合并贡献，销毁一个不会清掉另一个', () => {
    enableCustomHighlights()
    const first = fixture()
    const second = fixture()
    first.controller.find('alpha')
    second.controller.find('beta')
    expect(registry.get('readit-find')?.ranges).toHaveLength(3)

    first.controller.destroy()
    expect(registry.get('readit-find')?.ranges).toHaveLength(1)
    second.controller.destroy()
    expect(registry.has('readit-find')).toBe(false)
  })

  /** 让一个元素在 happy-dom 里真的看起来像溢出滚动盒。 */
  function makeScrollable(el: HTMLElement, clientHeight: number, scrollHeight: number): void {
    Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
    Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
    Object.defineProperty(el, 'clientTop', { value: 0, configurable: true })
    el.style.overflowY = 'auto'
  }

  const matchRect = (top: number, bottom: number): DOMRect =>
    ({ x: 0, y: 0, top, right: 50, bottom, left: 0, width: 50, height: bottom - top,
       toJSON: () => ({}) }) as DOMRect

  it('命中落在视口外时，滚的是真正能滚的那个祖先', () => {
    enableCustomHighlights()
    const { controller, target } = fixture()
    // **这三行是这条测试的前提，不是布景。** 原来的版本没有它们，等于默认
    // 「target 就是滚动容器」——而真引擎里阅读模式的面板会撑满内容全高，
    // scrollHeight 恰好等于 clientHeight，根本不是滚动盒。那个隐含前提正是缺陷。
    makeScrollable(target, 100, 500)
    target.scrollTop = 10
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(matchRect(100, 200))
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(matchRect(240, 260))

    controller.find('alpha')
    // 可见带 = rect.top + clientTop .. + clientHeight = 100..200；命中 240..260
    // 在带下方，最小滚动量 60
    expect(target.scrollTop).toBe(70)
    controller.destroy()
  })

  it('没有任何能滚的祖先时兜底滚文档——自然文档流布局下这是唯一能滚的东西', () => {
    // 桌面壳与任何不给宿主定高的嵌入方都是这种配置：面板撑满内容全高，
    // 视口的溢出从根元素传播上去，document 才是滚动容器。
    enableCustomHighlights()
    const { controller, target } = fixture()
    const scrolling = document.scrollingElement as HTMLElement
    Object.defineProperty(scrolling, 'clientHeight', { value: 768, configurable: true })
    Object.defineProperty(scrolling, 'scrollHeight', { value: 16051, configurable: true })
    scrolling.scrollTop = 0
    // target 明确**不可滚**：撑满内容，scrollHeight === clientHeight
    Object.defineProperty(target, 'clientHeight', { value: 16051, configurable: true })
    Object.defineProperty(target, 'scrollHeight', { value: 16051, configurable: true })
    target.style.overflowY = 'auto'
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(matchRect(1000, 1020))

    controller.find('alpha')

    expect({
      // 文档滚动元素的可见带是视口本身（0..768），不是它的边界盒
      documentScrolled: scrolling.scrollTop,
      targetUntouched: target.scrollTop,
    }).toEqual({ documentScrolled: 1020 - 768, targetUntouched: 0 })
    controller.destroy()
  })
})

describe('mark 降级路径', () => {
  it('没有 CSS.highlights 时用具名 mark 包裹，清空查询后逐字恢复内容', () => {
    disableCustomHighlights()
    const { controller, target } = fixture()
    const before = target.innerHTML
    expect(controller.find('alpha')).toEqual<FindResult>({ query: 'alpha', total: 2, current: 1 })
    expect(target.querySelectorAll('mark[data-readit-find]')).toHaveLength(2)
    expect(target.querySelectorAll('mark[data-readit-find-current]')).toHaveLength(1)

    expect(controller.find('')).toEqual<FindResult>({ query: '', total: 0, current: 0 })
    expect(target.querySelector('mark')).toBeNull()
    expect(target.innerHTML).toBe(before)
    controller.destroy()
  })

  it('跨内联节点的一个逻辑命中可拆成多个 mark，但计数仍为一', () => {
    disableCustomHighlights()
    const { controller, target } = fixture()
    target.innerHTML = '<p>Al<strong>ph</strong>a</p>'
    expect(controller.find('alpha').total).toBe(1)
    expect(target.querySelectorAll('mark[data-readit-find="0"]')).toHaveLength(3)
    expect(target.textContent).toBe('Alpha')
    controller.destroy()
  })
})

describe('源码模型与内置 UI', () => {
  it('源码查找不读取虚拟化 DOM，并把当前命中的完整偏移交给编辑器', () => {
    enableCustomHighlights()
    const source = ['top', 'needle one', 'middle', 'needle two'].join('\n')
    const { controller, revealSource, target } = fixture(() => source)
    target.textContent = 'DOM does not contain the query'

    expect(controller.find('needle')).toEqual<FindResult>({ query: 'needle', total: 2, current: 1 })
    expect(revealSource).toHaveBeenLastCalledWith({ start: 4, end: 10 })
    controller.find('needle')
    expect(revealSource).toHaveBeenLastCalledWith({ start: 22, end: 28 })
    expect(registry.has('readit-find')).toBe(false)
    controller.destroy()
  })

  it('无参 find 打开并聚焦嵌套查找栏，按钮与 Escape 驱动同一状态机', () => {
    enableCustomHighlights()
    const { controller, owner } = fixture()
    const returnTarget = document.createElement('button')
    owner.before(returnTarget)
    returnTarget.focus()
    expect(FIND_CSS).toContain('::highlight(readit-find)')
    expect(FIND_CSS).toContain(':host([data-readit-find-open])')

    controller.find()
    const ui = controller.element.shadowRoot!
    const input = ui.querySelector<HTMLInputElement>('input')!
    const opened = {
      state: owner.dataset['readitFindOpen'],
      focused: ui.activeElement === input,
    }
    input.value = 'alpha'
    input.dispatchEvent(new Event('input'))
    ui.querySelector<HTMLButtonElement>('[data-find-next]')!.click()
    input.setSelectionRange(2, 2)
    controller.find()
    const reopened = {
      count: ui.querySelector('output')?.textContent,
      selection: [input.selectionStart, input.selectionEnd],
    }

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect({
      opened,
      reopened,
      closed: {
        state: owner.dataset['readitFindOpen'],
        highlighted: registry.has('readit-find'),
        focusRestored: document.activeElement === returnTarget,
      },
    }).toEqual({
      opened: { state: 'true', focused: true },
      reopened: { count: '2 / 2', selection: [0, 5] },
      closed: { state: undefined, highlighted: false, focusRestored: true },
    })
    controller.destroy()
  })
})
