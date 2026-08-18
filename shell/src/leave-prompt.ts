import type { LeaveDecision } from './save-state.js'

export type LeaveKind = 'navigate' | 'close' | 'exit'

export interface LeavePromptElements {
  readonly root: HTMLElement
  readonly title: HTMLElement
  readonly message: HTMLElement
  readonly save: HTMLButtonElement
  readonly discard: HTMLButtonElement
  readonly cancel: HTMLButtonElement
}

export interface LeavePrompt {
  request(kind: LeaveKind): Promise<LeaveDecision>
  destroy(): void
}

export function createLeavePrompt(elements: LeavePromptElements): LeavePrompt {
  let pending: Promise<LeaveDecision> | null = null
  let resolvePending: ((decision: LeaveDecision) => void) | null = null

  const finish = (decision: LeaveDecision): void => {
    const resolve = resolvePending
    if (resolve === null) return
    resolvePending = null
    pending = null
    elements.root.hidden = true
    resolve(decision)
  }
  const onSave = (): void => finish('save')
  const onDiscard = (): void => finish('discard')
  const onCancel = (): void => finish('cancel')
  elements.save.addEventListener('click', onSave)
  elements.discard.addEventListener('click', onDiscard)
  elements.cancel.addEventListener('click', onCancel)

  return {
    request(kind): Promise<LeaveDecision> {
      if (pending !== null) return pending
      const exiting = kind === 'exit'
      const closing = kind === 'close'
      elements.title.textContent = exiting ? '退出 readit？' : closing ? '关闭窗口？' : '打开另一份文档？'
      elements.message.textContent = '当前文档有尚未保存的修改。'
      elements.save.textContent = exiting ? '保存并退出' : closing ? '保存并关闭' : '保存并继续'
      elements.discard.textContent = exiting ? '放弃并退出' : closing ? '放弃并关闭' : '放弃并继续'
      elements.root.hidden = false
      elements.cancel.focus()
      pending = new Promise((resolve) => {
        resolvePending = resolve
      })
      return pending
    },

    destroy(): void {
      finish('cancel')
      elements.save.removeEventListener('click', onSave)
      elements.discard.removeEventListener('click', onDiscard)
      elements.cancel.removeEventListener('click', onCancel)
    },
  }
}
