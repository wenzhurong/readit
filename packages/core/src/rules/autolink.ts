import type { MarkdownIt, StateCore, Token } from 'markdown-it'

/** GFM extended autolink match: [start, end) of `src`, plus the href to emit. */
export interface AutolinkMatch {
  start: number
  end: number
  href: string
}

const SCHEMES = ['http://', 'https://', 'ftp://']

/** Trailing characters stripped by "extended autolink path validation". */
const TRAILING = new Set(['?', '!', '.', ',', ':', '*', '_', '~', "'", '"'])

function isAlnum(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)
}

function isAlpha(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)
}

function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0b || c === 0x0c || c === 0x0d
}

/**
 * A character that may precede an extended www/url autolink:
 * start of the text run, whitespace, or one of `*` `_` `~` `(`.
 */
function precedingOk(src: string, pos: number): boolean {
  if (pos === 0) return true
  const c = src.charCodeAt(pos - 1)
  return isSpace(c) || c === 0x2a || c === 0x5f || c === 0x7e || c === 0x28
}

/**
 * "valid domain": segments of alnum / `_` / `-` separated by `.`, at least one
 * `.` (unless `allowShort`), and no `_` in the last two segments.
 * Returns the domain length, or 0 when invalid.
 */
export function checkDomain(src: string, start: number, max: number, allowShort: boolean): number {
  let np = 0
  let uscore1 = 0
  let uscore2 = 0
  let i = start + 1
  for (; i < max; i++) {
    const c = src.charCodeAt(i)
    if (c === 0x5f) uscore2++
    else if (c === 0x2e) {
      uscore1 = uscore2
      uscore2 = 0
      np++
    } else if (!isAlnum(c) && c !== 0x2d) break
  }
  if (uscore1 > 0 || uscore2 > 0) return 0
  if (allowShort) return i - start
  return np > 0 ? i - start : 0
}

/**
 * Extended autolink path validation: strip trailing punctuation, unbalanced
 * closing parens, and a trailing entity-looking `&name;`. Returns the new end.
 */
export function autolinkDelim(src: string, start: number, endIn: number): number {
  let end = endIn
  for (let i = start; i < end; i++) {
    if (src.charCodeAt(i) === 0x3c) {
      end = i
      break
    }
  }
  while (end > start) {
    // String indexing always yields `string` (empty when out of range), so
    // this is safe under noUncheckedIndexedAccess without an extra guard.
    const ch = src.charAt(end - 1)
    if (TRAILING.has(ch)) {
      end--
      continue
    }
    if (ch === ')') {
      let opening = 0
      let closing = 0
      for (let i = start; i < end; i++) {
        const c = src.charCodeAt(i)
        if (c === 0x28) opening++
        else if (c === 0x29) closing++
      }
      if (closing <= opening) return end
      end--
      continue
    }
    if (ch === ';') {
      let ne = end - 2
      while (ne > start && isAlpha(src.charCodeAt(ne))) ne--
      if (ne < end - 2 && src.charCodeAt(ne) === 0x26) end = ne
      else end--
      continue
    }
    return end
  }
  return end
}

/** `www.` autolink starting at `pos`. Returns the end offset, or -1. */
export function matchWww(src: string, pos: number, max: number): number {
  if (pos + 4 > max) return -1
  if (src.charCodeAt(pos) !== 0x77) return -1
  if (src.slice(pos, pos + 4) !== 'www.') return -1
  if (!precedingOk(src, pos)) return -1
  const dl = checkDomain(src, pos, max, false)
  if (dl === 0) return -1
  let end = pos + dl
  while (end < max && !isSpace(src.charCodeAt(end)) && src.charCodeAt(end) !== 0x3c) end++
  end = autolinkDelim(src, pos, end)
  return end > pos ? end : -1
}

/** `http://` / `https://` / `ftp://` autolink starting at `pos`. Returns end, or -1. */
export function matchUrl(src: string, pos: number, max: number): number {
  if (!precedingOk(src, pos)) return -1
  for (const scheme of SCHEMES) {
    if (pos + scheme.length > max) continue
    if (src.slice(pos, pos + scheme.length).toLowerCase() !== scheme) continue
    let end = pos + scheme.length
    while (end < max && !isSpace(src.charCodeAt(end)) && src.charCodeAt(end) !== 0x3c) end++
    end = autolinkDelim(src, pos, end)
    return end > pos + scheme.length ? end : -1
  }
  return -1
}

/** Scan one plain-text run and return every extended autolink in it. */
export function findAutolinks(src: string): AutolinkMatch[] {
  const out: AutolinkMatch[] = []
  const max = src.length
  let i = 0
  while (i < max) {
    const c = src.charCodeAt(i)
    let end = -1
    let href = ''

    if (c === 0x77 || c === 0x57) {
      end = matchWww(src, i, max)
      if (end > 0) href = 'http://' + src.slice(i, end)
    }
    if (end < 0 && (c === 0x68 || c === 0x48 || c === 0x66 || c === 0x46)) {
      end = matchUrl(src, i, max)
      if (end > 0) href = src.slice(i, end)
    }

    if (end > i) {
      out.push({ start: i, end, href })
      i = end
    } else {
      i++
    }
  }
  return out
}

function isLinkOpen(str: string): boolean {
  return /^<a[>\s]/i.test(str)
}
function isLinkClose(str: string): boolean {
  return /^<\/a\s*>/i.test(str)
}

function arrayReplaceAt(src: Token[], pos: number, newElements: Token[]): Token[] {
  return ([] as Token[]).concat(src.slice(0, pos), newElements, src.slice(pos + 1))
}

function autolinkRule(state: StateCore): void {
  for (const blockToken of state.tokens) {
    if (blockToken.type !== 'inline') continue
    let tokens = blockToken.children
    if (!tokens) continue

    let htmlLinkLevel = 0

    for (let i = tokens.length - 1; i >= 0; i--) {
      // tokens[i] is always in-bounds here (i is the for-loop's own index);
      // the guard exists only to satisfy noUncheckedIndexedAccess and is
      // never actually taken.
      const currentToken = tokens[i]
      if (currentToken === undefined) continue

      // Skip the contents of markdown links entirely.
      if (currentToken.type === 'link_close') {
        i--
        while (i >= 0) {
          const t = tokens[i]
          if (t === undefined) break
          if (t.level === currentToken.level || t.type === 'link_open') break
          i--
        }
        continue
      }

      // Skip the contents of raw-HTML <a> ... </a>.
      if (currentToken.type === 'html_inline') {
        if (isLinkOpen(currentToken.content) && htmlLinkLevel > 0) htmlLinkLevel--
        if (isLinkClose(currentToken.content)) htmlLinkLevel++
      }
      if (htmlLinkLevel > 0) continue

      if (currentToken.type !== 'text') continue

      const text = currentToken.content
      const links = findAutolinks(text)
      if (links.length === 0) continue

      const nodes: Token[] = []
      let level = currentToken.level
      let lastPos = 0

      for (const link of links) {
        const fullUrl = state.md.normalizeLink(link.href)
        if (!state.md.validateLink(fullUrl)) continue

        if (link.start > lastPos) {
          const t = new state.Token('text', '', 0)
          t.content = text.slice(lastPos, link.start)
          t.level = level
          nodes.push(t)
        }

        const openTok = new state.Token('link_open', 'a', 1)
        openTok.attrs = [['href', fullUrl]]
        openTok.level = level++
        openTok.markup = 'autolink'
        openTok.info = 'auto'
        nodes.push(openTok)

        const textTok = new state.Token('text', '', 0)
        textTok.content = text.slice(link.start, link.end)
        textTok.level = level
        nodes.push(textTok)

        const closeTok = new state.Token('link_close', 'a', -1)
        closeTok.level = --level
        closeTok.markup = 'autolink'
        closeTok.info = 'auto'
        nodes.push(closeTok)

        lastPos = link.end
      }

      if (nodes.length === 0) continue

      if (lastPos < text.length) {
        const t = new state.Token('text', '', 0)
        t.content = text.slice(lastPos)
        t.level = level
        nodes.push(t)
      }

      tokens = arrayReplaceAt(tokens, i, nodes)
      blockToken.children = tokens
    }
  }
}

/**
 * Register the GFM extended-autolink rule. Requires `linkify: false`:
 * linkify-it 6 disables fuzzyLink by default, so markdown-it 15's own linkify
 * recognises none of the bare-domain / `www.` forms.
 */
export function applyAutolink(md: MarkdownIt): void {
  md.core.ruler.push('readit_gfm_autolink', autolinkRule)
}
