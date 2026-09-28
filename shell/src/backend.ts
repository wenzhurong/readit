import type { ShellMode } from './mode-switch.js'

export interface DocumentPayload {
  readonly path: string
  readonly source: string
  readonly generation: number
}

/** 壳对 Rust 的全部依赖。main.ts 用 invoke 实现它；单测与真引擎夹具用替身。 */
export interface ShellBackend {
  openDocument(path: string): Promise<DocumentPayload>
  closeDocument(generation: number): Promise<void>
  saveDocument(content: string, generation: number): Promise<void>
  readDocument(generation: number): Promise<string>
  /** generation 决定对话框的起始目录；没有标签时传 null。 */
  openDialog(generation: number | null): Promise<void>
  takePendingPath(): Promise<string | null>
  setModeMenu(mode: ShellMode): Promise<void>
  cancelLeave(): Promise<void>
  completeLeave(kind: 'close' | 'exit'): Promise<void>
}

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export function createTauriBackend(invoke: TauriInvoke): ShellBackend {
  return {
    openDocument: (path) => invoke<DocumentPayload>('open_document', { path }),
    closeDocument: (generation) => invoke<void>('close_document', { generation }),
    saveDocument: (content, generation) => invoke<void>('save_document', { content, generation }),
    readDocument: (generation) => invoke<string>('read_document', { generation }),
    openDialog: (generation) => invoke<void>('open_dialog', { generation }),
    takePendingPath: () => invoke<string | null>('take_pending_path'),
    setModeMenu: (mode) => invoke<void>('set_mode_menu', { mode }),
    cancelLeave: () => invoke<void>('cancel_leave'),
    completeLeave: (kind) => invoke<void>('complete_leave', { kind }),
  }
}
