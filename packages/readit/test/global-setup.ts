import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'
import { buildDist } from '../build.js'
import { packTarball } from './pack.js'

declare module 'vitest' {
  interface ProvidedContext {
    /** npm pack 出来的 tarball 绝对路径，三条分发门共用一份。 */
    readitTarball: string
  }
}

/**
 * dist/ 是 gitignore 的，而这个 project 的每一条断言都读它。构建放在 globalSetup 里，
 * 而不是让测试自己 skip-if-missing：一条能被「忘了构建」静默跳过的门等于没有门。
 * tarball 也在这里打一次——三条门共用，且落在 os.tmpdir() 里，不进仓库、不进下一次 pack。
 */
export default async function setup(project: TestProject): Promise<void> {
  await buildDist()
  const dir = mkdtempSync(join(tmpdir(), 'readit-pack-'))
  project.provide('readitTarball', packTarball(dir))
}
