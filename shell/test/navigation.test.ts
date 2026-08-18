import { expect, it } from 'vitest'
import { routeDocumentOpen } from '../src/navigation.js'

it('routes an OS open through the element click contract without leaving a helper node', () => {
  const host = document.createElement('div')
  let href = ''
  host.addEventListener('click', (event) => {
    href = (event.target as HTMLAnchorElement).getAttribute('href') ?? ''
    event.preventDefault()
  })

  routeDocumentOpen(host, '/Users/example/next.md')

  expect(href).toBe('/Users/example/next.md')
  expect(host.childElementCount).toBe(0)
})

it('normalizes an extended-length Windows open before routing it', () => {
  const host = document.createElement('div')
  let href = ''
  host.addEventListener('click', (event) => {
    href = (event.target as HTMLAnchorElement).getAttribute('href') ?? ''
    event.preventDefault()
  })

  routeDocumentOpen(host, '\\\\?\\C:\\docs\\nested\\next.md')

  expect(href).toBe('C:/docs/nested/next.md')
  expect(host.childElementCount).toBe(0)
})
