import { defineReadit, mount } from '@readit/element'
import { createEditor } from '@readit/editor'
import type { EditorKind } from '@readit/editor'
import { editorContractCases, runAllCases } from '../../packages/editor/test/contract.js'
// 跨包边界的相对 import，同 `contract.ts` 那一条（上面）——`set-html.ts` 不在
// packages/element/package.json 的 "exports" 里（不该被宿主直接 import），
// 但 browser/ 不受 test/import-direction.test.ts 的扫描面覆盖（那条守卫只扫
// packages/*/src，browser/ 是测试基础设施，不是发布产物），跟 contract.ts
// 那条边同一个道理。`sanitizeSurvivesTags()`（下面）要测的正是 `createSetHtml`/
// `readEnv` 这两个函数本身有没有把 EXTRA_ELEMENTS/TIER2_EXTRA_TAGS 真的接上，
// 不重新实现一遍消毒器接线。
import { createSetHtml, readEnv } from '../../packages/element/src/set-html.js'
import { connectExternalLinks } from '../../shell/src/external-links.js'
import { rewriteLocalResources } from '../../shell/src/resources.js'

type MountOpts = NonNullable<Parameters<typeof mount>[1]>
type Handle = ReturnType<typeof mount>

export interface ReaditFixtureApi {
  mount(hostId: string, opts: MountOpts): string
  mountWithMermaid(hostId: string, opts: MountOpts): string
  get(id: string): Handle
  destroy(id: string): void
  destroyAll(): void
  readonly navigations: string[]
  connectShellExternalLinks(hostId: string): void
  shellExternalLinkState(): { opened: readonly string[]; feedback: readonly string[] }
  probeShellResourceRewrite(): string | null
  defineReadit(tag?: string): void
  /**
   * Task 17：跑 packages/editor/test/contract.ts 那张 P2 契约表——两个实现
   * 共用同一张表，plain 档已经在 vitest/happy-dom 里跑过（Task 13），这里让
   * codemirror 档在真浏览器里跑同一张表，兑现「两个实现才算验证过一个抽象」。
   * 不经过 mount()/kernel：这张表测的是 @readit/editor 自己的 P2 契约，不是
   * element 的挂载管线，用一个游离的 scratch 容器 + document 当 root 即可。
   */
  runEditorContract(kind: EditorKind): Promise<string[]>
  /**
   * 终审 ②：对每个给定标签名，用**真实生产配置**的 `setHtml()`（`readEnv()` 读
   * 当前页面的真实环境、`createSetHtml()` 接上 EXTRA_ELEMENTS/EXTRA_ATTRIBUTES/
   * TIER2_EXTRA_TAGS/TIER2_EXTRA_ATTR，与 kernel.ts 调用的是同一个函数）探测
   * 标签存不存活，不是重新实现一遍消毒器接线去猜。哪一级生效由页面当前的真实
   * `Element.setHTML`/`trustedTypes` 存在与否决定（跟 kernel.ts 完全一致）——
   * 调用方想强制第 2 级就在页面加载前 `Reflect.deleteProperty(Element.prototype,
   * 'setHTML')`（`sanitize-tier2.spec.ts`/`trusted-types.spec.ts` 的既有做法）。
   *
   * 表格行/单元格系标签（tbody/tfoot/thead/tr/td/th）需要 `<table>` 包一层
   * 探测，否则 HTML 解析器自己（不是消毒器）在「in body」插入模式下会直接
   * 丢弃这些开始标签（HTML5 树构建算法逐字如此）——那样测出的是解析器的丢弃，
   * 不是消毒器的允许名单，会污染结果。`source` 用更贴近真实用法的
   * `<picture><source srcset>` 组合探测，而不是孤立的 `<source>`。
   */
  sanitizeSurvivesTags(tags: string[]): Record<string, boolean>
}

const handles = new Map<string, Handle>()
const navigations: string[] = []
const shellExternalOpened: string[] = []
const shellExternalFeedback: string[] = []
const shellExternalStops = new Map<string, () => void>()
let seq = 0

const api: ReaditFixtureApi = {
  mount(hostId, opts) {
    const host = document.getElementById(hostId)
    if (host === null) throw new Error(`fixture: no host #${hostId}`)
    const id = `h${(seq += 1)}`
    handles.set(id, mount(host, { onNavigate: (path: string) => { navigations.push(path) }, ...opts }))
    return id
  },
  mountWithMermaid(hostId, opts) {
    const host = document.getElementById(hostId)
    if (host === null) throw new Error(`fixture: no host #${hostId}`)
    const id = `h${(seq += 1)}`
    handles.set(
      id,
      mount(host, {
        onNavigate: (path: string) => { navigations.push(path) },
        ...opts,
        loadMermaid: async () => {
          // 专用转发模块给 Rollup 一个稳定的 load-mermaid-* chunk 名，
          // Playwright 才能在网络层真正截断这条懒加载边。
          const { createMermaidRenderer } = await import('./load-mermaid.js')
          return createMermaidRenderer()
        },
      }),
    )
    return id
  },
  get(id) {
    const handle = handles.get(id)
    if (handle === undefined) throw new Error(`fixture: no handle ${id}`)
    return handle
  },
  destroy(id) {
    api.get(id).destroy()
    handles.delete(id)
  },
  destroyAll() {
    for (const handle of handles.values()) handle.destroy()
    handles.clear()
    for (const stop of shellExternalStops.values()) stop()
    shellExternalStops.clear()
  },
  navigations,
  connectShellExternalLinks(hostId) {
    const host = document.getElementById(hostId)
    if (host === null) throw new Error(`fixture: no host #${hostId}`)
    shellExternalStops.get(hostId)?.()
    shellExternalStops.set(
      hostId,
      connectExternalLinks(host, {
        async openExternal(url) {
          shellExternalOpened.push(url)
        },
        showFeedback(message) {
          shellExternalFeedback.push(message)
        },
      }),
    )
  },
  shellExternalLinkState() {
    return { opened: [...shellExternalOpened], feedback: [...shellExternalFeedback] }
  },
  probeShellResourceRewrite() {
    const root = document.createElement('div')
    root.innerHTML = '<img src="images/a b.png">'
    rewriteLocalResources(root)
    return root.querySelector('img')?.getAttribute('src') ?? null
  },
  defineReadit,
  async runEditorContract(kind) {
    const scratch = document.createElement('div')
    document.body.append(scratch)
    const cases = editorContractCases((opts) => createEditor(kind, opts), {
      mount() {
        const parent = document.createElement('div')
        scratch.append(parent)
        return { parent, root: document }
      },
      type(parent, next) {
        const ta = parent.querySelector('textarea')
        if (ta !== null) {
          ta.value = next
          ta.dispatchEvent(new Event('input', { bubbles: true }))
          return
        }
        const cm = parent.querySelector('.cm-content')
        if (cm === null) throw new Error('fixture: no input surface under parent')
        ;(cm as HTMLElement).focus()
        document.execCommand('selectAll')
        document.execCommand('insertText', false, next)
      },
      compositionTarget(parent) {
        const ta = parent.querySelector('textarea')
        if (ta !== null) return ta
        const cm = parent.querySelector('.cm-content')
        if (cm === null) throw new Error('fixture: no composition surface under parent')
        return cm
      },
      // plain 档的合成事件足够；codemirror 档不行（见 ContractEnv 文档注释）——
      // 那条行为改由 browser/editor/ime.spec.ts 的真实 CDP 组合验证。
      supportsSyntheticComposition: kind === 'plain',
    })
    const failures = await runAllCases(cases)
    scratch.remove()
    return failures
  },
  sanitizeSurvivesTags(tags) {
    const inject = createSetHtml(readEnv())
    const TABLE_CONTEXT = new Set(['tbody', 'tfoot', 'thead', 'tr', 'td', 'th'])
    const probeHtmlFor = (tag: string): string => {
      if (tag === 'source') return '<picture><source srcset="a.png" data-probe="1"><img src="b.png"></picture>'
      const inner = `<${tag} data-probe="1">inner</${tag}>`
      return TABLE_CONTEXT.has(tag) ? `<table>${inner}</table>` : inner
    }
    return Object.fromEntries(
      tags.map((tag) => {
        const div = document.createElement('div')
        inject(div, probeHtmlFor(tag))
        return [tag, div.querySelector(tag) !== null]
      }),
    )
  },
}

// §0 A9：页面全局统一 window.readitFixture（不是任务书草稿里到处出现的 window.__readit）。
Object.defineProperty(window, 'readitFixture', { value: api })
