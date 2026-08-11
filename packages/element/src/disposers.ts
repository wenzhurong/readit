/**
 * 一个挂载实例在生命期里注册的全部「需要拆掉的东西」。
 *
 * destroy() 的完整性由 test/leak.test.ts 的探针守，不靠代码评审看（设计文档 §3.5）。
 * 那条探针同时守着一条结构约束：src/ 里除本文件外不得直接调用 addEventListener。
 */
export interface Disposers {
  add(dispose: () => void): void
  /** 尚未拆掉的登记项数量。 */
  readonly size: number
  /** 逆序执行并清空。重复调用是安全的空操作。 */
  disposeAll(): void
}

export function createDisposers(): Disposers {
  const entries: Array<() => void> = []
  return {
    add(dispose: () => void): void {
      entries.push(dispose)
    },
    get size(): number {
      return entries.length
    },
    disposeAll(): void {
      // 逆序：后注册的通常建立在先注册的之上。
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const dispose = entries[i]
        if (dispose !== undefined) dispose()
      }
      entries.length = 0
    },
  }
}

/** 唯一允许的 addEventListener 入口——绕过它注册的监听器不会被 destroy() 拆掉。 */
export function addListener(
  disposers: Disposers,
  target: EventTarget,
  type: string,
  handler: EventListener,
  options?: AddEventListenerOptions,
): void {
  target.addEventListener(type, handler, options)
  disposers.add(() => {
    target.removeEventListener(type, handler, options)
  })
}
