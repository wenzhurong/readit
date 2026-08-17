import type { MountOptions } from 'readit/element'

type HighlighterLoader = NonNullable<MountOptions['loadHighlighter']>
type MermaidLoader = NonNullable<MountOptions['loadMermaid']>

/**
 * 壳注入给元素的两个懒加载器。
 *
 * 单独成一个模块只有一个理由：`main.ts` 从模块顶层就开始摸 DOM 与 Tauri IPC，
 * 导入即有副作用，测不了。于是它接的每一条线都没有回归测试——「高亮加载器把语言
 * 参数丢了」正是这样溜进出货应用的：库层测试全绿，因为库层的测试自己传 `langs`；
 * 而壳里调的是 `createShikiHighlighter()`，空语言集，每个代码块静默不高亮。
 *
 * `...With` 形态照 `createMermaidRendererWith` 的先例：把动态 import 作为参数传进
 * 来，测试就能在不触碰真实插件（会把整个 shiki 拉进来）的前提下钉住接线。
 */

/** `readit/plugins/highlight` 里壳用到的那一小块。 */
export interface HighlightPlugin {
  createShikiHighlighter(opts?: { langs?: readonly string[] }): ReturnType<HighlighterLoader>
}

/**
 * `readit/plugins/mermaid` 里壳用到的那一小块。
 *
 * 注意与高亮那边的不对称：`createShikiHighlighter` 是 async（语法包要按需
 * 动态 import），`createMermaidRenderer` 是**同步**的。原先写在 main.ts 里的
 * `async () => plugin.createMermaidRenderer()` 把这个差别糊掉了。
 */
export interface MermaidPlugin {
  createMermaidRenderer(): Awaited<ReturnType<MermaidLoader>>
}

export function createHighlighterLoaderWith(
  importPlugin: () => Promise<HighlightPlugin>,
): HighlighterLoader {
  // languages 一定要透传。元素给的是「至今见过的全部围栏语言的并集」，
  // 丢掉它等于把高亮整体关掉，而且不报错。
  return async (languages) => (await importPlugin()).createShikiHighlighter({ langs: languages })
}

export function createMermaidLoaderWith(
  importPlugin: () => Promise<MermaidPlugin>,
): MermaidLoader {
  return async () => (await importPlugin()).createMermaidRenderer()
}

export function createHighlighterLoader(): HighlighterLoader {
  return createHighlighterLoaderWith(() => import('readit/plugins/highlight'))
}

export function createMermaidLoader(): MermaidLoader {
  return createMermaidLoaderWith(() => import('readit/plugins/mermaid'))
}
