import { describe, expect, it, vi } from 'vitest'
import { gunzipSync } from 'node:zlib'
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
import { MATCH_HISTORY_UPLOAD_ORIGIN } from '../../src/main/services/match-history/upload/runtime-policy.ts'

const NOW = Date.parse('2026-08-05T14:00:00.000Z')
const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111'
const OFFICIAL_PACKAGED_RUNTIME = {
  isPackaged: true,
  distributionChannel: 'official',
} as const

function config(cloudflareEnabled = true): ClientConfig {
  return {
    matchHistoryUpload: {
      enabled: false,
      cloudflareEnabled,
      sessionPath: '/api/client/v1/match-history/upload-session',
      batchPath: '/api/client/v1/match-history/batches',
      maxBatchSize: 20,
      collectionPolicy: {
        refreshCurrentMatchLimit: 10,
        matchedPlayerLimit: 6,
        matchedMatchLimit: 20,
        maxBatchesPerSync: 7,
        targetGamePatch: '16.17',
      },
    },
  }
}

function parseRequestBody(init: Parameters<MatchHistoryUploadFetch>[1]): unknown {
  if (typeof init.body === 'string') return JSON.parse(init.body)
  return JSON.parse(gunzipSync(init.body).toString('utf8'))
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
        gameVersion: '16.17.1',
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
      async discardUploadEntriesOutsidePatch() {
        return 0
      },
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
  it('drains at most 140 matches per default round', () => {
    expect(DEFAULT_MAX_BATCHES).toBe(7)
  })

  it('uses all seven configured batches for the target patch', async () => {
    const targetPatches: Array<string | null> = []
    const resolutions: MatchHistoryUploadResolution[] = []
    let remaining = 7
    const service: MatchHistoryUploadService = {
      async discardUploadEntriesOutsidePatch(targetGamePatch) {
        targetPatches.push(targetGamePatch)
        return 0
      },
      async getNextPendingUploadPlatform(_now, targetGamePatch) {
        targetPatches.push(targetGamePatch)
        return remaining > 0 ? 'HN10' : null
      },
      async claimUploadBatch(_platformId, _limit, _now, targetGamePatch) {
        targetPatches.push(targetGamePatch)
        const item = claimed(1_000 + remaining, String.fromCharCode(96 + remaining))
        remaining -= 1
        return [item]
      },
      async getUploadTelemetry() {
        return { installationId: INSTALLATION_ID, pendingUploadCount: remaining }
      },
      async resolveUploadBatch(next) {
        resolutions.push(...next)
      },
    }
    const fetcher: MatchHistoryUploadFetch = async (url, init) => {
      if (url.endsWith('/upload-session')) return session()
      const body = parseRequestBody(init) as { samples: ClaimedMatchHistoryUploadSample['sample'][] }
      return response(200, {
        serverTime: new Date(NOW).toISOString(),
        acknowledgements: body.samples.map((sample) => ({
          sourceKey: sample.sourceKey,
          idempotencyKey: sample.idempotencyKey,
          status: 'inserted',
        })),
      })
    }

    const result = await drainMatchHistoryUploads(service, {
      clientVersion: '0.2.13',
      runtime: OFFICIAL_PACKAGED_RUNTIME,
      loadConfig: async () => config(),
      fetch: fetcher,
      now: () => NOW,
    })

    expect(result).toEqual({ batches: 7, uploaded: 7, retried: 0, rejected: 0 })
    expect(resolutions).toHaveLength(7)
    expect(targetPatches).toHaveLength(15)
    expect(targetPatches.every((patch) => patch === '16.17')).toBe(true)
  })

  it('does nothing while the Cloudflare config switch is disabled', async () => {
    const { service } = fakeService([claimed()])
    const fetcher = vi.fn()

    const result = await drainMatchHistoryUploads(service, {
      clientVersion: '0.2.9',
      runtime: OFFICIAL_PACKAGED_RUNTIME,
      loadConfig: async () => config(false),
      fetch: fetcher as unknown as MatchHistoryUploadFetch,
      now: () => NOW,
    })

    expect(result).toEqual({ batches: 0, uploaded: 0, retried: 0, rejected: 0 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('fails closed when the target game patch is missing', async () => {
    const { service } = fakeService([claimed()])
    const fetcher = vi.fn()
    const invalidConfig = config()
    delete invalidConfig.matchHistoryUpload?.collectionPolicy?.targetGamePatch

    const result = await drainMatchHistoryUploads(service, {
      clientVersion: '0.2.13',
      runtime: OFFICIAL_PACKAGED_RUNTIME,
      loadConfig: async () => invalidConfig,
      fetch: fetcher as unknown as MatchHistoryUploadFetch,
      now: () => NOW,
    })

    expect(result).toEqual({ batches: 0, uploaded: 0, retried: 0, rejected: 0 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    { runtime: undefined, label: 'missing runtime evidence' },
    { runtime: { isPackaged: false, distributionChannel: 'official' }, label: 'development runtime' },
    { runtime: { isPackaged: true, distributionChannel: 'local' }, label: 'unofficial package' },
  ])('does not contact upload endpoints for $label', async ({ runtime }) => {
    const { service } = fakeService([claimed()])
    const fetcher = vi.fn()

    const result = await drainMatchHistoryUploads(service, {
      clientVersion: '0.2.9',
      ...(runtime ? { runtime } : {}),
      loadConfig: async () => config(),
      fetch: fetcher as unknown as MatchHistoryUploadFetch,
      now: () => NOW,
    })

    expect(result).toEqual({ batches: 0, uploaded: 0, retried: 0, rejected: 0 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not reuse the legacy EdgeOne enabled switch', async () => {
    const { service } = fakeService([claimed()])
    const fetcher = vi.fn()
    const legacyConfig = config(false)
    legacyConfig.matchHistoryUpload!.enabled = true

    const result = await drainMatchHistoryUploads(service, {
      clientVersion: '0.2.11',
      runtime: OFFICIAL_PACKAGED_RUNTIME,
      loadConfig: async () => legacyConfig,
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
      runtime: OFFICIAL_PACKAGED_RUNTIME,
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
    const requests: Array<{
      url: string
      authorization?: string
      contentEncoding?: string
      body: unknown
    }> = []
    const fetcher: MatchHistoryUploadFetch = async (url, init) => {
      requests.push({
        url,
        authorization: init.headers.authorization,
        contentEncoding: init.headers['content-encoding'],
        body: parseRequestBody(init),
      })
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
      runtime: OFFICIAL_PACKAGED_RUNTIME,
      loadConfig: async () => config(),
      fetch: fetcher,
      now: () => NOW,
    })

    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/api/client/v1/match-history/upload-session',
      '/api/client/v1/match-history/batches',
    ])
    expect(requests.map((request) => new URL(request.url).origin)).toEqual([
      MATCH_HISTORY_UPLOAD_ORIGIN,
      MATCH_HISTORY_UPLOAD_ORIGIN,
    ])
    expect(requests[0].body).toEqual({
      schemaVersion: 2,
      clientVersion: '0.2.9',
      platformId: 'HN10',
      installationId: INSTALLATION_ID,
    })
    expect(requests[1].authorization).toBe('Bearer session-token-1234567890')
    expect(requests[0].contentEncoding).toBeUndefined()
    expect(requests[1].contentEncoding).toBe('gzip')
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
      runtime: OFFICIAL_PACKAGED_RUNTIME,
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
      runtime: OFFICIAL_PACKAGED_RUNTIME,
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

  it('keeps legacy game_archived acknowledgements retryable during server rollout', async () => {
    const item = claimed()
    const { service, resolutions } = fakeService([item])
    const fetcher: MatchHistoryUploadFetch = async (url) => {
      if (url.endsWith('/upload-session')) return session()
      return response(200, {
        serverTime: new Date(NOW).toISOString(),
        acknowledgements: [{
          sourceKey: item.sample.sourceKey,
          idempotencyKey: item.sample.idempotencyKey,
          status: 'rejected',
          code: 'game_archived',
          retryable: false,
        }],
      })
    }

    const result = await drainMatchHistoryUploads(service, {
      clientVersion: '0.2.10',
      runtime: OFFICIAL_PACKAGED_RUNTIME,
      loadConfig: async () => config(),
      fetch: fetcher,
      now: () => NOW,
    })

    expect(result).toMatchObject({ retried: 1, rejected: 0 })
    expect(resolutions).toEqual([
      expect.objectContaining({ outcome: 'retry', code: 'game_archived' }),
    ])
  })
})
