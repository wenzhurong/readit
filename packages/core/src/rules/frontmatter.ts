import type { MarkdownIt, Token } from 'markdown-it'
import { CORE_SCHEMA, load } from 'js-yaml'

type Scalar = string | number | boolean | null
type Value = Scalar | Value[] | { [key: string]: Value }

/** GitHub escapes `&`, `<` and `>` in text position and leaves quotes alone. */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function isContainer(v: Value): v is Value[] | { [key: string]: Value } {
  return typeof v === 'object' && v !== null
}

function scalarText(v: Scalar): string {
  return v === null ? '' : escapeText(String(v))
}

/** A nested container: `<table>` with no trailing newline. */
function nestedTable(v: Value[] | { [key: string]: Value }): string {
  if (Array.isArray(v)) {
    const body =
      v.length === 0 ? '' : `  <tr>\n${v.map((i) => `  <td>${cell(i)}</td>\n`).join('')}  </tr>\n`
    return `<table>\n  <tbody>\n${body}  </tbody>\n</table>`
  }
  const keys = Object.keys(v)
  const head = keys.map((k) => `  <th>${escapeText(k)}</th>\n`).join('')
  const row = keys.map((k) => `  <td>${cell(v[k] as Value)}</td>\n`).join('')
  return (
    `<table>\n  <thead>\n  <tr>\n${head}  </tr>\n  </thead>\n` +
    `  <tbody>\n  <tr>\n${row}  </tr>\n  </tbody>\n</table>`
  )
}

/** Every cell below the top level is wrapped in `<div dir="auto">`. */
function cell(v: Value): string {
  const inner = isContainer(v) ? `${nestedTable(v)}\n` : scalarText(v)
  return `<div dir="auto">${inner}</div>`
}

/** The top-level `<td>` is *not* wrapped in a div — verified against the oracle. */
function topCell(v: Value): string {
  return isContainer(v) ? `${nestedTable(v)}\n` : scalarText(v)
}

/**
 * Renders a YAML frontmatter body as GitHub's blob-view table.
 * Returns `null` when the YAML is not a mapping or fails to parse.
 */
export function renderFrontmatterTable(yaml: string): string | null {
  let data: unknown
  try {
    data = load(yaml, { schema: CORE_SCHEMA })
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const rows = Object.entries(data as Record<string, Value>)
    .map(([k, v]) => `  <tr>\n    <th>${escapeText(k)}</th>\n    <td>${topCell(v)}</td>\n  </tr>\n`)
    .join('')
  return (
    `<markdown-accessiblity-table><table>\n  <tbody>\n${rows}  </tbody>\n` +
    '</table></markdown-accessiblity-table>'
  )
}

const FENCE = /^---[ \t]*$/

export function applyFrontmatter(md: MarkdownIt): void {
  md.block.ruler.before(
    'table',
    'readit_frontmatter',
    (state, startLine, endLine, silent) => {
      if (startLine !== 0 || state.parentType !== 'root') return false
      const open = state.src.slice((state.bMarks[0] ?? 0) + (state.tShift[0] ?? 0), state.eMarks[0] ?? 0)
      if (!FENCE.test(open)) return false

      let close = -1
      for (let line = 1; line < endLine; line++) {
        const text = state.src.slice(
          (state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0),
          state.eMarks[line] ?? 0,
        )
        if (FENCE.test(text)) {
          close = line
          break
        }
      }
      if (close === -1) return false

      const body = state.getLines(1, close, 0, false)
      const html = renderFrontmatterTable(body)
      if (html === null) return false
      if (silent) return true

      const token = state.push('readit_frontmatter', '', 0)
      token.map = [0, close + 1]
      token.meta = { html }
      token.block = true
      state.line = close + 1
      return true
    },
    { alt: [] },
  )

  md.renderer.rules.readit_frontmatter = (tokens: Token[], idx: number): string =>
    `${(tokens[idx]?.meta as { html: string } | null)?.html ?? ''}\n`
}
