import { describe, expect, it } from 'vitest'
import { createItemSets } from '../../src/main/services/item-sets/item-set-installer.ts'

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
})
