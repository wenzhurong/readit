import { describe, expect, it } from 'vitest'
import { parseCommonMarkSpec, parseGfmSpec } from '../../scripts/fetch-specs.js'

const FENCE = '`'.repeat(32)

/**
 * Pins the exact bug Task 32a's review round 1 asked to be isolated: the
 * fenced-example regex in `parseGfmSpec` always captured the info string
 * (`m[1]`) that follows `example` on the fence line, but the parsed object it
 * built never stored that capture — so `extension` was silently dropped for
 * all 672 examples and 24 GFM-extension examples were indistinguishable from
 * the 648 base ones. That bug surfaced as 24 confusing L1 spec-suite mismatches
 * with no hint the loss happened at parse time; this test would have failed on
 * its own, in isolation, without needing the full 672-example suite to notice.
 */
describe('parseGfmSpec: extension info-string capture', () => {
  const text = [
    '# Base section',
    '',
    `${FENCE} example`,
    'foo',
    '.',
    '<p>foo</p>',
    FENCE,
    '',
    '# Autolink section',
    '',
    `${FENCE} example autolink`,
    'www.x.com',
    '.',
    '<p><a href="http://www.x.com">www.x.com</a></p>',
    FENCE,
    '',
    '<!-- END TESTS -->',
    '',
  ].join('\n')

  const examples = parseGfmSpec(text)

  it('parses exactly the 2 fenced examples in this fixture', () => {
    expect(examples).toHaveLength(2)
  })

  it('captures an empty extension for a plain "example" fence (the 648-example base case)', () => {
    expect(examples[0]?.extension).toBe('')
  })

  it('captures the trimmed extension name for "example autolink"', () => {
    expect(examples[1]?.extension).toBe('autolink')
  })
})

describe('parseCommonMarkSpec: extension is always the empty string', () => {
  it('sets extension to "" regardless of input — CommonMark has no extension concept', () => {
    const json = JSON.stringify([
      { markdown: 'foo\n', html: '<p>foo</p>\n', example: 1, section: 'Tabs' },
    ])
    expect(parseCommonMarkSpec(json)[0]?.extension).toBe('')
  })
})
