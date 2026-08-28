import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')) as T

describe('known high-severity npm advisories stay patched', () => {
  const core = readJson<{ dependencies: Record<string, string> }>('packages/core/package.json')
  const lock = readJson<{ packages: Record<string, { version?: string }> }>('package-lock.json')

  it('pins the shipped YAML parser to the reviewed patched release', () => {
    expect(core.dependencies['js-yaml']).toBe('4.3.2')
    expect(lock.packages['node_modules/js-yaml']?.version).toBe('4.3.2')
  })

  it('keeps the PostCSS build chain above the affected nanoid range', () => {
    expect(lock.packages['node_modules/nanoid']?.version).toBe('3.3.18')
  })
})
