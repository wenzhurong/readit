import { describe, expect, it } from 'vitest'
import { documentFileName, normalizeDocumentPath } from '../src/document-path.js'

describe('document paths from native shells', () => {
  it.each([
    ['/Users/example/README.md', '/Users/example/README.md'],
    ['C:\\Users\\example\\notes.md', 'C:/Users/example/notes.md'],
    ['\\\\?\\C:\\Users\\example\\long path.markdown', 'C:/Users/example/long path.markdown'],
    ['\\\\?\\UNC\\server\\share\\notes.md', '\\\\server\\share\\notes.md'],
  ])('normalizes %s for the web navigation model', (path, expected) => {
    expect(normalizeDocumentPath(path)).toBe(expected)
  })

  it('takes a filename from both slash styles and strips the extended prefix', () => {
    expect(documentFileName('\\\\?\\C:\\docs\\nested\\README.md')).toBe('README.md')
  })
})
