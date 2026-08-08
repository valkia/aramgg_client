import { createHash } from 'node:crypto'
import type {
  ClaimedMatchHistoryUploadSample,
  LocalMatchHistoryData,
  MatchHistoryUploadGame,
  MatchHistoryUploadResolution,
  MatchHistoryUploadSample,
  StoredMatchHistoryGame,
} from './types.ts'

export function getGameKey(platformId: string, gameId: number): string {
  return `${platformId}:${gameId}`
}

export function getUploadSourceKey(game: StoredMatchHistoryGame): string {
  return `match-history:v1:${game.platformId}:${game.gameId}`
}

function getLegacyLcuSourceKey(game: StoredMatchHistoryGame): string {
  return `lcu-match-history:v1:${game.platformId}:${game.gameId}`
}

export function toMatchHistoryUploadGame(game: StoredMatchHistoryGame): MatchHistoryUploadGame {
  const { gameKey: _gameKey, collectedAt: _collectedAt, ...uploadGame } = game
  return uploadGame
}

function getGamePayloadHash(game: StoredMatchHistoryGame): string {
  return createHash('sha256').update(JSON.stringify(toMatchHistoryUploadGame(game))).digest('hex')
}

function getIdempotencyKey(sourceKey: string, payloadHash: string): string {
  return createHash('sha256').update(`${sourceKey}:${payloadHash}`).digest('hex')
}

/**
 * The entry is keyed by region + game ID, never by page offset. Re-reading a
 * shifted match-history page therefore cannot create a duplicate upload.
 */
export function queueGameForUpload(data: LocalMatchHistoryData, game: StoredMatchHistoryGame): void {
  const sourceKey = getUploadSourceKey(game)
  const legacySourceKey = getLegacyLcuSourceKey(game)
  const payloadHash = getGamePayloadHash(game)
  const existing = data.uploadOutbox[sourceKey] || data.uploadOutbox[legacySourceKey]
  const tombstone = data.uploadedGameTombstones[sourceKey]
  if (legacySourceKey !== sourceKey) {
    delete data.uploadOutbox[legacySourceKey]
  }
  if (!existing && tombstone?.payloadHash === payloadHash) {
    return
  }
  if (tombstone) {
    delete data.uploadedGameTombstones[sourceKey]
  }
  if (existing?.payloadHash === payloadHash) {
    data.uploadOutbox[sourceKey] = {
      ...existing,
      sourceKey,
      idempotencyKey: getIdempotencyKey(sourceKey, payloadHash),
      status: existing.status === 'uploading' ? 'pending' : existing.status,
      nextAttemptAt: existing.nextAttemptAt ?? null,
      lastErrorCode: existing.lastErrorCode ?? null,
    }
    return
  }

  data.uploadOutbox[sourceKey] = {
    sourceKey,
    idempotencyKey: getIdempotencyKey(sourceKey, payloadHash),
    payloadHash,
    platformId: game.platformId,
    gameId: game.gameId,
    status: 'pending',
    attempts: existing?.attempts || 0,
    queuedAt: existing?.queuedAt || Date.now(),
    lastAttemptAt: null,
    nextAttemptAt: null,
    lastErrorCode: null,
    uploadedAt: null,
  }
}

export function createMatchHistoryUploadSample(
  entry: LocalMatchHistoryData['uploadOutbox'][string],
  game: StoredMatchHistoryGame,
): MatchHistoryUploadSample {
  return {
    sourceKey: entry.sourceKey,
    idempotencyKey: entry.idempotencyKey,
    payloadHash: entry.payloadHash,
    observedAt: new Date(game.collectedAt).toISOString(),
    game: toMatchHistoryUploadGame(game),
  }
}

function isDue(entry: LocalMatchHistoryData['uploadOutbox'][string], now: number): boolean {
  return entry.status === 'pending' &&
    entry.platformId !== 'UNKNOWN' &&
    /^[A-Z0-9]{2,16}$/.test(entry.platformId) &&
    (entry.nextAttemptAt ?? 0) <= now
}

export function getNextPendingMatchHistoryUploadPlatform(
  data: LocalMatchHistoryData,
  now = Date.now(),
): string | null {
  return Object.values(data.uploadOutbox)
    .filter((entry) => isDue(entry, now))
    .sort((left, right) => left.queuedAt - right.queuedAt || left.sourceKey.localeCompare(right.sourceKey))[0]
    ?.platformId ?? null
}

export function claimMatchHistoryUploadBatch(
  data: LocalMatchHistoryData,
  platformId: string,
  limit: number,
  now = Date.now(),
): ClaimedMatchHistoryUploadSample[] {
  const claimed: ClaimedMatchHistoryUploadSample[] = []
  const candidates = Object.values(data.uploadOutbox)
    .filter((entry) => entry.platformId === platformId && isDue(entry, now))
    .sort((left, right) => left.queuedAt - right.queuedAt || left.sourceKey.localeCompare(right.sourceKey))

  for (const entry of candidates) {
    if (claimed.length >= limit) {
      break
    }
    const game = data.games[getGameKey(entry.platformId, entry.gameId)]
    if (!game) {
      entry.status = 'rejected'
      entry.nextAttemptAt = null
      entry.lastErrorCode = 'missing_local_game'
      continue
    }

    entry.status = 'uploading'
    entry.attempts += 1
    entry.lastAttemptAt = now
    entry.nextAttemptAt = null
    entry.lastErrorCode = null
    claimed.push({
      sample: createMatchHistoryUploadSample(entry, game),
      attempts: entry.attempts,
    })
  }
  return claimed
}

export function resolveMatchHistoryUploadBatch(
  data: LocalMatchHistoryData,
  resolutions: MatchHistoryUploadResolution[],
  now = Date.now(),
): void {
  for (const resolution of resolutions) {
    const entry = data.uploadOutbox[resolution.sourceKey]
    if (!entry || entry.idempotencyKey !== resolution.idempotencyKey) {
      continue
    }

    entry.lastErrorCode = resolution.code ?? null
    if (resolution.outcome === 'uploaded') {
      data.uploadedGameTombstones[entry.sourceKey] = {
        payloadHash: entry.payloadHash,
        uploadedAt: now,
      }
      delete data.uploadOutbox[entry.sourceKey]
    } else if (resolution.outcome === 'retry') {
      entry.status = 'pending'
      entry.uploadedAt = null
      entry.nextAttemptAt = resolution.nextAttemptAt ?? now
    } else {
      entry.status = 'rejected'
      entry.uploadedAt = null
      entry.nextAttemptAt = null
    }
  }
}
