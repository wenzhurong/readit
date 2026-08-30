import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const PINNED_TAURI_ACTION = 'tauri-apps/tauri-action@1deb371b0cd8bd54025b384f1cd735e725c4060f'

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

function between(workflow: string, startMarker: string, endMarker: string): string {
  const start = workflow.indexOf(startMarker)
  const end = workflow.indexOf(endMarker, Math.max(start, 0))
  return start < 0 || end <= start ? '' : workflow.slice(start, end)
}

interface WorkflowStep {
  readonly env?: Record<string, unknown>
  readonly id?: string
  readonly name?: string
  readonly run?: string
  readonly shell?: string
  readonly uses?: string
  readonly with?: Record<string, unknown>
}

interface WorkflowJob {
  readonly name?: string
  readonly needs?: string | string[]
  readonly permissions?: Record<string, unknown>
  readonly 'runs-on'?: string
  readonly steps?: WorkflowStep[]
}

interface WorkflowDocument {
  jobs?: Record<string, WorkflowJob>
}

function actionReferences(workflow: string, jobName?: string): string[] {
  const jobs = (load(workflow) as WorkflowDocument).jobs ?? {}
  const selectedJobs = jobName === undefined ? Object.values(jobs) : [jobs[jobName]]

  return selectedJobs.flatMap((job) =>
    (job?.steps ?? []).flatMap((step) => {
      if (typeof step !== 'object' || step === null || !('uses' in step)) return []
      const reference = (step as { uses?: unknown }).uses
      return typeof reference === 'string' ? [reference] : []
    }),
  )
}

describe('release draft verifier workflow wiring', () => {
  const workflow = read('.github/workflows/release-desktop.yml')
  const workflowDocument = load(workflow) as WorkflowDocument
  const preflightJob = between(workflow, '\n  preflight:', '\n  prepare-draft:')
  const prepareJob = between(workflow, '\n  prepare-draft:', '\n  publish:')
  const publishJob = between(workflow, '\n  publish:', '\n  finalize-draft:')
  const finalizeJob = between(workflow, '\n  finalize-draft:', '\n  verify-draft:')
  const verifyStart = workflow.indexOf('\n  verify-draft:')
  const verifyJob = verifyStart < 0 ? '' : workflow.slice(verifyStart)
  const verifyJobDocument = workflowDocument.jobs?.['verify-draft']
  const rustUpdaterTest = read('shell/src-tauri/src/updater.rs')

  it('serializes every desktop release run instead of allowing mixed draft assets', () => {
    expect(workflow).toMatch(
      /\nconcurrency:\n  group: release-desktop-\$\{\{ github\.repository \}\}\n  cancel-in-progress: false\n/,
    )
  })

  it('checks main and version synchronization before any release write job', () => {
    expect(preflightJob).not.toBe('')
    expect(preflightJob).toContain("$GITHUB_REF\" != 'refs/heads/main'")
    expect(preflightJob).toContain('npm test -- shell/test/version-sync.test.ts')
    expect(preflightJob).toContain('persist-credentials: false')
    expect(prepareJob).toMatch(/\n    needs: preflight\n/)
  })

  it('resolves one draft ID without retargeting an existing draft before the builds', () => {
    expect(prepareJob).not.toBe('')
    expect(prepareJob).toMatch(/\n    permissions:\n      contents: write\n/)
    expect(prepareJob).toContain('release_id: ${{ steps.release.outputs.result }}')
    expect(prepareJob).toContain('github.rest.git.getRef')
    expect(prepareJob).toContain('github.paginate(github.rest.repos.listReleases')
    expect(prepareJob).toContain('release.name === releaseName || release.tag_name === tag')
    expect(prepareJob).toContain('github.rest.repos.createRelease')
    expect(prepareJob).not.toContain('github.rest.repos.updateRelease')
    expect(prepareJob).toContain('release = candidates[0]')
    expect(prepareJob).toContain('return String(release.id)')
    expect(prepareJob).not.toContain('continue-on-error')
  })

  it('passes the prepared immutable release ID to every serialized matrix publisher', () => {
    expect(publishJob).not.toBe('')
    expect(publishJob).toMatch(/\n    needs: prepare-draft\n/)
    expect(publishJob).toContain('max-parallel: 1')
    expect(publishJob).toContain('releaseId: ${{ needs.prepare-draft.outputs.release_id }}')
    expect(
      actionReferences(workflow).filter((reference) =>
        reference.toLowerCase().startsWith('tauri-apps/tauri-action@'),
      ),
    ).toEqual([PINNED_TAURI_ACTION])
    expect(actionReferences(workflow, 'publish')).toContain(PINNED_TAURI_ACTION)
    expect(publishJob).toContain('persist-credentials: false')
  })

  it('keeps the Rust workflow contract on the same pinned release action', () => {
    expect(rustUpdaterTest).toContain(`"${PINNED_TAURI_ACTION}"`)
    expect(rustUpdaterTest).toContain('("pinned official release action", PINNED_TAURI_ACTION)')
    expect(rustUpdaterTest).toContain('workflow_action_references(workflow)')
    expect(rustUpdaterTest).toContain('.to_ascii_lowercase()')
    expect(rustUpdaterTest).toContain('match release_actions.as_slice()')
    expect(rustUpdaterTest).toContain('if *reference == PINNED_TAURI_ACTION')
    expect(rustUpdaterTest).toContain('build_line < action_line')
    expect(rustUpdaterTest).toContain('!workflow.contains("uses: tauri-apps/tauri-action@v1")')
  })

  it('retargets only after publish and smoke succeed, with exact uploaded nonempty assets', () => {
    expect(finalizeJob).not.toBe('')
    expect(finalizeJob).toContain('needs: [prepare-draft, publish]')
    expect(finalizeJob).toMatch(/\n    permissions:\n      contents: write\n/)
    expect(finalizeJob).toContain('github.rest.repos.getRelease')
    expect(finalizeJob).toContain('verifier.expectedAssetNames(version)')
    expect(finalizeJob).toContain("asset.state !== 'uploaded'")
    expect(finalizeJob).toContain('asset.size <= 0')
    expect(finalizeJob).toContain('github.rest.repos.updateRelease')
    expect(finalizeJob).toContain('tag_name: tag')
    expect(finalizeJob).toContain('target_commitish: context.sha')
    expect(finalizeJob).not.toContain('continue-on-error')
  })

  it('gives the GET-only verifier draft visibility for the same release ID and workflow SHA', () => {
    expect(verifyJob).not.toBe('')
    expect(verifyJobDocument).toEqual({
      name: 'Verify release draft',
      needs: ['prepare-draft', 'finalize-draft'],
      'runs-on': 'ubuntu-latest',
      permissions: { contents: 'write' },
      steps: [
        {
          uses: 'actions/checkout@v7',
          with: { 'persist-credentials': false },
        },
        {
          uses: 'actions/setup-node@v6',
          with: { 'node-version': '22.20.0' },
        },
        {
          name: 'Read desktop version',
          id: 'desktop_version',
          shell: 'bash',
          run: [
            'version=$(node -p "JSON.parse(require(\'fs\').readFileSync(\'shell/src-tauri/tauri.conf.json\', \'utf8\')).version")',
            'echo "value=$version" >> "$GITHUB_OUTPUT"',
            '',
          ].join('\n'),
        },
        {
          name: 'Verify draft metadata, assets, and updater manifest',
          env: { GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}' },
          run: [
            'node .github/scripts/verify-release-draft.mjs',
            '--release-id "${{ needs.prepare-draft.outputs.release_id }}"',
            '--version "${{ steps.desktop_version.outputs.value }}"',
            '--target-sha "${{ github.sha }}"',
          ].join(' '),
        },
      ],
    })
  })

  it('verifies by exact release ID, rejects a live tag ref, and downloads detached signatures', () => {
    const verifier = read('.github/scripts/verify-release-draft.mjs')
    expect(verifier).toContain('`${repositoryUrl}/releases/${releaseId}`')
    expect(verifier).toContain('`${repositoryUrl}/git/ref/tags/${encodeURIComponent(tag)}`')
    expect(verifier).toContain('expectedSignatureAssetNames(version)')
    expect(verifier).toContain('signature does not match release asset')
    expect(verifier).not.toContain('/releases/tags/')
    expect(verifier).not.toContain('/releases?per_page=')
  })
})
