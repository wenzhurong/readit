import type { MarkdownIt, Token } from 'markdown-it'
import emojiData from '../../data/emoji.json' with { type: 'json' }

const UNICODE: Record<string, string> = emojiData.unicode
const CUSTOM = new Set<string>(emojiData.custom)

const NAME = /^[A-Za-z0-9_+-]+:/
const ASCII_WS = new Set([' ', '\t', '\n', '\r', '\f', '\v'])

/**
 * GitHub's shortcode scanner, reverse-engineered from POST /markdown on
 * 2026-08-06. A `:name:` candidate is taken when it starts the text run or is
 * preceded by ASCII whitespace; once any candidate has been taken, every later
 * candidate in the same run is taken regardless of what precedes it
 * (`:smile:-:smile:` -> both, but `-:smile: -:smile:` -> neither). Whether the
 * name is actually known does not affect that latch.
 */
export function replaceEmoji(s: string, customBase: string): string[] {
  const out: string[] = []
  let pos = 0
  let plain = ''
  let latched = false
  while (pos < s.length) {
    const i = s.indexOf(':', pos)
    if (i === -1) break
    const m = NAME.exec(s.slice(i + 1))
    if (!m) {
      plain += s.slice(pos, i + 1)
      pos = i + 1
      continue
    }
    if (!(i === 0 || ASCII_WS.has(s[i - 1] ?? '') || latched)) {
      plain += s.slice(pos, i + 1)
      pos = i + 1
      continue
    }
    latched = true
    const end = i + 1 + m[0].length
    const name = m[0].slice(0, -1)
    const markup = UNICODE[name]
    plain += s.slice(pos, i)
    if (markup !== undefined) {
      if (markup.includes('<')) {
        out.push(plain, markup)
        plain = ''
      } else {
        plain += markup
      }
    } else if (CUSTOM.has(name)) {
      out.push(
        plain,
        `<img class="emoji" title=":${name}:" alt=":${name}:" ` +
          `src="${customBase}${name}.png" height="20" width="20" align="absmiddle">`,
      )
      plain = ''
    } else {
      plain += `:${name}:`
    }
    pos = end
  }
  out.push(plain + s.slice(pos))
  return out
}

/**
 * `customBase` is prefixed to the bundled PNG file name for the 23 custom
 * shortcodes. The 23 files live in `packages/core/data/emoji/` and must be
 * copied next to the bundle at build time; they are never fetched at runtime.
 */
export function applyEmoji(md: MarkdownIt, customBase = 'emoji/'): void {
  // `??=` so this rule still works standalone in tests without clobbering the
  // central registration a later task adds in engine.ts (see tasklist.ts).
  md.renderer.rules.readit_raw ??= (tokens, idx) => tokens[idx]!.content

  md.core.ruler.after('text_join', 'readit_emoji', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.children) continue
      const next: Token[] = []
      for (const child of token.children) {
        if (child.type !== 'text') {
          next.push(child)
          continue
        }
        const parts = replaceEmoji(child.content, customBase)
        if (parts.length === 1) {
          child.content = parts[0] ?? ''
          next.push(child)
          continue
        }
        for (const [i, part] of parts.entries()) {
          if (part === '') continue
          // `readit_raw`, not `html_inline`: the raw-HTML policy in
          // sanitize.ts walks `html_inline`/`html_block` tokens, and readit's
          // own markup must never be scanned by it (§6.1 — GitHub's whitelist
          // has no `class`, so a shared token type gets `class="emoji"` and
          // `class="g-emoji"` silently stripped).
          const t = new state.Token(i % 2 === 0 ? 'text' : 'readit_raw', '', 0)
          t.content = part
          t.level = child.level
          next.push(t)
        }
      }
      token.children = next
    }
    return true
  })
}
