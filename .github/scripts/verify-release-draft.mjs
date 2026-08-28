import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const PLATFORM_ASSET = Object.freeze({
  'darwin-aarch64': (version) => `readit_${version}_aarch64.app.tar.gz`,
  'darwin-aarch64-app': (version) => `readit_${version}_aarch64.app.tar.gz`,
  'darwin-x86_64': (version) => `readit_${version}_x64.app.tar.gz`,
  'darwin-x86_64-app': (version) => `readit_${version}_x64.app.tar.gz`,
  'windows-x86_64': (version) => `readit_${version}_x64-setup.exe`,
  'windows-x86_64-nsis': (version) => `readit_${version}_x64-setup.exe`,
})

export const EXPECTED_PLATFORM_KEYS = Object.freeze(Object.keys(PLATFORM_ASSET))

export function expectedAssetNames(version) {
  return [
    'latest.json',
    `readit_${version}_aarch64.app.tar.gz`,
    `readit_${version}_aarch64.app.tar.gz.sig`,
    `readit_${version}_aarch64.dmg`,
    `readit_${version}_x64.app.tar.gz`,
    `readit_${version}_x64.app.tar.gz.sig`,
    `readit_${version}_x64.dmg`,
    `readit_${version}_x64-setup.exe`,
    `readit_${version}_x64-setup.exe.sig`,
  ]
}

export function expectedSignatureAssetNames(version) {
  return sorted(
    new Set(EXPECTED_PLATFORM_KEYS.map((platform) => `${PLATFORM_ASSET[platform](version)}.sig`)),
  )
}

function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function sameStrings(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

function assetUrls(asset) {
  return new Set(
    [asset?.url, asset?.browser_download_url]
      .filter((value) => typeof value === 'string' && value.length > 0),
  )
}

export function validateReleaseDraft({ release, manifest, signatureFiles, version, targetSha }) {
  const errors = []
  const expectedTag = `readit-v${version}`
  const expectedName = `readit v${version}`

  if (release?.draft !== true) errors.push('release is not a draft')
  if (release?.prerelease !== false) errors.push('release is unexpectedly marked as a prerelease')
  if (release?.tag_name !== expectedTag) {
    errors.push(`release tag is ${JSON.stringify(release?.tag_name)}, expected ${JSON.stringify(expectedTag)}`)
  }
  if (release?.name !== expectedName) {
    errors.push(`release name is ${JSON.stringify(release?.name)}, expected ${JSON.stringify(expectedName)}`)
  }
  if (release?.target_commitish !== targetSha) {
    errors.push(
      `release target is ${JSON.stringify(release?.target_commitish)}, expected ${JSON.stringify(targetSha)}`,
    )
  }

  const assets = Array.isArray(release?.assets) ? release.assets : []
  const actualNames = sorted(assets.map((asset) => asset?.name).filter((name) => typeof name === 'string'))
  const expectedNames = sorted(expectedAssetNames(version))
  if (!sameStrings(actualNames, expectedNames)) {
    errors.push(
      `release assets differ:\n  actual:   ${JSON.stringify(actualNames)}\n  expected: ${JSON.stringify(expectedNames)}`,
    )
  }
  for (const asset of assets) {
    if (asset?.state !== 'uploaded') {
      errors.push(`release asset ${JSON.stringify(asset?.name)} is not in the uploaded state`)
    }
    if (!Number.isSafeInteger(asset?.size) || asset.size <= 0) {
      errors.push(`release asset ${JSON.stringify(asset?.name)} has invalid size ${JSON.stringify(asset?.size)}`)
    }
  }

  if (manifest?.version !== version) {
    errors.push(`latest.json version is ${JSON.stringify(manifest?.version)}, expected ${JSON.stringify(version)}`)
  }
  const platforms = asObject(manifest?.platforms)
  const actualPlatformKeys = platforms === null ? [] : sorted(Object.keys(platforms))
  const expectedPlatformKeys = sorted(EXPECTED_PLATFORM_KEYS)
  if (!sameStrings(actualPlatformKeys, expectedPlatformKeys)) {
    errors.push(
      `latest.json platform keys differ:\n  actual:   ${JSON.stringify(actualPlatformKeys)}\n  expected: ${JSON.stringify(expectedPlatformKeys)}`,
    )
  }

  const assetsByName = new Map(assets.map((asset) => [asset?.name, asset]))
  for (const platform of EXPECTED_PLATFORM_KEYS) {
    const entry = asObject(platforms?.[platform])
    if (entry === null) {
      errors.push(`latest.json platform ${platform} is not an object`)
      continue
    }
    if (typeof entry.signature !== 'string' || entry.signature.trim().length === 0) {
      errors.push(`latest.json platform ${platform} has an empty signature`)
    }

    const expectedAssetName = PLATFORM_ASSET[platform](version)
    const signatureAssetName = `${expectedAssetName}.sig`
    const signatureFile = asObject(signatureFiles) === null ? undefined : signatureFiles[signatureAssetName]
    if (typeof signatureFile !== 'string' || signatureFile.trim().length === 0) {
      errors.push(`release signature asset ${signatureAssetName} is empty or was not downloaded`)
    } else if (typeof entry.signature === 'string' && entry.signature.trim() !== signatureFile.trim()) {
      errors.push(
        `latest.json platform ${platform} signature does not match release asset ${signatureAssetName}`,
      )
    }

    const expectedAsset = assetsByName.get(expectedAssetName)
    if (expectedAsset === undefined) {
      errors.push(`cannot validate ${platform} URL because release asset ${expectedAssetName} is missing`)
      continue
    }
    const allowedUrls = assetUrls(expectedAsset)
    if (typeof entry.url !== 'string' || !allowedUrls.has(entry.url)) {
      errors.push(
        `latest.json platform ${platform} URL is ${JSON.stringify(entry.url)}, ` +
          `expected the same-draft asset ${expectedAssetName} (${JSON.stringify([...allowedUrls])})`,
      )
    }
  }

  if (errors.length > 0) {
    throw new Error(`Release draft verification failed:\n- ${errors.join('\n- ')}`)
  }
}

function requestHeaders(token, accept) {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    'User-Agent': 'readit-release-draft-verifier',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

async function checkedFetch(fetchImpl, url, options) {
  const response = await fetchImpl(url, options)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `GitHub request failed (${response.status} ${response.statusText}) for ${url}` +
        (detail.length > 0 ? `: ${detail}` : ''),
    )
  }
  return response
}

export async function verifyRemoteReleaseDraft({
  releaseId,
  version,
  targetSha,
  repository,
  token,
  apiUrl = 'https://api.github.com',
  fetchImpl = globalThis.fetch,
}) {
  const [owner, name, ...extra] = repository.split('/')
  if (!owner || !name || extra.length > 0) throw new Error('repository must have the form owner/name')
  if (typeof fetchImpl !== 'function') throw new Error('this Node.js runtime does not provide fetch')

  const tag = `readit-v${version}`
  const repositoryUrl =
    `${apiUrl.replace(/\/$/, '')}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  const metadataHeaders = requestHeaders(token, 'application/vnd.github+json')
  const releaseResponse = await checkedFetch(fetchImpl, `${repositoryUrl}/releases/${releaseId}`, {
    headers: metadataHeaders,
  })
  const release = await releaseResponse.json()

  const tagRefUrl = `${repositoryUrl}/git/ref/tags/${encodeURIComponent(tag)}`
  const tagRefResponse = await fetchImpl(tagRefUrl, { headers: metadataHeaders })
  if (tagRefResponse.ok) {
    throw new Error(`Git tag ${tag} already exists; a draft release must not reuse a published tag`)
  }
  if (tagRefResponse.status !== 404) {
    const detail = await tagRefResponse.text().catch(() => '')
    throw new Error(
      `GitHub request failed (${tagRefResponse.status} ${tagRefResponse.statusText}) for ${tagRefUrl}` +
        (detail.length > 0 ? `: ${detail}` : ''),
    )
  }
  const latestAsset = Array.isArray(release?.assets)
    ? release.assets.find((asset) => asset?.name === 'latest.json')
    : undefined
  if (typeof latestAsset?.url !== 'string' || latestAsset.url.length === 0) {
    throw new Error('draft release has no downloadable latest.json asset')
  }

  const manifestResponse = await checkedFetch(fetchImpl, latestAsset.url, {
    headers: requestHeaders(token, 'application/octet-stream'),
  })
  const manifest = await manifestResponse.json()
  const assetsByName = new Map(release.assets.map((asset) => [asset?.name, asset]))
  const signatureFiles = Object.fromEntries(await Promise.all(
    expectedSignatureAssetNames(version).map(async (assetName) => {
      const asset = assetsByName.get(assetName)
      if (typeof asset?.url !== 'string' || asset.url.length === 0) {
        throw new Error(`draft release has no downloadable ${assetName} asset`)
      }
      const response = await checkedFetch(fetchImpl, asset.url, {
        headers: requestHeaders(token, 'application/octet-stream'),
      })
      return [assetName, await response.text()]
    }),
  ))
  validateReleaseDraft({ release, manifest, signatureFiles, version, targetSha })
  return { release, manifest, signatureFiles }
}

export function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key?.startsWith('--')) throw new Error(`unexpected argument ${JSON.stringify(key)}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${key}`)
    if (values.has(key)) throw new Error(`duplicate argument ${key}`)
    values.set(key, value)
    index += 1
  }

  const version = values.get('--version')
  const targetSha = values.get('--target-sha')
  const releaseId = values.get('--release-id')
  const repository = values.get('--repository') ?? process.env.GITHUB_REPOSITORY
  const token = process.env.GITHUB_TOKEN
  const unknown = [...values.keys()].filter(
    (key) => !['--release-id', '--version', '--target-sha', '--repository'].includes(key),
  )
  if (unknown.length > 0) throw new Error(`unknown argument ${unknown[0]}`)
  if (!releaseId) throw new Error('--release-id is required')
  if (!/^[1-9][0-9]*$/.test(releaseId)) throw new Error('--release-id must be a positive integer')
  if (!version) throw new Error('--version is required')
  if (!targetSha) throw new Error('--target-sha is required')
  if (!/^[0-9a-f]{40}$/i.test(targetSha)) throw new Error('--target-sha must be a full 40-character commit SHA')
  if (!repository) throw new Error('--repository or GITHUB_REPOSITORY is required')
  if (!token) throw new Error('GITHUB_TOKEN is required')
  return { releaseId, version, targetSha, repository, token, apiUrl: process.env.GITHUB_API_URL }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  await verifyRemoteReleaseDraft(options)
  console.log(
    `Verified draft ${options.releaseId} (readit-v${options.version}) at ${options.targetSha}: ` +
      '9 exact assets and 6 signed updater platforms.',
  )
}

const entry = process.argv[1]
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
