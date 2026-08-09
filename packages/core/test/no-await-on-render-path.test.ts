import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
/** prepare.ts is the one and only place allowed to await or dynamic-import (SPEC §3.1). */
const ALLOWED = new Set(['prepare.ts'])

function walk(dir: string, rel = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, rel + name + '/'))
    } else if (name.endsWith('.ts')) {
      out.push(rel + name)
    }
  }
  return out
}

describe('the synchronous render path', () => {
  const files = walk(SRC)

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const rel of files) {
    if (ALLOWED.has(rel)) continue
    it(`packages/core/src/${rel} contains no await and no dynamic import`, () => {
      const text = readFileSync(join(SRC, rel), 'utf8')
      expect(text).not.toMatch(/\bawait\b/)
      expect(text).not.toMatch(/\basync\b/)
      expect(text).not.toMatch(/\bimport\s*\(/)
    })
  }
})
