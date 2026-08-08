export const BACKGROUND_INITIAL_CURRENT_MATCH_LIMIT = 200
export const BACKGROUND_REFRESH_CURRENT_MATCH_LIMIT = 10
export const BACKGROUND_MATCHED_PLAYER_LIMIT = 3
export const BACKGROUND_MATCHED_MATCH_LIMIT = 20
export const BACKGROUND_REQUEST_PACING_MS = 250
export const BACKGROUND_SYNC_INTERVAL_MS = 3 * 60 * 1000
export const BACKGROUND_SYNC_MIN_GAP_MS = 60 * 1000

export function getBackgroundCurrentMatchLimit(historyScanLimit: number | null | undefined): number {
  return (historyScanLimit ?? 0) >= BACKGROUND_INITIAL_CURRENT_MATCH_LIMIT
    ? BACKGROUND_REFRESH_CURRENT_MATCH_LIMIT
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
