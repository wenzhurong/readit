import { CORE_SCHEMA, load } from 'js-yaml'
import type { InlineMathMode } from './types.js'

export type ParsedFrontmatter = { ok: true; data: unknown } | { ok: false; message: string }

/**
 * GitHub's banner text for a YAML rejection, minus the `Error in user YAML: ` prefix.
 *
 * ## What is reproducible here and what is not
 *
 * GitHub parses frontmatter with Psych, i.e. libyaml, and formats its
 * `Psych::SyntaxError` as `(<file>): <problem> <context> at line L column C` with
 * 1-based positions and `<unknown>` when there is no filename. readit parses with
 * js-yaml. For the corpus body `title: [unclosed` the two disagree on all three
 * moving parts:
 *
 *     libyaml   did not find expected ',' or ']' while parsing a flow sequence
 *               at line 1 column 8     <- the '[' that opened the sequence
 *     js-yaml   unexpected end of the stream within a flow collection
 *               mark 1:0 (0-based)     <- where the stream ran out
 *
 * That is a difference in DIAGNOSIS, not in formatting: libyaml reports the problem
 * against the construct that was left open, js-yaml against the point of failure, and
 * neither string is derivable from the other. So this reproduces GitHub's FRAME —
 * which is stable, and is what makes the banner look right — and fills it with
 * js-yaml's own reason and mark. The remaining difference is a single line of the
 * `github-only/frontmatter-malformed` corpus diff and is recorded on the ledger.
 *
 * js-yaml's `err.message` is deliberately NOT used: it appends a multi-line source
 * excerpt with a `-----^` caret, which would put three lines of ASCII art inside a
 * one-line banner. `reason` and `mark` are the structured fields behind it.
 */
export function yamlErrorMessage(err: unknown): string {
  const e = err as { reason?: unknown; mark?: { line?: unknown; column?: unknown } }
  const reason = typeof e.reason === 'string' && e.reason !== '' ? e.reason : String(err)
  // js-yaml's mark is 0-based; Psych's message is 1-based. The `?? 0` arms are for a
  // thrown value that is not a YAMLException at all — `load` is only documented to
  // throw those, but this function must stay total because `render()` does.
  const line = (typeof e.mark?.line === 'number' ? e.mark.line : 0) + 1
  const column = (typeof e.mark?.column === 'number' ? e.mark.column : 0) + 1
  return `(<unknown>): ${reason} at line ${line} column ${column}`
}

/**
 * Parse a frontmatter body, keeping a REJECTION distinct from a body that parses
 * cleanly into something other than a mapping. GitHub treats those cases differently,
 * and the public option reader also needs parse failure to be a total `{}` result.
 * This is the single CORE_SCHEMA path for visible rendering and option reads.
 */
export function parseFrontmatter(yaml: string): ParsedFrontmatter {
  try {
    return { ok: true, data: load(yaml, { schema: CORE_SCHEMA }) }
  } catch (err) {
    return { ok: false, message: yamlErrorMessage(err) }
  }
}

/** Same fence spelling used by the markdown-it block rule, without stateful regexp flags. */
export function isFrontmatterFence(line: string): boolean {
  return /^---[ \t]*$/.test(line)
}

/** Frontmatter at document start; later thematic-break-looking blocks are not configuration. */
function openingFrontmatterBody(src: string): string | null {
  const lines = src.split(/\r\n?|\n/)
  if (!isFrontmatterFence(lines[0] ?? '')) return null
  for (let line = 1; line < lines.length; line++) {
    if (isFrontmatterFence(lines[line] ?? '')) return lines.slice(1, line).join('\n')
  }
  return null
}

/**
 * Pure host-facing option reader (SPEC §8.6). It only reads the flat namespaced key;
 * callers decide how to merge it into API/application defaults. Rendering remains a
 * separate operation, so reading never consumes the visible frontmatter table.
 */
export function readFrontmatterOptions(src: string): { inlineMath?: InlineMathMode } {
  const body = openingFrontmatterBody(src)
  if (body === null) return {}
  const parsed = parseFrontmatter(body)
  if (
    !parsed.ok ||
    typeof parsed.data !== 'object' ||
    parsed.data === null ||
    Array.isArray(parsed.data)
  ) {
    return {}
  }

  const value = (parsed.data as Record<string, unknown>)['readit-inline-math']
  return value === 'github' || value === 'strict' || value === 'off' ? { inlineMath: value } : {}
}
