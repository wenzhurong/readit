import DOMPurify from 'dompurify'

/**
 * element 里**唯一**把 HTML 写进 DOM 的地方。三级：
 *
 *   1. `'setHTML' in Element.prototype`  -> Element.setHTML()
 *   2. 否则 window.trustedTypes 存在     -> 单一 Trusted Types 策略
 *   3. 否则                               -> 对已消毒内容用 innerHTML
 *
 * 二级不是可选项。任何下发 `require-trusted-types-for 'script'` 的企业宿主里，
 * 给 innerHTML 赋一个普通字符串会直接抛 TypeError，组件当场死掉；而本地开发机
 * 上没有那条 CSP，所以这个失败**永远不会在开发期出现**。它只在别人的生产环境里出现。
 *
 * 一二级的顺序不是抄近路：Element.setHTML() 自带消毒，规范上不受
 * require-trusted-types-for 约束，所以两者都在时走一级是正确的。
 *
 * 一级的内建消毒器比 Phase A 的输出更严格还是更宽松，Node 里判不了 —— 尤其是
 * 滚动同步依赖的 `data-line` 会不会被它剥掉。那条断言归 L3b-element（真浏览器）。
 * 本文件的测试只判「选了哪一级」与「那一级怎么递交」。
 */

/** setHtml 能写入的宿主节点。真实的 Element 结构上满足它。 */
export interface HtmlSink {
  /** Sanitizer API（一级）。老浏览器与 TS 5.9 的 lib.dom 里都还没有它，故可选。 */
  setHTML?: (html: string) => void
  innerHTML: string
}

/**
 * 二级需要的最小消毒器端口。形状照 DOMPurify 抄，好让生产接线就是 DOMPurify 本身、
 * 中间不夹适配器；返回值声明成 unknown 而不是 TrustedHTML，是为了不把
 * @types/trusted-types 拖进本包的编译面 —— 我们对那个值只做一件事：原样交给 innerHTML。
 */
export interface DomPurifyLike {
  sanitize(dirty: string, cfg: { RETURN_TRUSTED_TYPE: true }): unknown
}

export type InjectionTier = 'setHTML' | 'trusted-types' | 'innerHTML'

export interface InjectionEnv {
  /** `'setHTML' in Element.prototype` */
  hasSetHtml: boolean
  /** `window.trustedTypes` 是否存在 */
  hasTrustedTypes: boolean
  purify: DomPurifyLike
}

export function selectTier(env: InjectionEnv): InjectionTier {
  if (env.hasSetHtml) return 'setHTML'
  if (env.hasTrustedTypes) return 'trusted-types'
  return 'innerHTML'
}

/**
 * 从真实全局读一次。两处都用 typeof 守：在纯 Node 里这两个标识符根本不存在；
 * 在本包 vitest 用的 happy-dom（§0 A2）里 `window` 与 `Element` 都存在，但
 * happy-dom 20.11.2 都没有实现 Sanitizer API 与 Trusted Types，所以这两个探测
 * 在两种测试环境下碰巧给出同一个答案——真正装了这两个特性的宿主由 L3b-element
 * （真浏览器）断言。
 */
export function readEnv(): InjectionEnv {
  return {
    hasSetHtml: typeof Element !== 'undefined' && 'setHTML' in Element.prototype,
    hasTrustedTypes: typeof window !== 'undefined' && 'trustedTypes' in window,
    purify: DOMPurify,
  }
}

export function createSetHtml(env: InjectionEnv): (sink: HtmlSink, html: string) => void {
  // 档位在这里定一次。env 在页面生命周期内不会变，每次注入重判是白花的钱。
  const tier = selectTier(env)

  if (tier === 'setHTML') {
    return (sink, html) => {
      const setHTML = sink.setHTML
      if (setHTML === undefined) {
        throw new TypeError('setHtml: 选中了一级，但这个节点没有 setHTML()')
      }
      setHTML.call(sink, html)
    }
  }

  if (tier === 'trusted-types') {
    return (sink, html) => {
      // 单一策略：DOMPurify 自己只建一次策略并复用，所以整个组件生命周期里
      // 只有一个策略名要被宿主的 trusted-types 指令放行。
      const trusted = env.purify.sanitize(html, { RETURN_TRUSTED_TYPE: true })
      // TrustedHTML 不是 string —— 但在这条 CSP 下，innerHTML 的 setter 恰恰只接受它。
      // 这个 cast 是类型系统与运行时之间那道缝，不是偷懒。
      sink.innerHTML = trusted as string
    }
  }

  return (sink, html) => {
    // 到这里的 html 已经过 Phase A 的 hast-util-sanitize。三级不做第二遍消毒，
    // 做的是「相信上游」——这个信任由 core 的消毒测试承重，不由这里。
    sink.innerHTML = html
  }
}

let injector: ((sink: HtmlSink, html: string) => void) | null = null

/** 后续所有把 HTML 写进 DOM 的代码只准调它。别处不得再出现 `innerHTML =`。 */
export function setHtml(sink: HtmlSink, html: string): void {
  injector ??= createSetHtml(readEnv())
  injector(sink, html)
}
