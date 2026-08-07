import type { MarkdownIt, StateCore, Token } from 'markdown-it'

/**
 * Links to GitHub itself do not get rel="nofollow" (measured 2026-08-06,
 * SPEC §17.1 rule #15). gist.github.com is a separate host from github.com
 * but is GitHub's own property, so it is exempted too.
 */
const GITHUB_HOSTS: ReadonlySet<string> = new Set(['github.com', 'www.github.com', 'gist.github.com'])

/**
 * Only `http(s)://` links to a non-GitHub host count as "external". Relative
 * links, mailto:, and anything else without an http(s) scheme are left
 * alone. A URL that fails to parse is treated as internal — prefer under-
 * decorating to mis-decorating.
 *
 * Takes `string | number` (not `string`): `Token.attrGet` is typed to return
 * `string | number | null` in markdown-it 15 — an href is never actually a
 * number, but the compiler doesn't know that, so the caller side would need
 * a cast otherwise.
 */
function isExternal(href: string | number): boolean {
  if (typeof href === 'number') return false
  if (!/^https?:\/\//i.test(href)) return false
  try {
    return !GITHUB_HOSTS.has(new URL(href).hostname.toLowerCase())
  } catch {
    return false
  }
}

/**
 * GitHub-specific decoration for links and images (SPEC §17.1 rules #15/#16),
 * a coverage gap the plan's seven drafting groups flagged but none owned:
 *
 *  1. Every `<img>` gets `style="max-width: 100%;"` (deterministic GitHub
 *     output — readit must emit it, not have a normalizer hide the diff).
 *  2. An external `<a>` gets `rel="nofollow"`; a link to github.com does not.
 *  3. A bare image (not already inside a link) is wrapped in a synthetic
 *     `<a target="_blank" rel="noopener noreferrer" href="<src>">`.
 *  4. An image already inside an author's link keeps that link's href, and
 *     the *author's* link gains rel="nofollow" (per rule 2) — but the
 *     synthetic wrapper from rule 3 is never applied, so there is no target.
 *
 * Emoji images are exempt by construction: they are `readit_raw` tokens
 * (see emoji.ts / contract C3(a)), never markdown-it `image` tokens, so this
 * rule — which only looks at `image` tokens — never touches them. That
 * matches GitHub: its `<img class="emoji">` has neither max-width nor an
 * anchor wrapper.
 */
export function applyDecorate(md: MarkdownIt): void {
  md.core.ruler.push('readit_decorate', (state: StateCore) => {
    for (const blockToken of state.tokens) {
      const children = blockToken.children
      if (blockToken.type !== 'inline' || !children) continue

      // Depth, not "is the previous token link_open": an author can write
      // `[prefix ![a](x.png) suffix](url)`, where the image is not adjacent
      // to the link's open token. Depth counting is correct for arbitrary
      // nesting (and for GFM autolinks, which also emit link_open/link_close).
      let linkDepth = 0
      const out: Token[] = []

      for (const t of children) {
        if (t.type === 'link_open') {
          if (isExternal(t.attrGet('href') ?? '')) t.attrSet('rel', 'nofollow')
          linkDepth++
          out.push(t)
          continue
        }

        if (t.type === 'link_close') {
          linkDepth--
          out.push(t)
          continue
        }

        if (t.type === 'image') {
          // attrSet appends when the name is new, so style lands after the
          // existing src/alt(/title) attrs — matching GitHub's order.
          t.attrSet('style', 'max-width: 100%;')

          if (linkDepth === 0) {
            const open = new state.Token('link_open', 'a', 1)
            open.attrs = [
              ['target', '_blank'],
              ['rel', 'noopener noreferrer'],
              ['href', t.attrGet('src') ?? ''],
            ]
            const close = new state.Token('link_close', 'a', -1)
            out.push(open, t, close)
            continue
          }
        }

        out.push(t)
      }

      blockToken.children = out
    }
    return true
  })
}
