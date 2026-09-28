import type { LeaveDecision } from './save-state.js'

export type LeaveKind = 'navigate' | 'close-tab' | 'close' | 'exit'

export interface LeavePromptElements {
  readonly root: HTMLElement
  readonly title: HTMLElement
  readonly message: HTMLElement
  readonly save: HTMLButtonElement
  readonly discard: HTMLButtonElement
  readonly cancel: HTMLButtonElement
}

export interface LeavePrompt {
  /** documentName 写进提示，让用户知道问的是哪一份（多标签下尤其要紧）。 */
  request(kind: LeaveKind, documentName?: string | null): Promise<LeaveDecision>
  destroy(): void
}

/**
 * 保存 / 放弃 / 取消三动作的离开提示。
 *
 * 同时发起的请求**排队**：前一个答完，才显示下一个，各自拿各自的答案。多标签下文档内跳转
 * 的提示与关标签的提示可能同时出现；原先「后来者直接拿走前一个的答案」会把对 A 的决定用在
 * B 上。那个共用原本是给原生关窗 / 退出请求去重的，现在原生请求由 tab-session.ts 排队处理。
 */
export function createLeavePrompt(elements: LeavePromptElements): LeavePrompt {
  let resolveCurrent: ((decision: LeaveDecision) => void) | null = null
  let tail: Promise<unknown> = Promise.resolve()
  let destroyed = false

  const finish = (decision: LeaveDecision): void => {
    const resolve = resolveCurrent
    if (resolve === null) return
    resolveCurrent = null
    elements.root.hidden = true
    resolve(decision)
  }
  const onSave = (): void => finish('save')
  const onDiscard = (): void => finish('discard')
  const onCancel = (): void => finish('cancel')
  elements.save.addEventListener('click', onSave)
  elements.discard.addEventListener('click', onDiscard)
  elements.cancel.addEventListener('click', onCancel)

  const show = (kind: LeaveKind, documentName: string | null): Promise<LeaveDecision> => {
    if (destroyed) return Promise.resolve('cancel')
    const name = documentName === null ? null : `「${documentName}」`
    if (kind === 'navigate') {
      elements.title.textContent = '打开另一份文档？'
      elements.message.textContent = '当前文档有尚未保存的修改。'
      elements.save.textContent = '保存并继续'
      elements.discard.textContent = '放弃并继续'
    } else if (kind === 'close-tab') {
      elements.title.textContent = `关闭${name ?? '这份文档'}？`
      elements.message.textContent = '这份文档有尚未保存的修改。'
      elements.save.textContent = '保存并关闭'
      elements.discard.textContent = '放弃并关闭'
    } else {
      const exiting = kind === 'exit'
      elements.title.textContent = exiting ? '退出 readit？' : '关闭窗口？'
      elements.message.textContent = `${name ?? '当前文档'}有尚未保存的修改。`
      elements.save.textContent = exiting ? '保存并退出' : '保存并关闭'
      elements.discard.textContent = exiting ? '放弃并退出' : '放弃并关闭'
    }
    elements.root.hidden = false
    elements.cancel.focus()
    return new Promise((resolve) => {
      resolveCurrent = resolve
    })
  }

  return {
    request(kind, documentName = null): Promise<LeaveDecision> {
      const decision = tail.then(() => show(kind, documentName))
      tail = decision.catch(() => {})
      return decision
    },

    destroy(): void {
      destroyed = true
      finish('cancel')
      elements.save.removeEventListener('click', onSave)
      elements.discard.removeEventListener('click', onDiscard)
      elements.cancel.removeEventListener('click', onCancel)
    },
  }
}
