import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

it('desktop shell pins the reusable find bar to the WebView viewport', () => {
  const css = readFileSync(join(HERE, '..', 'src', 'styles.css'), 'utf8')
  expect(css).toMatch(/#reader\s*\{[^}]*--readit-find-position:\s*fixed;/s)
})
