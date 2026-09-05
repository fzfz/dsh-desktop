import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkupAllProfilePlugins,
  compareSemver,
  inferPluginRuntimeCompatibility,
  parseSemver,
  satisfiesComparator,
  satisfiesRange,
  evaluatePluginMarketCompatibility,
  readBundledDshVersion,
  type NpmPackageManifest
} from '../src/main/state/plugin-market-check'

const projectRoot = path.resolve(import.meta.dirname, '..')

describe('plugin-market-check', () => {
  it('parses and compares semver correctly', () => {
    expect(parseSemver('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: []
    })
    expect(parseSemver('0.1.2-alpha.4')).toEqual({
      major: 0,
      minor: 1,
      patch: 2,
      prerelease: ['alpha', 4]
    })
    expect(compareSemver('1.0.0', '1.0.1')).toBe(-1)
    expect(compareSemver('1.2.0', '1.1.9')).toBe(1)
    expect(compareSemver('0.1.2', '0.1.2-alpha.4')).toBe(1)
    expect(compareSemver('0.1.2-alpha.1', '0.1.2-alpha.4')).toBe(-1)
  })

  it('evaluates semver comparators and ranges', () => {
    expect(satisfiesComparator('0.1.2', '^0.1.0')).toBe(true)
    expect(satisfiesComparator('0.2.0', '^0.1.0')).toBe(false)
    expect(satisfiesComparator('1.2.3', '^1.0.0')).toBe(true)
    expect(satisfiesComparator('2.0.0', '^1.0.0')).toBe(false)
    expect(satisfiesComparator('0.1.5', '~0.1.2')).toBe(true)
    expect(satisfiesComparator('0.2.0', '~0.1.2')).toBe(false)
    expect(satisfiesRange('0.1.2-alpha.4', '^0.1.0 || ^0.1.2-0')).toBe(true)
    expect(satisfiesRange('0.1.2', '>=0.1.0 <0.2.0')).toBe(true)
    expect(satisfiesRange('0.2.5', '>=0.1.0 <0.2.0')).toBe(false)
  })

  it('infers runtime compatibility for manifests', () => {
    const compatibleManifest: NpmPackageManifest = {
      name: 'example-plugin',
      version: '1.2.0',
      peerDependencies: {
        '@deepseek-ai/dsh': '^0.1.2-0'
      }
    }
    expect(inferPluginRuntimeCompatibility(compatibleManifest, '0.1.2-rc.1').isCompatible).toBe(true)

    const incompatibleManifest: NpmPackageManifest = {
      name: 'legacy-plugin',
      version: '1.0.0',
      peerDependencies: {
        '@deepseek-ai/dsh': '^0.1.1'
      }
    }
    expect(inferPluginRuntimeCompatibility(incompatibleManifest, '0.1.2-rc.1').isCompatible).toBe(false)

    const deprecatedDepManifest: NpmPackageManifest = {
      name: 'deprecated-dep-plugin',
      version: '1.1.0',
      dependencies: {
        '@deepseek-ai/dsh-host-apiproxy': '^0.1.1'
      }
    }
    expect(inferPluginRuntimeCompatibility(deprecatedDepManifest, '0.1.2').isCompatible).toBe(false)

    const subPackagePeerManifest: NpmPackageManifest = {
      name: 'dsh-better-sidebar',
      version: '0.17.1',
      peerDependencies: {
        '@deepseek-ai/dsh-agent': '^0.1.0-rc.8',
        '@deepseek-ai/cordis': '^4.0.1'
      }
    }
    expect(inferPluginRuntimeCompatibility(subPackagePeerManifest, '0.1.2-rc.1').isCompatible).toBe(false)
    expect(inferPluginRuntimeCompatibility(subPackagePeerManifest, '0.1.0-rc.9').isCompatible).toBe(true)
  })

  it('evaluates plugin market compatibility for upgrade candidates', async () => {
    const mockManifest: NpmPackageManifest = {
      name: 'test-plugin',
      version: '2.0.0',
      peerDependencies: {
        '@deepseek-ai/dsh': '^0.1.2'
      }
    }

    const mockFetch = async () =>
      new Response(JSON.stringify(mockManifest), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })

    const report = await evaluatePluginMarketCompatibility({
      packageName: 'test-plugin',
      installedVersion: '1.0.0',
      currentRuntimeVersion: '0.1.2',
      hasLocalIssue: true,
      fetchFn: mockFetch as unknown as typeof fetch,
      locale: 'zh'
    })

    expect(report.healthStatus).toBe('incompatible-fixed-in-latest')
    expect(report.upgradeReady).toBe(true)
    expect(report.upgradeVersion).toBe('2.0.0')
  })

  it('stops before querying the plugin market when the bundled DSH manifest is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'dsh-desktop-missing-runtime-'))
    let fetchCalls = 0

    try {
      await expect(checkupAllProfilePlugins({
        plugins: ['example-plugin'],
        dshHome: root,
        bundledNodeModulesPath: path.join(root, 'missing-node-modules'),
        fetchFn: async () => {
          fetchCalls += 1
          return new Response('{}', { status: 200 })
        }
      })).rejects.toThrow(/@deepseek-ai.*dsh.*package\.json|ENOENT/iu)
      expect(fetchCalls).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reads a valid bundled DSH version and rejects invalid version values', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'dsh-desktop-runtime-version-'))
    const packageDirectory = path.join(root, '@deepseek-ai', 'dsh')
    const manifestPath = path.join(packageDirectory, 'package.json')

    try {
      await mkdir(packageDirectory, { recursive: true })
      await writeFile(manifestPath, JSON.stringify({ version: '0.1.2-rc.1' }))
      await expect(readBundledDshVersion(root)).resolves.toBe('0.1.2-rc.1')

      for (const version of ['', 12]) {
        await writeFile(manifestPath, JSON.stringify({ version }))
        await expect(readBundledDshVersion(root)).rejects.toThrow('Bundled DSH manifest has no version')
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses the shared bundled Runtime manifest reader for single-plugin recovery', async () => {
    const source = await readFile(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf8')

    expect(source).toContain(
      "const runtimeVersion = await readBundledDshVersion(join(app.getAppPath(), 'node_modules'))"
    )
    expect(source).not.toContain("|| '0.1.2-alpha.1'")
    expect(readBundledDshVersion).toBeTypeOf('function')
  })
})
