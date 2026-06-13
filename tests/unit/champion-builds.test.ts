import { describe, expect, it } from 'vitest'
import { mapChampionBuilds } from '../../src/main/data-loader.ts'

describe('champion build mapping', () => {
  it('maps the public builds array as the only build source', () => {
    const mapped = mapChampionBuilds({
      builds: [
        {
          queueId: 450,
          tags: { damage: 'AP' },
          stats: { games: 1000, wins: 540, winRate: 0.54, pickRate: 0.2 },
          startingItems: [{ items: [1056, 2003], games: 200, wins: 110 }],
          coreItems: [{ items: [6653, 3020, 4645], games: 500, wins: 275 }],
          itemExtensions: [{ items: [3089], games: 80, wins: 45 }],
          situationalItems: [{ items: [3157], games: 90, wins: 50 }],
        },
        {
          queueId: 450,
          tags: { damage: 'Burn' },
          stats: { games: 800, wins: 420, winRate: 0.525, pickRate: 0.16 },
          coreItems: [{ itemIds: [6655, 3020, 4646], games: 320, wins: 170 }],
        },
      ],
    }, 1)

    expect(mapped.builds).toHaveLength(2)
    expect(mapped.coreItems[0].itemIds).toEqual(['6653', '3020', '4645'])
    expect(mapped.startingItems[0].itemIds).toEqual(['1056', '2003'])
    expect(mapped.situationalItems[0].itemId).toBe('3157')
  })
})
