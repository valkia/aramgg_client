import axios from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LCUService } from '../../src/main/services/lcu/lcu-service.ts'
import { normalizeGame } from '../../src/main/services/match-history/local-match-history-service.ts'
import {
  HEXTECH_ARAM_QUEUE_TAG,
  SgpMatchHistoryService,
  getSgpMatchHistoryOrigin,
} from '../../src/main/services/match-history/sgp-match-history-service.ts'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}))

vi.mock('../../src/main/modules/logger.ts', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const puuid = '11111111-1111-1111-1111-111111111111'

function createLcuService(accessToken = 'private-entitlements-token'): LCUService {
  return {
    getEntitlementsAccessToken: vi.fn().mockResolvedValue(accessToken),
  } as unknown as LCUService
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('SGP match-history collection', () => {
  it('uses the built-in Tencent origin and reads a bounded q_2400 summary batch', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        games: [
          { metadata: { match_id: 'HN10_123' }, json: { gameId: 123, gameMode: 'KIWI' } },
          { metadata: { match_id: 'broken' } },
        ],
      },
    })
    const service = new SgpMatchHistoryService(createLcuService())

    const games = await service.getHextechAramSummaries(puuid, 'hn10', 0, 999)

    expect(games).toHaveLength(1)
    expect(games[0]).toMatchObject({ gameId: 123, gameMode: 'KIWI', participants: [] })
    expect(axios.get).toHaveBeenCalledWith(
      'https://hn10-k8s-sgp.lol.qq.com:21019/match-history-query/v1/products/lol/player/11111111-1111-1111-1111-111111111111/SUMMARY',
      expect.objectContaining({
        headers: { Authorization: 'Bearer private-entitlements-token' },
        params: {
          startIndex: 0,
          count: 200,
          tag: HEXTECH_ARAM_QUEUE_TAG,
          tagsQueryType: 'AND',
        },
        proxy: false,
        timeout: 15_000,
      }),
    )
  })

  it('rejects unsupported platforms before requesting a token or network origin', async () => {
    const lcuService = createLcuService()
    const service = new SgpMatchHistoryService(lcuService)

    await expect(service.getHextechAramSummaries(puuid, 'UNKNOWN', 0, 20))
      .rejects.toThrow('not configured for platform UNKNOWN')
    expect(lcuService.getEntitlementsAccessToken).not.toHaveBeenCalled()
    expect(axios.get).not.toHaveBeenCalled()
    expect(getSgpMatchHistoryOrigin('HN10')).toBe('https://hn10-k8s-sgp.lol.qq.com:21019')
  })

  it('normalizes flat SGP SUMMARY participants without per-game LCU requests', () => {
    const game = normalizeGame({
      gameId: 123,
      platformId: 'HN10',
      gameCreation: 100,
      gameDuration: 900,
      gameMode: 'KIWI',
      gameModeMutators: ['mapskin_map12_bloom'],
      gameType: 'MATCHED_GAME',
      gameVersion: '16.15',
      mapId: 12,
      queueId: 2400,
      endOfGameResult: 'GameComplete',
      participants: [{
        participantId: 1,
        puuid,
        riotIdGameName: 'Player One',
        riotIdTagline: 'CN1',
        championId: 266,
        teamId: 100,
        win: true,
        gameEndedInEarlySurrender: false,
        kills: 10,
        deaths: 2,
        assists: 8,
        item0: 1001,
        item1: 2003,
        item2: 0,
        item3: 0,
        item4: 0,
        item5: 0,
        item6: 0,
        playerAugment1: 18,
        playerAugment2: 42,
        playerAugment3: 0,
        playerAugment4: 0,
        playerAugment5: 0,
        playerAugment6: 0,
      }],
    }, 'HN10', 500)

    expect(game).toMatchObject({
      gameKey: 'HN10:123',
      gameMode: 'KIWI',
      queueId: 2400,
      gameModeMutators: ['mapskin_map12_bloom'],
    })
    expect(game?.participants).toEqual([
      expect.objectContaining({
        puuid,
        gameName: 'Player One',
        tagLine: 'CN1',
        championId: 266,
        win: true,
        items: [1001, 2003],
        augments: [18, 42],
      }),
    ])
  })
})
