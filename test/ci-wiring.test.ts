import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * `npm run typecheck` existed at the root and in both packages from the start, and ran in CI
 * nowhere — so `strict`, `noUncheckedIndexedAccess` and `verbatimModuleSyntax`, which a great deal
 * of this codebase's defensive guarding exists only to satisfy, were enforced by nothing automatic.
 * `npm test` cannot cover for that: vitest transpiles TypeScript without type-checking it.
 *
 * These assertions pin the wiring itself, the same way `offline-gate.test.ts` pins the no-egress
 * job, so that deleting the job or narrowing the config is a visible act rather than a silent one.
 */
const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

describe('typecheck is wired into CI', () => {
  const workflow = read('.github/workflows/test.yml')

  it('has a typecheck job in the test workflow that runs npm run typecheck', () => {
    expect(workflow).toMatch(/^ {2}typecheck:$/m)
    expect(workflow).toContain('- run: npm run typecheck')
  })

  it('runs typecheck once rather than across the three-OS matrix', () => {
    expect(workflow.match(/- run: npm run typecheck/g)).toHaveLength(1)
    // The job that carries it is the single-runner one, not the matrix job.
    const typecheckJob = workflow.slice(workflow.indexOf('\n  typecheck:'), workflow.indexOf('\n  unit:'))
    expect(typecheckJob).toContain('runs-on: ubuntu-latest')
    expect(typecheckJob).not.toContain('matrix')
  })

  it('is a peer gate, not a prerequisite, so a type error cannot hide a test failure', () => {
    expect(workflow).not.toMatch(/needs:\s*\[?\s*typecheck/)
  })

  /**
   * The assertion above stops the job from being made a PREREQUISITE. It does nothing about the
   * cheaper way to neuter it: `continue-on-error: true` leaves the job present, named and green
   * in the checks list while its failures stop blocking anything — so every other assertion in
   * this file would still pass over a typecheck that had been quietly made advisory.
   *
   * Asserted across the whole workflow rather than just the typecheck job, and as a bare
   * substring rather than a `: true` match, because it is equally fatal on `unit` and equally
   * effective on a single step. There is no legitimate use of it in this file: both jobs exist
   * to block a merge, which is precisely what the key switches off.
   */
  it('has no continue-on-error anywhere, on either job or any step', () => {
    expect(
      workflow,
      'continue-on-error makes a job advisory: still listed, still green, no longer blocking. ' +
        'If a job here should not gate a merge, delete it and say why — do not leave a check ' +
        'that looks like a gate and is not.',
    ).not.toContain('continue-on-error')
  })
})

describe('typecheck actually covers the whole repo', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

  it('the root script checks the root tsconfig, browser/ AND both workspaces', () => {
    // Workspace delegation alone left test/, tools/ and vitest.config.ts checked by nothing —
    // the offline gate itself did not even compile until the root tsconfig was added.
    // browser/ is a fourth island: not a workspace, and it needs the DOM lib, so it carries its
    // own tsconfig and its own invocation. Without this line nothing would check it either.
    expect(pkg.scripts.typecheck).toBe(
      'tsc --noEmit && tsc -p browser --noEmit && npm run typecheck --workspaces --if-present',
    )
  })

  it('keeps the DOM lib inside browser/tsconfig.json and out of the root one', () => {
    // Phase A purity is a type-level claim too: if the root `lib` gained "DOM", a stray
    // `document.` in test/ or tools/ would compile clean.
    const rootCfg = JSON.parse(read('tsconfig.json')) as { compilerOptions: { lib: string[] } }
    const browserCfg = JSON.parse(read('browser/tsconfig.json')) as { compilerOptions: { lib: string[] } }
    expect(rootCfg.compilerOptions.lib).toEqual(['ES2023'])
    expect(browserCfg.compilerOptions.lib).toContain('DOM')
  })

  it('the root tsconfig includes the root TypeScript that belongs to no workspace', () => {
    const tsconfig = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: Record<string, unknown>
      include: string[]
    }
    expect(tsconfig.include).toContain('test/**/*.ts')
    expect(tsconfig.include).toContain('tools/**/*.ts')
  })

  // 名单从磁盘读，不手写。手写的那份在计划二加进三个工作区包时会静默继续通过 ——
  // 三个新包一个都不检查，而测试名还写着 "everywhere"。
  const packageTsconfigs = readdirSync(new URL('../packages', import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}/tsconfig.json`)
    .sort()

  it('sees every workspace under packages/', () => {
    expect(packageTsconfigs.length).toBeGreaterThanOrEqual(5)
  })

  it.each(['strict', 'noUncheckedIndexedAccess', 'verbatimModuleSyntax'])(
    'enables %s everywhere, root and every package alike',
    (flag) => {
      for (const path of ['tsconfig.json', ...packageTsconfigs]) {
        const cfg = JSON.parse(read(path)) as { compilerOptions: Record<string, unknown> }
        expect(cfg.compilerOptions[flag], `${path} · ${flag}`).toBe(true)
      }
    },
  )
})
