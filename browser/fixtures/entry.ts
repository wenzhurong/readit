import { defineReadit, mount } from '@readit/element'

type MountOpts = NonNullable<Parameters<typeof mount>[1]>
type Handle = ReturnType<typeof mount>

export interface ReaditFixtureApi {
  mount(hostId: string, opts: MountOpts): string
  get(id: string): Handle
  destroy(id: string): void
  destroyAll(): void
  readonly navigations: string[]
  defineReadit(tag?: string): void
}

const handles = new Map<string, Handle>()
const navigations: string[] = []
let seq = 0

const api: ReaditFixtureApi = {
  mount(hostId, opts) {
    const host = document.getElementById(hostId)
    if (host === null) throw new Error(`fixture: no host #${hostId}`)
    const id = `h${(seq += 1)}`
    handles.set(id, mount(host, { onNavigate: (path: string) => { navigations.push(path) }, ...opts }))
    return id
  },
  get(id) {
    const handle = handles.get(id)
    if (handle === undefined) throw new Error(`fixture: no handle ${id}`)
    return handle
  },
  destroy(id) {
    api.get(id).destroy()
    handles.delete(id)
  },
  destroyAll() {
    for (const handle of handles.values()) handle.destroy()
    handles.clear()
  },
  navigations,
  defineReadit,
}

// §0 A9：页面全局统一 window.readitFixture（不是任务书草稿里到处出现的 window.__readit）。
Object.defineProperty(window, 'readitFixture', { value: api })
