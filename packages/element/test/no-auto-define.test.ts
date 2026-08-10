import { describe, expect, it } from 'vitest'

describe('import 时不自动注册', () => {
  it('import @readit/element 不碰 customElements', async () => {
    expect(customElements.get('readit-view')).toBeUndefined()
    const mod = await import('../src/index.js')
    expect(customElements.get('readit-view')).toBeUndefined()
    expect(mod.defineReadit).toBeTypeOf('function')
  })
})
