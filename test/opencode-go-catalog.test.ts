import { readFile } from 'node:fs/promises'
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

const CATALOG_PATCH_PATH = 'node_modules/@earendil-works/pi-ai/dist/providers/data/opencode-go.json'

async function expectedCatalog(): Promise<CatalogModel[]> {
  const raw = await readFile(new URL('./fixtures/opencode-go-catalog.expected.json', import.meta.url), 'utf8')
  const groups = JSON.parse(raw) as CatalogData
  return Object.values(groups).flatMap(group => Object.values(group))
}

async function expectedCatalogData(): Promise<CatalogData> {
  const raw = await readFile(new URL('./fixtures/opencode-go-catalog.expected.json', import.meta.url), 'utf8')
  return JSON.parse(raw) as CatalogData
}

describe('OpenCode Go model catalog', () => {
  it('exposes only the approved corrected static catalog', async () => {
    expect(getBuiltinModels('opencode-go')).toEqual(await expectedCatalog())
  })

  it('changes only the approved model ids relative to 0.84.3', () => {
    const previous = new Set<string>(PREVIOUS_MODEL_IDS)
    const current = new Set(getBuiltinModels('opencode-go').map(model => model.id))

    expect([...previous].filter(id => !current.has(id))).toEqual(['ox-alpha-free'])
    expect([...current].filter(id => !previous.has(id))).toEqual([
      'qwen3.8-flash',
      'glm-5.3-flash',
      'hy4-preview',
      'grok-4.6'
    ])
  })

  it('keeps the dependency version and patch target scoped', async () => {
    const [manifestRaw, patch] = await Promise.all([
      readFile(new URL('../node_modules/@earendil-works/pi-ai/package.json', import.meta.url), 'utf8'),
      readFile(new URL('../patches/@earendil-works+pi-ai+0.84.3.patch', import.meta.url), 'utf8')
    ])
    const manifest = JSON.parse(manifestRaw) as { version: string }
    const paths = [...patch.matchAll(/^(?:--- a|\+\+\+ b)\/(.+)$/gm)].map(match => match[1])
    const catalogImages = [...patch.matchAll(/^[+-](\{.*\})$/gm)].map(match => JSON.parse(match[1]!) as CatalogData)
    const catalogById = catalogImages.map(image => new Map(
      Object.values(image).flatMap(group => Object.values(group)).map(model => [model.id, model]),
    ))

    expect(manifest.version).toBe('0.84.3')
    expect(new Set(paths)).toEqual(new Set([CATALOG_PATCH_PATH]))
    expect(catalogImages).toHaveLength(2)
    expect(Object.values(catalogImages[0]!).flatMap(group => Object.keys(group))).toEqual(PREVIOUS_MODEL_IDS)
    expect(catalogImages[1]!).toEqual(await expectedCatalogData())
    for (const id of PREVIOUS_MODEL_IDS.filter(id => id !== 'ox-alpha-free')) {
      expect(catalogById[1]!.get(id)).toEqual(catalogById[0]!.get(id))
    }
  })
})
