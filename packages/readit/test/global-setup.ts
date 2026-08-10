import type { TestProject } from 'vitest/node'
import { buildDist } from '../build.js'

/**
 * dist/ 是 gitignore 的，而这个 project 的每一条断言都读它。构建放在 globalSetup 里，
 * 而不是让测试自己 skip-if-missing：一条能被「忘了构建」静默跳过的门等于没有门。
 * 副作用是 npm test 会连带构建一次——这正是想要的，构建坏掉必须让主套件变红。
 */
export default async function setup(_project: TestProject): Promise<void> {
  await buildDist()
}
