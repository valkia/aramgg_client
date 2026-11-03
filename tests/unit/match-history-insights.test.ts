import { describe, expect, it } from 'vitest'
import type { HextechAramMatchHistoryMatch, HextechAramMatchParticipant } from '../../src/shared/ipc-contract.ts'
import { buildScoreboardTeams, perMinute, summarizeMatches } from '../../src/renderer/services/match-history-insights.ts'

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

function performanceMatch(gameId: number, overrides: Partial<HextechAramMatchHistoryMatch> = {}) {
  return match(gameId, 'win', { participants: players().map((player, index) => ({
    ...player, isCurrentPlayer: index === 0, participationStats: { kills: player.kills, assists: player.assists },
  })), ...overrides })
}

describe('page performance metrics', () => {
  it('uses the current player and averages per-game shares, excluding remakes and duplicate games', () => {
    const first = performanceMatch(1)
    first.participants![0].damageToChampions = 10_000
    first.participants!.slice(0, 5).forEach((player) => { player.goldEarned = 2_000 })
    const second = performanceMatch(2)
    second.participants!.slice(0, 5).forEach((player) => { player.goldEarned = 2_500 })
    Object.assign(second.participants![0], { damageToChampions: 30_000, goldEarned: 10_000, participationStats: { kills: 2, assists: 0 } })
    second.participants!.reverse()
    const remake = performanceMatch(3, { result: 'remake' })
    expect(summarizeMatches([first, second, first, remake]).performance).toEqual({
      damage: { value: 20_000, samples: 2 }, participation: { value: 40, samples: 2 },
      gold: { value: 6_000, samples: 2 }, goldShare: { value: 35, samples: 2 },
    })
  })

  it('tracks independent samples and retains personal stats when team fields are missing or incomplete', () => {
    const first = performanceMatch(1)
    first.participants![0].damageToChampions = 0
    const missing = performanceMatch(2)
    Object.assign(missing.participants![0], { damageToChampions: null, goldEarned: 2_000 })
    Object.assign(missing.participants![1], { goldEarned: null, participationStats: { kills: null, assists: 4 } })
    const incomplete = performanceMatch(3)
    incomplete.participants = incomplete.participants!.slice(0, 4)
    Object.assign(incomplete.participants[0], { damageToChampions: 600, goldEarned: 3_000 })
    const performance = summarizeMatches([first, missing, incomplete, match(4, 'loss')]).performance
    expect(performance).toEqual({
      damage: { value: 300, samples: 2 }, participation: { value: 60, samples: 1 },
      gold: { value: 2_000, samples: 3 }, goldShare: { value: 20, samples: 1 },
    })
  })

  it('keeps genuine zeros but excludes zero denominators and unavailable raw kill/assist stats', () => {
    const zero = performanceMatch(1)
    zero.participants!.forEach((player) => Object.assign(player, {
      kills: 0, assists: 0, participationStats: { kills: 0, assists: 0 }, damageToChampions: 0, goldEarned: 0,
    }))
    expect(summarizeMatches([zero]).performance).toEqual({
      damage: { value: 0, samples: 1 }, participation: { value: null, samples: 0 },
      gold: { value: 0, samples: 1 }, goldShare: { value: null, samples: 0 },
    })
    const noParticipation = performanceMatch(2)
    noParticipation.participants![0].participationStats = { kills: 0, assists: 0 }
    expect(summarizeMatches([noParticipation]).performance.participation).toEqual({ value: 0, samples: 1 })
    for (const stats of [undefined, { kills: null, assists: 0 }, { kills: 0, assists: null }, { kills: 2, assists: 99 }]) {
      noParticipation.participants![0].participationStats = stats
      expect(summarizeMatches([noParticipation]).performance.participation).toEqual({ value: null, samples: 0 })
    }
  })

  it('requires a single unambiguous current player before attributing personal stats', () => {
    const ambiguous = [
      (list: HextechAramMatchParticipant[]) => { list[0].isCurrentPlayer = false },
      (list: HextechAramMatchParticipant[]) => { list[5].isCurrentPlayer = true },
      (list: HextechAramMatchParticipant[]) => { list[5].participantId = list[0].participantId },
      (list: HextechAramMatchParticipant[]) => { list[0].playerKey = list[5].playerKey = 'HN1:same-player' },
      (list: HextechAramMatchParticipant[]) => { list[0].championId = 266 },
      (list: HextechAramMatchParticipant[]) => { list[0].result = 'loss' },
    ]
    for (const change of ambiguous) {
      const game = performanceMatch(1)
      change(game.participants!)
      expect(Object.values(summarizeMatches([game]).performance)).toEqual(Array(4).fill({ value: null, samples: 0 }))
    }
  })

  it('rejects ambiguous team slots or player identities rather than inflating percentage samples', () => {
    const ambiguous = [
      (list: HextechAramMatchParticipant[]) => { list[2].participantId = list[1].participantId },
      (list: HextechAramMatchParticipant[]) => { list[2].playerKey = list[1].playerKey = 'HN1:same-player' },
      (list: HextechAramMatchParticipant[]) => { list[2].teamId = 200 },
      (list: HextechAramMatchParticipant[]) => { list[2].result = 'loss' },
      (list: HextechAramMatchParticipant[]) => { list[0].teamId = 0 },
    ]
    for (const change of ambiguous) {
      const game = performanceMatch(1)
      change(game.participants!)
      const performance = summarizeMatches([game]).performance
      expect(performance.damage.samples).toBe(1)
      expect(performance.participation).toEqual({ value: null, samples: 0 })
      expect(performance.goldShare).toEqual({ value: null, samples: 0 })
    }
    const duplicate = performanceMatch(2)
    duplicate.participants!.push({ ...duplicate.participants![2] })
    expect(summarizeMatches([duplicate]).performance.goldShare.samples).toBe(0)
  })

  it('excludes invalid numeric fields without fabricating zero averages', () => {
    for (const invalid of [null, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const game = performanceMatch(1)
      Object.assign(game.participants![0], { damageToChampions: invalid, goldEarned: invalid })
      const performance = summarizeMatches([game]).performance
      expect(performance.damage).toEqual({ value: null, samples: 0 })
      expect(performance.gold).toEqual({ value: null, samples: 0 })
      expect(performance.goldShare).toEqual({ value: null, samples: 0 })
    }
    expect(Object.values(summarizeMatches([match(1, 'remake')]).performance)).toEqual(Array(4).fill({ value: null, samples: 0 }))
  })
})

function players(): HextechAramMatchParticipant[] {
  return Array.from({ length: 10 }, (_, index) => ({
    participantId: index + 1, teamId: index < 5 ? 100 : 200, playerName: `Player ${index}`,
    isCurrentPlayer: index === 7, championId: 103, result: index < 5 ? 'win' : 'loss',
    kills: 2, deaths: 1, assists: 4, damageToChampions: index < 5 ? 100 : 200,
    damageTaken: 200, totalHeal: 50, damageToTurrets: 500, goldEarned: 1000, minionsKilled: 20,
    spell1Id: 4, spell2Id: 32, participationStats: { kills: 2, assists: 4 },
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
    zeros.forEach((player) => { player.participationStats = { kills: 0, assists: 0 } })
    expect(buildScoreboardTeams(zeros)[0].players[0]).toMatchObject({ damageShare: null, killParticipation: null, isTopDamage: false })
  })

  it('compares damage taken and total healing only within a valid team and computes rates from seconds', () => {
    const list = players()
    list[0].damageTaken = 400
    list[0].totalHeal = 0
    const player = buildScoreboardTeams(list, 600)[1].players[0]
    expect(player).toMatchObject({ takenShare: 400 / 1200 * 100, healShare: 0, goldPerMinute: 100, csPerMinute: 2 })
    list[1].totalHeal = null
    expect(buildScoreboardTeams(list, 600)[1].players[0]).toMatchObject({ takenShare: 400 / 1200 * 100, healShare: null })
    list.slice(0, 5).forEach((entry) => { entry.totalHeal = 0 })
    expect(buildScoreboardTeams(list, 600)[1].players[0].healShare).toBeNull()
  })

  it('rejects ambiguous team membership, invalid values and overflowing totals for comparison bars', () => {
    const changes = [
      (list: HextechAramMatchParticipant[]) => { list.push({ ...list[0] }) },
      (list: HextechAramMatchParticipant[]) => { list[5].participantId = list[0].participantId },
      (list: HextechAramMatchParticipant[]) => { list[0].playerKey = list[1].playerKey = 'HN1:duplicate' },
      (list: HextechAramMatchParticipant[]) => { list[1].result = 'loss' },
      (list: HextechAramMatchParticipant[]) => { list[0].teamId = 0 },
    ]
    for (const change of changes) {
      const list = players()
      change(list)
      const player = buildScoreboardTeams(list, 600).flatMap((team) => team.players).find((entry) => entry.participantId === 1)!
      expect(player).toMatchObject({ damageShare: null, takenShare: null, healShare: null, killParticipation: null, isTopDamage: false })
    }
    for (const value of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER]) {
      const list = players()
      list[0].damageTaken = value
      expect(buildScoreboardTeams(list)[1].players[0].takenShare).toBeNull()
    }
  })

  it('keeps raw missing or contradictory participation unavailable rather than using normalized zero or capping it', () => {
    const list = players().slice(0, 5)
    list[0].participationStats = { kills: 2, assists: null }
    expect(buildScoreboardTeams(list)[0].players[0].killParticipation).toBeNull()
    list[0].participationStats = { kills: 2, assists: 20 }
    expect(buildScoreboardTeams(list)[0].players[0].killParticipation).toBeNull()
    list[1].participationStats = { kills: null, assists: 4 }
    expect(buildScoreboardTeams(list)[0].kills).toBeNull()
    expect(buildScoreboardTeams(list)[0].players.every((entry) => entry.killParticipation === null)).toBe(true)
  })

  it('preserves real zero rates and rejects absent, nonfinite or nonpositive duration and invalid numerators', () => {
    expect(perMinute(0, 600)).toBe(0)
    expect(perMinute(52, 900)).toBeCloseTo(3.4666667)
    for (const duration of [0, -1, Infinity, NaN, Number.MIN_VALUE]) expect(perMinute(10, duration)).toBeNull()
    for (const value of [null, NaN, Infinity, -1, 1.5]) expect(perMinute(value, 600)).toBeNull()
    expect(buildScoreboardTeams(players())[0].players[0]).toMatchObject({ goldPerMinute: null, csPerMinute: null })
  })
})
