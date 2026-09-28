import { describe, expect, it } from 'vitest'
import { createLeavePrompt } from '../src/leave-prompt.js'

function promptElements() {
  const root = document.createElement('aside')
  root.hidden = true
  const title = document.createElement('h2')
  const message = document.createElement('p')
  const save = document.createElement('button')
  const discard = document.createElement('button')
  const cancel = document.createElement('button')
  root.append(title, message, save, discard, cancel)
  document.body.append(root)
  return { root, title, message, save, discard, cancel }
}

/** 请求排队之后，提示在下一个微任务才显示；排在后面的还要等前一个的答案一路传下来。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe('leave prompt', () => {
  it('offers save/discard/cancel wording for navigation and resolves the chosen action', async () => {
    const elements = promptElements()
    const prompt = createLeavePrompt(elements)

    const decision = prompt.request('navigate')
    await flush()
    expect(elements.root.hidden).toBe(false)
    expect(elements.title.textContent).toContain('另一份文档')
    expect(elements.save.textContent).toBe('保存并继续')
    expect(elements.discard.textContent).toBe('放弃并继续')
    elements.cancel.click()

    expect(await decision).toBe('cancel')
    expect(elements.root.hidden).toBe(true)
    prompt.destroy()
    elements.root.remove()
  })

  it('names the document when closing a tab', async () => {
    const elements = promptElements()
    const prompt = createLeavePrompt(elements)

    void prompt.request('close-tab', 'notes.md')
    await flush()

    expect({
      title: elements.title.textContent,
      message: elements.message.textContent,
      save: elements.save.textContent,
      discard: elements.discard.textContent,
    }).toEqual({
      title: '关闭「notes.md」？',
      message: '这份文档有尚未保存的修改。',
      save: '保存并关闭',
      discard: '放弃并关闭',
    })
    prompt.destroy()
    elements.root.remove()
  })

  it('names the document when the window closes or the app exits', async () => {
    const elements = promptElements()
    const prompt = createLeavePrompt(elements)

    void prompt.request('exit', 'a.md')
    await flush()

    expect([elements.title.textContent, elements.message.textContent, elements.save.textContent]).toEqual([
      '退出 readit？',
      '「a.md」有尚未保存的修改。',
      '保存并退出',
    ])
    prompt.destroy()
    elements.root.remove()
  })

  it('queues a second request until the first is answered, and each gets its own answer', async () => {
    // 评审关注第 5 条：两个流程的提示不能共用一个答案。
    const elements = promptElements()
    const prompt = createLeavePrompt(elements)

    const first = prompt.request('close-tab', 'a.md')
    const second = prompt.request('close', 'b.md')
    await flush()
    expect(elements.title.textContent).toBe('关闭「a.md」？')
    elements.discard.click()
    expect(await first).toBe('discard')

    await flush()
    expect(elements.root.hidden).toBe(false)
    expect(elements.message.textContent).toBe('「b.md」有尚未保存的修改。')
    elements.cancel.click()
    expect(await second).toBe('cancel')
    prompt.destroy()
    elements.root.remove()
  })
})
