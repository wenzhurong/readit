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
    // 开头那个 `npm run build` 不是顺手加的：`shell/` 这个工作区 import 的是**发布外观包**
    // （`readit/element`、`readit/plugins/*`），它们解析到 packages/readit/dist 的 .d.ts，
    // 而 dist 是 gitignored、由构建产生的。少了它，干净 clone 上 tsc 直接报
    // TS2307 Cannot find module 'readit/element'——2026-08-14 CI 上就是这么红的，
    // 而本机因为有残留 dist 一直是绿的。**那是「本地绿只因为脏工作树」的典型**。
    //
    // 让壳消费发布面是刻意的（它是第一个真实消费者，等于给分发面做 dogfood），
    // 所以修法是补构建顺序，不是把壳改成 import 工作区源码。构建实测 ~5s。
    // 根 `build` 必须**委派进 workspace**，不能直接 `vite-node packages/readit/build.ts`。
    //
    // build.ts 里是 `import * as esbuild from 'esbuild'`，而 esbuild 只声明在
    // packages/readit/package.json，根 package.json 没有它。从根启动 vite-node 时
    // 裸说明符按根解析——npm 10 恰好把 esbuild 提升到了根 node_modules 所以能过，
    // **npm 11 不提升就断**：`Cannot find package 'esbuild' imported from …/build.ts`。
    // 2026-08-14 Windows 机器（Node 24.18.0 / npm 11.16.0）实测到这条；本机把根
    // node_modules/esbuild 临时移走后逐字复现，改成委派后在同样条件下 exit 0。
    //
    // 换句话说：原写法隐式依赖包管理器的提升行为。委派进声明了该依赖的 workspace
    // 之后，解析从 packages/readit/ 起步，跟 npm 版本无关。
    // （vitest 的 globalSetup 一直是对的——它走 `import … from '../build.js'`，
    //   import 发生在 packages/readit/test/ 内部，所以 npm test 在 Windows 上一直是绿的。）
    expect(pkg.scripts.build).toBe('npm run build --workspace=readit')

    expect(pkg.scripts.typecheck).toBe(
      'npm run build && tsc --noEmit && tsc -p browser --noEmit && npm run typecheck --workspaces --if-present',
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

describe('Windows long-path and Rust coverage is wired into CI', () => {
  const workflow = read('.github/workflows/test.yml')
  const start = workflow.indexOf('\n  windows-long-path:')
  const end = workflow.indexOf('\n  perf:', start)
  const job = start >= 0 && end > start ? workflow.slice(start, end) : ''
  const rustDocumentSource = read('shell/src-tauri/src/document.rs')

  it('runs as an independent blocking Windows job', () => {
    expect(job).not.toBe('')
    expect(job).toContain('runs-on: windows-latest')
    expect(job).not.toContain('needs:')
    expect(job).not.toContain('continue-on-error')
  })

  it('requires the OS long-path policy instead of changing the registry to make the test pass', () => {
    expect(job).toContain("-Name LongPathsEnabled")
    expect(job).toContain('if ([int]$longPathsEnabled -ne 1)')
    expect(job).not.toMatch(/(?:Set|New)-ItemProperty/)
    expect(job).not.toMatch(/reg(?:\.exe)?\s+add/i)
  })

  it('clones the current checkout deeply with repository-local Git long paths enabled', () => {
    expect(job).toContain('$minimumClonePathLength = 200')
    expect(job).toContain('$targetClonePathLength = 210')
    expect(job).toContain('$clonePath.Length -ne $targetClonePathLength')
    expect(job).toContain('git -c core.longpaths=true clone --no-hardlinks')
    expect(job).toContain('--no-checkout')
    expect(job).toContain('git -C $clonePath config core.longpaths true')
    expect(job).toContain("git -C $clonePath config --bool core.longpaths")
    expect(job).toContain('git -C $clonePath checkout --detach $sourceHead')
    expect(job).toContain('$clonedHead -ne $sourceHead')
    expect(job).toContain('$clonePath.Length -lt $minimumClonePathLength')
    expect(job).toContain('READIT_LONG_PATH_ROOT=$clonePath')
  })

  it('proves that tracked input and generated output really cross MAX_PATH', () => {
    expect(job).toContain('$longCorpusPath.Length -le 260')
    expect(job).toContain('[IO.File]::ReadAllBytes($longCorpusPath)')
    expect(job).toContain('$longestBuildOutput.FullName.Length -le 260')
    expect(job).toContain('[IO.File]::OpenRead($longestBuildOutput.FullName)')
  })

  it('uses a fresh physical Cargo target within RUNNER_TEMP without shortening the source clone', () => {
    expect(job).toContain('$cargoTargetName = "readit-cargo-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"')
    expect(job).toContain('$cargoTargetPath.StartsWith(')
    expect(job).toContain('$cargoTargetPath.Length -ge 160')
    expect(job).toContain('$cargoTargetItem.Attributes -band [IO.FileAttributes]::ReparsePoint')
    expect(job).toContain("$cargoManifestPath = Join-Path $env:READIT_LONG_PATH_ROOT 'shell\\src-tauri\\Cargo.toml'")
    expect(job).toContain('$env:CARGO_TARGET_DIR = $cargoTargetPath')
    expect(job).toContain('$longestCargoOutput.FullName.Length -ge 260')
    expect(job).not.toContain("Join-Path $env:READIT_LONG_PATH_ROOT 'shell\\src-tauri\\target'")
  })

  it('keeps the Windows >260 document-open product test in the blocking Rust path', () => {
    const testName = 'document::tests::opens_an_extended_length_windows_document_path'
    expect(job).toContain(`$longPathTestName = '${testName}'`)
    expect(job).toContain('$escapedLongPathTestName = [regex]::Escape($longPathTestName)')
    expect(job).toContain('$longPathTestMatches = [regex]::Matches(')
    expect(job).toContain('$longPathTestMatches.Count -ne 1')
    expect(rustDocumentSource).toContain('#[cfg(windows)]')
    expect(rustDocumentSource).toContain('fn opens_an_extended_length_windows_document_path()')
    expect(rustDocumentSource).toContain('encode_wide().count() > 260')
    expect(rustDocumentSource).toContain('state.open_document(&document).unwrap()')
  })

  it('keeps dependencies physical and the unified native executable within its spawn budget', () => {
    expect(job).toContain("$expectedNodeModules = Join-Path $env:READIT_LONG_PATH_ROOT 'node_modules'")
    expect(job).toContain('[IO.FileAttributes]::ReparsePoint')
    expect(job).toContain("'node_modules\\@esbuild\\win32-x64\\esbuild.exe'")
    expect(job).toContain('$esbuildExecutablePath.Length -ge 260')
    expect(job).toContain("$esbuildVersion -ne '0.28.2'")
    expect(job).toContain("'packages\\readit\\node_modules\\esbuild'")
    expect(job).toContain("'node_modules\\tsx\\node_modules\\esbuild'")
    expect(job).toContain("'node_modules\\chalk\\package.json'")
    expect(job).toContain("'node_modules\\chalk\\source\\index.js'")
    expect(job).toContain('$rootChalkPackagePath.Length -ge 260')
    expect(job).toContain("$rootChalkVersion -ne '5.6.2'")
    expect(job).toContain("'node_modules\\marked-terminal\\node_modules\\chalk'")
    expect(job).toContain("'node_modules\\@arethetypeswrong\\cli\\node_modules\\chalk\\package.json'")
    expect(job).toContain("$attwChalkVersion -ne '4.1.2'")
    expect(job).not.toContain('--ignore-scripts')
    expect(job).not.toMatch(/\bsubst\b/i)
  })

  it('runs install, unit, build/typecheck, and Rust shell tests from that deep clone', () => {
    expect(job.match(/Set-Location -LiteralPath \$env:READIT_LONG_PATH_ROOT/g)).toHaveLength(4)
    expect(job).toContain('npm ci')
    expect(job).toContain('npm test')
    expect(job).toContain('npm run typecheck')
    expect(job.match(/cargo test --manifest-path \$cargoManifestPath/g)).toHaveLength(2)
  })
})

describe('the Windows long-path dependency graph has one hoisted esbuild binary', () => {
  const root = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> }
  const core = JSON.parse(read('packages/core/package.json')) as { devDependencies: Record<string, string> }
  const highlight = JSON.parse(read('packages/highlight/package.json')) as {
    devDependencies: Record<string, string>
  }
  const readit = JSON.parse(read('packages/readit/package.json')) as { devDependencies: Record<string, string> }
  const lock = JSON.parse(read('package-lock.json')) as {
    packages: Record<string, { version?: string; dependencies?: Record<string, string> }>
  }

  it('aligns direct build tools on the esbuild 0.28 line', () => {
    expect(core.devDependencies.tsx).toBe('4.23.12')
    expect(highlight.devDependencies.tsx).toBe('4.23.12')
    expect(readit.devDependencies.esbuild).toBe('0.28.2')
    expect(lock.packages['node_modules/tsx']?.dependencies?.esbuild).toBe('~0.28.0')
  })

  it('forbids nested esbuild packages that restore the >260-character executable path', () => {
    const esbuildPackages = Object.keys(lock.packages).filter(
      (path) => path === 'node_modules/esbuild' || path.endsWith('/node_modules/esbuild'),
    )
    const windowsBinaryPackages = Object.keys(lock.packages).filter(
      (path) =>
        path === 'node_modules/@esbuild/win32-x64' || path.endsWith('/node_modules/@esbuild/win32-x64'),
    )

    expect(esbuildPackages).toEqual(['node_modules/esbuild'])
    expect(windowsBinaryPackages).toEqual(['node_modules/@esbuild/win32-x64'])
    expect(lock.packages['node_modules/esbuild']?.version).toBe('0.28.2')
    expect(lock.packages['node_modules/@esbuild/win32-x64']?.version).toBe('0.28.2')
  })

  it('hoists Chalk 5 for marked-terminal while preserving ATTW Chalk 4 compatibility', () => {
    expect(root.devDependencies.chalk).toBe('5.6.2')
    expect(lock.packages['node_modules/chalk']?.version).toBe('5.6.2')
    expect(lock.packages['node_modules/marked-terminal']?.dependencies?.chalk).toBe('^5.4.1')
    expect(lock.packages['node_modules/marked-terminal/node_modules/chalk']).toBeUndefined()
    expect(lock.packages['node_modules/@arethetypeswrong/cli/node_modules/chalk']?.version).toBe('4.1.2')
    expect(lock.packages['node_modules/cli-highlight/node_modules/chalk']?.version).toBe('4.1.2')
  })
})

/**
 * The perf assertions were moved out of `npm test` for a good reason (review C2: an absolute
 * wall-clock number is the wrong thing to gate a three-OS matrix on). But the move landed them
 * where nothing ran them at all: `test:perf` existed only in `packages/element/package.json`,
 * was absent from the root, and appeared in no workflow. A sentinel nothing runs is worse than
 * a flaky one — a flaky gate at least gets looked at, whereas this one would have sat there
 * looking like coverage while a 50x highlighter regression sailed past it.
 *
 * That is the same failure this file's `continue-on-error` assertion exists to prevent, arriving
 * by a different door: not a check made advisory, but a check made unreachable. So it is pinned
 * the same way.
 */
describe('the perf sentinel is reachable from the root and runs in CI', () => {
  const workflow = read('.github/workflows/test.yml')
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

  it('has a root test:perf script that delegates to every workspace declaring one', () => {
    expect(
      pkg.scripts['test:perf'],
      'without a root script, `npm run test:perf` fails at the repo root and CI cannot invoke it',
    ).toBe('npm run test:perf --workspaces --if-present')
  })

  it('is declared by the workspace that owns the perf files', () => {
    const element = JSON.parse(read('packages/element/package.json')) as { scripts: Record<string, string> }
    expect(element.scripts['test:perf']).toBeDefined()
  })

  it('has a perf job in the test workflow that runs it', () => {
    expect(workflow).toMatch(/^ {2}perf:$/m)
    expect(workflow).toContain('- run: npm run test:perf')
  })

  it('runs perf once, on one OS — the point of moving it was to leave the three-OS matrix', () => {
    expect(workflow.match(/- run: npm run test:perf/g)).toHaveLength(1)
    const perfJob = workflow.slice(workflow.indexOf('\n  perf:'))
    expect(perfJob).toContain('runs-on: ubuntu-latest')
    expect(perfJob).not.toContain('matrix')
  })

  /**
   * The narrow reason this file cares: default `npm test` must NOT pick the perf files back up.
   * `packages/element/vitest.config.ts` excludes them by matching only `*.test.ts`, which is a
   * property of a glob three files away from here — exactly the kind of thing that gets widened
   * by someone with an unrelated goal.
   */
  it('keeps the perf files out of the default vitest include', () => {
    const cfg = read('packages/element/vitest.config.ts')
    expect(cfg).toContain("include: ['test/**/*.test.ts']")
  })
})
