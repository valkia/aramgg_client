import { describe, expect, it } from 'vitest'
import type { HextechAramMatchHistoryMatch, HextechAramMatchParticipant } from '../../src/shared/ipc-contract.ts'
import { buildMatchEncounters } from '../../src/renderer/services/match-encounters.ts'
import { getMatchHistoryPlayerKey } from '../../src/main/services/match-history/player-identity.ts'

function player(id: number, overrides: Partial<HextechAramMatchParticipant> = {}): HextechAramMatchParticipant {
  return { participantId: id, playerKey: `HN1:${id.toString(16).padStart(64, '0')}`, teamId: 100, playerName: 'Same name', isCurrentPlayer: id === 1,
    championId: 103, result: 'win', kills: 8, deaths: 2, assists: 12, damageToChampions: null, damageTaken: null,
    totalHeal: null, damageToTurrets: null, spell1Id: null, spell2Id: null,
    goldEarned: null, minionsKilled: null, tripleKills: 0, quadraKills: 0, pentaKills: 0, items: [], augments: [], ...overrides }
}
function match(id: number, overrides: Partial<HextechAramMatchHistoryMatch> = {}): HextechAramMatchHistoryMatch {
  return { gameId: id, gameCreation: id * 1000, gameDuration: 900, gameVersion: '16.21', championId: 103, result: 'win', kills: 8, deaths: 2, assists: 12,
    items: [], augments: [], participants: [player(1), player(2)], ...overrides }
}

describe('repeated encounters on the loaded page', () => {
  it('uses stable region-scoped opaque keys and rejects missing identities', () => {
    const key = getMatchHistoryPlayerKey('HN1', 'player-0001')!
    expect(key).toMatch(/^HN1:[a-f0-9]{64}$/)
    expect(key).not.toContain('player-0001')
    expect(getMatchHistoryPlayerKey('hn1', 'player-0001')).toBe(key)
    expect(getMatchHistoryPlayerKey('HN10', 'player-0001')).not.toBe(key)
    expect(getMatchHistoryPlayerKey('HN1', 'player-0002')).not.toBe(key)
    expect(getMatchHistoryPlayerKey('UNKNOWN', 'player-0001')).toBeUndefined()
    expect(getMatchHistoryPlayerKey('HN1', null)).toBeUndefined()
  })

  it('tracks changing teams, my results and the encountered player score without counting a game twice', () => {
    const newest = match(3, { result: 'remake', participants: [player(1), player(2, { teamId: 200, playerName: 'Newest name', kills: 1 })] })
    const result = buildMatchEncounters([match(1), newest, match(2, { result: 'loss' }), newest])
    expect(result).toMatchObject({ totalMatches: 3, coveredMatches: 3, players: [{ playerName: 'Newest name', sameTeam: 2, opponents: 1, wins: 1, losses: 1, remakes: 1 }] })
    expect(result.players[0].encounters.map((entry) => entry.gameId)).toEqual([3, 2, 1])
    expect(result.players[0].encounters[0]).toMatchObject({ sameTeam: false, result: 'remake', kills: 1 })
  })

  it('never joins names or identities from different regions, and excludes the current player', () => {
    expect(buildMatchEncounters([match(1), match(2, { participants: [player(1), player(3)] })]).players).toEqual([])
    expect(buildMatchEncounters([match(1), match(2, { participants: [player(1), player(2, { playerKey: `HN10:${'2'.padStart(64, '0')}` })] })]).players).toEqual([])
    expect(buildMatchEncounters([match(1), match(2)]).players.map((entry) => entry.playerKey)).toEqual([player(2).playerKey])
  })

  it('deduplicates repeated participant entries and rejects conflicting team identities', () => {
    expect(buildMatchEncounters([match(1, { participants: [player(1), player(2), player(2)] }), match(2)]).players[0].encounters).toHaveLength(2)
    expect(buildMatchEncounters([match(1, { participants: [player(1), player(2), player(2, { teamId: 200 })] }), match(2)]).players).toEqual([])
  })

  it('omits missing identities, unknown teams and ambiguous current players from coverage', () => {
    const result = buildMatchEncounters([
      match(1), match(2, { participants: [] }), match(3, { participants: [player(2)] }),
      match(4, { participants: [player(1, { teamId: 0 }), player(2)] }),
      match(5, { participants: [player(1), player(2, { isCurrentPlayer: true })] }),
      match(6, { participants: [player(1), player(2, { playerKey: undefined })] }),
      match(7, { participants: [player(1), player(2, { teamId: 0 })] }),
    ])
    expect(result).toMatchObject({ totalMatches: 7, coveredMatches: 1, players: [] })
    expect(buildMatchEncounters([])).toMatchObject({ totalMatches: 0, coveredMatches: 0, players: [] })
  })

  it('sorts by encounter count before recency and rebuilds from the current page only', () => {
    const matches = [match(1), match(2), match(3), match(4, { participants: [player(1), player(3)] }), match(5, { participants: [player(1), player(3)] })]
    expect(buildMatchEncounters(matches).players.map((entry) => entry.playerKey)).toEqual([player(2).playerKey, player(3).playerKey])
    expect(buildMatchEncounters([matches[0]]).players).toEqual([])
  })
})
