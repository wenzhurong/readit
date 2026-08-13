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

  it('当前 Range 落在视口外时用边界盒手写滚动量', () => {
    enableCustomHighlights()
    const { controller, target } = fixture()
    target.scrollTop = 10
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 100, right: 300, bottom: 200, left: 0, width: 300, height: 100,
      toJSON: () => ({}),
    })
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 240, right: 50, bottom: 260, left: 0, width: 50, height: 20,
      toJSON: () => ({}),
    })

    controller.find('alpha')
    expect(target.scrollTop).toBe(70)
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
    expect(FIND_CSS).toContain('::highlight(readit-find)')
    expect(FIND_CSS).toContain(':host([data-readit-find-open])')

    controller.find()
    expect(owner.dataset['readitFindOpen']).toBe('true')
    const ui = controller.element.shadowRoot!
    const input = ui.querySelector<HTMLInputElement>('input')!
    input.value = 'alpha'
    input.dispatchEvent(new Event('input'))
    expect(ui.querySelector('output')?.textContent).toBe('1 / 2')
    ui.querySelector<HTMLButtonElement>('[data-find-next]')!.click()
    expect(ui.querySelector('output')?.textContent).toBe('2 / 2')

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(owner.dataset['readitFindOpen']).toBeUndefined()
    expect(registry.has('readit-find')).toBe(false)
    controller.destroy()
  })
})
