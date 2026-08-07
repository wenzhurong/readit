import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OracleError,
  assertOracleResponse,
  dirOf,
  fetchOracle,
  main,
  oracleUrl,
  readManifest,
  refreshAll,
  type FetchLike,
  type OracleTarget,
} from '../scripts/oracle-refresh.js'

const TARGET: OracleTarget = {
  name: 'real-world/hello-world',
  repo: 'octocat/Hello-World',
  ref: '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d',
  path: 'README',
}

/** Verbatim shape of the 403 secondary-rate-limit body — the thing that must never be committed. */
const RATE_LIMIT_BODY = JSON.stringify({
  message: "API rate limit exceeded for 203.0.113.7. (But here's the good news: Authenticated requests get a higher rate limit. Check out the documentation for more details.)",
  documentation_url: 'https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting',
})

function fakeFetch(status: number, contentType: string | null, body: string): FetchLike {
  return async () => ({
    status,
    headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => body,
  })
}

const GOOD_BODY = '<div id="file" class="" data-path="README"><div class="plain"><pre>Hello World!\n</pre></div></div>'

describe('oracle-refresh', () => {
  it('builds the pinned contents URL with the html media type ref', () => {
    expect(oracleUrl(TARGET)).toBe(
      'https://api.github.com/repos/octocat/Hello-World/contents/README?ref=7fd1a60b01f91b314f59955a4e4d4e80d8edf11d',
    )
  })

  it('refuses a branch ref because it is not reproducible', () => {
    expect(() => oracleUrl({ ...TARGET, ref: 'main' })).toThrow(/full 40-char commit SHA, got "main"/)
  })

  it('percent-encodes path segments', () => {
    expect(oracleUrl({ ...TARGET, path: 'docs/a b/c#d.md' })).toContain('/contents/docs/a%20b/c%23d.md?ref=')
  })

  it('dirOf returns the containing directory or empty string at the repo root', () => {
    expect(dirOf('README.md')).toBe('')
    expect(dirOf('content/get-started/x.md')).toBe('content/get-started')
  })

  it('accepts a real 200 + application/vnd.github.html response', () => {
    expect(() => assertOracleResponse(TARGET, 200, 'application/vnd.github.html; charset=utf-8', GOOD_BODY)).not.toThrow()
  })

  it('rejects a 403 rate-limit JSON body before it can become a fixture', () => {
    expect(() => assertOracleResponse(TARGET, 403, 'application/json; charset=utf-8', RATE_LIMIT_BODY)).toThrow(OracleError)
    expect(() => assertOracleResponse(TARGET, 403, 'application/json; charset=utf-8', RATE_LIMIT_BODY)).toThrow(
      /expected HTTP 200, got 403/,
    )
  })

  it('rejects a 200 that came back as JSON because the Accept header was dropped', () => {
    expect(() => assertOracleResponse(TARGET, 200, 'application/json; charset=utf-8', '{"content":"SGk="}')).toThrow(
      /expected Content-Type application\/vnd\.github\.html, got "application\/json; charset=utf-8"/,
    )
  })

  it('rejects a 200 html response that is not the file shell', () => {
    expect(() => assertOracleResponse(TARGET, 200, 'application/vnd.github.html', '<html><body>maintenance</body></html>')).toThrow(
      /does not start with the <div id="file\|readme"> shell/,
    )
  })

  it('fetchOracle sends the media type, the bearer token and the api version', async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null
    const spy: FetchLike = async (url, init) => {
      seen = { url, headers: init.headers }
      return { status: 200, headers: { get: () => 'application/vnd.github.html; charset=utf-8' }, text: async () => GOOD_BODY }
    }
    await expect(fetchOracle(TARGET, 'tok', spy)).resolves.toBe(GOOD_BODY)
    expect(seen!.headers.Accept).toBe('application/vnd.github.html')
    expect(seen!.headers.Authorization).toBe('Bearer tok')
    expect(seen!.headers['X-GitHub-Api-Version']).toBe('2022-11-28')
  })

  it('fetchOracle requests the pinned ref, not the unpinned path', async () => {
    let seenUrl = ''
    const spy: FetchLike = async (url) => {
      seenUrl = url
      return { status: 200, headers: { get: () => 'application/vnd.github.html; charset=utf-8' }, text: async () => GOOD_BODY }
    }
    await fetchOracle(TARGET, 'tok', spy)
    expect(seenUrl).toContain(`?ref=${TARGET.ref}`)
  })

  it('refreshAll writes one fixture per target plus a timestamp-free provenance file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oracle-'))
    const written = await refreshAll([TARGET], 'tok', dir, fakeFetch(200, 'application/vnd.github.html', GOOD_BODY))
    expect(written).toHaveLength(2)
    // written is guaranteed length 2 by the assertion above; the `!` documents that for
    // noUncheckedIndexedAccess rather than silently tolerating a missing element.
    expect(await readFile(written[0]!, 'utf8')).toBe(GOOD_BODY)
    expect(await readdir(join(dir, 'real-world'))).toEqual(['hello-world.html'])
    const provenance = JSON.parse(await readFile(join(dir, 'oracle-provenance.json'), 'utf8'))
    expect(provenance).toEqual({
      'real-world/hello-world': {
        repo: 'octocat/Hello-World',
        ref: '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d',
        path: 'README',
        dir: '',
      },
    })
  })

  it('refreshAll writes nothing when the response is a rate-limit body', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oracle-'))
    await expect(refreshAll([TARGET], 'tok', dir, fakeFetch(403, 'application/json', RATE_LIMIT_BODY))).rejects.toThrow(
      OracleError,
    )
    expect(await readdir(dir)).toEqual([])
  })

  it('refreshAll is all-or-nothing: a later target failing leaves NO fixture and NO provenance on disk, including for targets that already succeeded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oracle-'))
    const second: OracleTarget = { ...TARGET, name: 'real-world/second', path: 'SECOND' }
    let call = 0
    const flaky: FetchLike = async () => {
      call += 1
      // First call (the TARGET fixture) succeeds; second call (the `second` fixture) comes back
      // as the rate-limit body. Under all-or-nothing semantics, the first target's fixture must
      // never land on disk on its own — a fixture with no matching provenance entry is exactly
      // the inconsistency Task 24's assertions would trip over.
      if (call === 1) {
        return { status: 200, headers: { get: () => 'application/vnd.github.html' }, text: async () => GOOD_BODY }
      }
      return { status: 403, headers: { get: () => 'application/json' }, text: async () => RATE_LIMIT_BODY }
    }
    await expect(refreshAll([TARGET, second], 'tok', dir, flaky)).rejects.toThrow(OracleError)
    expect(await readdir(dir)).toEqual([])
  })

  it('readManifest parses a JSON array of targets and derives dir for each entry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oracle-manifest-'))
    const manifestPath = join(dir, 'oracle-manifest.json')
    await writeFile(
      manifestPath,
      JSON.stringify([{ name: 'x', repo: 'o/r', ref: 'a'.repeat(40), path: 'docs/a.md' }]),
      'utf8',
    )
    await expect(readManifest(manifestPath)).resolves.toEqual([
      { name: 'x', repo: 'o/r', ref: 'a'.repeat(40), path: 'docs/a.md', dir: 'docs' },
    ])
  })

  it('readManifest rejects a manifest whose top level is not an array, instead of failing later inside .map', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oracle-manifest-'))
    const manifestPath = join(dir, 'oracle-manifest.json')
    await writeFile(manifestPath, JSON.stringify({ oops: 'not an array' }), 'utf8')
    await expect(readManifest(manifestPath)).rejects.toThrow(OracleError)
    await expect(readManifest(manifestPath)).rejects.toThrow(/expected a JSON array of targets/)
  })

  it('readManifest rejects an entry missing a required field, instead of silently producing a malformed target', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oracle-manifest-'))
    const manifestPath = join(dir, 'oracle-manifest.json')
    // No `ref`: Task 23 will be hand-editing this file, and a typo like this should fail loudly
    // right here, not resurface later as an obscure oracleUrl/SHA40 error far from the cause.
    await writeFile(manifestPath, JSON.stringify([{ name: 'x', repo: 'o/r', path: 'docs/a.md' }]), 'utf8')
    await expect(readManifest(manifestPath)).rejects.toThrow(OracleError)
    await expect(readManifest(manifestPath)).rejects.toThrow(/entry 0/)
  })

  it('main refuses to run without GITHUB_TOKEN, before ever reading a manifest or touching the network', async () => {
    const original = process.env.GITHUB_TOKEN
    delete process.env.GITHUB_TOKEN
    try {
      // No manifest/fixtures dir is supplied and none exists at the default location; if main()
      // got past the token check it would throw ENOENT instead of returning 2. The absence of a
      // thrown error is itself evidence the token guard ran first.
      await expect(main([])).resolves.toBe(2)
    } finally {
      if (original !== undefined) process.env.GITHUB_TOKEN = original
    }
  })
})

describe('main error handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function withToken<T>(run: () => Promise<T>): Promise<T> {
    const original = process.env.GITHUB_TOKEN
    process.env.GITHUB_TOKEN = 'tok'
    return run().finally(() => {
      if (original === undefined) delete process.env.GITHUB_TOKEN
      else process.env.GITHUB_TOKEN = original
    })
  }

  it('reports a clean message when the manifest is malformed, instead of an unhandled-rejection stack dump', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oracle-main-'))
    await writeFile(join(dir, 'oracle-manifest.json'), 'not json', 'utf8')
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      await withToken(async () => {
        const code = await main([dir])
        expect(code).not.toBe(0)
      })
      const output = errSpy.mock.calls.map((c) => String(c[0])).join('')
      // Asserting a specific, stable prefix (rather than "does not contain a stack trace") is
      // itself the proof: if main() ever let the rejection propagate unhandled again, there
      // would be no such call to process.stderr.write from inside main() to match against —
      // this assertion can only pass if main() caught the error itself and formatted it.
      expect(output).toMatch(/^oracle refresh failed: /)
    } finally {
      errSpy.mockRestore()
    }
  })

  it('reports a clean message when refreshAll rejects (e.g. a rate-limited response), instead of an unhandled-rejection stack dump', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oracle-main-'))
    await writeFile(join(dir, 'oracle-manifest.json'), JSON.stringify([TARGET]), 'utf8')
    vi.stubGlobal('fetch', async () => ({
      status: 403,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
      text: async () => RATE_LIMIT_BODY,
    }))
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      await withToken(async () => {
        const code = await main([dir])
        expect(code).not.toBe(0)
      })
      const output = errSpy.mock.calls.map((c) => String(c[0])).join('')
      expect(output).toMatch(/^oracle refresh failed: /)
      expect(output).toContain('expected HTTP 200, got 403')
      expect(await readdir(dir)).not.toContain('oracle-provenance.json')
    } finally {
      errSpy.mockRestore()
    }
  })
})

describe('vendor licence gate', () => {
  it('refuses michelf/mdtest because it is GPL-2.0', async () => {
    const { LicenseError, assertLicenceAllowed } = await import('../scripts/vendor-corpus.js')
    expect(() => assertLicenceAllowed('michelf/mdtest')).toThrow(LicenseError)
    expect(() => assertLicenceAllowed('michelf/mdtest')).toThrow(/GPL-2\.0/)
    expect(() => assertLicenceAllowed('karlcow/markdown-testsuite')).not.toThrow()
  })

  it('buildSelfTargets derives one target per corpus file at the merged SHA', async () => {
    const { buildSelfTargets } = await import('../scripts/oracle-refresh.js')
    expect(buildSelfTargets(['gfm/table-alignment'], 'readit-project/readit', 'b'.repeat(40), 'packages/core/test/corpus')).toEqual([
      { name: 'gfm/table-alignment', repo: 'readit-project/readit', ref: 'b'.repeat(40), path: 'packages/core/test/corpus/gfm/table-alignment.md' },
    ])
  })

  it('rawUrl builds a raw.githubusercontent.com URL, not the rate-limited REST API', async () => {
    const { rawUrl } = await import('../scripts/vendor-corpus.js')
    expect(rawUrl('o/r', 'a'.repeat(40), 'readme.md')).toBe(`https://raw.githubusercontent.com/o/r/${'a'.repeat(40)}/readme.md`)
  })

  it('vendorOne checks the licence before it ever calls fetch', async () => {
    const { vendorOne } = await import('../scripts/vendor-corpus.js')
    const dir = await mkdtemp(join(tmpdir(), 'vendor-'))
    const source = { dest: 'x.md', repo: 'michelf/mdtest', ref: 'a'.repeat(40), path: 'x.md', license: 'GPL-2.0' }
    const spy = async () => {
      throw new Error('fetch must not be called for a denied repo')
    }
    await expect(vendorOne(source, dir, spy)).rejects.toThrow(/GPL-2\.0/)
  })

  it('vendorOne does not write a file when the raw fetch is non-200', async () => {
    const { vendorOne } = await import('../scripts/vendor-corpus.js')
    const dir = await mkdtemp(join(tmpdir(), 'vendor-'))
    const source = { dest: 'x.md', repo: 'o/r', ref: 'a'.repeat(40), path: 'x.md', license: 'MIT' }
    await expect(
      vendorOne(source, dir, async () => ({ status: 404, text: async () => 'Not Found' })),
    ).rejects.toThrow(/404/)
    await expect(readdir(dir)).resolves.toEqual([])
  })
})
