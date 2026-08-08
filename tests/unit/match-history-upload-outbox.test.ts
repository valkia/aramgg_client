import { describe, expect, it } from 'vitest'
import {
  claimMatchHistoryUploadBatch,
  queueGameForUpload,
  resolveMatchHistoryUploadBatch,
  toMatchHistoryUploadGame,
} from '../../src/main/services/match-history/upload-outbox.ts'
import {
  compactLocalMatchHistoryData,
  MAX_STORED_MATCH_HISTORY_GAMES,
  MAX_UPLOADED_MATCH_HISTORY_TOMBSTONES,
} from '../../src/main/services/match-history/storage/retention.ts'
import type { LocalMatchHistoryData, StoredMatchHistoryGame } from '../../src/main/services/match-history/types.ts'

function createData(): LocalMatchHistoryData {
  return {
    schemaVersion: 2,
    updatedAt: 0,
    installationId: '11111111-1111-4111-8111-111111111111',
    activePlatformId: 'HN10',
    currentPlayerKey: null,
    players: {},
    games: {},
    uploadOutbox: {},
    uploadedGameTombstones: {},
  }
}

function createGame(overrides: Partial<StoredMatchHistoryGame> = {}): StoredMatchHistoryGame {
  return {
    gameKey: 'HN10:123',
    platformId: 'HN10',
    gameId: 123,
    gameCreation: 1,
    gameDuration: 900,
    gameMode: 'ARAM',
    gameModeMutators: [],
    gameType: 'MATCHED_GAME',
    gameVersion: '16.15',
    mapId: 12,
    queueId: 450,
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
    collectedAt: 100,
    ...overrides,
  }
}

describe('match-history upload outbox', () => {
  it('deduplicates a re-read game by platform + game ID instead of its page index', () => {
    const data = createData()
    const game = createGame()

    queueGameForUpload(data, game)
    const entry = data.uploadOutbox['match-history:v1:HN10:123']
    entry.status = 'uploaded'
    queueGameForUpload(data, { ...game, collectedAt: 999 })

    expect(Object.keys(data.uploadOutbox)).toEqual(['match-history:v1:HN10:123'])
    expect(data.uploadOutbox['match-history:v1:HN10:123']).toMatchObject({
      status: 'uploaded',
      gameId: 123,
      platformId: 'HN10',
    })
  })

  it('migrates the legacy LCU source key without creating a second outbox record', () => {
    const data = createData()
    const game = createGame()
    queueGameForUpload(data, game)
    const current = data.uploadOutbox['match-history:v1:HN10:123']
    delete data.uploadOutbox[current.sourceKey]
    data.uploadOutbox['lcu-match-history:v1:HN10:123'] = {
      ...current,
      sourceKey: 'lcu-match-history:v1:HN10:123',
      status: 'uploaded',
    }

    queueGameForUpload(data, game)

    expect(Object.keys(data.uploadOutbox)).toEqual(['match-history:v1:HN10:123'])
    expect(data.uploadOutbox['match-history:v1:HN10:123']).toMatchObject({
      sourceKey: 'match-history:v1:HN10:123',
      status: 'uploaded',
    })
  })

  it('updates one source record when a completed game payload changes instead of enqueuing a duplicate', () => {
    const data = createData()
    const game = createGame()
    queueGameForUpload(data, game)
    const firstIdempotencyKey = data.uploadOutbox['match-history:v1:HN10:123'].idempotencyKey

    queueGameForUpload(data, { ...game, gameVersion: '16.15.1' })

    expect(Object.keys(data.uploadOutbox)).toHaveLength(1)
    expect(data.uploadOutbox['match-history:v1:HN10:123']).toMatchObject({ status: 'pending' })
    expect(data.uploadOutbox['match-history:v1:HN10:123'].idempotencyKey).not.toBe(firstIdempotencyKey)
  })

  it('uses a compact upload tombstone until the game payload changes', () => {
    const data = createData()
    const game = createGame()
    data.games[game.gameKey] = game
    queueGameForUpload(data, game)
    const claimed = claimMatchHistoryUploadBatch(data, 'HN10', 20, 200)
    resolveMatchHistoryUploadBatch(data, [{
      sourceKey: claimed[0].sample.sourceKey,
      idempotencyKey: claimed[0].sample.idempotencyKey,
      outcome: 'uploaded',
    }], 300)

    queueGameForUpload(data, { ...game, collectedAt: 400 })
    expect(data.uploadOutbox).toEqual({})

    queueGameForUpload(data, { ...game, gameVersion: '16.15.1', collectedAt: 500 })
    expect(data.uploadedGameTombstones).toEqual({})
    expect(data.uploadOutbox['match-history:v1:HN10:123']).toMatchObject({ status: 'pending' })
  })

  it('removes only local metadata and keeps PUUID plus Riot ID in the upload game', () => {
    const uploadGame = toMatchHistoryUploadGame(createGame())

    expect(uploadGame).not.toHaveProperty('gameKey')
    expect(uploadGame).not.toHaveProperty('collectedAt')
    expect(uploadGame.participants[0]).toMatchObject({
      puuid: 'test-puuid-12345678',
      gameName: '测试玩家',
      tagLine: 'ARAM',
    })
  })

  it('claims due entries and applies retry, acknowledgement, and permanent rejection states', () => {
    const data = createData()
    const firstGame = createGame()
    data.games[firstGame.gameKey] = firstGame
    queueGameForUpload(data, firstGame)

    const firstClaim = claimMatchHistoryUploadBatch(data, 'HN10', 20, 200)
    expect(firstClaim).toHaveLength(1)
    expect(firstClaim[0].sample.observedAt).toBe(new Date(100).toISOString())
    expect(data.uploadOutbox[firstClaim[0].sample.sourceKey]).toMatchObject({
      status: 'uploading',
      attempts: 1,
    })

    resolveMatchHistoryUploadBatch(data, [{
      sourceKey: firstClaim[0].sample.sourceKey,
      idempotencyKey: firstClaim[0].sample.idempotencyKey,
      outcome: 'retry',
      code: 'storage_unavailable',
      nextAttemptAt: 500,
    }], 250)
    expect(claimMatchHistoryUploadBatch(data, 'HN10', 20, 499)).toEqual([])

    const retried = claimMatchHistoryUploadBatch(data, 'HN10', 20, 500)
    resolveMatchHistoryUploadBatch(data, [{
      sourceKey: retried[0].sample.sourceKey,
      idempotencyKey: retried[0].sample.idempotencyKey,
      outcome: 'uploaded',
    }], 600)
    expect(data.uploadOutbox[retried[0].sample.sourceKey]).toBeUndefined()
    expect(data.uploadedGameTombstones[retried[0].sample.sourceKey]).toMatchObject({
      uploadedAt: 600,
      payloadHash: retried[0].sample.payloadHash,
    })

    const rejectedGame = createGame({ gameKey: 'HN10:456', gameId: 456 })
    data.games[rejectedGame.gameKey] = rejectedGame
    queueGameForUpload(data, rejectedGame)
    const rejected = claimMatchHistoryUploadBatch(data, 'HN10', 20, 700)
    resolveMatchHistoryUploadBatch(data, [{
      sourceKey: rejected[0].sample.sourceKey,
      idempotencyKey: rejected[0].sample.idempotencyKey,
      outcome: 'rejected',
      code: 'unsupported_game',
    }], 800)
    expect(data.uploadOutbox[rejected[0].sample.sourceKey]).toMatchObject({
      status: 'rejected',
      lastErrorCode: 'unsupported_game',
    })
  })

  it('compacts uploaded bodies but never removes a pending game', () => {
    const data = createData()
    for (let index = 1; index <= MAX_STORED_MATCH_HISTORY_GAMES + 1; index += 1) {
      const game = createGame({
        gameKey: `HN10:${index}`,
        gameId: index,
        gameCreation: index,
        collectedAt: index,
      })
      data.games[game.gameKey] = game
      queueGameForUpload(data, game)
      const entry = data.uploadOutbox[`match-history:v1:HN10:${index}`]
      entry.status = 'uploaded'
      entry.uploadedAt = index
    }
    const pending = createGame({ gameKey: 'HN10:999999', gameId: 999999, gameCreation: 0 })
    data.games[pending.gameKey] = pending
    queueGameForUpload(data, pending)

    compactLocalMatchHistoryData(data)

    expect(Object.keys(data.games)).toHaveLength(MAX_STORED_MATCH_HISTORY_GAMES)
    expect(data.games[pending.gameKey]).toBeDefined()
    expect(data.games['HN10:1']).toBeUndefined()
    expect(data.uploadOutbox['match-history:v1:HN10:999999']).toMatchObject({ status: 'pending' })
    expect(Object.keys(data.uploadedGameTombstones)).toHaveLength(MAX_STORED_MATCH_HISTORY_GAMES + 1)
    expect(MAX_UPLOADED_MATCH_HISTORY_TOMBSTONES).toBeGreaterThan(MAX_STORED_MATCH_HISTORY_GAMES)
  })
})
