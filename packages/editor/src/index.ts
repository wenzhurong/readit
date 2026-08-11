import type { Editor, EditorKind, EditorOptions } from './types.js'

export type { Editor, EditorKind, EditorOptions } from './types.js'

/**
 * 两个实现都走 import()，`.` 入口因此没有任何静态运行时依赖。
 * codemirror 档一次性 176,654 B（SPEC §5.1 实测），只有真正切进
 * source / split 的宿主该付；plain 档虽然同步可得，也走 import() ——
 * 让两条路径同形，边界就由结构保证而不是由纪律保证。
 * test/module-boundary.test.ts 用 TypeScript 编译器 API 钉住这件事。
 */
export async function createEditor(kind: EditorKind, opts: EditorOptions): Promise<Editor> {
  if (kind === 'plain') {
    const { createPlainEditor } = await import('./plain.js')
    return createPlainEditor(opts)
  }
  const { createCodeMirrorEditor } = await import('./codemirror.js')
  return createCodeMirrorEditor(opts)
}
