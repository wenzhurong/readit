export interface TextSegment {
  readonly node: Text
  readonly start: number
  readonly end: number
}

export interface TextModel {
  readonly text: string
  readonly segments: readonly TextSegment[]
}

export interface TextMatch {
  readonly start: number
  readonly end: number
}

export interface MatchOptions {
  readonly caseSensitive?: boolean
}

const SHOW_TEXT = 4
const BLOCKED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE'])

function isSearchable(node: Text, boundary: ParentNode): boolean {
  let parent: Node | null = node.parentNode
  while (parent !== null) {
    if (parent.nodeType === 1) {
      const element = parent as HTMLElement
      if (
        BLOCKED_TAGS.has(element.tagName) ||
        element.hidden ||
        element.getAttribute('aria-hidden') === 'true'
      ) {
        return false
      }
    }
    if (parent === boundary) return true
    parent = parent.parentNode
  }
  return false
}

/** Build the flat searchable buffer and its exact text-node offset map. */
export function buildTextModel(root: ParentNode): TextModel {
  const doc = root.nodeType === 9 ? (root as Document) : root.ownerDocument
  if (doc === null) return { text: '', segments: [] }

  const walker = doc.createTreeWalker(root, SHOW_TEXT)
  const segments: TextSegment[] = []
  const chunks: string[] = []
  let offset = 0
  let current = walker.nextNode()
  while (current !== null) {
    const node = current as Text
    const value = node.data
    if (value !== '' && isSearchable(node, root)) {
      chunks.push(value)
      segments.push({ node, start: offset, end: offset + value.length })
      offset += value.length
    }
    current = walker.nextNode()
  }
  return { text: chunks.join(''), segments }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Literal, non-overlapping matches with browser-find-like case folding by default. */
export function findTextMatches(
  text: string,
  query: string,
  options: MatchOptions = {},
): TextMatch[] {
  if (query === '') return []
  const flags = options.caseSensitive === true ? 'gu' : 'giu'
  const expression = new RegExp(escapeRegExp(query), flags)
  return [...text.matchAll(expression)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }))
}

/** Materialize one flat-buffer match as a DOM Range, including cross-node matches. */
export function rangeForMatch(model: TextModel, match: TextMatch): Range {
  const start = model.segments.find((segment) => match.start >= segment.start && match.start < segment.end)
  const end = model.segments.find((segment) => match.end > segment.start && match.end <= segment.end)
  if (start === undefined || end === undefined || match.start >= match.end) {
    throw new RangeError(`find: invalid text match [${match.start}, ${match.end})`)
  }
  const range = start.node.ownerDocument.createRange()
  range.setStart(start.node, match.start - start.start)
  range.setEnd(end.node, match.end - end.start)
  return range
}

/** Convert a UTF-16 source offset to a clamped, zero-based source line. */
export function lineAtOffset(source: string, offset: number): number {
  const limit = Math.min(Math.max(Math.trunc(offset), 0), source.length)
  let line = 0
  for (let index = 0; index < limit; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1
  }
  return line
}
