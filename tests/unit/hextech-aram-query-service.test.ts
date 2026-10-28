import { describe, expect, it } from 'vitest'
import {
  MAX_HEXTECH_ARAM_QUERY_COUNT,
  MAX_HEXTECH_ARAM_QUERY_START_INDEX,
  buildHextechAramMatchHistoryPage,
  normalizeHextechAramQuery,
} from '../../src/main/services/match-history/hextech-aram-query-service.ts'
import type { StoredMatchHistoryGame } from '../../src/main/services/match-history/types.ts'
import { normalizeGame } from '../../src/main/services/match-history/local-match-history-service.ts'

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
        augments: new Map([[18, { name: '海克斯强化', description: '强化说明', rarity: 'kPrismatic' }]]),
        items: new Map([[223047, { name: '终局装备', description: '<mainText>装备说明</mainText>' }]]),
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
    expect(page.matches[1].augments[0]).toEqual({ id: 18, name: '海克斯强化', description: '强化说明', rarity: 'kPrismatic' })
    expect(page.matches[1].items[0]).toEqual({ id: 223047, name: '终局装备', description: '<mainText>装备说明</mainText>' })
    expect(page.matches[1].participants?.[0].augments).toEqual(page.matches[1].augments)
    expect(page.matches[1].participants?.[0].items).toEqual(page.matches[1].items)
    expect(page.matches[1].items[1]).toEqual({ id: 2003 })
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

  it('maps all ten players by participant ID, with localized assets and no renderer PUUIDs', () => {
    const rawGame = {
      gameId: 10, gameCreation: 1_000, gameMode: 'KIWI', queueId: 2400,
      participants: Array.from({ length: 10 }, (_, index) => ({
        participantId: index + 1, puuid: index === 0 ? currentPuuid : `other-player-${index}`,
        riotIdGameName: `Player ${index + 1}`, riotIdTagline: 'CN1',
        championId: 103, teamId: index < 5 ? 100 : 200, win: index < 5,
        kills: 10, deaths: 2, assists: 8, totalDamageDealtToChampions: (index + 1) * 1000,
        totalDamageTaken: 12_000, goldEarned: 10_000, totalMinionsKilled: 50, neutralMinionsKilled: 2,
        pentaKills: index === 0 ? 1 : 0, tripleKills: 2, quadraKills: 0,
        item0: 1001, playerAugment1: 18,
      })).reverse(),
    }
    const normalized = normalizeGame(rawGame, 'HN1', 2_000)!
    const page = buildHextechAramMatchHistoryPage({
      games: [normalized], rawGames: [rawGame], currentPuuid, playerName: 'Player 1#CN1',
      platformId: 'HN1', startIndex: 0, count: 10, scannedCount: 1, queriedAt: 2_000,
      labels: { champions: new Map([[103, { name: '阿狸' }]]), augments: new Map([[18, { name: '海克斯' }]]) },
    })
    expect(page.matches[0].participants).toHaveLength(10)
    expect(page.matches[0].participants?.find((player) => player.isCurrentPlayer)).toMatchObject({
      participantId: 1, playerName: 'Player 1#CN1', championName: '阿狸', result: 'win',
      damageToChampions: 1_000, damageTaken: 12_000, goldEarned: 10_000, minionsKilled: 52,
      pentaKills: 1, augments: [{ id: 18, name: '海克斯' }], items: [{ id: 1001 }],
    })
    expect(JSON.stringify(page)).not.toContain(currentPuuid)
    expect(normalized.participants[0]).not.toHaveProperty('goldEarned')
  })

  it('keeps unavailable or invalid detailed metrics null, including legacy history', () => {
    const options = {
      games: [game()], currentPuuid, playerName: '', platformId: 'HN10',
      startIndex: 0, count: 10, scannedCount: 1, queriedAt: 1_000,
    }
    expect(buildHextechAramMatchHistoryPage(options).matches[0].participants?.[0]).toMatchObject({
      damageToChampions: null, goldEarned: null, minionsKilled: null,
    })
    const page = buildHextechAramMatchHistoryPage({ ...options, rawGames: [{ gameId: 1, participants: [{
      participantId: 1, stats: { totalDamageDealtToChampions: -1, totalDamageTaken: '0', goldEarned: '',
        totalMinionsKilled: 2, neutralMinionsKilled: null, pentaKills: Infinity, tripleKills: true },
    }] }] })
    expect(page.matches[0].participants?.[0]).toMatchObject({
      damageToChampions: null, damageTaken: 0, goldEarned: null, minionsKilled: null, pentaKills: null, tripleKills: null,
    })
  })
})
