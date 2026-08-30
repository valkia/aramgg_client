import type { ClientConfig } from '../../../data-loader.ts'
import logger from '../../../modules/logger.ts'
import { BACKGROUND_MAX_UPLOAD_BATCHES_PER_SYNC } from '../collection-policy.ts'
import type { LocalMatchHistoryService } from '../local-match-history-service.ts'
import type { MatchHistoryUploadResolution } from '../types.ts'
import {
  createSession,
  getDefaultFetch,
  getUploadSettings,
  gzipJson,
  isRecord,
  postJson,
  readJson,
  resolveAcknowledgements,
  resolveWholeBatch,
  retryAfterSeconds,
  type MatchHistoryUploadFetch,
  type UploadResponse,
  type UploadSession,
} from './protocol.ts'
import {
  getMatchHistoryUploadEligibility,
  MATCH_HISTORY_DISTRIBUTION_CHANNEL,
  type MatchHistoryUploadRuntime,
} from './runtime-policy.ts'

export const DEFAULT_MAX_BATCHES = BACKGROUND_MAX_UPLOAD_BATCHES_PER_SYNC

export type MatchHistoryUploadService = Pick<
  LocalMatchHistoryService,
  | 'discardUploadEntriesOutsidePatch'
  | 'getNextPendingUploadPlatform'
  | 'getUploadTelemetry'
  | 'claimUploadBatch'
  | 'resolveUploadBatch'
>

export type MatchHistoryUploadResult = {
  batches: number
  uploaded: number
  retried: number
  rejected: number
}

export type MatchHistoryUploaderOptions = {
  clientVersion: string
  runtime?: MatchHistoryUploadRuntime
  loadConfig?: () => Promise<ClientConfig>
  fetch?: MatchHistoryUploadFetch
  now?: () => number
  maxBatches?: number
}

function addResults(result: MatchHistoryUploadResult, resolutions: MatchHistoryUploadResolution[]): void {
  for (const resolution of resolutions) {
    if (resolution.outcome === 'uploaded') result.uploaded += 1
    else if (resolution.outcome === 'retry') result.retried += 1
    else result.rejected += 1
  }
}

async function loadDefaultConfig(): Promise<ClientConfig> {
  const { loadDataApiConfig } = await import('../../../data-loader.ts')
  return loadDataApiConfig()
}

export async function drainMatchHistoryUploads(
  service: MatchHistoryUploadService,
  options: MatchHistoryUploaderOptions,
): Promise<MatchHistoryUploadResult> {
  const result: MatchHistoryUploadResult = { batches: 0, uploaded: 0, retried: 0, rejected: 0 }
  const runtime = options.runtime ?? {
    isPackaged: false,
    distributionChannel: MATCH_HISTORY_DISTRIBUTION_CHANNEL,
  }
  const eligibility = getMatchHistoryUploadEligibility(runtime)
  if (!eligibility.allowed) {
    logger.debug('[match-history] upload disabled for runtime', {
      reason: eligibility.reason,
      packaged: runtime.isPackaged,
      distributionChannel: runtime.distributionChannel,
    })
    return result
  }

  let settings
  try {
    settings = getUploadSettings(await (options.loadConfig ?? loadDefaultConfig)())
  } catch (error) {
    logger.warn('[match-history] upload config rejected', {
      error: error instanceof Error ? error.message : String(error),
      sensitiveValuesLogged: false,
    })
    return result
  }
  if (!settings) {
    return result
  }

  const fetcher = options.fetch ?? await getDefaultFetch()
  const now = options.now ?? Date.now
  const maxBatches = options.maxBatches ?? settings.maxBatchesPerSync
  const discardedOtherPatchCount = await service.discardUploadEntriesOutsidePatch(settings.targetGamePatch)
  if (discardedOtherPatchCount > 0) {
    logger.info('[match-history] discarded non-target-patch upload entries', {
      targetGamePatch: settings.targetGamePatch,
      discardedCount: discardedOtherPatchCount,
    })
  }
  let session: UploadSession | null = null
  let sessionPlatformId: string | null = null
  let adaptiveBatchSize = settings.maxBatchSize

  for (let index = 0; index < maxBatches; index += 1) {
    const attemptAt = now()
    const platformId = await service.getNextPendingUploadPlatform(attemptAt, settings.targetGamePatch)
    if (!platformId) break
    const telemetry = await service.getUploadTelemetry()

    if (!session || sessionPlatformId !== platformId || session.expiresAt <= attemptAt + 5000) {
      try {
        session = await createSession(
          fetcher,
          settings,
          options.clientVersion,
          platformId,
          telemetry.installationId,
          attemptAt,
        )
      } catch {
        break
      }
      if (!session) break
      sessionPlatformId = platformId
    }

    const limit = Math.min(settings.maxBatchSize, session.maxBatchSize, adaptiveBatchSize)
    const claimed = await service.claimUploadBatch(platformId, limit, attemptAt, settings.targetGamePatch)
    if (!claimed.length) continue
    result.batches += 1
    const requestBodyJson = JSON.stringify({
      schemaVersion: 2,
      clientVersion: options.clientVersion,
      sentAt: new Date(attemptAt).toISOString(),
      pendingUploadCount: telemetry.pendingUploadCount,
      samples: claimed.map((item) => item.sample),
    })
    const requestBody = gzipJson(requestBodyJson)

    if (Buffer.byteLength(requestBodyJson) > session.maxBodyBytes || requestBody.byteLength > session.maxBodyBytes) {
      const outcome = claimed.length === 1 ? 'rejected' : 'retry'
      const resolutions = resolveWholeBatch(claimed, outcome, 'payload_too_large', attemptAt, 0)
      await service.resolveUploadBatch(resolutions, attemptAt)
      addResults(result, resolutions)
      adaptiveBatchSize = Math.max(1, Math.floor(claimed.length / 2))
      continue
    }

    let response: UploadResponse
    try {
      response = await postJson(fetcher, settings.batchUrl, requestBody, session.token)
      if (response.status === 401) {
        session = await createSession(
          fetcher,
          settings,
          options.clientVersion,
          platformId,
          telemetry.installationId,
          now(),
        )
        if (session) {
          response = await postJson(fetcher, settings.batchUrl, requestBody, session.token)
        }
      }
    } catch {
      const resolutions = resolveWholeBatch(claimed, 'retry', 'network_error', attemptAt)
      await service.resolveUploadBatch(resolutions, attemptAt)
      addResults(result, resolutions)
      session = null
      continue
    }

    let resolutions: MatchHistoryUploadResolution[]
    if (response.status === 200) {
      resolutions = resolveAcknowledgements(claimed, await readJson(response), attemptAt)
    } else if (response.status === 413) {
      resolutions = resolveWholeBatch(
        claimed,
        claimed.length === 1 ? 'rejected' : 'retry',
        'payload_too_large',
        attemptAt,
        0,
      )
      adaptiveBatchSize = Math.max(1, Math.floor(claimed.length / 2))
    } else {
      const errorPayload = await readJson(response)
      const retryable = response.status === 429 || response.status >= 500 || (isRecord(errorPayload) && errorPayload.retryable === true)
      const code = isRecord(errorPayload) && typeof errorPayload.code === 'string'
        ? errorPayload.code
        : `http_${response.status}`
      resolutions = resolveWholeBatch(
        claimed,
        retryable ? 'retry' : 'rejected',
        code,
        attemptAt,
        retryAfterSeconds(response),
      )
    }
    await service.resolveUploadBatch(resolutions, attemptAt)
    addResults(result, resolutions)
  }
  return result
}
