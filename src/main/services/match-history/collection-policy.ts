import type { ClientConfig } from '../../data-loader.ts'

export const BACKGROUND_INITIAL_CURRENT_MATCH_LIMIT = 200
export const BACKGROUND_REFRESH_CURRENT_MATCH_LIMIT = 10
export const BACKGROUND_MATCHED_PLAYER_LIMIT = 6
export const BACKGROUND_MATCHED_MATCH_LIMIT = 20
export const BACKGROUND_MAX_UPLOAD_BATCHES_PER_SYNC = 7
export const BACKGROUND_REQUEST_PACING_MS = 250
export const BACKGROUND_SYNC_INTERVAL_MS = 3 * 60 * 1000
export const BACKGROUND_SYNC_MIN_GAP_MS = 60 * 1000

export type MatchHistoryCollectionPolicy = {
  refreshCurrentMatchLimit: number
  matchedPlayerLimit: number
  matchedMatchLimit: number
  maxBatchesPerSync: number
  targetGamePatch: string | null
}

export const DEFAULT_MATCH_HISTORY_COLLECTION_POLICY: MatchHistoryCollectionPolicy = {
  refreshCurrentMatchLimit: BACKGROUND_REFRESH_CURRENT_MATCH_LIMIT,
  matchedPlayerLimit: BACKGROUND_MATCHED_PLAYER_LIMIT,
  matchedMatchLimit: BACKGROUND_MATCHED_MATCH_LIMIT,
  maxBatchesPerSync: BACKGROUND_MAX_UPLOAD_BATCHES_PER_SYNC,
  targetGamePatch: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : fallback
}

function targetGamePatch(value: unknown): string | null {
  return typeof value === 'string' && /^\d{1,3}\.\d{1,3}$/.test(value.trim())
    ? value.trim()
    : null
}

export function isMatchHistoryGameVersionForPatch(gameVersion: string, patch: string): boolean {
  return gameVersion === patch || gameVersion.startsWith(`${patch}.`)
}

export function getMatchHistoryCollectionPolicy(
  config: ClientConfig | null | undefined,
): MatchHistoryCollectionPolicy {
  const upload = config?.matchHistoryUpload as unknown
  if (!isRecord(upload) || !isRecord(upload.collectionPolicy)) {
    return { ...DEFAULT_MATCH_HISTORY_COLLECTION_POLICY }
  }
  const policy = upload.collectionPolicy
  return {
    refreshCurrentMatchLimit: boundedInteger(
      policy.refreshCurrentMatchLimit,
      BACKGROUND_REFRESH_CURRENT_MATCH_LIMIT,
      1,
      50,
    ),
    matchedPlayerLimit: boundedInteger(policy.matchedPlayerLimit, BACKGROUND_MATCHED_PLAYER_LIMIT, 0, 10),
    matchedMatchLimit: boundedInteger(policy.matchedMatchLimit, BACKGROUND_MATCHED_MATCH_LIMIT, 1, 50),
    maxBatchesPerSync: boundedInteger(
      policy.maxBatchesPerSync,
      BACKGROUND_MAX_UPLOAD_BATCHES_PER_SYNC,
      1,
      10,
    ),
    targetGamePatch: targetGamePatch(policy.targetGamePatch),
  }
}

export function getBackgroundCurrentMatchLimit(
  historyScanLimit: number | null | undefined,
  policy: MatchHistoryCollectionPolicy = DEFAULT_MATCH_HISTORY_COLLECTION_POLICY,
): number {
  return (historyScanLimit ?? 0) >= BACKGROUND_INITIAL_CURRENT_MATCH_LIMIT
    ? policy.refreshCurrentMatchLimit
    : BACKGROUND_INITIAL_CURRENT_MATCH_LIMIT
}

export function getBackgroundSyncCoalesceCause(params: {
  inFlight: boolean
  lastCompletedAt: number
  now: number
  minimumGapMs?: number
}): 'in-flight' | 'minimum-gap' | null {
  if (params.inFlight) {
    return 'in-flight'
  }
  const minimumGapMs = params.minimumGapMs ?? BACKGROUND_SYNC_MIN_GAP_MS
  return params.lastCompletedAt > 0 && params.now - params.lastCompletedAt < minimumGapMs
    ? 'minimum-gap'
    : null
}
