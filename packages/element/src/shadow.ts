import type { Disposers } from './disposers.js'

export interface RootContext {
  readonly host: HTMLElement
  /** 宿主所属的 window。跨 iframe 时它不是 globalThis。 */
  readonly view: Window
  /** 样式与内容的容器：shadow:true 时是 ShadowRoot，false 时是宿主自身。 */
  readonly container: ShadowRoot | HTMLElement
  /** part="root" 的外层元素。 */
  readonly root: HTMLDivElement
  /** true = 走 adoptedStyleSheets；false = 回落到一个 <style> 元素。 */
  readonly adopted: boolean
  /** 按给定顺序整体替换样式表，数组顺序即层叠顺序。 */
  setStyles(cssTexts: readonly string[]): void
}

export function ownerView(host: HTMLElement): Window {
  const view = host.ownerDocument.defaultView
  if (view === null) {
    throw new Error('readit: 宿主元素不属于任何 window（游离的 document？），无法挂载')
  }
  return view
}

/**
 * lib.dom.d.ts 不把 `CSSStyleSheet` 建模成 `Window` 接口的成员——它和其余全局构造器
 * 一样，是一条独立的 `declare var`，不挂在 Window 类型上。但我们要的恰恰是「这个 view
 * 自己的」构造器（跨 iframe 时那不是 globalThis.CSSStyleSheet），所以只能读属性、
 * 用这个窄化类型顶一下，不读裸全局。
 */
type ViewWithCssom = Window & { CSSStyleSheet: typeof CSSStyleSheet }

/**
 * Safari 16.4 之前的 WKWebView 没有 ShadowRoot.adoptedStyleSheets，
 * light DOM 逃生舱则根本没有这个属性——两条路都要有 <style> 回落。
 */
function canAdopt(container: ShadowRoot | HTMLElement, view: Window): boolean {
  if (!('adoptedStyleSheets' in container)) return false
  try {
    new (view as ViewWithCssom).CSSStyleSheet()
    return true
  } catch {
    return false
  }
}

export function createRoot(host: HTMLElement, shadow: boolean, disposers: Disposers): RootContext {
  const view = ownerView(host)
  const doc = host.ownerDocument
  // 同一个宿主被挂载第二次时 attachShadow 会抛 NotSupportedError，复用既有的。
  const container: ShadowRoot | HTMLElement = shadow
    ? (host.shadowRoot ?? host.attachShadow({ mode: 'open' }))
    : host
  const adopted = canAdopt(container, view)

  const root = doc.createElement('div')
  root.className = 'readit-root'
  root.setAttribute('part', 'root')
  // 导航后要能把焦点放进来（#slug 桥接、后退键），但不进 Tab 序列。
  root.setAttribute('tabindex', '-1')
  container.appendChild(root)

  let styleEl: HTMLStyleElement | null = null

  const setStyles = (cssTexts: readonly string[]): void => {
    if (adopted) {
      const sheets = cssTexts.map((text) => {
        const sheet = new (view as ViewWithCssom).CSSStyleSheet()
        sheet.replaceSync(text)
        return sheet
      })
      ;(container as ShadowRoot).adoptedStyleSheets = sheets
      return
    }
    if (styleEl === null) {
      styleEl = doc.createElement('style')
      styleEl.setAttribute('data-readit', 'styles')
      container.insertBefore(styleEl, container.firstChild)
    }
    styleEl.textContent = cssTexts.join('\n')
  }

  disposers.add(() => {
    if (adopted) (container as ShadowRoot).adoptedStyleSheets = []
    if (styleEl !== null) {
      styleEl.remove()
      styleEl = null
    }
    root.remove()
  })

  return { host, view, container, root, adopted, setStyles }
}
