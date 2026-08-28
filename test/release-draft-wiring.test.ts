import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

function between(workflow: string, startMarker: string, endMarker: string): string {
  const start = workflow.indexOf(startMarker)
  const end = workflow.indexOf(endMarker, Math.max(start, 0))
  return start < 0 || end <= start ? '' : workflow.slice(start, end)
}

describe('release draft verifier workflow wiring', () => {
  const workflow = read('.github/workflows/release-desktop.yml')
  const preflightJob = between(workflow, '\n  preflight:', '\n  prepare-draft:')
  const prepareJob = between(workflow, '\n  prepare-draft:', '\n  publish:')
  const publishJob = between(workflow, '\n  publish:', '\n  finalize-draft:')
  const finalizeJob = between(workflow, '\n  finalize-draft:', '\n  verify-draft:')
  const verifyStart = workflow.indexOf('\n  verify-draft:')
  const verifyJob = verifyStart < 0 ? '' : workflow.slice(verifyStart)

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
    expect(publishJob).toContain(
      'tauri-apps/tauri-action@1deb371b0cd8bd54025b384f1cd735e725c4060f',
    )
    expect(publishJob).toContain('persist-credentials: false')
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

  it('runs the verifier as a blocking read-only job for the same release ID and workflow SHA', () => {
    expect(verifyJob).not.toBe('')
    expect(verifyJob).toContain('needs: [prepare-draft, finalize-draft]')
    expect(verifyJob).toMatch(/\n    permissions:\n      contents: read\n/)
    expect(verifyJob).toContain('node .github/scripts/verify-release-draft.mjs')
    expect(verifyJob).toContain('--release-id "${{ needs.prepare-draft.outputs.release_id }}"')
    expect(verifyJob).toContain('--version "${{ steps.desktop_version.outputs.value }}"')
    expect(verifyJob).toContain('--target-sha "${{ github.sha }}"')
    expect(verifyJob).toContain('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}')
    expect(verifyJob).toContain('persist-credentials: false')
    expect(verifyJob).not.toContain('continue-on-error')
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
