import { addListener, type Disposers } from './disposers.js'

/**
 * 前进/后退是元素自己的能力，不是壳的（SPEC §11.2）：历史栈整个活在这个模块里，
 * kernel.ts 只提供 DOM 挂载点与 showError/clearError 两个回调。
 */

export type LinkKind = 'hash' | 'relative' | 'external' | 'ignore'

/**
 * 一个 URL scheme 至少两个字母（RFC 3986 语法上允许单字母，但没有任何真实
 * scheme 只有一个字母）——这条把 Windows 盘符（`C:\docs\a.md`）从「外链」里摘出去，
 * 它长得跟 `scheme:` 一模一样，实际上是本地路径。
 */
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/

export function classifyHref(href: string): LinkKind {
  if (href === '') return 'ignore'
  if (href.startsWith('#')) return 'hash'
  if (href.startsWith('//')) return 'external'
  const match = SCHEME_RE.exec(href)
  const scheme = match?.[1]
  if (scheme !== undefined && scheme.length >= 2) return 'external'
  return 'relative'
}

/**
 * 手写的字符串算法，不用 URL API 做相对路径解析，两个理由：
 *
 *  1. happy-dom（本包测试环境，§0 A2）的全局 `URL` 构造器对「相对路径 + 非
 *     http(s) 的 base」解析有 bug——不管传进去的 base 是什么，解析结果的
 *     scheme 总变成它自己伪造的 location（`http:`），而不尊重调用者给的 base
 *     （已用 `new URL('../x', import.meta.url)` 在这个环境里实测复现）。用它会
 *     让这个函数在测试里跟生产浏览器表现不一致，而这恰恰是最不该有分歧的地方。
 *     改用 `node:url` 的 `URL` 又不行：那是 Node 内建模块，生产构建要进真实
 *     浏览器（Task 9 的 dist/element.js），不能有这条依赖。
 *  2. baseUrl 不一定是合法 URL——纯相对路径（'docs/README.md'）、绝对路径
 *     （'/docs/README.md'）、空串都要接受，这些都不是 `new URL()` 能直接吃的
 *     形式，需要伪造一个 origin 才能喂给它，多一道折腾还多一个可能出错的地方。
 *
 * 算法是 RFC 3986 §5.3「合并路径」+ §5.2.4「移除 dot segments」的简化版：
 * 按字符串切分处理，不关心 scheme/authority 是否存在——整个 baseUrl 被当成
 * 「最后一个 / 之前是目录，之后是文件名」，这对 'docs/x.md'、'/docs/x.md'、
 * 'file:///U/docs/x.md' 三种形态都成立，不需要为 scheme 开特殊分支。
 *
 * 例外是 §5.3 明写的一条分支，之前这里漏了：**参照路径本身以 `/` 开头时，
 * 它不与 base 的目录合并，直接就是目标路径**——只有 base 的 scheme+authority
 * 前缀（`file://` 这一段）要保留，`file://` 之后那部分整个被参照路径替换掉。
 * 漏掉这条分支时 `resolveRelative('docs/README.md', '/img/a.md')` 会算成
 * `'docs//img/a.md'`（把根绝对路径当成了普通相对段去拼接），而
 * `classifyHref('/abs/x.md')` 恰好把这类 href 分类成 'relative'（见
 * `classifyHref` 的 it.each 用例），会直接喂进这个函数——路径可达，不是纸面问题。
 */
export function resolveRelative(baseUrl: string, href: string): { path: string; hash: string } {
  const hashIndex = href.indexOf('#')
  const rawPath = hashIndex === -1 ? href : href.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : href.slice(hashIndex)
  const decodedPath = decodePathSafely(rawPath)

  if (decodedPath.startsWith('/')) {
    return { path: authorityPrefixOf(baseUrl) + removeDotSegments(decodedPath), hash }
  }

  const baseDir = baseUrl.slice(0, baseUrl.lastIndexOf('/') + 1)
  return { path: removeDotSegments(baseDir + decodedPath), hash }
}

/**
 * `baseUrl` 的 `scheme://` 前缀（含裸协议相对的 `//`），没有则是空串。
 * 'docs/README.md' 与 '/docs/README.md' 都没有——它们不是带 scheme 的 URL，
 * 只是路径，根绝对参照路径替换掉它们的全部内容，无需保留任何前缀。
 * 'file:///U/docs/README.md' 有——'file://'，根绝对参照路径只替换 authority
 * 之后的部分，scheme+authority 本身保留。
 */
function authorityPrefixOf(baseUrl: string): string {
  const match = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:)?\/\//.exec(baseUrl)
  return match === null ? '' : match[0]
}

function decodePathSafely(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

/** RFC 3986 §5.2.4，按 '/' 切分处理，不特殊对待 scheme 前缀。 */
function removeDotSegments(path: string): string {
  const out: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '.') continue
    if (segment === '..') {
      // 只在有「真实」段可弹时弹；开头的空段（scheme 之后的 authority 占位，
      // 例如 'file:///' 里那两个空段）不弹——真实调用方不会构造出弹穿它们的输入。
      if (out.length > 0 && out[out.length - 1] !== '') out.pop()
      continue
    }
    out.push(segment)
  }
  return out.join('/')
}

/**
 * GitHub 把标题锚点的 id 放在兄弟 `<a id="user-content-<slug>">` 上（见 core 的
 * `rules/clobber.ts`），href 却是不带前缀的 `#<slug>`。`CLOBBER_PREFIX` 不在
 * `@readit/core` 的公开 exports 里（P1 只开 `.` / `./types` / `./package.json`），
 * 这里按值硬编码——那边一改，`test/navigate.test.ts` 里那条拿真实 render()
 * 输出做的用例会红，不会静默失配。
 *
 * 找不用 `querySelector('#' + slug)`：slug 里可以有点号、冒号、emoji，
 * `CSS.escape` 的转义规则不等于 id 的合法字符集，遍历比较更稳。
 */
const CLOBBER_PREFIX = 'user-content-'

export function findAnchorTarget(scope: ParentNode, slug: string): Element | null {
  const prefixed = CLOBBER_PREFIX + slug
  let plain: Element | null = null
  for (const el of scope.querySelectorAll('[id]')) {
    if (el.id === prefixed) return el
    if (plain === null && el.id === slug) plain = el
  }
  return plain
}

export interface HistoryEntry {
  readonly path: string
  readonly hash: string
}

export interface NavigationHooks {
  readonly view: Window
  readonly host: HTMLElement
  readonly content: HTMLElement
  readonly baseUrl: string
  readonly onNavigate: ((path: string) => void) | null
  showError(title: string, path: string, detail: string): void
  clearError(): void
}

export interface NavigationController {
  entries(): readonly HistoryEntry[]
  index(): number
  canBack(): boolean
  canForward(): boolean
  back(): boolean
  forward(): boolean
  /** 装饰外链 + 应用挂起的 #hash；要等 HTML 真的进了 DOM 才有意义，kernel.ts 挂进 onAfterRender。 */
  afterRender(): void
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * shadow 内部的点击是 composed 的，会冒到宿主上；`event.target` 在跨 shadow
 * 边界时会被 retarget 成宿主自己，composedPath() 才给得出真正被点中的节点链。
 */
function closestAnchor(event: Event): HTMLAnchorElement | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  for (const node of path) {
    if (node instanceof HTMLAnchorElement) return node
  }
  const target = event.target
  return target instanceof Element ? target.closest('a') : null
}

export function createNavigation(hooks: NavigationHooks, disposers: Disposers): NavigationController {
  const stack: HistoryEntry[] = [{ path: hooks.baseUrl, hash: '' }]
  let cursor = 0
  let loadedPath = hooks.baseUrl
  let pendingHash = ''

  const applyHash = (hash: string): void => {
    if (hash === '') return
    const target = findAnchorTarget(hooks.content, hash.slice(1))
    if (target === null) return
    target.setAttribute('tabindex', '-1')
    ;(target as HTMLElement).focus()
  }

  const fail = (path: string, detail: string): void => {
    hooks.showError('这个链接打不开', path, detail)
  }

  const fail2 = (path: string, detail: string): void => {
    hooks.showError('这个链接需要宿主处理', path, detail)
  }

  const go = (entry: HistoryEntry, push: boolean): void => {
    if (push) {
      stack.length = cursor + 1
      stack.push(entry)
      cursor = stack.length - 1
    }
    // 评审 Important/M5：这一行必须在下面的「同路径早退」分支之前跑，不能像
    // 原来那样放在它之后。onNavigate === null 那条失败路径会在更新 loadedPath
    // 之前就 return（下面有注释解释原因），于是失败之后按后退键回到的那个
    // entry 会命中「entry.path === loadedPath」的早退分支——如果 clearError()
    // 还留在那个分支之后，错误角标会永远清不掉，卡死在屏幕上。同步抛出/
    // 异步拒绝那两条路径也有同一个隐患：失败一次后 loadedPath 会变成失败的那个
    // path，再点同一个链接会命中同一个早退分支。unconditional 地放在最前面，
    // 三条失败路径 + 正常路径都覆盖到，而不是逐个补丁。
    hooks.clearError()
    if (entry.path === loadedPath) {
      // 同一个文件内部的锚点跳转，不惊动宿主。
      if (entry.hash !== '') applyHash(entry.hash)
      return
    }
    const onNavigate = hooks.onNavigate
    if (onNavigate === null) {
      fail2(entry.path, '挂载时没有给 onNavigate 回调，元素自己拿不到文件内容。')
      return
    }
    loadedPath = entry.path
    pendingHash = entry.hash
    let result: unknown
    try {
      // onNavigate 的契约返回类型是 void（P4），而 `=> void` 接受任何返回值。
      // 宿主返回一个 Promise 就是它告诉元素「这个文件打不开」的通道——设计文档 §8
      // 要求相对跳转失败有窗口内错误态，而回调本身没有别的出口。
      result = (onNavigate as (path: string) => unknown)(entry.path)
    } catch (error) {
      pendingHash = ''
      fail(entry.path, describeError(error))
      return
    }
    if (isPromiseLike(result)) {
      result.then(undefined, (error: unknown) => {
        pendingHash = ''
        fail(entry.path, describeError(error))
      })
    }
  }

  const step = (delta: number): boolean => {
    const next = cursor + delta
    const entry = stack[next]
    if (entry === undefined) return false
    cursor = next
    go(entry, false)
    return true
  }

  const decorateLinks = (): void => {
    for (const anchor of hooks.content.querySelectorAll('a[href]')) {
      if (classifyHref(anchor.getAttribute('href') ?? '') !== 'external') continue
      // 外链交系统浏览器：不拦截，但不能让它把嵌入方的页面自己导航走。core 的
      // Phase A 输出可能已经给非 GitHub 外链设了 rel="nofollow"（rules/decorate.ts），
      // 这里在已有 token 基础上补，不是整个覆盖掉。
      anchor.setAttribute('target', '_blank')
      const rel = (anchor.getAttribute('rel') ?? '').split(/\s+/).filter((token) => token !== '')
      for (const token of ['noopener', 'noreferrer']) if (!rel.includes(token)) rel.push(token)
      anchor.setAttribute('rel', rel.join(' '))
    }
  }

  const onClick = (event: Event): void => {
    const mouse = event as MouseEvent
    if (mouse.defaultPrevented) return
    if (mouse.button !== 0) return
    if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return
    const anchor = closestAnchor(event)
    if (anchor === null) return
    const href = anchor.getAttribute('href')
    if (href === null) return
    const kind = classifyHref(href)
    if (kind === 'external' || kind === 'ignore') return
    event.preventDefault()
    if (kind === 'hash') {
      go({ path: loadedPath, hash: href }, true)
      return
    }
    // 相对链接按当前显示的那个文件解析，不是按最初的 baseUrl。
    go(resolveRelative(loadedPath === '' ? hooks.baseUrl : loadedPath, href), true)
  }

  const onKeyDown = (event: Event): void => {
    const key = event as KeyboardEvent
    if (key.defaultPrevented) return
    const back = (key.altKey && key.key === 'ArrowLeft') || (key.metaKey && key.key === '[')
    const forward = (key.altKey && key.key === 'ArrowRight') || (key.metaKey && key.key === ']')
    if (!back && !forward) return
    if (step(back ? -1 : 1)) event.preventDefault()
  }

  const onMouseUp = (event: Event): void => {
    const mouse = event as MouseEvent
    if (mouse.button !== 3 && mouse.button !== 4) return
    if (step(mouse.button === 3 ? -1 : 1)) event.preventDefault()
  }

  // 三个都挂在宿主上：shadow 内部的事件是 composed 的，会冒到这里，而 composedPath()
  // 仍然给得出真正的目标。挂在宿主而不是 document 上，意味着元素只处理自己里面的
  // 按键——全局快捷键归宿主，这是嵌入式组件该有的边界。
  addListener(disposers, hooks.host, 'click', onClick)
  addListener(disposers, hooks.host, 'keydown', onKeyDown)
  addListener(disposers, hooks.host, 'mouseup', onMouseUp)

  return {
    entries: () => stack,
    index: () => cursor,
    canBack: () => cursor > 0,
    canForward: () => cursor < stack.length - 1,
    back: () => step(-1),
    forward: () => step(1),
    afterRender(): void {
      decorateLinks()
      if (pendingHash === '') return
      const hash = pendingHash
      pendingHash = ''
      applyHash(hash)
    },
  }
}
