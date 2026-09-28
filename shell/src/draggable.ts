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
 * 一次拖动的结果：位置，加上拖动时的视口尺寸。
 *
 * ⚠️ 2026-09-28 改判：**位置只在拖动时的那个窗口尺寸下有效**。窗口尺寸一变（最大化、
 * 还原、全屏、拖边缩放），控件回到 CSS 给的默认右上角，这个位置作废。此前位置按左上角
 * 记绝对坐标、窗口变化时只做 clamp：拖过一次（哪怕只有拖动阈值那 4px）之后最大化，控件
 * 就停在屏幕中间，再也回不到右上角——960→1920 时右边距从 22px 变成 982px，真引擎复现。
 * 那个行为曾被登记为「已知非缺陷」，用户实际使用后改判为缺陷，并选定了这条语义。
 */
export interface Placement {
  readonly position: Position
  readonly viewport: Size
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
  topInset = 0,
): Position {
  const minTop = topInset + margin
  const maxLeft = Math.max(margin, viewport.width - size.width - margin)
  const maxTop = Math.max(minTop, viewport.height - size.height - margin)
  return {
    left: Math.min(Math.max(desired.left, margin), maxLeft),
    top: Math.min(Math.max(desired.top, minTop), maxTop),
  }
}

export interface PositionStore {
  read(): Placement | null
  write(value: Placement): void
  clear(): void
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * localStorage 支持的位置存档，存成 `{ left, top, width, height }`。读到任何不是
 * 「四个有限数、尺寸为正」的东西都当没有存过——存档损坏时应该回到默认角落，而不是把
 * 控件放到 NaN 上去。修复前的旧存档只有 left/top，没记窗口尺寸、无从判断它在当前尺寸下
 * 是否有效，同样当作没有。
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
        const width = parsed?.['width']
        const height = parsed?.['height']
        if (!finite(left) || !finite(top) || !finite(width) || !finite(height)) return null
        if (width <= 0 || height <= 0) return null
        return { position: { left, top }, viewport: { width, height } }
      } catch {
        return null
      }
    },
    write({ position, viewport }) {
      // 写不进去（隐私模式、配额）不该让控件变得不可用，位置丢了就丢了。
      try {
        storage?.setItem(key, JSON.stringify({ ...position, ...viewport }))
      } catch {
        /* 忽略 */
      }
    },
    clear() {
      try {
        storage?.removeItem(key)
      } catch {
        /* 忽略 */
      }
    },
  }
}

function sameSize(a: Size, b: Size): boolean {
  return a.width === b.width && a.height === b.height
}

export interface DraggableOptions {
  readonly store: PositionStore
  viewport(): Size
  /** 视口顶部被占掉的高度（桌面壳的标签栏）。控件拖不进这一段。 */
  topInset?(): number
}

/**
 * 让一个 fixed 定位的控件可以拖动。
 *
 * 位置自己记账，不回读 `getBoundingClientRect()`——一是拖动过程中每帧读布局会强制
 * 同步排版，二是这样这段逻辑在没有排版的测试环境里也是可测的（happy-dom 的 rect 恒为 0）。
 * 只有按下的那一刻读一次，用来把 CSS 的 top/right 默认位置换算成 left/top。
 *
 * 存档与屏幕始终一致：要么存着屏幕上那个拖过的位置，要么什么也不存、控件在 CSS 默认位置。
 * 语义见 {@link Placement}。
 */
export function connectDraggable(element: HTMLElement, options: DraggableOptions): () => void {
  let applied: Placement | null = null

  const apply = (desired: Position, viewport: Size): void => {
    const rect = element.getBoundingClientRect()
    const clamped = clampPosition(
      desired,
      { width: rect.width, height: rect.height },
      viewport,
      EDGE_MARGIN,
      options.topInset?.() ?? 0,
    )
    element.style.left = `${clamped.left}px`
    element.style.top = `${clamped.top}px`
    // 默认位置来自 CSS 的 right；一旦按 left 定位就必须把它让开，否则两边同时生效。
    element.style.right = 'auto'
    applied = { position: clamped, viewport }
  }

  // 连接时的内联定位就是「默认位置」：壳里它为空，默认的右上角由样式表的 top/right 给出；
  // 测试夹具里它直接写在内联样式上。所以回到默认 = 原样还原这三项，不能一律删掉——
  // 一律删掉会把内联给出的默认位置一起删了，控件掉到左上角（2026-09-28 真引擎测出）。
  const initial = { left: element.style.left, top: element.style.top, right: element.style.right }
  const returnToDefault = (): void => {
    element.style.left = initial.left
    element.style.top = initial.top
    element.style.right = initial.right
    applied = null
    options.store.clear()
  }

  const stored = options.store.read()
  if (stored !== null) {
    // readit 每次都以同一尺寸启动；在别的尺寸（比如最大化时）拖的位置，这里不再有效。
    if (sameSize(stored.viewport, options.viewport())) apply(stored.position, stored.viewport)
    else returnToDefault()
  }

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
      left: applied?.position.left ?? rect.left,
      top: applied?.position.top ?? rect.top,
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
    apply({ left: origin.left + dx, top: origin.top + dy }, options.viewport())
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

  // 窗口尺寸一变，拖过的位置就作废，回到右上角。不再在新尺寸下 clamp 那个旧位置：
  // clamp 只能保证控件不出视口，保证不了它回到用户期望的角落。
  const onResize = (): void => {
    if (applied !== null && !sameSize(applied.viewport, options.viewport())) returnToDefault()
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
