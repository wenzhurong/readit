import { createEngine } from './engine.js'
import { DEFAULT_OPTIONS } from './types.js'
import type {
  ExplainEntry,
  InlineMathMode,
  RenderOptions,
  RenderResult,
} from './types.js'

export { DEFAULT_OPTIONS } from './types.js'
export type {
  ExplainEntry,
  Highlighter,
  InlineMathMode,
  MathRenderer,
  RenderOptions,
  RenderResult,
} from './types.js'

function resolve(opts?: Partial<RenderOptions>): RenderOptions {
  return { ...DEFAULT_OPTIONS, ...opts }
}

/** Phase A 入口：纯同步、无 DOM、字节确定。 */
export function render(src: string, opts?: Partial<RenderOptions>): string {
  return renderWithExplain(src, opts).html
}

/** 与 render 相同的渲染，另带美元护栏的判定日志（explain:false 时为空数组）。 */
export function renderWithExplain(
  src: string,
  opts?: Partial<RenderOptions>,
): RenderResult {
  const resolved = resolve(opts)
  const md = createEngine(resolved)
  const env: { explain: ExplainEntry[] } = { explain: [] }
  const html = md.render(src, env)
  return { html, explain: resolved.explain ? env.explain : [] }
}

export { prepare, scan, DEFAULT_LOADERS } from './prepare.js'
export type { Loaders, ScanResult } from './prepare.js'

/**
 * 纯函数，由宿主调用后把结果作为选项传入 render（SPEC §8.6 纯度约束）。
 * 当前恒返回 {}；frontmatter 解析由后续任务实现。
 * 本函数永不修改 src，frontmatter 仍照常渲染成表格。
 */
export function readFrontmatterOptions(
  src: string,
): { inlineMath?: InlineMathMode } {
  void src
  return {}
}
