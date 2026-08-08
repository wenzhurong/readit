import { describe, expect, it } from 'vitest'
import { render } from '../src/index.js'
import { compareToFixture, discoverCorpus, readCorpus, readFixture, readProvenance } from './corpus-harness.js'

/**
 * This is readit's central, falsifiable claim: normalized render() output equals GitHub's real
 * blob-view HTML for the committed corpus, byte for byte, after only the SPEC 4.1-sanctioned
 * normalization (unwrap the article shell, strip non-deterministic salt, restore D-LINK/D-CAMO,
 * blank octicon paths, flatten highlight spans, reduce the mermaid enrichment section, drop
 * hovercard noise, sort attributes, collapse whitespace).
 *
 * `{ math: null, highlighter: null }`: Phase A's render() is synchronous and takes an already
 * resolved renderer; passing null exercises the deterministic no-network fallback path
 * (`<math-renderer class="js-inline-math" style="display: inline-block">…</math-renderer>`, or
 * its `js-display-math` / `display: block` twin for the two block forms; plain highlighted-shell
 * markup) rather than requiring a live MathJax/starry-night instance in a zero-network test run.
 *
 * Deliberately NOT a whitelist of "known mismatches": every corpus file is asserted equal to its
 * oracle fixture, full stop. A file that does not match today fails loudly and by name — that is
 * the first honest measurement of the fidelity claim (see task-24-report.md for the categorized
 * breakdown of what currently fails and why). Silently excusing a subset here would put the
 * suite's green checkmark back in front of the same gap this task exists to surface.
 */
const NAMES = discoverCorpus()
const PROVENANCE = readProvenance()

describe('corpus vs committed GitHub oracle fixtures (zero network)', () => {
  it('has a corpus in the 45-60 file band mandated by SPEC 13.3', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(45)
    expect(NAMES.length).toBeLessThanOrEqual(60)
  })

  it('covers the four snapshotted SPEC 13.3 categories', () => {
    const categories = new Set(NAMES.map((n) => n.split('/')[0]))
    expect([...categories].sort()).toEqual(['frontend', 'gfm', 'github-only', 'real-world'])
  })

  it.each(NAMES)('%s', (name) => {
    const provenance = PROVENANCE[name]
    expect(
      provenance,
      `no oracle provenance for "${name}". The contents endpoint only serves committed files: ` +
        'push the corpus first, then run `npm run oracle:refresh` from the merged commit SHA.',
    ).toBeDefined()

    const actualHtml = render(readCorpus(name), { math: null, highlighter: null })
    // provenance is asserted defined immediately above; the `!` documents that for
    // noUncheckedIndexedAccess rather than tolerating a real gap.
    const result = compareToFixture(actualHtml, readFixture(name), provenance!)
    if (!result.equal) {
      // Line diff first: vitest prints it element by element and points at the offending tag.
      expect(result.actualLines).toEqual(result.expectedLines)
      // Backstop for a difference the line split cannot show (e.g. whitespace inside <pre>).
      expect(result.actual).toBe(result.expected)
    }
    expect(result.equal).toBe(true)
  })
})
