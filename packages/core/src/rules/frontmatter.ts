import type { MarkdownIt, Token } from 'markdown-it'
import { isFrontmatterFence, parseFrontmatter } from '../frontmatter-options.js'

export { yamlErrorMessage } from '../frontmatter-options.js'

type Scalar = string | number | boolean | null
type Value = Scalar | Value[] | { [key: string]: Value }

/** GitHub escapes `&`, `<` and `>` in text position and leaves quotes alone. */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Attribute position additionally escapes the double quote (same rule as codeblock.ts). */
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;')
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
  const entries = Object.entries(v)
  const head = entries.map(([k]) => `  <th>${escapeText(k)}</th>\n`).join('')
  const row = entries.map(([, val]) => `  <td>${cell(val)}</td>\n`).join('')
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

/** The blob-view table for an already-parsed body, or `null` if it is not a mapping. */
function tableFor(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const rows = Object.entries(data as Record<string, Value>)
    .map(([k, v]) => `  <tr>\n    <th>${escapeText(k)}</th>\n    <td>${topCell(v)}</td>\n  </tr>\n`)
    .join('')
  return (
    `<markdown-accessiblity-table><table>\n  <tbody>\n${rows}  </tbody>\n` +
    '</table></markdown-accessiblity-table>'
  )
}

/**
 * GitHub's malformed-frontmatter fallback: an error banner followed by the WHOLE
 * fenced block, fences included, re-shown as a `highlight-source-yaml` snippet.
 * Shape measured from `test/fixtures/github-only/frontmatter-malformed.html`.
 *
 * `block` is the raw source from the opening `---` through the closing one, trailing
 * newline included. Two details are measured rather than inferred, and neither is
 * guessable from the other snippet wrapper readit emits (`rules/codeblock.ts`):
 *
 *  - the snippet div carries the same `highlight … notranslate position-relative
 *    overflow-auto` + `dir="auto"` shell as a fenced code block, and
 *  - `data-snippet-clipboard-copy-content` carries a LEADING newline that the `<pre>`
 *    does not.
 *
 * This is readit-generated, class-bearing markup, so it must never travel as
 * `html_block` (contract C3(a) — the sanitizer would strip every `class` here and
 * could not tell it from author HTML). It rides the rule's own
 * `readit_frontmatter` token type, exactly as the success path does.
 */
export function renderFrontmatterError(block: string, message: string): string {
  return (
    `<div class="flash flash-error mb-3">Error in user YAML: ${escapeText(message)}</div>` +
    '<div class="highlight highlight-source-yaml notranslate position-relative overflow-auto"' +
    ` dir="auto" data-snippet-clipboard-copy-content="${escapeAttr(`\n${block}`)}">` +
    `<pre>${escapeText(block)}</pre></div>`
  )
}

/**
 * Renders a YAML frontmatter body as GitHub's blob-view table.
 * Returns `null` when the YAML is not a mapping or fails to parse.
 *
 * Kept as the table-only entry point (the block rule below needs the two failure
 * modes apart, and calls `parseFrontmatter` directly).
 */
export function renderFrontmatterTable(yaml: string): string | null {
  const parsed = parseFrontmatter(yaml)
  return parsed.ok ? tableFor(parsed.data) : null
}

export function applyFrontmatter(md: MarkdownIt): void {
  md.block.ruler.before(
    'table',
    'readit_frontmatter',
    (state, startLine, endLine, silent) => {
      if (startLine !== 0 || state.parentType !== 'root') return false
      const open = state.src.slice((state.bMarks[0] ?? 0) + (state.tShift[0] ?? 0), state.eMarks[0] ?? 0)
      if (!isFrontmatterFence(open)) return false

      let close = -1
      for (let line = 1; line < endLine; line++) {
        const text = state.src.slice(
          (state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0),
          state.eMarks[line] ?? 0,
        )
        if (isFrontmatterFence(text)) {
          close = line
          break
        }
      }
      if (close === -1) return false

      const body = state.getLines(1, close, 0, false)
      const parsed = parseFrontmatter(body)
      // A REJECTED body gets GitHub's error banner; a body that parses into something
      // that is not a mapping still falls through to CommonMark, because no oracle
      // says otherwise and the banner is specifically an "Error in user YAML".
      const html = parsed.ok
        ? tableFor(parsed.data)
        : renderFrontmatterError(state.getLines(0, close + 1, 0, true), parsed.message)
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
