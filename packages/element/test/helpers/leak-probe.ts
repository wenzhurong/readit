/**
 * 泄漏探针。挂载/销毁循环之后监听器与观察器的净增量必须是 0。
 *
 * 为什么是探针而不是代码评审：设计文档 §3.5 明写「用一条泄漏检测测试守住，
 * 不靠代码评审看」。ResizeObserver 与 MutationObserver 现在还没人用（read 模式
 * 不需要），探针照样把它们计上——Task 13–17 的编辑器一旦漏掉一个 disconnect()，
 * 红的是这条，而不是三个月后某个宿主 SPA 的内存曲线。
 *
 * ## 补丁打在哪：不是 `view.EventTarget.prototype`
 *
 * 任务书原文的实现补丁打在 `view.EventTarget.prototype` 上。在 happy-dom
 * 20.11.2（§0 A2/A3 钉的版本）下实测这是错的，探针自己的自检测试
 * （下面「抓得到没拆的监听器」那条）会先红：`window.EventTarget` 作为裸全局
 * 读到的其实是 **Node.js 自带**的那个 `EventTarget` 类（Node 15+ 全局可用），
 * 跟真实 DOM 节点（`document.createElement('div')`）的原型链毫无关系——两者
 * `instanceof` 互不成立。真正持有 `addEventListener` 的那个类存在（`constructor.name
 * === 'EventTarget'`），但没有任何全局标识符能直接拿到它，只能从一个真实
 * DOM 实例往上走原型链，找到「自己拥有 addEventListener」的那一层。
 *
 * 更麻烦的是 `MediaQueryList`（`theme.ts` 的 `matchMedia()` 用它注册系统主题
 * 变化监听）：它不通过这条共享的 EventTarget 基类实现监听器，是在自己的
 * 原型上直接定义的 `addEventListener`/`removeEventListener`——补丁只打 DOM
 * 节点那一层，`createThemeController` 里的 `mql.addEventListener` 完全测不到，
 * 会造成「探针看起来没问题，但漏了一整类监听器」的假阴性。
 *
 * 所以这里不信任任何全局标识符，一律从真实实例采样、往上走原型链找到
 * 「自己拥有 addEventListener」的那一层再打补丁；ShadowRoot 与普通 Element
 * 实测共享同一层（用 `document.createElement('div')` 采样已经够），
 * `MediaQueryList` 单独采样一次。
 *
 * 第三层是 `view`（window/globalThis）自己：实测它既不是 DOM 节点共享的那层，
 * 也不是 `MediaQueryList` 那层——`window.addEventListener` 是 window 自己的
 * own property（`Object.prototype.hasOwnProperty.call(window,
 * 'addEventListener')` 为真），不经过任何共享原型，需要单独采样打补丁。
 * 现在本包代码没有任何 `addListener(disposers, view, …)` 的调用点（不是活洞），
 * 但 Task 13–17 的滚动同步一旦挂 window 的 resize/scroll，漏了这一层会让探针
 * 在真正该报警的时候保持假绿，所以这一批就把它补齐，不等出问题才发现。
 *
 * 这三层是本包 `addListener()` 实际调用过、以及可预见会调用的全部具体类型
 * （navigate.ts 的 host 点击/键盘/鼠标事件、theme.ts 的 matchMedia change
 * 事件、Task 13–17 可能挂的 window 事件）。若以后出现第四类 EventTarget 实现
 * （比如某个第三方库自己的事件总线），需要在这里再加一次 `patchOwnerOf` 采样
 * ——这不是自动泛化的，见文件末尾「已知局限」。
 */
export interface LeakCounts {
  listeners: number
  resizeObservers: number
  mutationObservers: number
}

export interface LeakProbe {
  /** 相对安装时刻的净增量。 */
  counts(): LeakCounts
  /** 没拆掉的监听器，形如 "HTMLDivElement#click"，给断言失败时的人看。 */
  describe(): string[]
  uninstall(): void
}

interface Disconnectable {
  disconnect(): void
}

type ListenerFn = (
  this: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | AddEventListenerOptions | EventListenerOptions,
) => void

interface PatchedProto {
  proto: Record<string, unknown>
  add: ListenerFn
  remove: ListenerFn
}

export function installLeakProbe(view: Window & typeof globalThis): LeakProbe {
  const live = new Map<string, string>()
  const ids = new WeakMap<object, number>()
  let seq = 0
  const idOf = (value: object): number => {
    const existing = ids.get(value)
    if (existing !== undefined) return existing
    seq += 1
    ids.set(value, seq)
    return seq
  }
  const captureOf = (options?: boolean | AddEventListenerOptions | EventListenerOptions): boolean =>
    typeof options === 'boolean' ? options : options?.capture === true
  const keyOf = (target: EventTarget, type: string, listener: object, capture: boolean): string =>
    `${idOf(target)}|${type}|${idOf(listener)}|${capture ? 1 : 0}`

  const patched: PatchedProto[] = []

  /** 从一个真实实例往上走原型链，找到「自己拥有 addEventListener」的那一层并打补丁。 */
  function patchOwnerOf(sample: EventTarget | null): void {
    if (sample === null) return
    let proto: object | null = sample
    while (proto !== null && !Object.prototype.hasOwnProperty.call(proto, 'addEventListener')) {
      proto = Object.getPrototypeOf(proto)
    }
    if (proto === null) return
    const rec = proto as Record<string, unknown>
    if (patched.some((p) => p.proto === rec)) return // 两个采样点可能共享同一层，别打两次
    const realAdd = rec['addEventListener'] as ListenerFn
    const realRemove = rec['removeEventListener'] as ListenerFn
    patched.push({ proto: rec, add: realAdd, remove: realRemove })

    rec['addEventListener'] = function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): void {
      if (listener !== null && listener !== undefined) {
        live.set(
          keyOf(this, type, listener as object, captureOf(options)),
          `${this.constructor.name}#${type}`,
        )
      }
      realAdd.call(this, type, listener, options)
    }

    rec['removeEventListener'] = function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ): void {
      if (listener !== null && listener !== undefined) {
        live.delete(keyOf(this, type, listener as object, captureOf(options)))
      }
      realRemove.call(this, type, listener, options)
    }
  }

  patchOwnerOf(view.document.createElement('div'))
  if (typeof view.matchMedia === 'function') {
    patchOwnerOf(view.matchMedia('(prefers-color-scheme: dark)') as unknown as EventTarget)
  }
  // `view` 自己（window/globalThis）也要采样：实测它跟 DOM 节点共享的那层、跟
  // MediaQueryList 那层都不是同一个对象——`window.addEventListener` 是 window
  // 自己的实例属性（own property），不经过任何原型。现在本包代码没有任何
  // `addListener(disposers, view, …)` 的调用点，所以不是活洞，但 Task 13–17
  // 的滚动同步一旦挂 window 的 resize/scroll，漏了这一层会让探针在真正该报警
  // 的时候保持假绿——不能等到那时才发现。
  patchOwnerOf(view)

  let resizeObservers = 0
  let mutationObservers = 0

  function wrap(realCtor: unknown, onOpen: () => void, onClose: () => void): unknown {
    return class Counting {
      #inner: Disconnectable | null
      #closed = false
      constructor(callback: unknown) {
        onOpen()
        this.#inner =
          typeof realCtor === 'function'
            ? (new (realCtor as new (cb: unknown) => Disconnectable)(callback) as Disconnectable)
            : null
      }
      observe(...args: unknown[]): void {
        ;(this.#inner as unknown as { observe?: (...a: unknown[]) => void } | null)?.observe?.(...args)
      }
      unobserve(...args: unknown[]): void {
        ;(this.#inner as unknown as { unobserve?: (...a: unknown[]) => void } | null)?.unobserve?.(...args)
      }
      takeRecords(): unknown[] {
        return (
          (this.#inner as unknown as { takeRecords?: () => unknown[] } | null)?.takeRecords?.() ?? []
        )
      }
      disconnect(): void {
        this.#inner?.disconnect()
        if (this.#closed) return
        this.#closed = true
        onClose()
      }
    }
  }

  const realResize = (view as unknown as Record<string, unknown>)['ResizeObserver']
  const realMutation = (view as unknown as Record<string, unknown>)['MutationObserver']
  Reflect.set(
    view,
    'ResizeObserver',
    wrap(realResize, () => (resizeObservers += 1), () => (resizeObservers -= 1)),
  )
  Reflect.set(
    view,
    'MutationObserver',
    wrap(realMutation, () => (mutationObservers += 1), () => (mutationObservers -= 1)),
  )

  return {
    counts: (): LeakCounts => ({ listeners: live.size, resizeObservers, mutationObservers }),
    describe: (): string[] => [...live.values()].sort(),
    uninstall(): void {
      for (const { proto, add, remove } of patched) {
        proto['addEventListener'] = add
        proto['removeEventListener'] = remove
      }
      Reflect.set(view, 'ResizeObserver', realResize)
      Reflect.set(view, 'MutationObserver', realMutation)
    },
  }
}
