import {
  createKernel,
  dedent,
  isInlineMath,
  isMode,
  isTheme,
  resolveMountOptions,
  type Kernel,
} from './kernel.js'
import { GITHUB_EMOJI_BASE } from '@readit/core'
import type { MountHandle, MountOptions } from './types.js'

export type { Mode, MountHandle, MountOptions, Theme } from './types.js'
export { DEFAULT_MOUNT_OPTIONS } from './kernel.js'

export function mount(host: HTMLElement, opts?: Partial<MountOptions>): MountHandle {
  const kernel = createKernel(host, resolveMountOptions(opts))
  // 只暴露 M6 的六个方法：内核上的 root / disposers / onAfterRender 是内部接缝，
  // 一旦从公共句柄漏出去就再也收不回来。
  return {
    setValue: (value: string): void => {
      kernel.setValue(value)
    },
    getValue: (): string => kernel.getValue(),
    setMode: (mode): void => {
      kernel.setMode(mode)
    },
    setTheme: (theme): void => {
      kernel.setTheme(theme)
    },
    find: (query, options) => kernel.find(query, options),
    destroy: (): void => {
      kernel.destroy()
    },
  }
}

export const DEFAULT_TAG = 'readit-view'

function readEnum<T extends string>(
  el: HTMLElement,
  attr: string,
  guard: (value: string) => value is T,
  fallback: T,
): T {
  const raw = el.getAttribute(attr)
  if (raw === null) return fallback
  if (guard(raw)) return raw
  // 未知取值不静默吞掉（§12 降级必须可见）。
  el.ownerDocument.defaultView?.console.warn(
    `readit: <${el.localName}> 的 ${attr}="${raw}" 不是合法取值，回落到 "${fallback}"`,
  )
  return fallback
}

/**
 * 每次调用都造一个新类：一个构造器只能注册一次，用同一个类注册第二个标签名
 * 同样抛 NotSupportedError。类体在函数里，import 时不求值 HTMLElement，
 * 所以 Node 里 import 这个模块不会 ReferenceError。
 */
function createReaditElement(): CustomElementConstructor {
  return class ReaditViewElement extends HTMLElement {
    static readonly observedAttributes: readonly string[] = ['mode', 'theme']

    #kernel: Kernel | null = null
    #value = ''

    get value(): string {
      return this.#kernel?.getValue() ?? this.#value
    }

    set value(next: string) {
      this.#value = next
      this.#kernel?.setValue(next)
    }

    connectedCallback(): void {
      if (this.#kernel !== null) return
      if (this.#value === '') this.#value = dedent(this.textContent ?? '')
      // 轻 DOM 里的源码已经取走；shadow:false 时留着它会和渲染结果并排显示。
      this.textContent = ''
      this.#kernel = createKernel(
        this,
        resolveMountOptions({
          value: this.#value,
          mode: readEnum(this, 'mode', isMode, 'read'),
          theme: readEnum(this, 'theme', isTheme, 'auto'),
          inlineMath: readEnum(this, 'inline-math', isInlineMath, 'github'),
          shadow: this.getAttribute('shadow') !== 'false',
          baseUrl: this.getAttribute('base-url') ?? '',
          emojiBase: this.getAttribute('emoji-base') ?? GITHUB_EMOJI_BASE,
        }),
      )
    }

    disconnectedCallback(): void {
      const kernel = this.#kernel
      if (kernel === null) return
      this.#value = kernel.getValue()
      this.#kernel = null
      kernel.destroy()
    }

    attributeChangedCallback(name: string): void {
      const kernel = this.#kernel
      if (kernel === null) return
      if (name === 'mode') kernel.setMode(readEnum(this, 'mode', isMode, 'read'))
      else if (name === 'theme') kernel.setTheme(readEnum(this, 'theme', isTheme, 'auto'))
    }
  }
}

export function defineReadit(tag: string = DEFAULT_TAG): void {
  const registry = globalThis.customElements as CustomElementRegistry | undefined
  if (registry === undefined) {
    throw new Error('readit: 当前环境没有 customElements，defineReadit() 无从注册')
  }
  // 自动注册会让同页两个版本抛不可恢复的 NotSupportedError（SPEC §9.3），
  // 所以这个函数存在、且守着 get()。
  if (registry.get(tag) !== undefined) return
  registry.define(tag, createReaditElement())
}
