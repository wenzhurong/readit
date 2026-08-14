import {
  buildTextModel,
  findTextMatches,
  rangeForMatch,
  type TextMatch,
  type TextModel,
} from './model.js'

export type FindDirection = 'next' | 'previous'

export interface FindOptions {
  readonly direction?: FindDirection
  readonly caseSensitive?: boolean
}

export interface FindResult {
  readonly query: string
  readonly total: number
  /** One-based; zero means there is no current match. */
  readonly current: number
}

export interface FindControllerOptions {
  /** The readit host; the open state lives here, outside shadowRoot.innerHTML. */
  readonly owner: HTMLElement
  /** Stable in-tree mount point for the find-bar host. */
  readonly mount: HTMLElement
  /** The visible read/split document searched through DOM text nodes. */
  readonly target: () => HTMLElement
  /** Non-null in source/plain mode, where virtualized editor DOM must not be searched. */
  readonly source: () => string | null
  readonly revealSource: (match: TextMatch) => void
}

export interface FindController {
  readonly element: HTMLElement
  find(query?: string, options?: FindOptions): FindResult
  refresh(): FindResult
  clear(): FindResult
  destroy(): void
}

export const FIND_CSS = `
::highlight(readit-find) { background: #fff8c5; color: inherit; }
::highlight(readit-find-current) { background: #f2cc60; color: inherit; }
mark[data-readit-find] { background: #fff8c5; color: inherit; padding: 0; }
mark[data-readit-find-current] { background: #f2cc60; }
.readit-find-ui-host {
  display: none; position: absolute; z-index: 10; top: 8px; right: 8px;
}
:host([data-readit-find-open]) .readit-find-ui-host,
[data-readit-find-open] .readit-find-ui-host { display: block; }
`

const UI_CSS = `
:host { all: initial; font: 13px/1.4 system-ui, sans-serif; color: CanvasText; }
.bar {
  display: flex; align-items: center; gap: 4px; padding: 6px;
  border: 1px solid color-mix(in srgb, CanvasText 24%, transparent);
  border-radius: 8px; background: Canvas; color: CanvasText;
  box-shadow: 0 4px 14px rgba(0,0,0,.18);
}
input { width: 190px; min-width: 80px; padding: 4px 7px; font: inherit; color: inherit; background: inherit; }
output { min-width: 52px; text-align: center; white-space: nowrap; }
button { width: 28px; height: 28px; border: 0; border-radius: 5px; color: inherit; background: transparent; cursor: pointer; }
button:hover { background: color-mix(in srgb, CanvasText 10%, transparent); }
button:disabled { opacity: .4; cursor: default; }
`

interface HighlightRegistryLike {
  set(name: string, value: unknown): unknown
  delete(name: string): boolean
}

interface HighlightState {
  readonly registry: HighlightRegistryLike
  readonly Highlight: new (...ranges: AbstractRange[]) => unknown
  readonly matches: Map<object, readonly Range[]>
  readonly current: Map<object, readonly Range[]>
}

const states = new WeakMap<object, HighlightState>()

function highlightState(view: Window): HighlightState | null {
  const host = view as unknown as {
    CSS?: { highlights?: HighlightRegistryLike }
    Highlight?: new (...ranges: AbstractRange[]) => unknown
  }
  const registry = host.CSS?.highlights
  const Highlight = host.Highlight
  if (registry === undefined || typeof registry.set !== 'function' || typeof Highlight !== 'function') {
    return null
  }
  const key = registry as object
  let state = states.get(key)
  if (state === undefined) {
    state = { registry, Highlight, matches: new Map(), current: new Map() }
    states.set(key, state)
  }
  return state
}

function syncHighlight(state: HighlightState, name: string, contributions: Map<object, readonly Range[]>): void {
  const ranges = [...contributions.values()].flat()
  if (ranges.length === 0) {
    state.registry.delete(name)
    return
  }
  state.registry.set(name, new state.Highlight(...ranges))
}

function setHighlightContribution(
  state: HighlightState,
  token: object,
  ranges: readonly Range[],
  current: Range | null,
): void {
  if (ranges.length === 0) state.matches.delete(token)
  else state.matches.set(token, ranges)
  if (current === null) state.current.delete(token)
  else state.current.set(token, [current])
  syncHighlight(state, 'readit-find', state.matches)
  syncHighlight(state, 'readit-find-current', state.current)
}

function removeHighlightContribution(state: HighlightState, token: object): void {
  state.matches.delete(token)
  state.current.delete(token)
  syncHighlight(state, 'readit-find', state.matches)
  syncHighlight(state, 'readit-find-current', state.current)
}

interface Painter {
  clear(target: HTMLElement): void
  paint(target: HTMLElement, model: TextModel, matches: readonly TextMatch[], current: number): Range | null
  destroy(target: HTMLElement): void
}

function createPainter(view: Window): Painter {
  const state = highlightState(view)
  const token = {}
  let marks: HTMLElement[] = []

  const clearMarks = (target: HTMLElement): void => {
    const parents = new Set<Node>()
    for (const mark of marks) {
      const parent = mark.parentNode
      if (parent === null) continue
      parents.add(parent)
      mark.replaceWith(...mark.childNodes)
    }
    marks = []
    for (const parent of parents) parent.normalize()
    // If a rerender detached every old mark, there is nothing left to normalize.
    if (parents.size > 0 && !target.isConnected) target.normalize()
  }

  const clear = (target: HTMLElement): void => {
    if (state === null) clearMarks(target)
    else removeHighlightContribution(state, token)
  }

  const paintFallback = (
    model: TextModel,
    matches: readonly TextMatch[],
    current: number,
  ): Range | null => {
    const doc = model.segments[0]?.node.ownerDocument
    if (doc === undefined) return null

    // Work per original Text node and from right to left. Splitting a later
    // slice then leaves all earlier offsets valid on the original node.
    for (const segment of model.segments) {
      const slices = matches.flatMap((match, index) => {
        const start = Math.max(match.start, segment.start)
        const end = Math.min(match.end, segment.end)
        return start < end ? [{ start: start - segment.start, end: end - segment.start, index }] : []
      }).sort((a, b) => b.start - a.start)

      for (const slice of slices) {
        const range = doc.createRange()
        range.setStart(segment.node, slice.start)
        range.setEnd(segment.node, slice.end)
        const mark = doc.createElement('mark')
        mark.dataset['readitFind'] = String(slice.index)
        if (slice.index === current) mark.dataset['readitFindCurrent'] = 'true'
        range.surroundContents(mark)
        marks.push(mark)
      }
    }

    const selected = marks.filter((mark) => mark.dataset['readitFindCurrent'] === 'true')
    const first = selected[0]
    const last = selected[selected.length - 1]
    if (first === undefined || last === undefined) return null
    const range = doc.createRange()
    range.setStartBefore(first)
    range.setEndAfter(last)
    return range
  }

  return {
    clear,
    paint(_target, model, matches, current) {
      if (matches.length === 0 || current < 0) return null
      if (state === null) return paintFallback(model, matches, current)
      const ranges = matches.map((match) => rangeForMatch(model, match))
      const selected = ranges[current] ?? null
      setHighlightContribution(state, token, ranges, selected)
      return selected
    },
    destroy(target) {
      clear(target)
    },
  }
}

function revealRange(range: Range, scroller: HTMLElement): void {
  const match = range.getBoundingClientRect()
  const viewport = scroller.getBoundingClientRect()
  if (match.height <= 0 || viewport.height <= 0) return
  if (match.top < viewport.top) scroller.scrollTop += match.top - viewport.top
  else if (match.bottom > viewport.bottom) scroller.scrollTop += match.bottom - viewport.bottom
}

function makeButton(doc: Document, label: string, text: string, attribute: string): HTMLButtonElement {
  const button = doc.createElement('button')
  button.type = 'button'
  button.setAttribute('aria-label', label)
  button.setAttribute(attribute, '')
  button.textContent = text
  return button
}

function result(query: string, matches: readonly TextMatch[], current: number): FindResult {
  return { query, total: matches.length, current: current < 0 ? 0 : current + 1 }
}

function deepestActiveElement(doc: Document): HTMLElement | null {
  let active: Element | null = doc.activeElement
  while (active?.shadowRoot?.activeElement !== undefined && active.shadowRoot.activeElement !== null) {
    active = active.shadowRoot.activeElement
  }
  return active instanceof HTMLElement ? active : null
}

export function createFindController(options: FindControllerOptions): FindController {
  const doc = options.mount.ownerDocument
  const view = doc.defaultView
  if (view === null) throw new Error('find: mount point has no owning window')

  const element = doc.createElement('div')
  element.className = 'readit-find-ui-host'
  const ui = element.attachShadow({ mode: 'open' })
  const style = doc.createElement('style')
  style.textContent = UI_CSS
  const bar = doc.createElement('div')
  bar.className = 'bar'
  bar.setAttribute('role', 'search')
  const input = doc.createElement('input')
  input.type = 'search'
  input.setAttribute('aria-label', '查找文档')
  input.autocomplete = 'off'
  const count = doc.createElement('output')
  count.setAttribute('aria-live', 'polite')
  const previous = makeButton(doc, '上一个匹配', '↑', 'data-find-previous')
  const next = makeButton(doc, '下一个匹配', '↓', 'data-find-next')
  const close = makeButton(doc, '关闭查找', '×', 'data-find-close')
  bar.append(input, count, previous, next, close)
  ui.append(style, bar)
  options.mount.append(element)

  const painter = createPainter(view)
  let query = ''
  let matches: TextMatch[] = []
  let current = -1
  let caseSensitive = false
  let destroyed = false
  let returnFocus: HTMLElement | null = null

  const updateUi = (): void => {
    count.textContent = current < 0 ? `0 / ${matches.length}` : `${current + 1} / ${matches.length}`
    previous.disabled = matches.length === 0
    next.disabled = matches.length === 0
  }

  const paint = (): void => {
    const target = options.target()
    painter.clear(target)
    // Most mounts have no active query. Do not traverse a freshly hydrated
    // MathJax/Mermaid tree merely to rediscover that an empty query has no
    // matches; those trees can contain thousands of text-bearing SVG nodes.
    if (query === '') {
      matches = []
      updateUi()
      return
    }
    const source = options.source()
    if (source !== null) {
      matches = findTextMatches(source, query, { caseSensitive })
      const selected = matches[current]
      if (selected !== undefined) options.revealSource(selected)
      updateUi()
      return
    }

    const model = buildTextModel(target)
    matches = findTextMatches(model.text, query, { caseSensitive })
    const selected = painter.paint(target, model, matches, current)
    if (selected !== null) revealRange(selected, target)
    updateUi()
  }

  const execute = (
    nextQuery: string,
    findOptions: FindOptions,
    behavior: 'advance' | 'replace' | 'refresh',
  ): FindResult => {
    if (destroyed) throw new Error('find: controller has been destroyed')
    const nextCase = findOptions.caseSensitive ?? (nextQuery === query ? caseSensitive : false)
    const same = nextQuery === query && nextCase === caseSensitive
    const prior = current
    query = nextQuery
    caseSensitive = nextCase

    // First build obtains the new total. paint() also clears stale DOM marks or
    // global registry contributions before reading the next model.
    current = -1
    paint()
    if (matches.length > 0) {
      if (behavior === 'refresh' && prior >= 0) current = Math.min(prior, matches.length - 1)
      else if (behavior === 'advance' && same && prior >= 0) {
        const delta = findOptions.direction === 'previous' ? -1 : 1
        current = (prior + delta + matches.length) % matches.length
      } else current = findOptions.direction === 'previous' ? matches.length - 1 : 0
    }
    // Repaint once with the chosen current item. The first pass deliberately
    // had current=-1 so it could not scroll or mark a stale index.
    paint()
    return result(query, matches, current)
  }

  const open = (): void => {
    const active = deepestActiveElement(doc)
    if (active !== input) returnFocus = active
    options.owner.dataset['readitFindOpen'] = 'true'
    input.focus()
    input.select()
  }

  const clear = (): FindResult => {
    input.value = ''
    return execute('', { caseSensitive: false }, 'replace')
  }

  const hide = (): void => {
    const focus = returnFocus
    returnFocus = null
    delete options.owner.dataset['readitFindOpen']
    clear()
    if (focus?.isConnected === true) focus.focus({ preventScroll: true })
  }

  const onInput = (): void => {
    execute(input.value, { caseSensitive }, 'replace')
  }
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      hide()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      execute(input.value, { direction: event.shiftKey ? 'previous' : 'next', caseSensitive }, 'advance')
    }
  }
  const onPrevious = (): void => {
    execute(input.value, { direction: 'previous', caseSensitive }, 'advance')
  }
  const onNext = (): void => {
    execute(input.value, { direction: 'next', caseSensitive }, 'advance')
  }
  const onClose = (): void => hide()

  input.addEventListener('input', onInput)
  input.addEventListener('keydown', onKeydown)
  previous.addEventListener('click', onPrevious)
  next.addEventListener('click', onNext)
  close.addEventListener('click', onClose)
  updateUi()

  return {
    element,
    find(nextQuery, findOptions = {}) {
      open()
      if (nextQuery === undefined) return result(query, matches, current)
      input.value = nextQuery
      return execute(nextQuery, findOptions, 'advance')
    },
    refresh() {
      return execute(query, { caseSensitive }, 'refresh')
    },
    clear,
    destroy() {
      if (destroyed) return
      painter.destroy(options.target())
      destroyed = true
      input.removeEventListener('input', onInput)
      input.removeEventListener('keydown', onKeydown)
      previous.removeEventListener('click', onPrevious)
      next.removeEventListener('click', onNext)
      close.removeEventListener('click', onClose)
      delete options.owner.dataset['readitFindOpen']
      element.remove()
    },
  }
}
