export const LOCAL_MATCH_HISTORY_SCHEMA_VERSION = 2

export type MatchHistoryCollectionSource = 'current' | 'matched'
export type MatchHistoryUploadStatus = 'pending' | 'uploading' | 'uploaded' | 'rejected'

export interface StoredMatchHistoryPlayer {
  playerKey: string
  puuid: string
  platformId: string
  gameName: string
  tagLine: string
  summonerId: number | null
  isCurrentUser: boolean
  /** True only when this player shared a stored match with the local user. */
  isDirectEncounter?: boolean
  firstSeenAt: number
  lastSeenAt: number
  historyCollectedAt: number | null
  lastHistoryScanAt: number | null
  /** Largest successfully completed history request, used for one-time backfills. */
  historyScanLimit?: number
  collectionSource: MatchHistoryCollectionSource | null
}

export interface StoredMatchHistoryParticipant {
  participantId: number
  puuid: string | null
  gameName: string
  tagLine: string
  championId: number
  teamId: number
  playerSubteamId: number
  subteamPlacement: number
  win: boolean
  gameEndedInEarlySurrender: boolean
  kills: number
  deaths: number
  assists: number
  items: number[]
  augments: number[]
}

export interface StoredMatchHistoryGame {
  gameKey: string
  platformId: string
  gameId: number
  gameCreation: number
  gameDuration: number
  gameMode: string
  gameModeMutators: string[]
  gameType: string
  gameVersion: string
  mapId: number
  queueId: number
  endOfGameResult: string
  participants: StoredMatchHistoryParticipant[]
  collectedAt: number
}

/** Exact game object accepted by cf-api; local storage metadata is omitted. */
export type MatchHistoryUploadGame = Omit<StoredMatchHistoryGame, 'gameKey' | 'collectedAt'>

export interface MatchHistoryUploadSample {
  sourceKey: string
  idempotencyKey: string
  payloadHash: string
  observedAt: string
  game: MatchHistoryUploadGame
}

export interface ClaimedMatchHistoryUploadSample {
  sample: MatchHistoryUploadSample
  attempts: number
}

export interface MatchHistoryUploadResolution {
  sourceKey: string
  idempotencyKey: string
  outcome: 'uploaded' | 'retry' | 'rejected'
  code?: string
  nextAttemptAt?: number | null
}

/**
 * Uploads remain in this local outbox until cf-api explicitly acknowledges them.
 * `sourceKey` is the server-side unique key; `idempotencyKey` identifies this exact payload.
 */
export interface MatchHistoryUploadOutboxEntry {
  sourceKey: string
  idempotencyKey: string
  payloadHash: string
  platformId: string
  gameId: number
  status: MatchHistoryUploadStatus
  attempts: number
  queuedAt: number
  lastAttemptAt: number | null
  nextAttemptAt: number | null
  lastErrorCode: string | null
  uploadedAt: number | null
}

export interface UploadedMatchHistoryTombstone {
  payloadHash: string
  uploadedAt: number
}

export interface MatchHistoryUploadTelemetry {
  installationId: string
  pendingUploadCount: number
}

export interface LocalMatchHistoryData {
  schemaVersion: typeof LOCAL_MATCH_HISTORY_SCHEMA_VERSION
  updatedAt: number
  installationId: string
  activePlatformId: string | null
  currentPlayerKey: string | null
  players: Record<string, StoredMatchHistoryPlayer>
  games: Record<string, StoredMatchHistoryGame>
  uploadOutbox: Record<string, MatchHistoryUploadOutboxEntry>
  uploadedGameTombstones: Record<string, UploadedMatchHistoryTombstone>
}
