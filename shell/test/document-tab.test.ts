import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MountHandle, MountOptions } from 'readit/element'
import type { DocumentPayload } from '../src/backend.js'
import { createDocumentTab, type DocumentTabDeps } from '../src/document-tab.js'

interface FakeMount {
  readonly host: HTMLElement
  readonly options: Partial<MountOptions>
  readonly values: string[]
  readonly modes: string[]
  destroyed: boolean
}

const FIRST: DocumentPayload = { path: '/docs/a.md', source: '# A\n', generation: 1 }

function harness(overrides: Partial<DocumentTabDeps> = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  const mounts: FakeMount[] = []
  let opened = 10
  const backend = {
    openDocument: vi.fn(async (path: string): Promise<DocumentPayload> => ({
      path,
      source: `# ${path}\n`,
      generation: (opened += 1),
    })),
    closeDocument: vi.fn(async (_generation: number) => {}),
    saveDocument: vi.fn(async (_content: string, _generation: number) => {}),
    readDocument: vi.fn(async (_generation: number) => '# from disk\n'),
  }
  const deps: DocumentTabDeps = {
    backend,
    container,
    mountDefaults: { breaks: true },
    mount(host, options) {
      host.attachShadow({ mode: 'open' })
      const record: FakeMount = {
        host,
        options,
        values: [options.value ?? ''],
        modes: [options.mode ?? 'read'],
        destroyed: false,
      }
      mounts.push(record)
      const handle: MountHandle = {
        setValue: (value) => {
          record.values.push(value)
        },
        getValue: () => record.values.at(-1) ?? '',
        setMode: (mode) => {
          record.modes.push(mode)
        },
        setTheme: () => {},
        find: () => {
          throw new Error('not used here')
        },
        destroy: () => {
          record.destroyed = true
        },
      }
      return handle
    },
    resourceBase: (generation) => `readit://localhost/${generation}/`,
    waitForComposition: async () => {},
    askToNavigate: vi.fn(async () => 'cancel' as const),
    changed: vi.fn(),
    conflictChanged: vi.fn(),
    reportError: vi.fn(),
    ...overrides,
  }
  const mounted = (): FakeMount => {
    const record = mounts[0]
    if (record === undefined) throw new Error('nothing mounted')
    return record
  }
  const navigate = (target: string): Promise<void> =>
    (mounted().options.onNavigate as (path: string) => Promise<void>)(target)
  return { container, mounts, mounted, navigate, backend, deps }
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('document tab', () => {
  it('mounts into its own host under the container with the shell defaults', () => {
    const { container, mounted, deps } = harness()
    const tab = createDocumentTab(deps, FIRST, 'split')

    expect({
      inContainer: tab.host.parentElement === container,
      className: tab.host.className,
      inertUntilActivated: tab.host.inert,
      breaks: mounted().options.breaks,
      value: mounted().options.value,
      mode: mounted().options.mode,
      baseUrl: mounted().options.baseUrl,
    }).toEqual({
      inContainer: true,
      className: 'document-tab',
      inertUntilActivated: true,
      breaks: true,
      value: '# A\n',
      mode: 'split',
      baseUrl: '/docs/a.md',
    })
  })

  it('reports user edits as this tab becoming dirty', () => {
    const changed = vi.fn()
    const { mounted, deps } = harness({ changed })
    const tab = createDocumentTab(deps, FIRST, 'read')
    changed.mockClear()

    mounted().options.onChange?.('# A edited\n')

    expect({ dirty: tab.snapshot().dirty, reportedTab: changed.mock.calls.at(-1)?.[0] === tab }).toEqual({
      dirty: true,
      reportedTab: true,
    })
  })

  it('saves with its own generation', async () => {
    const { mounted, backend, deps } = harness()
    const tab = createDocumentTab(deps, FIRST, 'read')
    mounted().options.onChange?.('# A edited\n')

    await tab.save()

    expect(backend.saveDocument.mock.calls).toEqual([['# A edited\n', 1]])
  })

  it('navigates in place: opens the target, then releases the previous generation', async () => {
    const { mounted, navigate, backend, deps } = harness()
    const tab = createDocumentTab(deps, FIRST, 'read')

    await navigate('/docs/b.md')

    expect({
      opened: backend.openDocument.mock.calls,
      closed: backend.closeDocument.mock.calls,
      path: tab.path(),
      generation: tab.generation(),
      shown: mounted().values.at(-1),
    }).toEqual({
      opened: [['/docs/b.md']],
      closed: [[1]],
      path: '/docs/b.md',
      generation: 11,
      shown: '# /docs/b.md\n',
    })
  })

  it('asks before navigating away from unsaved edits; cancel keeps the document', async () => {
    const askToNavigate = vi.fn(async () => 'cancel' as const)
    const { mounted, navigate, backend, deps } = harness({ askToNavigate })
    const tab = createDocumentTab(deps, FIRST, 'read')
    mounted().options.onChange?.('# dirty\n')

    await navigate('/docs/b.md')

    expect({ asked: askToNavigate.mock.calls.length, opened: backend.openDocument.mock.calls.length, generation: tab.generation() }).toEqual({
      asked: 1,
      opened: 0,
      generation: 1,
    })
  })

  it('keeps the current document when opening the target fails, and rejects so the element can show it', async () => {
    const { navigate, backend, deps } = harness()
    backend.openDocument.mockRejectedValueOnce(new Error('cannot open /docs/missing.md'))
    const tab = createDocumentTab(deps, FIRST, 'read')

    await expect(navigate('/docs/missing.md')).rejects.toThrow('cannot open')
    expect({ generation: tab.generation(), closed: backend.closeDocument.mock.calls.length }).toEqual({
      generation: 1,
      closed: 0,
    })
  })

  it('reloads external changes for its current generation and ignores stale ones', async () => {
    vi.useFakeTimers()
    const { mounted, backend, deps } = harness()
    const tab = createDocumentTab(deps, FIRST, 'read')

    tab.diskChanged(99)
    tab.diskChanged(1)
    await vi.advanceTimersByTimeAsync(80)
    // 去抖到期后，重载链里还有两次 await（组合门、读盘）；Promise 不受假计时器影响，清几轮微任务。
    for (let i = 0; i < 10; i += 1) await Promise.resolve()

    expect({ reads: backend.readDocument.mock.calls, shown: mounted().values.at(-1) }).toEqual({
      reads: [[1]],
      shown: '# from disk\n',
    })
  })

  it('rewrites local resources with its generation, and with the new one after navigating', async () => {
    const { mounted, navigate, deps } = harness()
    createDocumentTab(deps, FIRST, 'read')
    const shadow = mounted().host.shadowRoot
    if (shadow === null) throw new Error('fake mount has no shadow root')

    const before = document.createElement('img')
    before.setAttribute('src', 'img.png')
    shadow.append(before)
    await Promise.resolve()
    await navigate('/docs/b.md')
    const after = document.createElement('img')
    after.setAttribute('src', 'img.png')
    shadow.append(after)
    await Promise.resolve()

    expect([before.getAttribute('src'), after.getAttribute('src')]).toEqual([
      'readit://localhost/1/img.png',
      'readit://localhost/11/img.png',
    ])
  })

  it('toggles the active class and inertness', () => {
    const { deps } = harness()
    const tab = createDocumentTab(deps, FIRST, 'read')

    tab.setActive(true)
    const active = { cls: tab.host.classList.contains('is-active'), inert: tab.host.inert }
    tab.setActive(false)
    const inactive = { cls: tab.host.classList.contains('is-active'), inert: tab.host.inert }

    expect({ active, inactive }).toEqual({
      active: { cls: true, inert: false },
      inactive: { cls: false, inert: true },
    })
  })

  it('destroy releases the mount, the host and the Rust generation', () => {
    const { mounted, backend, deps } = harness()
    const tab = createDocumentTab(deps, FIRST, 'read')

    tab.destroy()

    expect({ destroyed: mounted().destroyed, connected: tab.host.isConnected, closed: backend.closeDocument.mock.calls }).toEqual({
      destroyed: true,
      connected: false,
      closed: [[1]],
    })
  })
})
