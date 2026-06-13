import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'

let tempRoot = ''

async function writeJson(filePath: string, payload: any): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(payload), 'utf8')
}

function manifest(files: string[]): any {
  return {
    files: files.map((filePath) => ({ path: filePath })),
  }
}

function shardIndex(dataVersion: string): any {
  return {
    dataVersion,
    shards: [
      {
        id: 1,
        path: 'champion-shards/1.json',
        championIds: [5, 6, 7, 8],
      },
    ],
  }
}

function oldVladimirShard(): any {
  return {
    champions: {
      8: {
        champion: { id: 8, name: 'Vladimir' },
        build: {
          coreItems: [{ items: [6653, 3020, 4645] }],
        },
      },
    },
  }
}

function latestVladimirShard(): any {
  return {
    champions: {
      8: {
        champion: { id: 8, name: 'Vladimir' },
        builds: [
          {
            queueId: 450,
            stats: { games: 6535, wins: 3400, winRate: 0.52 },
            tags: { damage: 'AP' },
            coreItems: [{ items: [6653, 3020, 4645] }],
          },
        ],
      },
    },
  }
}

async function seedData(): Promise<void> {
  const dataRoot = path.join(tempRoot, 'data')
  const activeVersionDir = path.join(dataRoot, 'versions', '16.12.1')
  const latestVersionDir = path.join(dataRoot, 'versions', '16.12.2')
  const activeFiles = [
    'augments.json',
    'champions.json',
    'items.json',
    'manifest.json',
    'champion-shards/index.json',
    'champion-shards/1.json',
  ]
  const latestFiles = [
    'manifest.json',
    'champion-shards/1.json',
  ]

  await writeJson(path.join(dataRoot, 'current.json'), {
    schemaVersion: 3,
    dataVersion: '16.12.1',
    gamePatch: '16.12',
    manifest: '/api/client/v1/data/16.12.1/manifest.json',
  })
  await writeJson(path.join(activeVersionDir, 'manifest.json'), manifest(activeFiles))
  await writeJson(path.join(activeVersionDir, 'augments.json'), { augments: [] })
  await writeJson(path.join(activeVersionDir, 'champions.json'), { champions: [] })
  await writeJson(path.join(activeVersionDir, 'items.json'), { items: [] })
  await writeJson(path.join(activeVersionDir, 'champion-shards', 'index.json'), shardIndex('16.12.1'))
  await writeJson(path.join(activeVersionDir, 'champion-shards', '1.json'), oldVladimirShard())

  await writeJson(path.join(latestVersionDir, 'manifest.json'), manifest(latestFiles))
  await writeJson(path.join(latestVersionDir, 'champion-shards', '1.json'), latestVladimirShard())
}

describe('latest champion shard detail loading', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.unstubAllGlobals()
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aramgg-data-loader-'))
    await seedData()

    vi.doMock('../../src/main/modules/app-paths.ts', () => ({
      getAppDataDir: () => tempRoot,
      getLogDir: () => path.join(tempRoot, 'logs'),
    }))

    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = String(input)
      if (url.endsWith('/api/client/v1/config')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            dataVersion: '16.12.2',
            gamePatch: '16.12',
            manifest: '/api/client/v1/data/16.12.2/manifest.json',
          }),
        }
      }

      if (url.endsWith('/api/client/v1/data/16.12.2/manifest.json')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => manifest(['manifest.json', 'champion-shards/1.json']),
        }
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.resetModules()
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true })
      tempRoot = ''
    }
  })

  it('uses a newer cached champion shard when the newer version is not fully activated', async () => {
    const { loadChampionBuild, clearCache } = await import('../../src/main/data-loader.ts')

    try {
      const build = await loadChampionBuild(8)

      expect(build?.builds).toHaveLength(1)
      expect(build.builds[0].games).toBe(6535)
      expect(build.coreItems[0].itemIds).toEqual(['6653', '3020', '4645'])
    } finally {
      clearCache()
    }
  })
})
