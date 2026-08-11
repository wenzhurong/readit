import { defineReadit, mount } from '@readit/element'
import { createEditor } from '@readit/editor'
import type { EditorKind } from '@readit/editor'
import { editorContractCases, runAllCases } from '../../packages/editor/test/contract.js'

type MountOpts = NonNullable<Parameters<typeof mount>[1]>
type Handle = ReturnType<typeof mount>

export interface ReaditFixtureApi {
  mount(hostId: string, opts: MountOpts): string
  get(id: string): Handle
  destroy(id: string): void
  destroyAll(): void
  readonly navigations: string[]
  defineReadit(tag?: string): void
  /**
   * Task 17：跑 packages/editor/test/contract.ts 那张 P2 契约表——两个实现
   * 共用同一张表，plain 档已经在 vitest/happy-dom 里跑过（Task 13），这里让
   * codemirror 档在真浏览器里跑同一张表，兑现「两个实现才算验证过一个抽象」。
   * 不经过 mount()/kernel：这张表测的是 @readit/editor 自己的 P2 契约，不是
   * element 的挂载管线，用一个游离的 scratch 容器 + document 当 root 即可。
   */
  runEditorContract(kind: EditorKind): Promise<string[]>
}

const handles = new Map<string, Handle>()
const navigations: string[] = []
let seq = 0

const api: ReaditFixtureApi = {
  mount(hostId, opts) {
    const host = document.getElementById(hostId)
    if (host === null) throw new Error(`fixture: no host #${hostId}`)
    const id = `h${(seq += 1)}`
    handles.set(id, mount(host, { onNavigate: (path: string) => { navigations.push(path) }, ...opts }))
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
  },
  navigations,
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
}

// §0 A9：页面全局统一 window.readitFixture（不是任务书草稿里到处出现的 window.__readit）。
Object.defineProperty(window, 'readitFixture', { value: api })
