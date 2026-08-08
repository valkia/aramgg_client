import { describe, expect, it, vi } from 'vitest'
import type { ClientConfig } from '../../src/main/data-loader.ts'
import type {
  ClaimedMatchHistoryUploadSample,
  MatchHistoryUploadResolution,
} from '../../src/main/services/match-history/types.ts'
import type {
  MatchHistoryUploadFetch,
  UploadResponse,
} from '../../src/main/services/match-history/upload/protocol.ts'
import {
  DEFAULT_MAX_BATCHES,
  drainMatchHistoryUploads,
  type MatchHistoryUploadService,
} from '../../src/main/services/match-history/upload/uploader.ts'

const NOW = Date.parse('2026-08-05T14:00:00.000Z')
const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111'

function config(enabled = true): ClientConfig {
  return {
    matchHistoryUpload: {
      enabled,
      sessionPath: '/api/client/v1/match-history/upload-session',
      batchPath: '/api/client/v1/match-history/batches',
      maxBatchSize: 20,
    },
  }
}

function response(status: number, payload: unknown, headers: Record<string, string> = {}): UploadResponse {
  return {
    status,
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null
      },
    },
    async json() {
      return payload
    },
  }
}

function session(token = 'session-token-1234567890'): UploadResponse {
  return response(200, {
    token,
    expiresAt: new Date(NOW + 15 * 60 * 1000).toISOString(),
    maxBatchSize: 20,
    maxBodyBytes: 1024 * 1024,
  })
}

function claimed(gameId = 123, idempotencyCharacter = 'a'): ClaimedMatchHistoryUploadSample {
  return {
    attempts: 1,
    sample: {
      sourceKey: `match-history:v1:HN10:${gameId}`,
      idempotencyKey: idempotencyCharacter.repeat(64),
      payloadHash: 'b'.repeat(64),
      observedAt: new Date(NOW - 1000).toISOString(),
      game: {
        platformId: 'HN10',
        gameId,
        gameCreation: NOW - 60_000,
        gameDuration: 900,
        gameMode: 'KIWI',
        gameModeMutators: ['mapskin_ha_bilgewater'],
        gameType: 'MATCHED_GAME',
        gameVersion: '16.15.1',
        mapId: 12,
        queueId: 2400,
        endOfGameResult: 'GameComplete',
        participants: [{
          participantId: 1,
          puuid: 'test-puuid-12345678',
          gameName: '测试玩家',
          tagLine: 'ARAM',
          championId: 53,
          teamId: 100,
          playerSubteamId: 1,
          subteamPlacement: 1,
          win: true,
          gameEndedInEarlySurrender: false,
          kills: 4,
          deaths: 9,
          assists: 27,
          items: [4646],
          augments: [1238],
        }],
      },
    },
  }
}

function fakeService(samples: ClaimedMatchHistoryUploadSample[]): {
  service: MatchHistoryUploadService
  resolutions: MatchHistoryUploadResolution[]
} {
  let available = samples.length > 0
  const resolutions: MatchHistoryUploadResolution[] = []
  return {
    resolutions,
    service: {
      async getNextPendingUploadPlatform() {
        return available ? 'HN10' : null
      },
      async claimUploadBatch(_platformId, limit) {
        available = false
        return samples.slice(0, limit)
      },
      async getUploadTelemetry() {
        return {
          installationId: INSTALLATION_ID,
          pendingUploadCount: available ? samples.length : 0,
        }
      },
      async resolveUploadBatch(next) {
        resolutions.push(...next)
      },
    },
  }
}

describe('match-history uploader', () => {
  it('drains at most 100 matches per default round', () => {
    expect(DEFAULT_MAX_BATCHES).toBe(5)
  })

  it('does nothing while the cf-api config switch is disabled', async () => {
    const { service } = fakeService([claimed()])
    const fetcher = vi.fn()

    const result = await drainMatchHistoryUploads(service, {
      clientVersion: '0.2.9',
      loadConfig: async () => config(false),
      fetch: fetcher as unknown as MatchHistoryUploadFetch,
      now: () => NOW,
    })

    expect(result).toEqual({ batches: 0, uploaded: 0, retried: 0, rejected: 0 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a config that redirects uploads to another same-origin write path', async () => {
    const { service } = fakeService([claimed()])
    const fetcher = vi.fn()

    const result = await drainMatchHistoryUploads(service, {
      clientVersion: '0.2.9',
      loadConfig: async () => ({
        matchHistoryUpload: {
          ...config().matchHistoryUpload,
          batchPath: '/api/client/v1/other-write-endpoint',
        },
      }),
      fetch: fetcher as unknown as MatchHistoryUploadFetch,
      now: () => NOW,
    })

    expect(result.batches).toBe(0)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses the short session and uploads PUUID plus Riot ID to the trusted batch path', async () => {
    const item = claimed()
    const { service, resolutions } = fakeService([item])
    const requests: Array<{ url: string; authorization?: string; body: unknown }> = []
    const fetcher: MatchHistoryUploadFetch = async (url, init) => {
      requests.push({ url, authorization: init.headers.authorization, body: JSON.parse(init.body) })
      if (url.endsWith('/upload-session')) return session()
      return response(200, {
        serverTime: new Date(NOW).toISOString(),
        acknowledgements: [{
          sourceKey: item.sample.sourceKey,
          idempotencyKey: item.sample.idempotencyKey,
          status: 'inserted',
        }],
      })
    }

    const result = await drainMatchHistoryUploads(service, {
      clientVersion: '0.2.9',
      loadConfig: async () => config(),
      fetch: fetcher,
      now: () => NOW,
    })

    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/api/client/v1/match-history/upload-session',
      '/api/client/v1/match-history/batches',
    ])
    expect(requests[0].body).toEqual({
      schemaVersion: 2,
      clientVersion: '0.2.9',
      platformId: 'HN10',
      installationId: INSTALLATION_ID,
    })
    expect(requests[1].authorization).toBe('Bearer session-token-1234567890')
    expect(requests[1].body).toMatchObject({ schemaVersion: 2, pendingUploadCount: 1 })
    expect((requests[1].body as any).samples[0].game.participants[0]).toMatchObject({
      puuid: 'test-puuid-12345678',
      gameName: '测试玩家',
      tagLine: 'ARAM',
    })
    expect(result.uploaded).toBe(1)
    expect(resolutions).toEqual([expect.objectContaining({ outcome: 'uploaded' })])
  })

  it('renews one expired session after 401 and resends the same idempotent batch', async () => {
    const item = claimed()
    const { service, resolutions } = fakeService([item])
    let sessionCount = 0
    let batchCount = 0
    const fetcher: MatchHistoryUploadFetch = async (url) => {
      if (url.endsWith('/upload-session')) {
        sessionCount += 1
        return session(`session-token-${sessionCount}-1234567890`)
      }
      batchCount += 1
      if (batchCount === 1) return response(401, { code: 'unauthorized', retryable: true })
      return response(200, {
        serverTime: new Date(NOW).toISOString(),
        acknowledgements: [{
          sourceKey: item.sample.sourceKey,
          idempotencyKey: item.sample.idempotencyKey,
          status: 'duplicate',
        }],
      })
    }

    await drainMatchHistoryUploads(service, {
      clientVersion: '0.2.9',
      loadConfig: async () => config(),
      fetch: fetcher,
      now: () => NOW,
    })

    expect(sessionCount).toBe(2)
    expect(batchCount).toBe(2)
    expect(resolutions).toEqual([expect.objectContaining({ outcome: 'uploaded' })])
  })

  it('separates retryable and permanent per-sample rejections', async () => {
    const first = claimed(123, 'a')
    const second = claimed(456, 'c')
    const { service, resolutions } = fakeService([first, second])
    const fetcher: MatchHistoryUploadFetch = async (url) => {
      if (url.endsWith('/upload-session')) return session()
      return response(200, {
        serverTime: new Date(NOW).toISOString(),
        acknowledgements: [
          {
            sourceKey: first.sample.sourceKey,
            idempotencyKey: first.sample.idempotencyKey,
            status: 'rejected',
            code: 'storage_unavailable',
            retryable: true,
          },
          {
            sourceKey: second.sample.sourceKey,
            idempotencyKey: second.sample.idempotencyKey,
            status: 'rejected',
            code: 'unsupported_game',
            retryable: false,
          },
        ],
      })
    }

    const result = await drainMatchHistoryUploads(service, {
      clientVersion: '0.2.9',
      loadConfig: async () => config(),
      fetch: fetcher,
      now: () => NOW,
    })

    expect(result).toMatchObject({ retried: 1, rejected: 1 })
    expect(resolutions).toEqual([
      expect.objectContaining({ outcome: 'retry', code: 'storage_unavailable' }),
      expect.objectContaining({ outcome: 'rejected', code: 'unsupported_game' }),
    ])
  })
})
