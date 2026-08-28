import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SHELL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = join(SHELL_DIR, '..')

const read = (path: string): string => readFileSync(path, 'utf8')

function packageVersionFromToml(text: string): string {
  const packageHeader = text.match(/^\[package\]\s*$/m)
  if (packageHeader?.index === undefined) throw new Error('Cargo.toml [package] section is missing')
  const packageBody = text.slice(packageHeader.index + packageHeader[0].length)
  const nextSection = packageBody.search(/^\[/m)
  const packageSection = nextSection === -1 ? packageBody : packageBody.slice(0, nextSection)
  const version = packageSection.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1]
  if (version === undefined) throw new Error('Cargo.toml [package] version is missing')
  return version
}

function packageVersionFromCargoLock(text: string, name: string): string {
  const packages = text.split(/^\[\[package\]\]\s*$/m)
  const section = packages.find((candidate) =>
    new RegExp(`^name\\s*=\\s*"${name}"\\s*$`, 'm').test(candidate),
  )
  const version = section?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1]
  if (version === undefined) throw new Error(`${name} version is missing from Cargo.lock`)
  return version
}

describe('desktop release version synchronization', () => {
  it('keeps Tauri, Cargo and npm package metadata on one version', () => {
    const tauriConfig = JSON.parse(read(join(SHELL_DIR, 'src-tauri/tauri.conf.json'))) as {
      version: string
    }
    const shellPackage = JSON.parse(read(join(SHELL_DIR, 'package.json'))) as { version: string }
    const packageLock = JSON.parse(read(join(REPO_ROOT, 'package-lock.json'))) as {
      packages: Record<string, { version?: string }>
    }

    const versions = {
      tauri: tauriConfig.version,
      cargoToml: packageVersionFromToml(read(join(SHELL_DIR, 'src-tauri/Cargo.toml'))),
      cargoLock: packageVersionFromCargoLock(
        read(join(SHELL_DIR, 'src-tauri/Cargo.lock')),
        'readit-shell',
      ),
      shellPackage: shellPackage.version,
      packageLock: packageLock.packages.shell?.version,
    }

    expect(versions.packageLock).toBeDefined()
    expect(new Set(Object.values(versions))).toEqual(new Set([versions.tauri]))
  })
})
