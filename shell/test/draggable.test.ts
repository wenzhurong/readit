import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clampPosition,
  connectDraggable,
  createStoredPosition,
  type Position,
} from '../src/draggable.js'

const VIEWPORT = { width: 1000, height: 800 }

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  }
}

function makeControl(): { element: HTMLElement; button: HTMLButtonElement } {
  const element = document.createElement('div')
  const button = document.createElement('button')
  element.append(button)
  document.body.append(element)
  return { element, button }
}

function pointer(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, {
    pointerId: 1,
    button: 0,
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  })
}

describe('clampPosition', () => {
  it('视口内的位置原样返回', () => {
    expect(clampPosition({ left: 300, top: 200 }, { width: 120, height: 30 }, VIEWPORT)).toEqual({
      left: 300,
      top: 200,
    })
  })

  it('越过右下边界时被拉回，留出边距', () => {
    expect(clampPosition({ left: 9999, top: 9999 }, { width: 120, height: 30 }, VIEWPORT)).toEqual({
      left: 1000 - 120 - 8,
      top: 800 - 30 - 8,
    })
  })

  it('负坐标被拉回边距，不允许推到屏幕外', () => {
    expect(clampPosition({ left: -500, top: -500 }, { width: 120, height: 30 }, VIEWPORT)).toEqual({
      left: 8,
      top: 8,
    })
  })

  it('控件比视口还大时取下界，而不是算出一个负数', () => {
    // 上界会低于下界，这时必须让下界赢——否则窗口被缩到极小后控件会飞出屏幕。
    expect(clampPosition({ left: 400, top: 400 }, { width: 4000, height: 4000 }, VIEWPORT)).toEqual({
      left: 8,
      top: 8,
    })
  })
})

describe('位置存档', () => {
  it('存进去能原样读回来', () => {
    const store = createStoredPosition('k', memoryStorage())
    store.write({ left: 12, top: 34 })
    expect(store.read()).toEqual({ left: 12, top: 34 })
  })

  it.each([
    ['损坏的 JSON', 'not json'],
    ['不是对象', '42'],
    ['字段不是数字', '{"left":"a","top":2}'],
    ['字段是 NaN', '{"left":null,"top":2}'],
  ])('%s 一律当作没有存档，回到默认角落', (_name, raw) => {
    const storage = memoryStorage()
    storage.setItem('k', raw)
    expect(createStoredPosition('k', storage).read()).toBeNull()
  })

  it('没有 storage 时读为空、写不抛', () => {
    const store = createStoredPosition('k', null)
    expect(() => store.write({ left: 1, top: 2 })).not.toThrow()
    expect(store.read()).toBeNull()
  })

  it('storage 写入抛异常时也不能让控件挂掉', () => {
    const hostile = { ...memoryStorage(), setItem: () => { throw new Error('quota') } } as Storage
    expect(() => createStoredPosition('k', hostile).write({ left: 1, top: 2 })).not.toThrow()
  })
})

describe('拖拽', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('超过阈值后控件跟着指针走，松手把位置存下来', () => {
    const { element } = makeControl()
    const store = createStoredPosition('k', memoryStorage())
    connectDraggable(element, { store, viewport: () => VIEWPORT })

    element.dispatchEvent(pointer('pointerdown', 100, 100))
    element.dispatchEvent(pointer('pointermove', 160, 140))
    const whileDragging = element.dataset['dragging']
    element.dispatchEvent(pointer('pointerup', 160, 140))

    expect({
      whileDragging,
      afterDrop: element.dataset['dragging'],
      style: { left: element.style.left, top: element.style.top, right: element.style.right },
      stored: store.read(),
    }).toEqual({
      whileDragging: 'true',
      afterDrop: undefined,
      style: { left: '60px', top: '40px', right: 'auto' },
      stored: { left: 60, top: 40 },
    })
  })

  it('位移不到阈值不算拖拽 —— 控件不动，也不写存档', () => {
    const { element } = makeControl()
    const store = createStoredPosition('k', memoryStorage())
    connectDraggable(element, { store, viewport: () => VIEWPORT })

    element.dispatchEvent(pointer('pointerdown', 100, 100))
    element.dispatchEvent(pointer('pointermove', 102, 101))
    element.dispatchEvent(pointer('pointerup', 102, 101))

    expect({ left: element.style.left, stored: store.read() }).toEqual({ left: '', stored: null })
  })

  it('拖拽松手后的那次 click 被吃掉 —— 否则放手就顺手切换了模式', () => {
    // 承重断言：浏览器在 pointerup 之后还会派一次 click，目标正是被按住的那个按钮。
    const { element, button } = makeControl()
    const onClick = vi.fn()
    button.addEventListener('click', onClick)
    connectDraggable(element, {
      store: createStoredPosition('k', memoryStorage()),
      viewport: () => VIEWPORT,
    })

    element.dispatchEvent(pointer('pointerdown', 100, 100))
    element.dispatchEvent(pointer('pointermove', 160, 140))
    element.dispatchEvent(pointer('pointerup', 160, 140))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(onClick).not.toHaveBeenCalled()
  })

  it('只吃紧随拖拽的那一次 click，之后的点击照常生效', () => {
    const { element, button } = makeControl()
    const onClick = vi.fn()
    button.addEventListener('click', onClick)
    connectDraggable(element, {
      store: createStoredPosition('k', memoryStorage()),
      viewport: () => VIEWPORT,
    })

    element.dispatchEvent(pointer('pointerdown', 100, 100))
    element.dispatchEvent(pointer('pointermove', 160, 140))
    element.dispatchEvent(pointer('pointerup', 160, 140))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('连接时套用已存位置，并且照样过一遍 clamp', () => {
    const { element } = makeControl()
    const storage = memoryStorage()
    storage.setItem('k', JSON.stringify({ left: 99999, top: -50 } satisfies Position))
    connectDraggable(element, {
      store: createStoredPosition('k', storage),
      viewport: () => VIEWPORT,
    })

    expect({ left: element.style.left, top: element.style.top }).toEqual({
      left: `${1000 - 8}px`,
      top: '8px',
    })
  })

  it('destroy() 之后不再响应指针', () => {
    const { element } = makeControl()
    const stop = connectDraggable(element, {
      store: createStoredPosition('k', memoryStorage()),
      viewport: () => VIEWPORT,
    })

    stop()
    element.dispatchEvent(pointer('pointerdown', 100, 100))
    element.dispatchEvent(pointer('pointermove', 200, 200))

    expect(element.style.left).toBe('')
  })
})
