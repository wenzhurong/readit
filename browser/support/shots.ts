/**
 * 截图清单。零 import，因为 vitest（离线、不认识 @playwright/test）与 Playwright 都要读它。
 * 每一条会被 HOSTS 里的两个宿主页各断言一次，共用同一个基线文件名。
 */
export interface Shot {
  readonly name: string
  /** /content/ 下的文件名。 */
  readonly content: string
  readonly theme: 'light' | 'dark'
  readonly instances: 1 | 2
  readonly mermaid?: true
}

export const HOSTS = ['visual', 'hostile'] as const

export const SHOTS: readonly Shot[] = [
  { name: 'kitchen-sink-light', content: 'kitchen-sink.md', theme: 'light', instances: 1 },
  { name: 'kitchen-sink-dark', content: 'kitchen-sink.md', theme: 'dark', instances: 1 },
  { name: 'code-and-tables-light', content: 'code-and-tables.md', theme: 'light', instances: 1 },
  { name: 'alerts-and-footnotes-light', content: 'alerts-and-footnotes.md', theme: 'light', instances: 1 },
  { name: 'mermaid-light', content: 'mermaid.md', theme: 'light', instances: 1, mermaid: true },
  { name: 'two-instances-light-dark', content: 'kitchen-sink.md', theme: 'light', instances: 2 },
]
