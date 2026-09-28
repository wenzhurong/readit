import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clampPosition,
  connectDraggable,
  createStoredPosition,
  type Placement,
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
  it('位置连同拖动时的窗口尺寸一起存，能原样读回来', () => {
    const store = createStoredPosition('k', memoryStorage())
    const placement: Placement = { position: { left: 12, top: 34 }, viewport: VIEWPORT }
    store.write(placement)
    expect(store.read()).toEqual(placement)
  })

  it('clear() 之后读为空', () => {
    const store = createStoredPosition('k', memoryStorage())
    store.write({ position: { left: 12, top: 34 }, viewport: VIEWPORT })
    store.clear()
    expect(store.read()).toBeNull()
  })

  it.each([
    ['损坏的 JSON', 'not json'],
    ['不是对象', '42'],
    ['字段不是数字', '{"left":"a","top":2}'],
    ['字段是 NaN', '{"left":null,"top":2}'],
    // 修复前的格式只有 left/top。没记窗口尺寸，就无从判断它在当前尺寸下是否有效。
    ['旧格式：没有拖动时的窗口尺寸', '{"left":12,"top":34}'],
    ['窗口尺寸不是正数', '{"left":12,"top":34,"width":0,"height":800}'],
  ])('%s 一律当作没有存档，回到默认角落', (_name, raw) => {
    const storage = memoryStorage()
    storage.setItem('k', raw)
    expect(createStoredPosition('k', storage).read()).toBeNull()
  })

  it('没有 storage 时读为空、写与清都不抛', () => {
    const store = createStoredPosition('k', null)
    expect(() => store.write({ position: { left: 1, top: 2 }, viewport: VIEWPORT })).not.toThrow()
    expect(() => store.clear()).not.toThrow()
    expect(store.read()).toBeNull()
  })

  it('storage 写入或删除抛异常时也不能让控件挂掉', () => {
    const hostile = {
      ...memoryStorage(),
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('denied') },
    } as Storage
    const store = createStoredPosition('k', hostile)
    expect(() => store.write({ position: { left: 1, top: 2 }, viewport: VIEWPORT })).not.toThrow()
    expect(() => store.clear()).not.toThrow()
  })
})

describe('拖拽', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('超过阈值后控件跟着指针走，松手把位置连同当时的窗口尺寸存下来', () => {
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
      stored: { position: { left: 60, top: 40 }, viewport: VIEWPORT },
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

  it('窗口尺寸与存档相同：连接时套用已存位置，并且照样过一遍 clamp', () => {
    const { element } = makeControl()
    const storage = memoryStorage()
    storage.setItem('k', JSON.stringify({ left: 99999, top: -50, width: 1000, height: 800 }))
    connectDraggable(element, {
      store: createStoredPosition('k', storage),
      viewport: () => VIEWPORT,
    })

    expect({ left: element.style.left, top: element.style.top }).toEqual({
      left: `${1000 - 8}px`,
      top: '8px',
    })
  })

  it('窗口尺寸与存档不同：不套用，留在默认右上角，并清掉存档', () => {
    // readit 每次都以 960×720 启动；在最大化窗口里拖的位置，重启后不该出现在 960 宽的窗口里。
    const { element } = makeControl()
    const storage = memoryStorage()
    storage.setItem('k', JSON.stringify({ left: 1500, top: 300, width: 1920, height: 1080 }))
    const store = createStoredPosition('k', storage)
    connectDraggable(element, { store, viewport: () => VIEWPORT })

    expect({ left: element.style.left, top: element.style.top, stored: store.read() }).toEqual({
      left: '',
      top: '',
      stored: null,
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

describe('窗口尺寸变化', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  function dragged(viewport: { current: { width: number; height: number } }) {
    const { element } = makeControl()
    const store = createStoredPosition('k', memoryStorage())
    connectDraggable(element, { store, viewport: () => viewport.current })
    element.dispatchEvent(pointer('pointerdown', 100, 100))
    element.dispatchEvent(pointer('pointermove', 160, 140))
    element.dispatchEvent(pointer('pointerup', 160, 140))
    return { element, store }
  }

  function inlinePosition(element: HTMLElement) {
    return { left: element.style.left, top: element.style.top, right: element.style.right }
  }

  it.each([
    ['最大化（变大）', { width: 1920, height: 1080 }],
    ['缩小', { width: 600, height: 500 }],
    ['只变高度', { width: 1000, height: 900 }],
  ])('拖过之后%s：控件回到 CSS 默认的右上角，存档清空', (_name, next) => {
    const viewport = { current: VIEWPORT }
    const { element, store } = dragged(viewport)

    viewport.current = next
    window.dispatchEvent(new Event('resize'))

    expect({ style: inlinePosition(element), stored: store.read() }).toEqual({
      style: { left: '', top: '', right: '' },
      stored: null,
    })
  })

  it('默认位置写在内联样式上时，回到默认是还原那几项，而不是把它们删掉', () => {
    const { element } = makeControl()
    element.style.top = '12px'
    element.style.right = '12px'
    const viewport = { current: VIEWPORT }
    connectDraggable(element, {
      store: createStoredPosition('k', memoryStorage()),
      viewport: () => viewport.current,
    })
    element.dispatchEvent(pointer('pointerdown', 100, 100))
    element.dispatchEvent(pointer('pointermove', 160, 140))
    element.dispatchEvent(pointer('pointerup', 160, 140))

    viewport.current = { width: 1920, height: 1080 }
    window.dispatchEvent(new Event('resize'))

    expect(inlinePosition(element)).toEqual({ left: '', top: '12px', right: '12px' })
  })

  it('尺寸没变的 resize 不动已拖的位置', () => {
    const viewport = { current: VIEWPORT }
    const { element, store } = dragged(viewport)

    viewport.current = { ...VIEWPORT }
    window.dispatchEvent(new Event('resize'))

    expect({ style: inlinePosition(element), stored: store.read() }).toEqual({
      style: { left: '60px', top: '40px', right: 'auto' },
      stored: { position: { left: 60, top: 40 }, viewport: VIEWPORT },
    })
  })

  it('回到默认位置之后还能再拖，新位置按新的窗口尺寸记', () => {
    const viewport = { current: VIEWPORT }
    const { element, store } = dragged(viewport)
    viewport.current = { width: 1920, height: 1080 }
    window.dispatchEvent(new Event('resize'))

    element.dispatchEvent(pointer('pointerdown', 300, 300))
    element.dispatchEvent(pointer('pointermove', 350, 320))
    element.dispatchEvent(pointer('pointerup', 350, 320))

    // happy-dom 的 rect 恒为 0，所以起点是 0,0，位移 50,20。
    expect(store.read()).toEqual({
      position: { left: 50, top: 20 },
      viewport: { width: 1920, height: 1080 },
    })
  })
})
