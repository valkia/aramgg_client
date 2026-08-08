import { describe, expect, it, vi } from 'vitest'
import { createItemSets } from '../../src/main/services/item-sets/item-set-installer.ts'

vi.mock('../../src/main/modules/logger.ts', () => ({
  default: { info: vi.fn(), warn: vi.fn() },
}))
vi.mock('../../src/main/services/lcu/lcu-service.ts', () => ({
  getLCUServiceInstance: vi.fn(),
}))
vi.mock('../../src/main/data-loader.ts', () => ({
  loadChampionBuild: vi.fn(),
  loadChampionName: vi.fn(),
}))

describe('ARAM item set builder', () => {
  const firstBuild = {
    tags: { style: 'AP' },
    patch: '16.12',
    games: 1000,
    winRate: 0.54,
    startingItems: [{ itemIds: [1056, 2003], games: 160, winRate: 0.52 }],
    coreItems: [{ itemIds: [6653, 3020, 4645], games: 500, winRate: 0.55 }],
    itemExtensions: [{ itemIds: [3089], games: 90, winRate: 0.56 }],
    situationalItems: [{ itemId: 3157, games: 120, winRate: 0.57 }],
  }

  const secondBuild = {
    tags: { style: 'Burn' },
    games: 900,
    winRate: 0.53,
    coreItems: [{ itemIds: [6655, 3020, 4646], games: 420, winRate: 0.54 }],
  }

  it('creates one LCU item set per trusted build variant', () => {
    const result = createItemSets(
      { championId: 1, alias: 'Annie' },
      null,
      { builds: [firstBuild, secondBuild] }
    )

    expect(result.totalBuilds).toBe(2)
    expect(result.skippedBuilds).toEqual([])
    expect(result.itemSets).toHaveLength(2)
    expect(result.itemSets[0].title).toContain('AP')
    expect(result.itemSets[1].title).toContain('Burn')
    expect(result.itemSets[0].blocks.map(block => block.type)).toEqual([
      expect.stringContaining('ARAMGG Starter'),
      expect.stringContaining('ARAMGG Core'),
      'ARAMGG Next Items',
      'ARAMGG Situational Items',
    ])
  })

  it('also accepts a raw builds array', () => {
    const result = createItemSets(
      { championId: 1, alias: 'Annie' },
      null,
      [firstBuild, secondBuild]
    )

    expect(result.itemSets).toHaveLength(2)
  })

  it('accepts the current Tencent build when only recommendation rates are available', () => {
    const result = createItemSets(
      { championId: 35, alias: 'Shaco' },
      null,
      [{
        patch: '16.15',
        tier: 'Tencent',
        games: 0,
        startingItems: [{ itemIds: [3802], games: 0, pickRate: 0.1638, winRate: 0.5155 }],
        coreItems: [{ itemIds: [126697, 6676, 3031], games: 0, pickRate: 0.161, winRate: 0.4337 }],
        fullItems: [{ itemIds: [126697, 3031, 3036, 3508, 6676, 6699], games: 0, pickRate: 0.0297, winRate: 0.505 }],
        itemExtensions: [],
        situationalItems: [{ itemId: 3020, games: 0, pickRate: 0.1306, winRate: 0.4893 }],
      }]
    )

    expect(result.skippedBuilds).toEqual([])
    expect(result.itemSets).toHaveLength(1)
    expect(result.itemSets[0].blocks.map(block => block.type)).toEqual([
      expect.stringContaining('ARAMGG Starter'),
      expect.stringContaining('ARAMGG Core'),
      expect.stringContaining('ARAMGG Full Build'),
      'ARAMGG Situational Items',
    ])
  })

  it('still rejects builds without game counts or recommendation rates', () => {
    const result = createItemSets(
      { championId: 35, alias: 'Shaco' },
      null,
      [{ coreItems: [{ itemIds: [6676, 3031, 3036], games: 0, pickRate: 0 }] }]
    )

    expect(result.itemSets).toHaveLength(0)
    expect(result.skippedBuilds).toHaveLength(1)
  })
})
