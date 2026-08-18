import { describe, expect, it } from 'vitest'
import {
  documentFileName,
  documentWindowTitle,
  normalizeDocumentPath,
} from '../src/document-path.js'

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

describe('原生窗口标题', () => {
  it('带上文件名，脏了才有 ● 前缀', () => {
    expect(documentWindowTitle('/a/b/notes.md', false)).toBe('notes.md — readit')
    expect(documentWindowTitle('/a/b/notes.md', true)).toBe('● notes.md — readit')
  })

  it('没有文档时退回应用名，不显示一个孤零零的破折号', () => {
    expect(documentWindowTitle(null, false)).toBe('readit')
    expect(documentWindowTitle(null, true)).toBe('readit')
  })
})
