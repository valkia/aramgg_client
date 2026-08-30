export const OFFICIAL_MATCH_HISTORY_DISTRIBUTION_CHANNEL = 'official'
export const DEFAULT_MATCH_HISTORY_UPLOAD_ORIGIN = 'http://127.0.0.1:8787'

export const MATCH_HISTORY_DISTRIBUTION_CHANNEL = String(
  import.meta.env.ARAMGG_DISTRIBUTION_CHANNEL || 'local',
).trim().toLowerCase()

export const MATCH_HISTORY_UPLOAD_ORIGIN = String(
  import.meta.env.ARAMGG_MATCH_HISTORY_UPLOAD_ORIGIN || DEFAULT_MATCH_HISTORY_UPLOAD_ORIGIN,
).trim()

export type MatchHistoryUploadRuntime = {
  isPackaged: boolean
  distributionChannel: string
}

export type MatchHistoryUploadEligibility = {
  allowed: boolean
  reason: 'allowed' | 'not_packaged' | 'unofficial_distribution'
}

export function getMatchHistoryUploadEligibility(
  runtime: MatchHistoryUploadRuntime,
): MatchHistoryUploadEligibility {
  if (!runtime.isPackaged) {
    return { allowed: false, reason: 'not_packaged' }
  }

  if (runtime.distributionChannel.trim().toLowerCase() !== OFFICIAL_MATCH_HISTORY_DISTRIBUTION_CHANNEL) {
    return { allowed: false, reason: 'unofficial_distribution' }
  }

  return { allowed: true, reason: 'allowed' }
}
