import { readFile, readdir } from 'node:fs/promises'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { describe, expect, it } from 'vitest'

type CatalogModel = ReturnType<typeof getBuiltinModels>[number]
type CatalogData = Record<string, Record<string, CatalogModel>>

const PREVIOUS_MODEL_IDS = [
  'minimax-m3',
  'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
  'deepseek-v4-pro',
  'glm-5.1',
  'glm-5.2',
  'glm-5.3',
  'hy3',
  'kimi-k2.6',
  'kimi-k2.7-code',
  'kimi-k3',
  'longcat-2.0',
  'mimo-v2.5',
  'mimo-v2.5-pro',
  'minimax-m2.7',
  'ox-alpha-free',
  'qwen3.6-plus',
  'qwen3.7-max',
  'qwen3.7-plus',
  'qwen3.8-max',
  'gpt-5.6-luna',
  'grok-4.5',
  'muse-spark-1.2-contributor'
] as const

async function expectedCatalog(): Promise<CatalogModel[]> {
  const raw = await readFile(new URL('./fixtures/opencode-go-catalog.expected.json', import.meta.url), 'utf8')
  const groups = JSON.parse(raw) as CatalogData
  return Object.values(groups).flatMap(group => Object.values(group))
}

describe('OpenCode Go model catalog', () => {
  it('exposes the upstream 0.84.4 static catalog', async () => {
    expect(getBuiltinModels('opencode-go')).toEqual(await expectedCatalog())
  })

  it('keeps the catalog additions and upstream removals relative to 0.84.3', () => {
    const previous = new Set<string>(PREVIOUS_MODEL_IDS)
    const current = new Set(getBuiltinModels('opencode-go').map(model => model.id))

    expect([...previous].filter(id => !current.has(id))).toEqual(['ox-alpha-free', 'grok-4.5'])
    expect([...current].filter(id => !previous.has(id))).toEqual([
      'qwen3.8-flash',
      'glm-5.3-flash',
      'hy4-preview',
      'grok-4.6'
    ])
  })

  it('uses the updated dependency without a stale catalog patch', async () => {
    const [manifestRaw, patches] = await Promise.all([
      readFile(new URL('../node_modules/@earendil-works/pi-ai/package.json', import.meta.url), 'utf8'),
      readdir(new URL('../patches/', import.meta.url))
    ])
    const manifest = JSON.parse(manifestRaw) as { version: string }

    expect(manifest.version).toBe('0.84.4')
    expect(patches.filter(name => name.startsWith('@earendil-works+pi-ai+'))).toEqual([])
  })
})
