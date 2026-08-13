import { createEngine } from './engine.js'
import { DEFAULT_OPTIONS } from './types.js'
import type { RenderOptions, RenderResult } from './types.js'
import type { ReaditEnv } from './rules/math-inline.js'

export { DEFAULT_OPTIONS, GITHUB_EMOJI_BASE } from './types.js'
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

/**
 * 与 render 相同的渲染，另带美元护栏的判定日志（explain:false 时为空数组）。
 *
 * 跨规则契约（Task 27 定的、math-inline.ts 的 ReaditEnv 消费的形状）：
 * env = { readit: resolvedOptions }，传给 md.render(src, env)；math-inline.ts
 * 的核心规则据此读 env.readit?.inlineMath / env.readit?.math / env.readit?.explain，
 * 并在 explain 为 true 时把判定日志写进 env.readitExplain。这里只需要原样
 * 读回 env.readitExplain ?? []——不需要额外的 `resolved.explain ?` 判断，
 * 因为 math-inline.ts 自己保证了 explain:false 时 env.readitExplain 始终
 * 是 undefined（见 test/inline-math/explain.test.ts 的
 * "never constructs an entry when explain is false" 用例）。
 */
export function renderWithExplain(
  src: string,
  opts?: Partial<RenderOptions>,
): RenderResult {
  const resolved = resolve(opts)
  const md = createEngine(resolved)
  const env: ReaditEnv = { readit: resolved }
  const html = md.render(src, env)
  return { html, explain: env.readitExplain ?? [] }
}

export { prepare, scan, DEFAULT_LOADERS } from './prepare.js'
export type { Loaders, ScanResult } from './prepare.js'
export { readFrontmatterOptions } from './frontmatter-options.js'
