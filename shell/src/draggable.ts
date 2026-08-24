/** 超过这个位移才算拖拽；不到就当普通点击，按钮照常工作。 */
const DRAG_THRESHOLD = 4
/** 夹到视口内时留的边距，保证控件永远有一部分可见可点。 */
const EDGE_MARGIN = 8

export interface Position {
  readonly left: number
  readonly top: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

/**
 * 纯函数：把期望位置夹进视口。
 *
 * 控件比视口还大时上界会低于下界，此时一律取下界——宁可贴着左上角，也不能算出一个
 * 负数把它推到屏幕外。窗口缩小后重新应用同一位置也走这里，所以"拖到角落再缩窗口"
 * 不会让控件永久失联。
 */
export function clampPosition(
  desired: Position,
  size: Size,
  viewport: Size,
  margin = EDGE_MARGIN,
): Position {
  const maxLeft = Math.max(margin, viewport.width - size.width - margin)
  const maxTop = Math.max(margin, viewport.height - size.height - margin)
  return {
    left: Math.min(Math.max(desired.left, margin), maxLeft),
    top: Math.min(Math.max(desired.top, margin), maxTop),
  }
}

export interface PositionStore {
  read(): Position | null
  write(value: Position): void
}

/**
 * localStorage 支持的位置存档。读到任何不是「两个有限数」的东西都当没有存过——
 * 存档损坏时应该回到默认角落，而不是把控件放到 NaN 上去。
 */
export function createStoredPosition(key: string, storage: Storage | null): PositionStore {
  return {
    read() {
      try {
        const raw = storage?.getItem(key) ?? null
        if (raw === null) return null
        const parsed = JSON.parse(raw) as Record<string, unknown> | null
        const left = parsed?.['left']
        const top = parsed?.['top']
        if (typeof left !== 'number' || typeof top !== 'number') return null
        if (!Number.isFinite(left) || !Number.isFinite(top)) return null
        return { left, top }
      } catch {
        return null
      }
    },
    write(value) {
      // 写不进去（隐私模式、配额）不该让控件变得不可用，位置丢了就丢了。
      try {
        storage?.setItem(key, JSON.stringify(value))
      } catch {
        /* 忽略 */
      }
    },
  }
}

export interface DraggableOptions {
  readonly store: PositionStore
  viewport(): Size
}

/**
 * 让一个 fixed 定位的控件可以拖动。
 *
 * 位置自己记账，不回读 `getBoundingClientRect()`——一是拖动过程中每帧读布局会强制
 * 同步排版，二是这样这段逻辑在没有排版的测试环境里也是可测的（happy-dom 的 rect 恒为 0）。
 * 只有按下的那一刻读一次，用来把 CSS 的 top/right 默认位置换算成 left/top。
 */
export function connectDraggable(element: HTMLElement, options: DraggableOptions): () => void {
  let applied: Position | null = null

  const apply = (desired: Position): void => {
    const rect = element.getBoundingClientRect()
    const clamped = clampPosition(
      desired,
      { width: rect.width, height: rect.height },
      options.viewport(),
    )
    element.style.left = `${clamped.left}px`
    element.style.top = `${clamped.top}px`
    // 默认位置来自 CSS 的 right；一旦按 left 定位就必须把它让开，否则两边同时生效。
    element.style.right = 'auto'
    applied = clamped
  }

  const stored = options.store.read()
  if (stored !== null) apply(stored)

  let origin: { pointerId: number; x: number; y: number; left: number; top: number } | null = null
  let dragged = false

  const suppressClick = (event: Event): void => {
    event.stopPropagation()
    event.preventDefault()
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    const rect = element.getBoundingClientRect()
    origin = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: applied?.left ?? rect.left,
      top: applied?.top ?? rect.top,
    }
    dragged = false
    // ⚠️ 这里**不能**取指针捕获。取了之后 click 事件的目标会变成容器而不是按钮，
    // 普通点击就再也切不了模式了。这是真引擎行为，而 happy-dom 的 setPointerCapture
    // 是空实现，单测在结构上看不见它——2026-08-24 由 browser/element/
    // shell-mode-switch.spec.ts 的「原地点击照常切换模式」这条反空断言逼出来。
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (origin === null || event.pointerId !== origin.pointerId) return
    const dx = event.clientX - origin.x
    const dy = event.clientY - origin.y
    if (!dragged) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
      dragged = true
      element.dataset['dragging'] = 'true'
      // 越过阈值之后才捕获：此后指针离开控件、甚至离开窗口，也还收得到移动与松手。
      element.setPointerCapture?.(event.pointerId)
    }
    apply({ left: origin.left + dx, top: origin.top + dy })
  }

  const onPointerUp = (event: PointerEvent): void => {
    if (origin === null || event.pointerId !== origin.pointerId) return
    element.releasePointerCapture?.(event.pointerId)
    origin = null
    element.removeAttribute('data-dragging')
    if (!dragged) return
    // 拖拽松手后浏览器还会派一次 click；不吃掉它，松手就会顺手切换模式。
    element.addEventListener('click', suppressClick, { capture: true, once: true })
    if (applied !== null) options.store.write(applied)
  }

  // 窗口变小可能把已存位置挤到视口外，重新应用一次让 clamp 把它拉回来。
  const onResize = (): void => {
    if (applied !== null) apply(applied)
  }

  element.addEventListener('pointerdown', onPointerDown)
  // 挂在 window 而不是元素上：按下之后指针很快就会离开控件，元素上收不到后续移动。
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('resize', onResize)

  return () => {
    element.removeEventListener('pointerdown', onPointerDown)
    element.removeEventListener('click', suppressClick, { capture: true })
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    window.removeEventListener('resize', onResize)
  }
}
