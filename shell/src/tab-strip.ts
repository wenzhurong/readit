export interface TabView {
  readonly id: number
  readonly label: string
  readonly path: string
  readonly dirty: boolean
  /** 后台标签有待裁决的外部修改冲突。当前标签的冲突直接弹提示条，不在这里标。 */
  readonly conflict: boolean
}

export interface TabStripOptions {
  activate(id: number): void
  close(id: number): void
  open(): void
  /** 快捷键前缀：macOS 是 `⌘`，Windows 是 `Ctrl+`。只用于 title 提示。 */
  readonly shortcutModifier: string
}

export interface TabStripHandle {
  render(tabs: readonly TabView[], activeId: number | null): void
  destroy(): void
}

/**
 * 标签栏。只发意图（切换 / 关闭 / 打开），状态由 tab-session 统一裁决后整条重画——与
 * mode-switch.ts 同一个模式：菜单、快捷键、标签栏三条入口共用同一份真相。
 */
export function connectTabStrip(root: HTMLElement, options: TabStripOptions): TabStripHandle {
  const list = root.querySelector<HTMLElement>('[role="tablist"]')
  const open = root.querySelector<HTMLButtonElement>('button[data-action="open"]')
  // 大声失败：少了其中一个，就少了一个入口。
  if (list === null || open === null) throw new Error('readit shell is missing the tab strip')
  open.title = `打开…（${options.shortcutModifier}O）`
  const doc = root.ownerDocument
  let shownActive: number | null = null

  const tabIdOf = (target: EventTarget | null): number | null => {
    const tab = target instanceof Element ? target.closest<HTMLElement>('[role="tab"]') : null
    const id = Number(tab?.dataset['tabId'])
    return Number.isInteger(id) && id > 0 ? id : null
  }

  const onClick = (event: MouseEvent): void => {
    const id = tabIdOf(event.target)
    if (id === null) return
    const onClose = event.target instanceof Element && event.target.closest('.tab-close') !== null
    if (onClose) options.close(id)
    else options.activate(id)
  }
  // 中键：按下时就吃掉，免得 Windows 上进入自动滚动；松开（auxclick）时关闭。
  const onMouseDown = (event: MouseEvent): void => {
    if (event.button === 1 && tabIdOf(event.target) !== null) event.preventDefault()
  }
  const onAuxClick = (event: MouseEvent): void => {
    if (event.button !== 1) return
    const id = tabIdOf(event.target)
    if (id === null) return
    event.preventDefault()
    options.close(id)
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const id = tabIdOf(event.target)
    if (id === null) return
    event.preventDefault()
    options.activate(id)
  }
  const onOpen = (): void => options.open()

  list.addEventListener('click', onClick)
  list.addEventListener('mousedown', onMouseDown)
  list.addEventListener('auxclick', onAuxClick)
  list.addEventListener('keydown', onKeyDown)
  open.addEventListener('click', onOpen)

  return {
    render(tabs, activeId) {
      list.replaceChildren(
        ...tabs.map((view) => {
          const tab = doc.createElement('div')
          tab.setAttribute('role', 'tab')
          tab.dataset['tabId'] = String(view.id)
          tab.setAttribute('aria-selected', String(view.id === activeId))
          tab.tabIndex = view.id === activeId ? 0 : -1
          tab.title = view.path
          if (view.conflict) tab.dataset['conflict'] = 'true'
          const label = doc.createElement('span')
          label.className = 'tab-label'
          label.textContent = view.dirty ? `● ${view.label}` : view.label
          const close = doc.createElement('button')
          close.type = 'button'
          close.className = 'tab-close'
          close.tabIndex = -1
          close.setAttribute('aria-label', `关闭 ${view.label}`)
          close.textContent = '×'
          tab.append(label, close)
          return tab
        }),
      )
      // 只在切换当前标签时把它滚进标签栏视野；每次重画都滚会跟打字抢。
      if (activeId !== shownActive) {
        shownActive = activeId
        list
          .querySelector<HTMLElement>('[aria-selected="true"]')
          ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      }
    },

    destroy() {
      list.removeEventListener('click', onClick)
      list.removeEventListener('mousedown', onMouseDown)
      list.removeEventListener('auxclick', onAuxClick)
      list.removeEventListener('keydown', onKeyDown)
      open.removeEventListener('click', onOpen)
    },
  }
}
