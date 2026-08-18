import { describe, expect, it } from 'vitest'
import { createLeavePrompt } from '../src/leave-prompt.js'

function button(): HTMLButtonElement {
  return document.createElement('button')
}

describe('leave prompt', () => {
  it('offers save/discard/cancel wording for navigation and resolves the chosen action', async () => {
    const root = document.createElement('aside')
    root.hidden = true
    const title = document.createElement('h2')
    const message = document.createElement('p')
    const save = button()
    const discard = button()
    const cancel = button()
    root.append(title, message, save, discard, cancel)
    document.body.append(root)
    const prompt = createLeavePrompt({ root, title, message, save, discard, cancel })

    const decision = prompt.request('navigate')
    expect(root.hidden).toBe(false)
    expect(title.textContent).toContain('另一份文档')
    expect(save.textContent).toBe('保存并继续')
    expect(discard.textContent).toBe('放弃并继续')
    cancel.click()

    expect(await decision).toBe('cancel')
    expect(root.hidden).toBe(true)
    prompt.destroy()
    root.remove()
  })

  it('deduplicates simultaneous native leave requests', async () => {
    const root = document.createElement('aside')
    const title = document.createElement('h2')
    const message = document.createElement('p')
    const save = button()
    const discard = button()
    const cancel = button()
    const prompt = createLeavePrompt({ root, title, message, save, discard, cancel })

    const first = prompt.request('exit')
    const second = prompt.request('close')
    expect(second).toBe(first)
    expect(save.textContent).toBe('保存并退出')
    discard.click()
    expect(await first).toBe('discard')
    prompt.destroy()
  })
})
