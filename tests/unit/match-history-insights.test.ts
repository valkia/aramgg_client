import { describe, expect, it } from 'vitest'
import type { HextechAramMatchHistoryMatch, HextechAramMatchParticipant } from '../../src/shared/ipc-contract.ts'
import { buildScoreboardTeams, summarizeMatches } from '../../src/renderer/services/match-history-insights.ts'

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

function players(): HextechAramMatchParticipant[] {
  return Array.from({ length: 10 }, (_, index) => ({
    participantId: index + 1, teamId: index < 5 ? 100 : 200, playerName: `Player ${index}`,
    isCurrentPlayer: index === 7, championId: 103, result: index < 5 ? 'win' : 'loss',
    kills: 2, deaths: 1, assists: 4, damageToChampions: index < 5 ? 100 : 200,
    damageTaken: 200, goldEarned: 1000, minionsKilled: 20,
    tripleKills: 0, quadraKills: 0, pentaKills: 0, items: [], augments: [],
  }))
}

describe('match scoreboard', () => {
  it('uses own team totals, orders the current team first and allows tied leaders', () => {
    const teams = buildScoreboardTeams(players().reverse())
    expect(teams.map((team) => team.teamId)).toEqual([200, 100])
    expect(teams[0]).toMatchObject({ complete: true, kills: 10, damage: 1000, gold: 5000 })
    expect(teams[0].players[0]).toMatchObject({ participantId: 6, damageShare: 20, killParticipation: 60, isTopDamage: true })
  })

  it('does not invent percentages or leader badges from missing data or zero denominators', () => {
    const missing = players().slice(0, 4)
    expect(buildScoreboardTeams([...missing, missing[0]])[0].players[0]).toMatchObject({ damageShare: null, killParticipation: null, isTopDamage: false })
    const unknown = players().slice(0, 5)
    unknown[2].damageToChampions = null
    expect(buildScoreboardTeams(unknown)[0].players[0]).toMatchObject({ damageShare: null, isTopDamage: false, killParticipation: 60 })
    const zeros = players().slice(0, 5).map((player) => ({ ...player, damageToChampions: 0, kills: 0, assists: 0 }))
    expect(buildScoreboardTeams(zeros)[0].players[0]).toMatchObject({ damageShare: null, killParticipation: null, isTopDamage: false })
  })
})
