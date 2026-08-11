import type { MarkdownIt, Token } from 'markdown-it'
import type { Highlighter } from '../types.js'
import scopes from '../../data/lang-scopes.json' with { type: 'json' }

const SCOPES: Record<string, string> = scopes

/** GitHub escapes `&`, `<` and `>` in text position and leaves quotes alone. */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Attribute position additionally escapes the double quote. */
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;')
}

/**
 * `highlight-<scope with dots replaced by dashes>`, or `null` when GitHub has
 * no grammar for the fence info string and therefore emits the plain
 * `snippet-clipboard-content` wrapper instead.
 */
export function scopeClassFor(lang: string): string | null {
  const scope = SCOPES[lang]
  return scope === undefined ? null : `highlight-${scope.replace(/\./g, '-')}`
}

/**
 * A fence's language: the first whitespace-delimited word of its info
 * string, or `''` for a bare fence. This is CommonMark's own definition (the
 * rest of the info string is the fence's business, not the language's) —
 * not a GitHub-specific rule, so nothing here is measured against the corpus.
 *
 * Exported for `rules/math-block.ts`, which must recognize exactly the fence
 * languages this file would otherwise treat as highlightable — see that
 * file's `` ```math `` handling. Sharing the function (rather than each file
 * keeping its own copy of the expression) is what makes that guarantee hold
 * by construction instead of by comment.
 */
export function fenceLanguage(token: Token): string {
  return token.info.trim().split(/\s+/)[0] ?? ''
}

function renderBlock(token: Token, highlighter: Highlighter | null): string {
  const trimmed = token.content.replace(/\n$/, '')
  const lang = fenceLanguage(token)
  const copy = escapeAttr(trimmed)
  const line = token.attrGet('data-line')
  const dataLine = line === null ? '' : ` data-line="${line}"`
  const scopeClass = lang === '' ? null : scopeClassFor(lang)

  if (scopeClass !== null) {
    const body = highlighter?.highlight(trimmed, lang) ?? escapeText(trimmed)
    return (
      `<div class="highlight ${scopeClass} notranslate position-relative overflow-auto"` +
      ` dir="auto"${dataLine} data-snippet-clipboard-copy-content="${copy}">` +
      `<pre>${body}</pre></div>\n`
    )
  }

  const langAttr = lang === '' ? '' : ` lang="${escapeAttr(lang)}"`
  return (
    '<div class="snippet-clipboard-content notranslate position-relative overflow-auto"' +
    `${dataLine} data-snippet-clipboard-copy-content="${copy}">` +
    `<pre${langAttr} class="notranslate"><code>${escapeText(token.content)}</code></pre></div>\n`
  )
}

export function applyCodeBlock(md: MarkdownIt, highlighter: Highlighter | null = null): void {
  // tokens[idx] is always in-bounds here (idx is the renderer's own current
  // index); the guard exists only to satisfy noUncheckedIndexedAccess.
  const render = (tokens: Token[], idx: number): string => {
    const token = tokens[idx]
    if (token === undefined) return ''
    return renderBlock(token, highlighter)
  }
  md.renderer.rules.fence = render
  md.renderer.rules.code_block = render
}
