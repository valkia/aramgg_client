import type { ClientConfig } from '../../../data-loader.ts'
import { resolveTrustedClientDataUrl } from '../../../../shared/client-data-security.ts'
import type {
  ClaimedMatchHistoryUploadSample,
  MatchHistoryUploadResolution,
} from '../types.ts'

const SESSION_PATH = '/api/client/v1/match-history/upload-session'
const BATCH_PATH = '/api/client/v1/match-history/batches'
const DEFAULT_MAX_BATCH_SIZE = 20
const MAX_BATCH_SIZE = 20
const MAX_BODY_BYTES = 1024 * 1024
const REQUEST_TIMEOUT_MS = 15 * 1000
const BASE_RETRY_DELAY_MS = 30 * 1000
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000
const DATA_API_ORIGIN = process.env.ARAMGG_DATA_API_ORIGIN || 'https://data.dtodo.cn'
const DATA_ALLOWED_ORIGINS = process.env.ARAMGG_DATA_ALLOWED_ORIGINS || ''

export type JsonRecord = Record<string, unknown>

export type UploadResponse = {
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}

export type MatchHistoryUploadFetch = (
  url: string,
  init: {
    method: 'POST'
    headers: Record<string, string>
    body: string
    signal: AbortSignal
  },
) => Promise<UploadResponse>

export type UploadSession = {
  token: string
  expiresAt: number
  maxBatchSize: number
  maxBodyBytes: number
}

export type UploadSettings = {
  sessionUrl: string
  batchUrl: string
  maxBatchSize: number
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getTrustedEndpoint(value: unknown, expectedPath: string): string {
  const configuredPath = value === undefined ? expectedPath : value
  if (typeof configuredPath !== 'string' || !configuredPath.trim()) {
    throw new Error('上传接口路径无效')
  }
  const url = new URL(resolveTrustedClientDataUrl(
    configuredPath,
    DATA_API_ORIGIN,
    DATA_ALLOWED_ORIGINS,
  ))
  if (url.pathname !== expectedPath || url.search || url.hash) {
    throw new Error(`上传接口路径不受信任：${url.pathname}`)
  }
  return url.toString()
}

export function getUploadSettings(config: ClientConfig): UploadSettings | null {
  const raw = config.matchHistoryUpload as unknown
  if (!isRecord(raw) || raw.enabled !== true) {
    return null
  }
  const configuredMax = raw.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE
  if (!Number.isInteger(configuredMax) || Number(configuredMax) < 1 || Number(configuredMax) > MAX_BATCH_SIZE) {
    throw new Error('上传批量上限无效')
  }
  return {
    sessionUrl: getTrustedEndpoint(raw.sessionPath, SESSION_PATH),
    batchUrl: getTrustedEndpoint(raw.batchPath, BATCH_PATH),
    maxBatchSize: Number(configuredMax),
  }
}

export async function getDefaultFetch(): Promise<MatchHistoryUploadFetch> {
  if (process.versions?.electron) {
    const { net } = await import('electron')
    return net.fetch.bind(net) as unknown as MatchHistoryUploadFetch
  }
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('当前运行时不支持 fetch')
  }
  return globalThis.fetch as unknown as MatchHistoryUploadFetch
}

export async function postJson(
  fetcher: MatchHistoryUploadFetch,
  url: string,
  body: string,
  authorization?: string,
): Promise<UploadResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetcher(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
      },
      body,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

export async function readJson(response: UploadResponse): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function parseSession(value: unknown, now: number): UploadSession | null {
  if (!isRecord(value)) {
    return null
  }
  const expiresAt = typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : Number.NaN
  if (
    typeof value.token !== 'string' || value.token.length < 16 || value.token.length > 4096 ||
    !Number.isFinite(expiresAt) || expiresAt <= now ||
    !Number.isInteger(value.maxBatchSize) || Number(value.maxBatchSize) < 1 || Number(value.maxBatchSize) > MAX_BATCH_SIZE ||
    !Number.isInteger(value.maxBodyBytes) || Number(value.maxBodyBytes) < 1 || Number(value.maxBodyBytes) > MAX_BODY_BYTES
  ) {
    return null
  }
  return {
    token: value.token,
    expiresAt,
    maxBatchSize: Number(value.maxBatchSize),
    maxBodyBytes: Number(value.maxBodyBytes),
  }
}

export async function createSession(
  fetcher: MatchHistoryUploadFetch,
  settings: UploadSettings,
  clientVersion: string,
  platformId: string,
  installationId: string,
  now: number,
): Promise<UploadSession | null> {
  const response = await postJson(fetcher, settings.sessionUrl, JSON.stringify({
    schemaVersion: 2,
    clientVersion,
    platformId,
    installationId,
  }))
  if (response.status !== 200) {
    return null
  }
  return parseSession(await readJson(response), now)
}

export function getRetryAt(attempts: number, now: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined && retryAfterSeconds >= 0) {
    return now + Math.min(retryAfterSeconds * 1000, MAX_RETRY_DELAY_MS)
  }
  const exponent = Math.min(Math.max(attempts - 1, 0), 10)
  return now + Math.min(BASE_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS)
}

export function retryAfterSeconds(response: UploadResponse): number | undefined {
  const value = Number(response.headers.get('retry-after'))
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export function resolveWholeBatch(
  claimed: ClaimedMatchHistoryUploadSample[],
  outcome: 'retry' | 'rejected',
  code: string,
  now: number,
  retryAfter?: number,
): MatchHistoryUploadResolution[] {
  return claimed.map(({ sample, attempts }) => ({
    sourceKey: sample.sourceKey,
    idempotencyKey: sample.idempotencyKey,
    outcome,
    code,
    nextAttemptAt: outcome === 'retry' ? getRetryAt(attempts, now, retryAfter) : null,
  }))
}

export function resolveAcknowledgements(
  claimed: ClaimedMatchHistoryUploadSample[],
  payload: unknown,
  now: number,
): MatchHistoryUploadResolution[] {
  const rawAcknowledgements = isRecord(payload) && Array.isArray(payload.acknowledgements)
    ? payload.acknowledgements
    : []
  const acknowledgements = new Map<string, JsonRecord>()
  for (const acknowledgement of rawAcknowledgements) {
    if (isRecord(acknowledgement)) {
      acknowledgements.set(`${String(acknowledgement.sourceKey)}\0${String(acknowledgement.idempotencyKey)}`, acknowledgement)
    }
  }

  return claimed.map(({ sample, attempts }) => {
    const acknowledgement = acknowledgements.get(`${sample.sourceKey}\0${sample.idempotencyKey}`)
    const status = acknowledgement?.status
    const code = typeof acknowledgement?.code === 'string' ? acknowledgement.code : 'invalid_acknowledgement'
    if (status === 'inserted' || status === 'duplicate' || status === 'updated') {
      return { sourceKey: sample.sourceKey, idempotencyKey: sample.idempotencyKey, outcome: 'uploaded' }
    }
    if (status === 'rejected' && acknowledgement?.retryable === false) {
      return { sourceKey: sample.sourceKey, idempotencyKey: sample.idempotencyKey, outcome: 'rejected', code }
    }
    return {
      sourceKey: sample.sourceKey,
      idempotencyKey: sample.idempotencyKey,
      outcome: 'retry',
      code,
      nextAttemptAt: getRetryAt(attempts, now),
    }
  })
}
