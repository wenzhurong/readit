import { describe, expect, it, vi } from 'vitest'

// The production entry point must stay directly executable by Node in Actions, so it is .mjs.
// @ts-expect-error The verifier is plain JavaScript and intentionally has no generated declaration file.
import { EXPECTED_PLATFORM_KEYS, expectedAssetNames, expectedSignatureAssetNames, validateReleaseDraft, verifyRemoteReleaseDraft } from '../.github/scripts/verify-release-draft.mjs'

const VERSION = '1.2.3'
const RELEASE_ID = '42'
const TARGET_SHA = 'a'.repeat(40)
const REPOSITORY = 'wenzhurong/readit'
const API_ROOT = 'https://api.github.test'
const REPOSITORY_API = `${API_ROOT}/repos/${REPOSITORY}`

interface ReleaseAsset {
  readonly name: string
  readonly url: string
  readonly browser_download_url: string
  state: string
  size: number
}

const PLATFORM_ASSET: Record<string, string> = {
  'darwin-aarch64': `readit_${VERSION}_aarch64.app.tar.gz`,
  'darwin-aarch64-app': `readit_${VERSION}_aarch64.app.tar.gz`,
  'darwin-x86_64': `readit_${VERSION}_x64.app.tar.gz`,
  'darwin-x86_64-app': `readit_${VERSION}_x64.app.tar.gz`,
  'windows-x86_64': `readit_${VERSION}_x64-setup.exe`,
  'windows-x86_64-nsis': `readit_${VERSION}_x64-setup.exe`,
}

function fixture() {
  const assets: ReleaseAsset[] = (expectedAssetNames(VERSION) as string[]).map((name, index) => ({
    name,
    url: `${REPOSITORY_API}/releases/assets/${index + 1}`,
    browser_download_url: `https://github.test/${REPOSITORY}/releases/download/readit-v${VERSION}/${name}`,
    state: 'uploaded',
    size: index + 1,
  }))
  const assetsByName = new Map<string, ReleaseAsset>(assets.map((asset) => [asset.name, asset]))
  const signatureFiles = Object.fromEntries(
    (expectedSignatureAssetNames(VERSION) as string[]).map((name) => [name, `signature-file:${name}`]),
  )
  const platforms = Object.fromEntries(
    EXPECTED_PLATFORM_KEYS.map((platform: string) => {
      const updaterAsset = PLATFORM_ASSET[platform]!
      return [
        platform,
        {
          signature: signatureFiles[`${updaterAsset}.sig`],
          url: assetsByName.get(updaterAsset)!.url,
        },
      ]
    }),
  )
  return {
    release: {
      id: Number(RELEASE_ID),
      draft: true,
      prerelease: false,
      tag_name: `readit-v${VERSION}`,
      name: `readit v${VERSION}`,
      target_commitish: TARGET_SHA,
      assets,
    },
    manifest: { version: VERSION, platforms },
    signatureFiles,
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function verificationOptions(fetchImpl: typeof fetch) {
  return {
    releaseId: RELEASE_ID,
    version: VERSION,
    targetSha: TARGET_SHA,
    repository: REPOSITORY,
    token: 'test-token',
    apiUrl: API_ROOT,
    fetchImpl,
  }
}

function remoteFixture(overrides: { existingTag?: boolean; wrongSignature?: boolean } = {}) {
  const data = fixture()
  const releaseUrl = `${REPOSITORY_API}/releases/${RELEASE_ID}`
  const tagRefUrl = `${REPOSITORY_API}/git/ref/tags/readit-v${VERSION}`
  const latestAsset = data.release.assets.find((asset) => asset.name === 'latest.json')!
  const signatureNameByUrl = new Map(
    data.release.assets
      .filter((asset) => asset.name.endsWith('.sig'))
      .map((asset) => [asset.url, asset.name]),
  )
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init)
    expect(request.method).toBe('GET')
    expect(request.body).toBeNull()

    const url = request.url
    if (url === releaseUrl) return jsonResponse(data.release)
    if (url === tagRefUrl) {
      return overrides.existingTag
        ? jsonResponse({ ref: `refs/tags/readit-v${VERSION}`, object: { sha: TARGET_SHA } })
        : new Response('not found', { status: 404, statusText: 'Not Found' })
    }
    if (url === latestAsset.url) return jsonResponse(data.manifest)
    const signatureName = signatureNameByUrl.get(url)
    if (signatureName !== undefined) {
      const value = overrides.wrongSignature && signatureName.includes('x64.app')
        ? 'wrong-signature'
        : data.signatureFiles[signatureName]!
      return new Response(`${value}\n`, { status: 200 })
    }
    return new Response('unexpected URL', { status: 500 })
  })
  return { ...data, fetchImpl, releaseUrl, tagRefUrl, latestAsset, signatureNameByUrl }
}

describe('release draft contract', () => {
  it('accepts one draft with the exact assets, platforms, URLs, and signature file contents', () => {
    const { release, manifest, signatureFiles } = fixture()
    expect(() => validateReleaseDraft({
      release,
      manifest,
      signatureFiles,
      version: VERSION,
      targetSha: TARGET_SHA,
    })).not.toThrow()
    expect(expectedAssetNames(VERSION)).toHaveLength(9)
    expect(expectedSignatureAssetNames(VERSION)).toHaveLength(3)
    expect(EXPECTED_PLATFORM_KEYS).toHaveLength(6)
  })

  it('rejects release asset, manifest, URL, and detached-signature drift', () => {
    const { release, manifest, signatureFiles } = fixture()
    release.assets.push({
      name: 'unexpected.zip',
      url: `${REPOSITORY_API}/releases/assets/99`,
      browser_download_url: 'https://github.test/unexpected.zip',
      state: 'uploaded',
      size: 99,
    })
    manifest.version = '9.9.9'
    manifest.platforms['darwin-aarch64'].signature = '   '
    manifest.platforms['windows-x86_64'].url = release.assets.find(
      (asset: { name: string }) => asset.name.includes('aarch64.app.tar.gz'),
    )!.url
    delete manifest.platforms['darwin-x86_64-app']
    manifest.platforms['unexpected-platform'] = { signature: 'x', url: 'https://example.test/wrong' }
    signatureFiles[`readit_${VERSION}_x64.app.tar.gz.sig`] = 'different-file-signature'
    release.assets[0]!.state = 'new'
    release.assets[1]!.size = 0

    expect(() => validateReleaseDraft({
      release,
      manifest,
      signatureFiles,
      version: VERSION,
      targetSha: TARGET_SHA,
    })).toThrow(
      /assets differ[\s\S]*not in the uploaded state[\s\S]*invalid size[\s\S]*version[\s\S]*platform keys differ[\s\S]*empty signature[\s\S]*does not match[\s\S]*same-draft asset/,
    )
  })

  it('rejects draft tag, name, target, and object-shape drift', () => {
    const { release, manifest, signatureFiles } = fixture()
    release.draft = false
    release.prerelease = true
    release.tag_name = 'readit-v9.9.9'
    release.name = 'wrong release'
    release.target_commitish = 'b'.repeat(40)
    manifest.platforms['darwin-aarch64-app'] = null as never

    expect(() => validateReleaseDraft({
      release,
      manifest,
      signatureFiles,
      version: VERSION,
      targetSha: TARGET_SHA,
    })).toThrow(
      /not a draft[\s\S]*prerelease[\s\S]*release tag[\s\S]*release name[\s\S]*release target[\s\S]*not an object/,
    )
  })
})

describe('authenticated release-id verification', () => {
  it('binds to the prepared release ID and downloads latest.json plus all three .sig assets', async () => {
    const remote = remoteFixture()
    const result = await verifyRemoteReleaseDraft(
      verificationOptions(remote.fetchImpl as typeof fetch),
    )
    expect(result).toMatchObject({
      release: { id: Number(RELEASE_ID) },
      manifest: { version: VERSION },
    })
    for (const [name, signature] of Object.entries(remote.signatureFiles)) {
      expect(result.signatureFiles[name].trim()).toBe(signature)
    }

    const urls = remote.fetchImpl.mock.calls.map(([input]) => String(input))
    expect(urls).toContain(remote.releaseUrl)
    expect(urls).toContain(remote.tagRefUrl)
    expect(urls).toContain(remote.latestAsset.url)
    for (const assetUrl of remote.signatureNameByUrl.keys()) expect(urls).toContain(assetUrl)
    expect(urls.some((url) => url.includes('/releases?'))).toBe(false)
    expect(urls.some((url) => url.includes('/releases/tags/'))).toBe(false)
  })

  it('rejects an existing Git tag before trusting draft assets', async () => {
    const remote = remoteFixture({ existingTag: true })
    await expect(
      verifyRemoteReleaseDraft(verificationOptions(remote.fetchImpl as typeof fetch)),
    ).rejects.toThrow(`Git tag readit-v${VERSION} already exists`)
    expect(remote.fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('rejects a detached signature whose content differs from latest.json', async () => {
    const remote = remoteFixture({ wrongSignature: true })
    await expect(
      verifyRemoteReleaseDraft(verificationOptions(remote.fetchImpl as typeof fetch)),
    ).rejects.toThrow(/signature does not match release asset readit_1\.2\.3_x64\.app\.tar\.gz\.sig/)
  })
})
