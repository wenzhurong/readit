/**
 * Quadratic-blowup inputs, ported from cmark's `test/pathological_tests.py`.
 *
 * Generated here rather than vendored: cmark is BSD-2-Clause and the file is Python, so a port is
 * both smaller and licence-free. A lightweight reader must not be wedged by a bracket bomb, so
 * these run under a hard per-case timeout rather than as output snapshots.
 */
export interface PathologicalCase {
  name: string
  /** Input source. Built lazily so importing the module stays cheap. */
  source: () => string
}

const rep = (s: string, n: number): string => s.repeat(n)

export const PATHOLOGICAL_CASES: readonly PathologicalCase[] = [
  { name: 'nested-strong-emph', source: () => rep('*a **a ', 5000) + 'b' + rep(' a** a*', 5000) },
  { name: 'many-emph-closers', source: () => rep('a*', 20000) },
  { name: 'many-emph-openers', source: () => rep('*a', 20000) },
  { name: 'many-link-closers', source: () => rep('a]', 20000) },
  { name: 'many-link-openers', source: () => rep('a[', 20000) },
  { name: 'mismatched-openers-closers', source: () => rep('*a_ ', 20000) },
  { name: 'openers-closers-multiple-of-3', source: () => 'a**b' + rep('c* ', 20000) },
  { name: 'link-openers-emph-closers', source: () => rep('[ a_ ', 20000) },
  { name: 'nested-brackets', source: () => rep('[', 20000) + 'a' + rep(']', 20000) },
  { name: 'nested-block-quotes', source: () => rep('> ', 20000) + 'a' },
  { name: 'deeply-nested-lists', source: () => Array.from({ length: 500 }, (_, i) => rep('  ', i) + '* a').join('\n') },
  { name: 'backticks', source: () => Array.from({ length: 1500 }, (_, i) => 'b' + rep('`', i + 1)).join('') },
  { name: 'unclosed-links-a', source: () => rep('[a](<b', 20000) },
  { name: 'unclosed-links-b', source: () => rep('[a](b', 20000) },
  { name: 'reference-collisions', source: () => rep('[a]: b\n', 20000) + rep('[a]', 20000) },
  { name: 'nul-byte', source: () => rep('a\u0000b ', 10000) },
]
