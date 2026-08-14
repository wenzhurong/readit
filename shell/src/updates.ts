export interface UpdateMetadata {
  readonly version: string
  readonly currentVersion: string
}

export interface UpdateApi {
  check(): Promise<UpdateMetadata | null>
  install(): Promise<void>
}

export interface UpdateNoticeElements {
  readonly notice: HTMLElement
  readonly message: HTMLElement
  readonly button: HTMLButtonElement
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function connectUpdateNotice(
  elements: UpdateNoticeElements,
  api: UpdateApi,
): Promise<() => void> {
  let update: UpdateMetadata | null
  try {
    update = await api.check()
  } catch {
    // Update checks must not make an otherwise-offline reader unusable.
    return () => {}
  }
  if (update === null) return () => {}

  elements.message.textContent = `readit ${update.version} 已可用。`
  elements.notice.hidden = false

  let installing = false
  const install = (): void => {
    if (installing) return
    installing = true
    elements.button.disabled = true
    elements.message.textContent = `正在安装 readit ${update.version}…`
    void api
      .install()
      .then(() => {
        elements.message.textContent = '更新已安装，正在重启…'
      })
      .catch((error: unknown) => {
        installing = false
        elements.button.disabled = false
        elements.message.textContent = `更新失败：${errorMessage(error)}`
      })
  }
  elements.button.addEventListener('click', install)

  return () => {
    elements.button.removeEventListener('click', install)
  }
}
