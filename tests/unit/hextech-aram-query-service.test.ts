import { describe, expect, it } from 'vitest'
import {
  MAX_HEXTECH_ARAM_QUERY_COUNT,
  MAX_HEXTECH_ARAM_QUERY_START_INDEX,
  buildHextechAramMatchHistoryPage,
  normalizeHextechAramQuery,
} from '../../src/main/services/match-history/hextech-aram-query-service.ts'
import type { StoredMatchHistoryGame } from '../../src/main/services/match-history/types.ts'

const currentPuuid = '11111111-1111-1111-1111-111111111111'

function game(overrides: Partial<StoredMatchHistoryGame> = {}): StoredMatchHistoryGame {
  return {
    gameKey: 'HN10:1',
    platformId: 'HN10',
    gameId: 1,
    gameCreation: 100,
    gameDuration: 900,
    gameMode: 'KIWI',
    gameModeMutators: ['aram_mayhem'],
    gameType: 'MATCHED_GAME',
    gameVersion: '16.17',
    mapId: 12,
    queueId: 2400,
    endOfGameResult: 'GameComplete',
    participants: [{
      participantId: 1,
      puuid: currentPuuid,
      gameName: 'Player One',
      tagLine: 'CN1',
      championId: 266,
      teamId: 100,
      playerSubteamId: 0,
      subteamPlacement: 0,
      win: true,
      gameEndedInEarlySurrender: false,
      kills: 10,
      deaths: 2,
      assists: 8,
      items: [223047, 2003],
      augments: [18, 42],
    }],
    collectedAt: 200,
    ...overrides,
  }
}

describe('Hextech ARAM match-history query', () => {
  it('bounds renderer-controlled pagination values', () => {
    expect(normalizeHextechAramQuery(undefined)).toEqual({ startIndex: 0, count: 10 })
    expect(normalizeHextechAramQuery({ startIndex: -1, count: 0 })).toEqual({
      startIndex: 0,
      count: 10,
    })
    expect(normalizeHextechAramQuery({ startIndex: 999_999, count: 999 })).toEqual({
      startIndex: MAX_HEXTECH_ARAM_QUERY_START_INDEX,
      count: MAX_HEXTECH_ARAM_QUERY_COUNT,
    })
  })

  it('returns only the current player\'s KIWI matches and preserves pagination state', () => {
    const normalAram = game({
      gameKey: 'HN10:2',
      gameId: 2,
      gameCreation: 300,
      gameMode: 'ARAM',
      gameModeMutators: [],
      queueId: 450,
      participants: [game().participants[0]],
    })
    const missingCurrentPlayer = game({
      gameKey: 'HN10:3',
      gameId: 3,
      gameCreation: 400,
      participants: [{
        ...game().participants[0],
        puuid: '22222222-2222-2222-2222-222222222222',
      }],
    })
    const newestLoss = game({
      gameKey: 'HN10:4',
      gameId: 4,
      gameCreation: 500,
      participants: [{ ...game().participants[0], championId: 103, win: false }],
    })

    const page = buildHextechAramMatchHistoryPage({
      games: [game(), normalAram, missingCurrentPlayer, newestLoss, newestLoss],
      currentPuuid,
      playerName: 'Player One#CN1',
      platformId: 'HN10',
      startIndex: 10,
      count: 5,
      scannedCount: 5,
      queriedAt: 1_000,
      labels: {
        champions: new Map([[103, { name: '阿狸', iconUrl: 'https://example.com/ahri.png' }]]),
        augments: new Map([[18, { name: '海克斯强化' }]]),
        items: new Map([[223047, { name: '终局装备' }]]),
      },
    })

    expect(page).toMatchObject({
      playerName: 'Player One#CN1',
      platformId: 'HN10',
      startIndex: 10,
      count: 5,
      returnedCount: 2,
      hasPrevious: true,
      hasMore: true,
    })
    expect(page.matches.map((match) => match.gameId)).toEqual([4, 1])
    expect(page.matches[0]).toMatchObject({
      result: 'loss',
      championId: 103,
      championName: '阿狸',
      championIconUrl: 'https://example.com/ahri.png',
    })
    expect(page.matches[1].augments[0]).toEqual({ id: 18, name: '海克斯强化' })
    expect(page.matches[1].items[0]).toEqual({ id: 223047, name: '终局装备' })
  })

  it('marks aborted and early-surrender matches as remakes', () => {
    const page = buildHextechAramMatchHistoryPage({
      games: [game({ endOfGameResult: 'Abort_AntiCheatExit' })],
      currentPuuid,
      playerName: 'Player One#CN1',
      platformId: 'HN10',
      startIndex: 0,
      count: 10,
      scannedCount: 1,
      queriedAt: 1_000,
    })

    expect(page.matches[0].result).toBe('remake')
    expect(page.hasMore).toBe(false)
  })
})
