import { describe, expect, it } from 'vitest'
import type { HextechAramMatchHistoryMatch } from '../../src/shared/ipc-contract.ts'
import { summarizeMatches } from '../../src/renderer/services/match-history-insights.ts'

function match(gameId: number, result: HextechAramMatchHistoryMatch['result'], overrides = {}): HextechAramMatchHistoryMatch {
  return { gameId, gameCreation: gameId * 1000, gameDuration: 900, gameVersion: '16.21', championId: 103, kills: 8, deaths: 2, assists: 12, result, items: [], augments: [], ...overrides }
}

describe('match history insights', () => {
  it('excludes remakes, deduplicates games and uses total KDA rather than mean ratios', () => {
    const win = match(1, 'win', { deaths: 0 })
    const summary = summarizeMatches([win, match(3, 'remake', { kills: 99 }), match(2, 'loss', { deaths: 4 }), win])
    expect(summary).toMatchObject({ completed: 2, wins: 1, losses: 1, remakes: 1, winRate: 50, kda: 10, averageKills: 8, averageDeaths: 2, averageAssists: 12, streak: 0 })
    expect(summary.ordered.map((game) => game.gameId)).toEqual([3, 2, 1])
  })

  it('counts consecutive results from the newest game and stops at remakes', () => {
    expect(summarizeMatches([match(2, 'loss'), match(4, 'win'), match(3, 'win'), match(5, 'win')])).toMatchObject({ streak: 3, streakResult: 'win' })
    expect(summarizeMatches([match(3, 'loss'), match(2, 'remake'), match(1, 'loss')])).toMatchObject({ streak: 1, streakResult: 'loss' })
  })

  it('does not invent zero percentages for empty or remake-only history', () => {
    for (const games of [[], [match(1, 'remake')]]) {
      expect(summarizeMatches(games)).toMatchObject({ completed: 0, winRate: null, kda: null, streak: 0 })
    }
    expect(summarizeMatches([match(1, 'win', { deaths: 0 })]).kda).toBe(20)
  })
})
