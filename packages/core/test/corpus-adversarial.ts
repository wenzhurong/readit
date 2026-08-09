import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const KARLCOW_DIR = new URL('./corpus/adversarial/karlcow/', import.meta.url).pathname

/** Input file names of the vendored karlcow/markdown-testsuite (MIT). Outputs are not vendored. */
export function discoverKarlcow(dir: string = KARLCOW_DIR): string[] {
  return readdirSync(dir)
    .filter((n) => n.endsWith('.md'))
    .sort()
}

export function readKarlcow(name: string, dir: string = KARLCOW_DIR): string {
  return readFileSync(join(dir, name), 'utf8')
}
