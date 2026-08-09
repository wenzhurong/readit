import type { MarkdownIt, StateCore, Token } from 'markdown-it'

/**
 * Block-level token types GitHub decorates with dir="auto".
 * Measured 2026-08-06 against `GET /repos/{o}/{r}/contents/{p}`
 * (Accept: application/vnd.github.html) over 12 real READMEs:
 * p / h1..h6 / ul / ol carry it; blockquote, hr, pre, table, thead,
 * tbody, tr, th, td and li never do.
 */
const DIR_AUTO_TOKENS: ReadonlySet<string> = new Set([
  'paragraph_open',
  'heading_open',
  'bullet_list_open',
  'ordered_list_open',
])

function hasClass(token: Token, name: string): boolean {
  const cls = token.attrGet('class')
  return cls !== null && String(cls).split(' ').includes(name)
}

/**
 * Must be applied AFTER applyTaskList: GitHub omits dir="auto" on a list that
 * carries `contains-task-list`, and this rule detects that via the class the
 * task-list rule has already set.
 */
export function applyDirAuto(md: MarkdownIt): void {
  md.core.ruler.push('readit_dir_auto', (state: StateCore) => {
    for (const token of state.tokens) {
      if (!DIR_AUTO_TOKENS.has(token.type)) continue
      if (token.hidden) continue
      if (hasClass(token, 'contains-task-list')) continue
      token.attrSet('dir', 'auto')
    }
    return true
  })
}
