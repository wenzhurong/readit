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
 * Where GitHub serves the 23 custom-shortcode PNGs from. Measured against the
 * blob-view oracle for `test/corpus/gfm/emoji.md`, whose fixture carries
 * `src="https://github.githubassets.com/images/icons/emoji/shipit.png"`.
 *
 * This is a constant of GitHub's, not a readit deployment choice, which is why
 * it is the DEFAULT rather than a `RenderOptions` field threaded through
 * `state.env.readit` (C3(c)). readit's claim is byte-equality with GitHub, and
 * there is exactly one string that satisfies it; a host that wants something
 * else is departing from the oracle deliberately and can say so at the seam
 * below. The previous default was the relative `emoji/`, which made every
 * custom emoji a BROKEN IMAGE for any consumer that called `render()` without
 * also copying `packages/core/data/emoji/` next to its own bundle — i.e. all of
 * them, since `engine.ts` never passed an override.
 */
export const GITHUB_EMOJI_BASE = 'https://github.githubassets.com/images/icons/emoji/'

/**
 * `customBase` is prefixed to the PNG file name for the 23 custom shortcodes.
 * It defaults to `GITHUB_EMOJI_BASE`, which is what `engine.ts` gets.
 *
 * The parameter stays as the seam for a host that would rather serve the PNGs
 * itself: the 23 files are committed under `packages/core/data/emoji/` and
 * SPEC §5.1 budgets copying them to `dist/emoji/` at build time. Such a host
 * assembles its own engine and passes its own base; nothing is ever fetched at
 * runtime by this rule either way — it only writes a URL into an attribute.
 */
export function applyEmoji(md: MarkdownIt, customBase = GITHUB_EMOJI_BASE): void {
  // `??=` so this rule still works standalone in tests without clobbering the
  // central registration a later task adds in engine.ts (see tasklist.ts).
  md.renderer.rules.readit_raw ??= (tokens, idx) => tokens[idx]!.content

  // `after('text_join')` is load-bearing, not incidental: before the merge,
  // `\:smile:` is a `text_special(':')` plus a `text('smile:')`, and neither
  // half looks like a candidate. After it they are one `text` token, which is
  // what makes readit substitute there — matching GitHub. Note this is the
  // OPPOSITE anchor to `applyMathInline`'s dollar guard, which needs
  // `text_special` still separate. See engine.ts coupling #6, and
  // test/rules/emoji.test.ts's "fires on a backslash-escaped colon".
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
