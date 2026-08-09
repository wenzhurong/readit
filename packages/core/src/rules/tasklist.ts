import type { MarkdownIt, StateCore, Token } from 'markdown-it'

/**
 * Checkbox markup copied byte-for-byte from GitHub, captured 2026-08-06 from
 * GET /repos/microsoft/vscode/contents/CONTRIBUTING.md (unchecked) and
 * GET /repos/kamiyaa/joshuto/contents/README.md (checked).
 * Attribute order is GitHub's: type, id, disabled, class, aria-label, checked.
 * `id` and `disabled` really are emitted with empty values.
 *
 * Written as literal strings rather than token attributes so that neither the
 * order nor the empty-value spelling can drift.
 */
const CHECKBOX_UNCHECKED =
  '<input type="checkbox" id="" disabled="" class="task-list-item-checkbox" aria-label="Incomplete task">'
const CHECKBOX_CHECKED =
  '<input type="checkbox" id="" disabled="" class="task-list-item-checkbox" aria-label="Completed task" checked="">'

/** `[ ]` / `[x]` / `[X]` at the very start, followed by whitespace or end of the text run. */
const TASK_MARKER = /^\[([ xX])\](?=[ \t]|$)/

const LIST_OPEN = new Set(['bullet_list_open', 'ordered_list_open'])
const LIST_CLOSE = new Set(['bullet_list_close', 'ordered_list_close'])

function markerOf(inline: Token): 'checked' | 'unchecked' | null {
  const first = inline.children?.[0]
  if (first === undefined || first.type !== 'text') return null
  const match = TASK_MARKER.exec(first.content)
  if (match === null) return null
  return match[1] === ' ' ? 'unchecked' : 'checked'
}

export function applyTaskList(md: MarkdownIt): void {
  // Self-generated HTML that carries a `class` attribute must not travel as
  // html_inline/html_block: a later sanitization pass strips class/style from
  // those token types (it cannot distinguish generated markup from
  // user-authored HTML). `readit_raw` is the escape hatch for that pass.
  // `??=` so this rule still works standalone in tests without clobbering the
  // central registration a later task adds in engine.ts.
  md.renderer.rules.readit_raw ??= (tokens, idx) => tokens[idx]!.content

  md.core.ruler.push('readit_task_list', (state: StateCore) => {
    const tokens = state.tokens
    const listStack: Token[] = []

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      if (token === undefined) continue
      if (LIST_OPEN.has(token.type)) {
        listStack.push(token)
        continue
      }
      if (LIST_CLOSE.has(token.type)) {
        listStack.pop()
        continue
      }
      if (token.type !== 'list_item_open') continue

      const paragraph = tokens[i + 1]
      const inline = tokens[i + 2]
      if (paragraph === undefined || paragraph.type !== 'paragraph_open') continue
      if (inline === undefined || inline.type !== 'inline') continue

      const marker = markerOf(inline)
      if (marker === null) continue

      const children = inline.children
      if (children === null) continue
      const firstChild = children[0]
      if (firstChild === undefined) continue

      // Drop the literal `[x]`; the space that followed it is kept, matching GitHub.
      firstChild.content = firstChild.content.slice(3)
      inline.content = inline.content.slice(3)

      const checkbox = new state.Token('readit_raw', '', 0)
      checkbox.content = marker === 'checked' ? CHECKBOX_CHECKED : CHECKBOX_UNCHECKED
      children.unshift(checkbox)

      token.attrSet('class', 'task-list-item')
      const list = listStack[listStack.length - 1]
      if (list !== undefined) list.attrSet('class', 'contains-task-list')
    }
    return true
  })
}
