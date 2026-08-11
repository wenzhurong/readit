import type { Editor, EditorOptions } from '../src/types.js'

export type EditorFactory = (opts: EditorOptions) => Promise<Editor>

export interface ContractEnv {
  /** 造一个已在文档树里的挂载点。 */
  mount(): { parent: HTMLElement; root: ShadowRoot | Document }
  /** 模拟一次用户输入。两个实现的输入通道不同，所以由环境提供。 */
  type(parent: HTMLElement, value: string): void
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

  return [
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
        assertEqual(sink.changes[sink.changes.length - 1], 'ab', 'last onChange value')
        ed.destroy()
      },
    },
    {
      name: '组合期间的 setValue 被推迟到 compositionend 之后才落地',
      async run() {
        const sink = { changes: [] as string[], scrolls: [] as number[] }
        const { ed, parent } = await make('a', sink)
        const target = parent.firstElementChild
        assert(target !== null, 'editor must put a node under parent')
        target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        ed.setValue('外部写入')
        assertEqual(ed.getValue(), 'a', 'value during composition')
        target.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        assertEqual(ed.getValue(), '外部写入', 'value after compositionend')
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
