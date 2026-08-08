import type { MarkdownIt, StateCore, Token } from 'markdown-it'

/**
 * Links to GitHub itself do not get rel="nofollow". Measured 2026-08-07 via
 * `POST /markdown` (mode: gfm) for all three hosts, including the forms that
 * actually exercise the exemption path: a bare autolink to `www.github.com`
 * and an explicit link to `gist.github.com` both came back without `rel`,
 * same as a plain `github.com` link. (An earlier pass only had `github.com`
 * itself directly measured and carried the other two as plausible inference
 * — that gap is closed now.)
 *
 * `help.github.com` and `docs.github.com` come from the oracle fixture
 * `test/fixtures/real-world/gitignore.html`, where five links to those two
 * hosts come back with no `rel` at all. Same host-based exemption, two more
 * hosts — GitHub's documentation domains are "GitHub itself" too.
 */
const GITHUB_HOSTS: ReadonlySet<string> = new Set([
  'github.com',
  'www.github.com',
  'gist.github.com',
  'help.github.com',
  'docs.github.com',
])

/**
 * `http(s)://` links to a non-GitHub host count as "external"; so does a
 * protocol-relative link (`//host/path`) to a non-GitHub host — measured
 * 2026-08-07: `[a](//example.com/x)` comes back `rel="nofollow"` on real
 * GitHub, while `[a](//github.com/x)` and `[a](//www.github.com/x)` do not.
 * A protocol-relative href is normalized to `https:` before the same
 * scheme/host check runs, since the scheme itself never affects the
 * decision — only the host does.
 *
 * `mailto:` links do NOT get nofollow — also measured 2026-08-07, across
 * three different mailto forms (explicit `[a](mailto:x@y.z)`, a bare-email
 * GFM extended autolink, and a `<mailto:x@y.z>` CommonMark autolink): none
 * of the three came back with `rel`. SPEC §17.1 rule #15's "外部链接与全部
 * 自动链接" ("external links and all autolinks") was generalized from
 * http(s) autolinks specifically and does not hold for mailto — do not
 * "fix" this from the SPEC prose without re-measuring; it was checked.
 *
 * Relative links (no scheme, no leading `//`) and anything else without an
 * http(s)-after-normalization scheme are left alone. A URL that fails to
 * parse is treated as internal — prefer under-decorating to mis-decorating.
 *
 * Takes `string | number` (not `string`): `Token.attrGet` is typed to return
 * `string | number | null` in markdown-it 15 — an href is never actually a
 * number, but the compiler doesn't know that, so the caller side would need
 * a cast otherwise. (Same underlying typing gap as `dirauto.ts`'s
 * `String(cls)`; not unified here since the shapes differ — a boolean-typed
 * `typeof` guard vs. a `String()` coercion — but it's the same root cause.)
 *
 * Exported for `rules/rawshape.ts`, which applies the same rule to `<a>`
 * elements the author wrote as literal HTML. Importing it rather than copying
 * the predicate is deliberate: the exemption set above has already drifted
 * once when it lived in two places.
 */
export function isExternal(href: string | number): boolean {
  if (typeof href === 'number') return false
  const normalized = href.startsWith('//') ? `https:${href}` : href
  if (!/^https?:\/\//i.test(normalized)) return false
  try {
    return !GITHUB_HOSTS.has(new URL(normalized).hostname.toLowerCase())
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
            // The synthetic link's href IS the image src, so an external src
            // makes the synthetic link external and rule 2 applies to it too:
            // `rel="noopener noreferrer nofollow"`. Oracle bytes, from
            // test/fixtures/github-only/image-absolute-external.html.
            const src = t.attrGet('src') ?? ''
            const open = new state.Token('link_open', 'a', 1)
            open.attrs = [
              ['target', '_blank'],
              ['rel', isExternal(src) ? 'noopener noreferrer nofollow' : 'noopener noreferrer'],
              ['href', src],
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
