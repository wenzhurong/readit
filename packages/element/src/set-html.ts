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
 * §0.1 追加（批次 5，L3b-element 实测发现）：一级的内建消毒器**比 Phase A 的输出更
 * 严格**——浏览器原生 `Element.setHTML()` 不传配置时，落到自己的默认允许名单，
 * 那份名单不认识 `<img>`、`<input>`、`<details>`/`<summary>`，全局属性名单里没有
 * `id`/`class`/`style`/`data-*`。标题锚点的 `id`、任务列表的 checkbox、图片、
 * `data-line` 全部会在写入真实 DOM 这一步消失——这些不是"用户内容"要过安全审查，
 * 是 Phase A **自己生成**的、已经判定安全的输出（甚至部分从不经过
 * `hast-util-sanitize`，见 `@readit/core` 的 `sanitize.ts`）。TIER1_SANITIZER_CONFIG
 * 就是补这个缺口的地方。
 */

/**
 * 第 1 级用的 Sanitizer 配置的最小类型面。TS 5.9 的 lib.dom.d.ts 完全没有
 * Sanitizer API 的类型（同 readEnv() 探测 trustedTypes 时的理由：类型系统
 * 落后于浏览器实现），这里只声明用得到的那一小片，不追求还原整份规范。
 */
export interface SanitizerNameEntry {
  readonly name: string
  readonly namespace?: string
}
export interface SanitizerElementEntry extends SanitizerNameEntry {
  readonly attributes?: readonly SanitizerNameEntry[]
}
export interface SanitizerConfigLike {
  readonly elements: readonly SanitizerElementEntry[]
  readonly attributes: readonly SanitizerNameEntry[]
  readonly dataAttributes?: boolean
  // 规范里还有 removeElements / replaceWithChildrenElements / comments 等字段；
  // 这里只做「取浏览器自己的默认值、加东西」的展开，不需要认识其余字段的形状，
  // 也就不需要在类型里穷举它们。
}
export interface SanitizerInstanceLike {
  get(): SanitizerConfigLike
}
export interface SanitizerCtorLike {
  new (config?: SanitizerConfigLike): SanitizerInstanceLike
}

/**
 * Phase A 真实输出里，浏览器默认 Sanitizer 允许名单没有覆盖到的元素。
 *
 * 不是手写猜的，是实测出来的：把 kernel.ts 会喂给 setHtml() 的完整语料
 * （标题锚点、GFM 表格、任务列表、脚注、代码高亮块、图片、自定义 emoji 快捷码、
 * math-renderer 数学降级块、`<details>`）跑一遍 `@readit/core` 的 `render()`，
 * 用 `DOMParser` 解析出「期望」的元素与属性集合，再用下面这份配置跑一遍
 * `setHTML()`，逐元素逐属性 diff 到零差异（诊断脚本与命令见 batch-5-report.md）。
 */
const EXTRA_ELEMENTS: readonly SanitizerElementEntry[] = [
  // 浏览器默认 Sanitizer 完全不认识 <img>——Phase A 渲染的每一张图片
  // （含自定义 emoji 的 <img class="emoji">，见 rules/emoji.ts）都会消失。
  {
    name: 'img',
    attributes: [{ name: 'src' }, { name: 'alt' }, { name: 'height' }, { name: 'width' }, { name: 'align' }],
  },
  // 任务列表清单的复选框（rules/tasklist.ts）。
  { name: 'input', attributes: [{ name: 'type' }, { name: 'checked' }, { name: 'disabled' }] },
  // 默认名单里没有，GitHub 形状的可折叠块（用户原始 HTML 里的 <details>）会被整个剥掉。
  { name: 'details', attributes: [{ name: 'open' }] },
  { name: 'summary' },
  // GitHub 的两个自定义元素，Phase A 直接生成（rules/table.ts、rules/math-inline.ts），
  // 不经过用户内容的消毒路径，本来就不该被当成「未知标签」处理。
  { name: 'markdown-accessiblity-table', namespace: 'http://www.w3.org/1999/xhtml' },
  { name: 'math-renderer', namespace: 'http://www.w3.org/1999/xhtml' },
]

/** 同上，覆盖的是全局属性名单（浏览器默认对所有元素都放行的那一份）。 */
const EXTRA_ATTRIBUTES: readonly SanitizerNameEntry[] = [
  // 标题锚点、脚注回链、任务列表复选框都靠 id 定位；class 是 GitHub 形状样式
  // （markdown-alert、highlight、task-list-item……）的唯一挂载点；style 是
  // math-renderer 降级块与自定义 emoji 对齐用的行内样式；target/rel 是外链装饰
  // （navigate.ts 的 decorateLinks()）；aria-* 是可访问性标注；version 是
  // octicon svg 的版本属性。
  { name: 'id' },
  { name: 'class' },
  { name: 'style' },
  { name: 'target' },
  { name: 'rel' },
  { name: 'aria-hidden' },
  { name: 'aria-label' },
  { name: 'aria-describedby' },
  { name: 'version' },
]

/**
 * 在浏览器自己的默认配置基础上做加法，**不是**从零手写一张白名单去替换它——
 * `<script>`、事件处理器属性（onclick/onerror/onload……）、`<iframe>`、`<object>`、
 * `<style>` 这些默认配置本来就会拦的东西，原样保留，不重新发明。已经用真实
 * XSS 语料（`<script>`、`onerror`、`onclick`、`onload`、`javascript:` 协议的
 * href/formaction、`<iframe>`、`<object>`）验证过加了 EXTRA_ELEMENTS /
 * EXTRA_ATTRIBUTES 之后它们仍然被拦——见 batch-5-report.md 的复现记录。
 *
 * `dataAttributes: true`：`data-line`（滚动同步用）、`data-footnote-ref` 等一批
 * `data-*` 没有必要逐个列举，浏览器自己就有这个开关。
 */
function buildTier1Sanitizer(ctor: SanitizerCtorLike): SanitizerInstanceLike {
  const base = new ctor().get()
  return new ctor({
    ...base,
    elements: [...base.elements, ...EXTRA_ELEMENTS],
    attributes: [...base.attributes, ...EXTRA_ATTRIBUTES],
    dataAttributes: true,
  })
}

/** setHtml 能写入的宿主节点。真实的 Element 结构上满足它。 */
export interface HtmlSink {
  /** Sanitizer API（一级）。老浏览器与 TS 5.9 的 lib.dom 里都还没有它，故可选。 */
  setHTML?: (html: string, options?: { sanitizer?: SanitizerConfigLike | SanitizerInstanceLike }) => void
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
  /**
   * 全局 `Sanitizer` 构造器，仅当 `hasSetHtml` 为真时才可能有意义。规范上两者
   * 同属一套 API、理应同时存在，这里仍然分开探测、允许它缺席——`hasSetHtml`
   * 为真但这个是 `undefined` 时，第 1 级退回不传配置的 `setHTML(html)`
   * （回到浏览器默认的、更严格的允许名单），而不是抛错把组件搞挂。
   */
  sanitizerCtor: SanitizerCtorLike | undefined
}

export function selectTier(env: InjectionEnv): InjectionTier {
  if (env.hasSetHtml) return 'setHTML'
  if (env.hasTrustedTypes) return 'trusted-types'
  return 'innerHTML'
}

/**
 * 从真实全局读一次。三处都用 typeof 守：在纯 Node 里这几个标识符根本不存在；
 * 在本包 vitest 用的 happy-dom（§0 A2）里 `window` 与 `Element` 都存在，但
 * happy-dom 20.11.2 都没有实现 Sanitizer API 与 Trusted Types，所以这几个探测
 * 在两种测试环境下碰巧给出同一个答案——真正装了这两个特性的宿主由 L3b-element
 * （真浏览器）断言。
 */
export function readEnv(): InjectionEnv {
  const sanitizerCtor = (globalThis as unknown as { Sanitizer?: SanitizerCtorLike }).Sanitizer
  return {
    hasSetHtml: typeof Element !== 'undefined' && 'setHTML' in Element.prototype,
    hasTrustedTypes: typeof window !== 'undefined' && 'trustedTypes' in window,
    purify: DOMPurify,
    sanitizerCtor: typeof sanitizerCtor === 'function' ? sanitizerCtor : undefined,
  }
}

export function createSetHtml(env: InjectionEnv): (sink: HtmlSink, html: string) => void {
  // 档位在这里定一次。env 在页面生命周期内不会变，每次注入重判是白花的钱。
  const tier = selectTier(env)

  if (tier === 'setHTML') {
    // 同理只算一次：sanitizer 配置在整个页面生命周期内不会变。
    const sanitizer = env.sanitizerCtor === undefined ? undefined : buildTier1Sanitizer(env.sanitizerCtor)
    return (sink, html) => {
      const setHTML = sink.setHTML
      if (setHTML === undefined) {
        throw new TypeError('setHtml: 选中了一级，但这个节点没有 setHTML()')
      }
      if (sanitizer === undefined) setHTML.call(sink, html)
      else setHTML.call(sink, html, { sanitizer })
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
