import type { Editor, EditorOptions } from '../src/types.js'

export type EditorFactory = (opts: EditorOptions) => Promise<Editor>

export interface ContractEnv {
  /** 造一个已在文档树里的挂载点。 */
  mount(): { parent: HTMLElement; root: ShadowRoot | Document }
  /** 模拟一次用户输入。两个实现的输入通道不同，所以由环境提供。 */
  type(parent: HTMLElement, value: string): void
  /**
   * 组合（IME）事件应该派发在哪个节点上（Task 17 在真浏览器里跑 codemirror
   * 档时发现的必要补充：这张表最初假设 `parent.firstElementChild` 就是
   * 输入面本身，对 plain 档的 `<textarea>` 恰好成立，但 CodeMirror 把真正
   * 接收组合事件的 contenteditable（`.cm-content`）包在好几层容器之下
   * （`.cm-editor > .cm-scroller > .cm-content`）——组合事件不会从父节点
   * 派发下去、只会从子节点往上冒泡，派发在错误的节点上这条用例测的就不是
   * 真实路径。由各环境按自己的真实 DOM 结构给出正确节点。
   */
  compositionTarget(parent: HTMLElement): Element
  /**
   * 合成的（`dispatchEvent()` 派发的）CompositionEvent 能不能驱动这个实现的
   * 组合期推迟逻辑。plain 档的 `<textarea>` 只靠简单布尔标志响应
   * compositionstart/compositionend 监听器，不区分事件是否可信，合成事件足够
   * （见 plain.ts 的 composing/deferred）。CodeMirror 6 不是这样：
   * `view.composing` 只在「真的观察到一次组合期间的文本变更」时才从 0 递增到
   * `>0`（`@codemirror/view` 内部 `applyDOMChange` 里 `composing++` 那一行），
   * 单纯 `dispatchEvent(new CompositionEvent('compositionstart'))` 只会把
   * 内部计数置成 0——`view.composing` 的 getter 判的是 `> 0`，永远不满足。
   * 这不是版本缺陷，是它刻意只信任浏览器自己报告的、真实发生过内容变化的组合
   * 状态，合成事件驱动不了它。这个字段为 false 时，下面「组合期间的 setValue
   * 被推迟」这条用例会被排除在返回的用例表之外——那条行为改由
   * browser/editor/ime.spec.ts 用 CDP 的 Input.imeSetComposition 验证，
   * 那是唯一能真正驱动这条路径、而不是自我肯定的办法。
   */
  readonly supportsSyntheticComposition: boolean
}

export interface ContractCase {
  readonly name: string
  run(): Promise<void>
}

// 返回类型是 `asserts ok` 而不是任务书原文的 `void`：contract.ts 里
// `assert(target !== null, ...)` 之后要把 target 用作非 null 值，
// `void` 签名下 TypeScript strict 模式无法收窄，`npm run typecheck` 会红
// （TS18047）。`asserts ok` 让编译器把调用点表达式本身收窄，行为不变。
function assert(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(message)
}

function assertEqual(actual: unknown, expected: unknown, what: string): void {
  assert(
    Object.is(actual, expected),
    `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  )
}

/**
 * 有的实现（CodeMirror）靠 MutationObserver 兜底识别 execCommand 这类
 * 非「浏览器原生 beforeinput」驱动的编辑——那条兜底路径按规范只能是异步的
 * （MutationObserver 回调是微任务），不像 textarea 的 input 事件那样在同一个
 * 调用栈内同步触发 onChange。Task 17 在真浏览器里跑 codemirror 档时实测到：
 * `env.type()` 返回后立刻检查 sink 是空的，要等一拍才有值。轮询一小段时间
 * 而不是假设同步，覆盖两种实现——textarea 那档本来就同步满足条件，这个循环
 * 在它身上是一次立即返回、不产生任何等待的空转。
 */
async function waitFor(check: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/**
 * 与排版无关的契约用例。plain 档在 vitest（happy-dom，无排版）里跑，
 * codemirror 档在 Playwright（真浏览器）里跑同一张表——「两个实现才算验证过
 * 一个抽象」这句话的兑现形式就是这张表被跑了两遍。
 */
export function editorContractCases(create: EditorFactory, env: ContractEnv): ContractCase[] {
  const make = async (
    value: string,
    sink: { changes: string[]; scrolls: number[] },
  ): Promise<{ ed: Editor; parent: HTMLElement }> => {
    const { parent, root } = env.mount()
    const ed = await create({
      parent,
      root,
      value,
      onChange: (v) => sink.changes.push(v),
      onScroll: (l) => sink.scrolls.push(l),
    })
    return { ed, parent }
  }

  const cases: ContractCase[] = [
    {
      name: 'getValue() 返回初始 value',
      async run() {
        const sink = { changes: [] as string[], scrolls: [] as number[] }
        const { ed } = await make('# hi\nthere', sink)
        assertEqual(ed.getValue(), '# hi\nthere', 'getValue')
        ed.destroy()
      },
    },
    {
      name: 'setValue() 整体换文档，getValue() 立刻反映',
      async run() {
        const sink = { changes: [] as string[], scrolls: [] as number[] }
        const { ed } = await make('a', sink)
        ed.setValue('b\nc')
        assertEqual(ed.getValue(), 'b\nc', 'getValue after setValue')
        ed.destroy()
      },
    },
    {
      name: 'setValue() 不得把自己的写入当成用户输入回灌 onChange',
      async run() {
        const sink = { changes: [] as string[], scrolls: [] as number[] }
        const { ed } = await make('a', sink)
        ed.setValue('b')
        assertEqual(sink.changes.length, 0, 'onChange call count')
        ed.destroy()
      },
    },
    {
      name: '用户输入触发 onChange，带的是完整新文档',
      async run() {
        const sink = { changes: [] as string[], scrolls: [] as number[] }
        const { ed, parent } = await make('a', sink)
        env.type(parent, 'ab')
        await waitFor(() => sink.changes.length > 0)
        assertEqual(sink.changes[sink.changes.length - 1], 'ab', 'last onChange value')
        ed.destroy()
      },
    },
    {
      name: 'topLine() 在未滚动时是 0',
      async run() {
        const sink = { changes: [] as string[], scrolls: [] as number[] }
        const { ed } = await make('1\n2\n3\n4\n5', sink)
        assertEqual(ed.topLine(), 0, 'topLine')
        ed.destroy()
      },
    },
    {
      name: 'destroy() 把自己的 DOM 从 parent 上摘干净，且可重复调用',
      async run() {
        const sink = { changes: [] as string[], scrolls: [] as number[] }
        const { ed, parent } = await make('a', sink)
        ed.destroy()
        ed.destroy()
        assertEqual(parent.childElementCount, 0, 'parent.childElementCount after destroy')
      },
    },
  ]

  // 插在「setValue 不回灌」之后、「用户输入触发 onChange」之前，保持与旧顺序
  // 一致——只对能被合成事件驱动的实现才加这条，见 ContractEnv.supportsSyntheticComposition
  // 的文档注释。
  if (env.supportsSyntheticComposition) {
    cases.splice(3, 0, {
      name: '组合期间的 setValue 被推迟到 compositionend 之后才落地',
      async run() {
        const sink = { changes: [] as string[], scrolls: [] as number[] }
        const { ed, parent } = await make('a', sink)
        const target = env.compositionTarget(parent)
        target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        ed.setValue('外部写入')
        assertEqual(ed.getValue(), 'a', 'value during composition')
        target.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        assertEqual(ed.getValue(), '外部写入', 'value after compositionend')
        ed.destroy()
      },
    })
  }

  return cases
}

/** 跑完整张表，返回失败描述数组（空数组 == 全过）。Playwright 侧靠它把页面内的结果带回 Node。 */
export async function runAllCases(cases: readonly ContractCase[]): Promise<string[]> {
  const failures: string[] = []
  for (const c of cases) {
    try {
      await c.run()
    } catch (err) {
      failures.push(`${c.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return failures
}
