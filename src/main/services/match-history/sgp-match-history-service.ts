import axios from 'axios'
import logger from '../../modules/logger.ts'
import type LCUService from '../lcu/lcu-service.ts'
import { logMatchHistoryDev } from './dev-diagnostics.ts'

export const HEXTECH_ARAM_QUEUE_ID = 2400
export const HEXTECH_ARAM_QUEUE_TAG = `q_${HEXTECH_ARAM_QUEUE_ID}`
export const SGP_MATCH_HISTORY_MAX_PAGE_SIZE = 200

const SGP_MATCH_HISTORY_TIMEOUT_MS = 15_000
const SGP_MAX_ATTEMPTS = 3
const SGP_RETRY_BASE_DELAY_MS = 250

/**
 * Built-in allowlist derived from LeagueAkari's SGP server table. Remote data
 * cannot add origins; endpoint changes require a reviewed client release.
 */
const SGP_MATCH_HISTORY_ORIGINS: Readonly<Record<string, string>> = Object.freeze({
  HN1: 'https://hn1-k8s-sgp.lol.qq.com:21019',
  HN10: 'https://hn10-k8s-sgp.lol.qq.com:21019',
  TJ100: 'https://tj100-sgp.lol.qq.com:21019',
  TJ101: 'https://tj101-sgp.lol.qq.com:21019',
  NJ100: 'https://nj100-sgp.lol.qq.com:21019',
  GZ100: 'https://gz100-sgp.lol.qq.com:21019',
  CQ100: 'https://cq100-sgp.lol.qq.com:21019',
  BGP2: 'https://bgp2-k8s-sgp.lol.qq.com:21019',
  PBE: 'https://pbe-sgp.lol.qq.com:21019',
  PREPBE: 'https://prepbe-sgp.lol.qq.com:21019',
  TW2: 'https://apse1-red.pp.sgp.pvp.net',
  SG2: 'https://apse1-red.pp.sgp.pvp.net',
  PH2: 'https://apse1-red.pp.sgp.pvp.net',
  VN2: 'https://apse1-red.pp.sgp.pvp.net',
  PBE1: 'https://usw2-red.pp.sgp.pvp.net',
  EUW1: 'https://euc1-red.pp.sgp.pvp.net',
  JP1: 'https://apne1-red.pp.sgp.pvp.net',
  RU: 'https://euc1-red.pp.sgp.pvp.net',
  BR1: 'https://usw2-red.pp.sgp.pvp.net',
  OC1: 'https://apse1-red.pp.sgp.pvp.net',
  TR1: 'https://euc1-red.pp.sgp.pvp.net',
  LA1: 'https://usw2-red.pp.sgp.pvp.net',
  LA2: 'https://usw2-red.pp.sgp.pvp.net',
  NA1: 'https://usw2-red.pp.sgp.pvp.net',
  TH2: 'https://apse1-red.pp.sgp.pvp.net',
  KR: 'https://apne1-red.pp.sgp.pvp.net',
})

type AnyRecord = Record<string, unknown>
type SgpRequestError = Error & { response?: { status?: number; headers?: Record<string, unknown> } }

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidPuuid(value: string): boolean {
  return /^[a-zA-Z0-9-]{8,128}$/.test(value)
}

function normalizePlatformId(value: string): string {
  return value.trim().toUpperCase()
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

function getRetryDelayMs(error: SgpRequestError, attempt: number): number {
  const retryAfter = error.response?.headers?.['retry-after']
  const retryAfterSeconds = Number(Array.isArray(retryAfter) ? retryAfter[0] : retryAfter)
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(retryAfterSeconds * 1000, 5_000)
  }

  return SGP_RETRY_BASE_DELAY_MS * 2 ** attempt
}

function shouldRetry(error: SgpRequestError): boolean {
  const status = error.response?.status
  return status === undefined || status === 429 || status >= 500
}

function compactParticipant(value: unknown): AnyRecord | null {
  if (!isRecord(value)) {
    return null
  }

  return {
    participantId: value.participantId,
    puuid: value.puuid,
    riotIdGameName: value.riotIdGameName,
    riotIdTagline: value.riotIdTagline,
    summonerName: value.summonerName,
    championId: value.championId,
    teamId: value.teamId,
    playerSubteamId: value.playerSubteamId,
    subteamPlacement: value.subteamPlacement,
    win: value.win,
    gameEndedInEarlySurrender: value.gameEndedInEarlySurrender,
    kills: value.kills,
    deaths: value.deaths,
    assists: value.assists,
    item0: value.item0,
    item1: value.item1,
    item2: value.item2,
    item3: value.item3,
    item4: value.item4,
    item5: value.item5,
    item6: value.item6,
    playerAugment1: value.playerAugment1,
    playerAugment2: value.playerAugment2,
    playerAugment3: value.playerAugment3,
    playerAugment4: value.playerAugment4,
    playerAugment5: value.playerAugment5,
    playerAugment6: value.playerAugment6,
  }
}

/** Drop large challenge/mission/damage fields before leaving the SGP layer. */
function compactSummary(value: AnyRecord): AnyRecord {
  return {
    gameId: value.gameId,
    platformId: value.platformId,
    gameCreation: value.gameCreation,
    gameDuration: value.gameDuration,
    gameMode: value.gameMode,
    gameModeMutators: value.gameModeMutators,
    gameType: value.gameType,
    gameVersion: value.gameVersion,
    mapId: value.mapId,
    queueId: value.queueId,
    endOfGameResult: value.endOfGameResult,
    participants: Array.isArray(value.participants)
      ? value.participants.map(compactParticipant).filter((participant) => participant !== null)
      : [],
  }
}

function getSummaryGames(payload: unknown): AnyRecord[] {
  if (!isRecord(payload) || !Array.isArray(payload.games)) {
    throw new Error('SGP match-history response did not contain a games array')
  }

  return payload.games.flatMap((entry) => {
    if (!isRecord(entry) || !isRecord(entry.json)) {
      return []
    }
    return [compactSummary(entry.json)]
  })
}

export function getSgpMatchHistoryOrigin(platformId: string): string | null {
  const normalized = normalizePlatformId(platformId)
  return SGP_MATCH_HISTORY_ORIGINS[normalized] || null
}

export class SgpMatchHistoryInterruptedError extends Error {
  constructor() {
    super('SGP match-history collection interrupted')
    this.name = 'SgpMatchHistoryInterruptedError'
  }
}

export class SgpMatchHistoryService {
  constructor(private readonly lcuService: LCUService) {}

  async getHextechAramSummaries(
    puuid: string,
    platformId: string,
    startIndex: number,
    count: number,
    shouldContinue?: () => Promise<boolean>,
  ): Promise<AnyRecord[]> {
    if (!isValidPuuid(puuid)) {
      throw new Error('Invalid SGP match-history PUUID')
    }

    const origin = getSgpMatchHistoryOrigin(platformId)
    if (!origin) {
      throw new Error(`SGP match history is not configured for platform ${normalizePlatformId(platformId)}`)
    }

    const normalizedStartIndex = Number.isInteger(startIndex) && startIndex >= 0 ? startIndex : 0
    const normalizedCount = Number.isInteger(count)
      ? Math.max(1, Math.min(count, SGP_MATCH_HISTORY_MAX_PAGE_SIZE))
      : 20
    const endpoint = `${origin}/match-history-query/v1/products/lol/player/${encodeURIComponent(puuid)}/SUMMARY`

    let lastError: unknown = null
    for (let attempt = 0; attempt < SGP_MAX_ATTEMPTS; attempt += 1) {
      if (shouldContinue && !await shouldContinue()) {
        throw new SgpMatchHistoryInterruptedError()
      }

      const tokenStartedAt = performance.now()
      const accessToken = await this.lcuService.getEntitlementsAccessToken()
      const tokenDurationMs = Math.round((performance.now() - tokenStartedAt) * 10) / 10
      if (!accessToken) {
        throw new Error('League Client did not provide an entitlements access token')
      }

      const requestStartedAt = performance.now()
      logMatchHistoryDev('SGP summary request started', {
        platformId: normalizePlatformId(platformId),
        startIndex: normalizedStartIndex,
        count: normalizedCount,
        tag: HEXTECH_ARAM_QUEUE_TAG,
        attempt: attempt + 1,
        tokenDurationMs,
      })
      try {
        const response = await axios.get(endpoint, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            startIndex: normalizedStartIndex,
            count: normalizedCount,
            tag: HEXTECH_ARAM_QUEUE_TAG,
            tagsQueryType: 'AND',
          },
          proxy: false,
          timeout: SGP_MATCH_HISTORY_TIMEOUT_MS,
        })
        if (shouldContinue && !await shouldContinue()) {
          throw new SgpMatchHistoryInterruptedError()
        }
        const games = getSummaryGames(response.data)
        logMatchHistoryDev('SGP summary request completed', {
          platformId: normalizePlatformId(platformId),
          startIndex: normalizedStartIndex,
          requestedCount: normalizedCount,
          returnedCount: games.length,
          status: response.status,
          contentLength: response.headers?.['content-length'] || null,
          durationMs: Math.round((performance.now() - requestStartedAt) * 10) / 10,
          attempt: attempt + 1,
        })
        return games
      } catch (error) {
        if (error instanceof SgpMatchHistoryInterruptedError) {
          throw error
        }
        lastError = error
        const requestError = error as SgpRequestError
        logMatchHistoryDev('SGP summary request failed', {
          platformId: normalizePlatformId(platformId),
          startIndex: normalizedStartIndex,
          requestedCount: normalizedCount,
          status: requestError.response?.status ?? null,
          durationMs: Math.round((performance.now() - requestStartedAt) * 10) / 10,
          attempt: attempt + 1,
        })
        if (attempt >= SGP_MAX_ATTEMPTS - 1 || !shouldRetry(requestError)) {
          break
        }

        logger.debug('[match-history] retrying SGP summary request', {
          platformId: normalizePlatformId(platformId),
          status: requestError.response?.status ?? null,
          attempt: attempt + 1,
          sensitiveValuesLogged: false,
        })
        await delay(getRetryDelayMs(requestError, attempt))
      }
    }

    const requestError = lastError as SgpRequestError
    throw new Error(`SGP match-history request failed${requestError?.response?.status ? ` (${requestError.response.status})` : ''}`)
  }
}
