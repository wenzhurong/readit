import type { Page } from './harness.js'

/** 真壳前端在夹具服务器上的地址（build-fixtures.mjs 打包到这里）。 */
export const SHELL_URL = '/assets/shell/index.html'

export interface FakeShellOptions {
  /** 假磁盘：规范化路径 → 内容。open_document 只认这里的路径。 */
  readonly files: Readonly<Record<string, string>>
  /** 启动时就在待打开队列里的路径（相当于双击打开）。 */
  readonly pending?: readonly string[]
  /** 「打开…」对话框被调用时「用户选中」的路径。 */
  readonly dialog?: readonly string[]
}

export interface ShellCall {
  readonly cmd: string
  readonly args: Record<string, unknown>
}

declare global {
  interface Window {
    readitShell: {
      readonly calls: ShellCall[]
      readonly files: Record<string, string>
      readonly open: Record<number, string>
      enqueue(paths: readonly string[]): void
      emit(event: string, payload: unknown): void
      failSaves(message: string | null): void
    }
  }
}

/**
 * 在页面脚本之前装上一个假的 Tauri 后端。命令名与载荷照 shell/src-tauri/src/lib.rs：
 * generation 从 1 开始单调递增，关闭后保存 / 读盘被拒，事件经 transformCallback 注册的回调派发。
 * 整个函数会被序列化进页面，不能引用模块作用域里的任何东西。
 */
function installFakeBackend(options: FakeShellOptions): void {
  type Callback = (message: unknown) => void
  const callbacks = new Map<number, Callback>()
  const listeners = new Map<string, number[]>()
  const calls: ShellCall[] = []
  const files: Record<string, string> = { ...options.files }
  const pending: string[] = [...(options.pending ?? [])]
  const open: Record<number, string> = {}
  let nextCallback = 1
  let nextGeneration = 0
  let saveFailure: string | null = null

  const emit = (event: string, payload: unknown): void => {
    for (const id of listeners.get(event) ?? []) callbacks.get(id)?.({ event, id, payload })
  }

  const commands: Record<string, (args: Record<string, unknown>) => unknown> = {
    'plugin:event|listen': (args) => {
      const event = String(args['event'])
      const handler = Number(args['handler'])
      listeners.set(event, [...(listeners.get(event) ?? []), handler])
      return handler
    },
    'plugin:event|unlisten': () => null,
    'plugin:window|set_title': () => null,
    frontend_ready: () => null,
    set_mode_menu: () => null,
    check_for_update: () => null,
    install_update: () => null,
    open_external: () => null,
    cancel_leave: () => null,
    complete_leave: () => null,
    take_pending_path: () => pending.shift() ?? null,
    open_document: (args) => {
      const path = String(args['path'])
      const source = files[path]
      if (source === undefined) throw new Error(`cannot open ${path}: No such file or directory`)
      nextGeneration += 1
      open[nextGeneration] = path
      return { path, source, generation: nextGeneration }
    },
    close_document: (args) => {
      delete open[Number(args['generation'])]
      return null
    },
    save_document: (args) => {
      if (saveFailure !== null) throw new Error(saveFailure)
      const generation = Number(args['generation'])
      const path = open[generation]
      if (path === undefined) throw new Error(`cannot save: document generation ${generation} is not open`)
      files[path] = String(args['content'])
      return null
    },
    read_document: (args) => {
      const generation = Number(args['generation'])
      const path = open[generation]
      if (path === undefined) throw new Error(`cannot reload: document generation ${generation} is not open`)
      return files[path] ?? ''
    },
    open_dialog: () => {
      const chosen = options.dialog ?? []
      pending.push(...chosen)
      if (chosen.length > 0) emit('readit-documents-pending', null)
      return null
    },
  }

  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: {
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { windowLabel: 'main', label: 'main' },
      },
      transformCallback(callback: Callback): number {
        const id = nextCallback
        nextCallback += 1
        callbacks.set(id, callback)
        return id
      },
      unregisterCallback(id: number): void {
        callbacks.delete(id)
      },
      convertFileSrc: (path: string): string => path,
      async invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
        calls.push({ cmd, args })
        const command = commands[cmd]
        if (command === undefined) throw new Error(`fake shell backend: unknown command ${cmd}`)
        return command(args)
      },
    },
  })
  Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', {
    value: { unregisterListener(): void {} },
  })
  Object.defineProperty(window, 'readitShell', {
    value: {
      calls,
      files,
      open,
      enqueue(paths: readonly string[]): void {
        pending.push(...paths)
        emit('readit-documents-pending', null)
      },
      emit,
      failSaves(message: string | null): void {
        saveFailure = message
      },
    },
  })
}

/** 装上假后端、打开真壳前端，等它把原生关窗拦截接好（frontend_ready）再返回。 */
export async function openShell(page: Page, options: FakeShellOptions): Promise<void> {
  await page.addInitScript(installFakeBackend, options)
  await page.goto(SHELL_URL)
  await page.waitForFunction(() => window.readitShell.calls.some((call) => call.cmd === 'frontend_ready'))
}
