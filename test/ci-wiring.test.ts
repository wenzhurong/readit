import { readFileSync } from 'node:fs'
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
})

describe('typecheck actually covers the whole repo', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

  it('the root script checks the root tsconfig AND both workspaces', () => {
    // Workspace delegation alone left test/, tools/ and vitest.config.ts checked by nothing —
    // the offline gate itself did not even compile until the root tsconfig was added.
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit && npm run typecheck --workspaces --if-present')
  })

  it('the root tsconfig includes the root TypeScript that belongs to no workspace', () => {
    const tsconfig = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: Record<string, unknown>
      include: string[]
    }
    expect(tsconfig.include).toContain('test/**/*.ts')
    expect(tsconfig.include).toContain('tools/**/*.ts')
  })

  it.each(['strict', 'noUncheckedIndexedAccess', 'verbatimModuleSyntax'])(
    'enables %s everywhere, root and both packages alike',
    (flag) => {
      for (const path of ['tsconfig.json', 'packages/core/tsconfig.json', 'packages/math/tsconfig.json']) {
        const cfg = JSON.parse(read(path)) as { compilerOptions: Record<string, unknown> }
        expect(cfg.compilerOptions[flag], `${path} · ${flag}`).toBe(true)
      }
    },
  )
})
