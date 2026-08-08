import { describe, expect, it } from 'vitest'
import {
  createBuildRoutes,
  getSkillKey,
  getSkillPriority,
  normalizeSingleItemRecords
} from '../../src/renderer/service/champion-build-routes.js'

describe('champion build routes', () => {
  it('flattens and deduplicates next item records by item id', () => {
    const records = normalizeSingleItemRecords([
      { itemIds: [3075, 3065], games: 40, wins: 22 },
      { itemIds: [3075], games: 203, wins: 118, winRate: 0.58 },
      { itemIds: [3065], games: 110, wins: 61, winRate: 0.55 },
    ])

    expect(records.map(record => record.itemId)).toEqual(['3075', '3065'])
    expect(records[0].games).toBe(203)
    expect(records[1].games).toBe(110)
  })

  it('keeps repeated item extensions to one visible next item per route', () => {
    const routes = createBuildRoutes({
      builds: [
        {
          tags: { style: 'Tank' },
          patch: '16.12',
          stats: { games: 1000, winRate: 0.54 },
          coreItems: [
            { itemIds: [3084, 3111, 2502], games: 968, winRate: 0.56 },
          ],
          itemExtensions: [
            { coreItemIds: [3084, 3111, 3748], itemIds: [3075], games: 59, winRate: 0.53 },
            { coreItemIds: [2502, 3047, 3084], itemIds: [3075], games: 81, winRate: 0.56 },
            { coreItemIds: [3084, 3111, 6664], itemIds: [3075], games: 203, winRate: 0.57 },
            { coreItemIds: [2502, 3084, 3111], itemIds: [3065], games: 110, winRate: 0.55 },
            { coreItemIds: [2502, 3084, 3111], itemIds: [3065], games: 97, winRate: 0.54 },
            { coreItemIds: [2502, 3084, 3111], itemIds: [3083], games: 68, winRate: 0.52 },
          ],
          situationalItems: [
            { id: 2504, games: 1165, winRate: 0.54, averageIndex: 2.8 },
            { itemId: 2504, games: 200, winRate: 0.58, averageIndex: 3.4 },
          ],
        },
      ],
    })

    expect(routes).toHaveLength(1)
    expect(routes[0].itemExtensions.map(item => item.itemId)).toEqual(['3075', '3065', '3083'])
    expect(routes[0].itemExtensions[0].games).toBe(203)
    expect(routes[0].situationalItems.map(item => item.itemId)).toEqual(['2504'])
    expect(routes[0].situationalItems[0].distinctiveScore).toBe(3.4)
  })

  it('normalizes and sorts summoner spell and skill order recommendations', () => {
    const primarySkillOrder = [1, 2, 3, 1, 1, 4, 1, 2, 1, 2, 4, 2, 2, 3, 3, 4, 3, 3]
    const routes = createBuildRoutes({
      builds: [{
        coreItems: [{ items: [6653, 3020, 4645], games: 500 }],
        summonerSpells: [
          { summonerSpellIds: [6, 32], games: 120, pick_rate: 0.12, win_rate: 0.51 },
          { summonerSpellIds: [4, 32], games: 720, pick_rate: 0.72, win_rate: 0.556 },
          { summonerSpellIds: [4], games: 1000 },
        ],
        skillOrders: [
          { skillOrder: primarySkillOrder, games: 680, pick_rate: 0.68, win_rate: 0.544 },
          { skillOrder: [1, 2, 3], games: 900 },
        ],
      }],
    })

    expect(routes[0].summonerSpells).toHaveLength(2)
    expect(routes[0].summonerSpells[0]).toMatchObject({
      summonerSpellIds: [4, 32],
      games: 720,
      pickRate: 0.72,
      winRate: 0.556,
    })
    expect(routes[0].skillOrders).toHaveLength(1)
    expect(routes[0].skillOrders[0].skillOrder).toEqual(primarySkillOrder)
    expect(getSkillPriority(primarySkillOrder)).toEqual(['Q', 'W', 'E'])
    expect(primarySkillOrder.map(getSkillKey)).toEqual([
      'Q', 'W', 'E', 'Q', 'Q', 'R', 'Q', 'W', 'Q',
      'W', 'R', 'W', 'W', 'E', 'E', 'R', 'E', 'E',
    ])
  })

  it('keeps full builds and 15-level rate-only recommendations from Tencent data', () => {
    const skillOrder = [1, 2, 3, 1, 1, 4, 1, 3, 1, 3, 4, 3, 3, 2, 2]
    const routes = createBuildRoutes({
      builds: [{
        patch: '16.15',
        games: null,
        coreItems: [
          { itemIds: [126697, 6676, 3031], games: null, pickRate: 0.161, winRate: 0.4337 },
        ],
        fullItems: [
          { itemIds: [126697, 3031, 3036, 3508, 6676, 6699], games: null, pickRate: 0.0297, winRate: 0.505 },
        ],
        skillOrders: [
          { skillOrder, games: null, pickRate: 0.1261, winRate: 0.4636 },
        ],
      }],
    })

    expect(routes).toHaveLength(1)
    expect(routes[0].fullItems[0].items).toEqual(['126697', '3031', '3036', '3508', '6676', '6699'])
    expect(routes[0].skillOrders[0].skillOrder).toEqual(skillOrder)
  })
})
