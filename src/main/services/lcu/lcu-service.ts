/**
 * 统一的 LCU (League Client Update) 服务
 *
 * 合并自：
 * - src/service/lcu.js (LCUService)
 * - electron/modules/app-config.ts (MainProcessLCU)
 * - electron/modules/ipc-handlers.ts (IpcLCUService)
 *
 * 功能：
 * - LCU 认证和连接管理
 * - 符文页操作（查询、创建、删除、应用）
 * - 选人会话查询
 * - 游戏流程阶段监控
 * - Token 缓存和连接失败冷却机制
 */

import https from 'https'
import axios from 'axios'
import logger from '../../modules/logger.ts'
import { getLcuToken } from './token-loader.ts'
import { LcuJsonApiEvent, LcuWampSocket } from './lcu-wamp-socket.ts'
import {
  LCUAuthResult,
  LCUAuthConfig,
  LCUUrls,
  GameflowPhase,
  ChampSelectAction,
  ChampSelectBenchChampion,
  ChampSelectSession,
  ChampSelectSnapshot,
  PerkPage,
} from './types.ts'

const LCU_ENDPOINT_PROBE_TIMEOUT_MS = 2500
const LCU_MATCH_HISTORY_TIMEOUT_MS = 10 * 1000
const LCU_ENTITLEMENTS_TIMEOUT_MS = 5 * 1000
const LCU_CONNECTION_DIAGNOSTIC_INTERVAL_MS = 30 * 1000
const RECOVERABLE_LCU_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ERR_SOCKET_CLOSED',
])

type LcuRequestError = Error & {
  code?: string
  errno?: string | number
  syscall?: string
  address?: string
  port?: string | number
  cause?: { code?: string }
  response?: { status?: number }
}

const getLcuRequestErrorCode = (error: unknown): string | null => {
  const err = error as LcuRequestError
  return err.code || err.cause?.code || null
}

const isRecoverableLcuRequestError = (error: unknown): boolean => {
  const code = getLcuRequestErrorCode(error)
  return Boolean(code && RECOVERABLE_LCU_ERROR_CODES.has(code))
}

const summarizeLcuRequestError = (error: unknown) => {
  const err = error as LcuRequestError
  return {
    name: err.name || 'Error',
    message: String(err.message || error || 'Unknown LCU request error').slice(0, 500),
    code: getLcuRequestErrorCode(error),
    errno: err.errno ?? null,
    syscall: err.syscall || null,
    address: err.address || null,
    port: err.port ?? null,
    status: err.response?.status ?? null,
  }
}

const createEmptyChampSelectSnapshot = (
  params: {
    connected: boolean
    gameflowPhase: GameflowPhase | null
    status: ChampSelectSnapshot['status']
    reason: string | null
  }
): ChampSelectSnapshot => ({
  connected: params.connected,
  gameflowPhase: params.gameflowPhase,
  isInChampSelect: params.gameflowPhase === 'ChampSelect',
  champSelectSession: null,
  localPlayerCellId: null,
  selfChampionId: null,
  benchEnabled: false,
  benchChampions: [],
  myTeam: [],
  actions: [],
  timer: null,
  status: params.status,
  reason: params.reason,
  updatedAt: Date.now(),
})

const toPositiveInteger = (value: unknown): number | null => {
  const numberValue = Number(value)
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    return null
  }

  return numberValue
}

const normalizeMatchHistoryRange = (beginIndex: unknown, endIndex: unknown) => {
  const begin = Number.isInteger(beginIndex) && Number(beginIndex) >= 0
    ? Math.min(Number(beginIndex), 99)
    : 0
  const requestedEnd = Number.isInteger(endIndex) && Number(endIndex) >= begin
    ? Number(endIndex)
    : begin + 19

  return {
    begin,
    end: Math.min(requestedEnd, begin + 49, 99),
  }
}

const isValidPuuid = (value: unknown): value is string => {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{8,128}$/.test(value)
}

const CHAMP_SELECT_DIAGNOSTIC_MAX_VALUES = 24
const CHAMP_SELECT_DIAGNOSTIC_MAX_ARRAYS = 60
const CHAMP_SELECT_DIAGNOSTIC_MAX_DEPTH = 7
const CHAMP_SELECT_DIAGNOSTIC_ARRAY_KEYWORDS = [
  'available',
  'bench',
  'candidate',
  'card',
  'champion',
  'eligible',
  'hand',
  'option',
  'pick',
  'reroll',
  'roll',
  'select',
  'trade',
]

let lastChampSelectSessionDiagnosticSignature = ''

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const pathLooksCandidateLike = (path: string): boolean => {
  const normalizedPath = path.toLowerCase()
  return CHAMP_SELECT_DIAGNOSTIC_ARRAY_KEYWORDS.some((keyword) => normalizedPath.includes(keyword))
}

const getObjectKeys = (value: unknown, limit = 24): string[] => {
  if (!isRecord(value)) {
    return []
  }

  return Object.keys(value).sort().slice(0, limit)
}

const pushUniqueNumber = (values: number[], value: unknown): void => {
  const championId = toPositiveInteger(value)
  if (!championId || values.includes(championId) || values.length >= CHAMP_SELECT_DIAGNOSTIC_MAX_VALUES) {
    return
  }

  values.push(championId)
}

const collectChampionIdsFromValue = (
  value: unknown,
  path = 'session',
  depth = 0,
  values: number[] = [],
  seen = new WeakSet<object>()
): number[] => {
  if (depth > CHAMP_SELECT_DIAGNOSTIC_MAX_DEPTH || values.length >= CHAMP_SELECT_DIAGNOSTIC_MAX_VALUES) {
    return values
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return values
    }
    seen.add(value)

    value.slice(0, 40).forEach((item, index) => {
      if (pathLooksCandidateLike(path) && typeof item !== 'object') {
        pushUniqueNumber(values, item)
      }
      collectChampionIdsFromValue(item, `${path}[${index}]`, depth + 1, values, seen)
    })
    return values
  }

  if (!isRecord(value)) {
    return values
  }

  if (seen.has(value)) {
    return values
  }
  seen.add(value)

  for (const [key, childValue] of Object.entries(value)) {
    const nextPath = `${path}.${key}`
    if (/champion/i.test(key)) {
      pushUniqueNumber(values, childValue)
    }
    collectChampionIdsFromValue(childValue, nextPath, depth + 1, values, seen)
  }

  return values
}

const collectChampionValuePaths = (
  value: unknown,
  path = 'session',
  depth = 0,
  results: Array<{ path: string; value: number }> = [],
  seen = new WeakSet<object>()
): Array<{ path: string; value: number }> => {
  if (depth > CHAMP_SELECT_DIAGNOSTIC_MAX_DEPTH || results.length >= CHAMP_SELECT_DIAGNOSTIC_MAX_VALUES) {
    return results
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return results
    }
    seen.add(value)

    value.slice(0, 20).forEach((item, index) => {
      collectChampionValuePaths(item, `${path}[${index}]`, depth + 1, results, seen)
    })
    return results
  }

  if (!isRecord(value)) {
    return results
  }

  if (seen.has(value)) {
    return results
  }
  seen.add(value)

  for (const [key, childValue] of Object.entries(value)) {
    const nextPath = `${path}.${key}`
    const championId = /champion/i.test(key) ? toPositiveInteger(childValue) : null
    if (championId) {
      results.push({ path: nextPath, value: championId })
      if (results.length >= CHAMP_SELECT_DIAGNOSTIC_MAX_VALUES) {
        return results
      }
    }

    collectChampionValuePaths(childValue, nextPath, depth + 1, results, seen)
  }

  return results
}

const collectCandidateArraySummaries = (
  value: unknown,
  path = 'session',
  depth = 0,
  results: Array<{
    path: string
    length: number
    championIds: number[]
    elementKeys: string[]
  }> = [],
  seen = new WeakSet<object>()
): Array<{ path: string; length: number; championIds: number[]; elementKeys: string[] }> => {
  if (depth > CHAMP_SELECT_DIAGNOSTIC_MAX_DEPTH || results.length >= CHAMP_SELECT_DIAGNOSTIC_MAX_ARRAYS) {
    return results
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return results
    }
    seen.add(value)

    const championIds = collectChampionIdsFromValue(value, path)
    const elementKeys = getObjectKeys(value.find(isRecord), 16)
    if (pathLooksCandidateLike(path) || championIds.length > 0) {
      results.push({
        path,
        length: value.length,
        championIds,
        elementKeys,
      })
    }

    value.slice(0, 20).forEach((item, index) => {
      collectCandidateArraySummaries(item, `${path}[${index}]`, depth + 1, results, seen)
    })
    return results
  }

  if (!isRecord(value)) {
    return results
  }

  if (seen.has(value)) {
    return results
  }
  seen.add(value)

  for (const [key, childValue] of Object.entries(value)) {
    collectCandidateArraySummaries(childValue, `${path}.${key}`, depth + 1, results, seen)
    if (results.length >= CHAMP_SELECT_DIAGNOSTIC_MAX_ARRAYS) {
      break
    }
  }

  return results
}

const summarizeTeamMembers = (members: unknown): Array<{
  cellId: number | null
  championId: number | null
  championPickIntent: number | null
}> => {
  if (!Array.isArray(members)) {
    return []
  }

  return members.slice(0, 10).map((member) => {
    const record = isRecord(member) ? member : {}
    return {
      cellId: Number.isInteger(record.cellId) ? Number(record.cellId) : null,
      championId: toPositiveInteger(record.championId),
      championPickIntent: toPositiveInteger(record.championPickIntent),
    }
  })
}

const logChampSelectSessionDiagnostic = (
  session: ChampSelectSession | null,
  snapshot: ChampSelectSnapshot
): void => {
  if (!session || snapshot.status !== 'ready') {
    lastChampSelectSessionDiagnosticSignature = ''
    return
  }

  try {
    const candidateArrays = collectCandidateArraySummaries(session)
    const championValuePaths = collectChampionValuePaths(session)
    const handLikeArrays = candidateArrays.filter((summary) =>
      /hand|card|option|available|eligible|candidate/i.test(summary.path)
    )

    const diagnostic = {
      topLevelKeys: getObjectKeys(session, 80),
      localPlayerCellId: snapshot.localPlayerCellId,
      selfChampionId: snapshot.selfChampionId,
      benchEnabled: snapshot.benchEnabled,
      benchChampionIds: snapshot.benchChampions.map((benchChampion) => benchChampion.championId),
      myTeam: summarizeTeamMembers(snapshot.myTeam),
      actionChampionIds: collectChampionIdsFromValue(snapshot.actions, 'snapshot.actions'),
      championValuePaths,
      candidateArrays,
      handLikeArrays,
      note: '结构诊断只记录字段名、数组长度和 championId 摘要，不记录完整 LCU session payload',
    }
    const signature = JSON.stringify({
      topLevelKeys: diagnostic.topLevelKeys,
      selfChampionId: diagnostic.selfChampionId,
      benchChampionIds: diagnostic.benchChampionIds,
      myTeam: diagnostic.myTeam,
      championValuePaths,
      candidateArrays,
    })

    if (signature === lastChampSelectSessionDiagnosticSignature) {
      return
    }

    lastChampSelectSessionDiagnosticSignature = signature
    logger.info('[LCU] champ-select raw session diagnostic', diagnostic)
  } catch (error) {
    const err = error as Error
    logger.debug('[LCU] champ-select raw session diagnostic failed:', err.message)
  }
}

const normalizeBenchChampions = (
  benchChampions: ChampSelectSession['benchChampions']
): ChampSelectBenchChampion[] => {
  if (!Array.isArray(benchChampions)) {
    return []
  }

  const seenChampionIds = new Set<number>()
  const normalized: ChampSelectBenchChampion[] = []

  for (const benchChampion of benchChampions) {
    const championId = toPositiveInteger(benchChampion?.championId)
    if (!championId || seenChampionIds.has(championId)) {
      continue
    }

    seenChampionIds.add(championId)
    normalized.push({
      ...benchChampion,
      championId,
    })
  }

  return normalized
}

const getSelfChampionIdFromActions = (
  actions: ChampSelectAction[][],
  localPlayerCellId: number | null
): number | null => {
  if (localPlayerCellId == null || !Array.isArray(actions)) {
    return null
  }

  for (const actionGroup of actions) {
    if (!Array.isArray(actionGroup)) {
      continue
    }

    for (const action of actionGroup) {
      if (action.actorCellId !== localPlayerCellId) {
        continue
      }

      const championId = toPositiveInteger(action.championId)
      if (championId) {
        return championId
      }
    }
  }

  return null
}

const getSelfChampionId = (session: ChampSelectSession): number | null => {
  const localPlayerCellId = Number.isInteger(session.localPlayerCellId)
    ? session.localPlayerCellId
    : null

  if (localPlayerCellId == null) {
    return null
  }

  const localPlayer = Array.isArray(session.myTeam)
    ? session.myTeam.find((member) => member.cellId === localPlayerCellId)
    : null
  const teamChampionId = toPositiveInteger(localPlayer?.championId)
  if (teamChampionId) {
    return teamChampionId
  }

  return getSelfChampionIdFromActions(session.actions || [], localPlayerCellId)
}

const buildChampSelectSnapshot = (
  params: {
    connected: boolean
    gameflowPhase: GameflowPhase | null
    session: ChampSelectSession | null
  }
): ChampSelectSnapshot => {
  const { connected, gameflowPhase, session } = params

  if (!connected && !gameflowPhase) {
    return createEmptyChampSelectSnapshot({
      connected,
      gameflowPhase,
      status: 'unavailable',
      reason: 'lcu-unavailable',
    })
  }

  if (gameflowPhase !== 'ChampSelect') {
    return createEmptyChampSelectSnapshot({
      connected,
      gameflowPhase,
      status: 'not-in-champ-select',
      reason: gameflowPhase ? `phase-${gameflowPhase}` : 'gameflow-phase-unavailable',
    })
  }

  if (!session || session.errorCode) {
    return createEmptyChampSelectSnapshot({
      connected,
      gameflowPhase,
      status: 'empty',
      reason: session?.errorCode ? `session-error-${session.errorCode}` : 'no-champ-select-session',
    })
  }

  const benchChampions = normalizeBenchChampions(session.benchChampions)
  const localPlayerCellId = Number.isInteger(session.localPlayerCellId)
    ? session.localPlayerCellId
    : null
  const actions = Array.isArray(session.actions) ? session.actions : []

  return {
    connected,
    gameflowPhase,
    isInChampSelect: true,
    champSelectSession: session,
    localPlayerCellId,
    selfChampionId: getSelfChampionId(session),
    benchEnabled: session.benchEnabled === true || benchChampions.length > 0,
    benchChampions,
    myTeam: Array.isArray(session.myTeam) ? session.myTeam : [],
    actions,
    timer: session.timer || null,
    status: 'ready',
    reason: null,
    updatedAt: Date.now(),
  }
}

/**
 * LCU 服务配置选项
 */
export interface LCUServiceOptions {
  /** Token 缓存时长（毫秒），默认 60000 */
  tokenCacheDuration?: number
  /** 连接失败后的冷却时长（毫秒），默认 10000 */
  failCooldown?: number
}

export interface GameflowPhaseSubscription {
  close: () => void
  isConnected: () => boolean
}

export interface GameflowPhaseSubscriptionOptions {
  forceRefresh?: boolean
  onOpen?: () => void
  onClose?: (reason: string) => void
  onError?: (error: Error) => void
}

/**
 * 统一的 LCU 服务类
 */
export class LCUService {
  private active: boolean = false
  private url: string | null = null
  private token: string | null = null
  private port: string | null = null
  private auth: LCUAuthConfig | null = null
  private urls: LCUUrls | null = null
  private champSelectSnapshot: ChampSelectSnapshot = createEmptyChampSelectSnapshot({
    connected: false,
    gameflowPhase: null,
    status: 'unavailable',
    reason: 'not-initialized',
  })

  // 缓存相关
  private lastTokenFetchTime: number = 0
  private lastFailTime: number = 0
  private tokenCacheDuration: number
  private failCooldown: number
  private authRefreshPromise: Promise<LCUAuthResult | null> | null = null
  private lastConnectionDiagnosticAt: number = 0
  private lastConnectionDiagnosticSignature: string = ''

  // HTTPS Agent（禁用证书验证，LCU 使用自签名证书）
  private httpsAgent = new https.Agent({
    rejectUnauthorized: false,
  })

  constructor(options: LCUServiceOptions) {
    this.tokenCacheDuration = options.tokenCacheDuration ?? 60000
    this.failCooldown = options.failCooldown ?? 10000
  }

  /**
   * 设置内部变量（认证信息和 API URLs）
   */
  private setVars(token: string | null, port: string | null, url: string | null): void {
    this.active = !!token
    this.url = url
    this.token = token
    this.port = port

    if (token && url) {
      this.auth = {
        auth: {
          username: 'riot',
          password: token,
        },
      }

      this.urls = {
        authToken: `${url}/riotclient/auth-token`,
        curSession: `${url}/lol-champ-select/v1/session`,
        curPerk: `${url}/lol-perks/v1/currentpage`,
        perks: `${url}/lol-perks/v1/pages`,
        currentSummoner: `${url}/lol-summoner/v1/current-summoner`,
        itemSets: `${url}/lol-item-sets/v1/item-sets`,
        position1: `${url}/lol-lobby-team-builder/v1/position-preferences`,
        position2: `${url}/lol-lobby-team-builder/v2/position-preferences`,
        gameflowPhase: `${url}/lol-gameflow/v1/gameflow-phase`,
        gameflowSession: `${url}/lol-gameflow/v1/session`,
      }
    } else {
      this.auth = null
      this.urls = null
    }
  }

  private logConnectionDiagnostic(
    event: string,
    details: Record<string, unknown>
  ): void {
    const now = Date.now()
    const signature = JSON.stringify({
      event,
      context: details.context || null,
      reason: details.reason || null,
      port: details.port || details.previousPort || null,
      code: details.code || null,
      status: details.status || null,
    })

    if (
      signature === this.lastConnectionDiagnosticSignature &&
      now - this.lastConnectionDiagnosticAt < LCU_CONNECTION_DIAGNOSTIC_INTERVAL_MS
    ) {
      return
    }

    this.lastConnectionDiagnosticAt = now
    this.lastConnectionDiagnosticSignature = signature
    logger.warn(event, {
      ...details,
      sensitiveValuesLogged: false,
    })
  }

  private invalidateAuth(
    reason: string,
    error: unknown = null,
    applyCooldown: boolean = true
  ): string | null {
    const previousPort = this.port
    this.setVars(null, null, null)
    this.lastTokenFetchTime = 0
    this.lastFailTime = applyCooldown ? Date.now() : 0

    this.logConnectionDiagnostic('[LCU connection] cached auth invalidated', {
      reason,
      previousPort,
      ...(error ? summarizeLcuRequestError(error) : {}),
    })

    return previousPort
  }

  private async probeCurrentConnection(context: string): Promise<boolean> {
    if (!this.urls || !this.auth || !this.port) {
      return false
    }

    const startedAt = Date.now()
    try {
      const response = await axios.get(this.urls.authToken, {
        ...this.auth,
        httpsAgent: this.httpsAgent,
        proxy: false,
        timeout: LCU_ENDPOINT_PROBE_TIMEOUT_MS,
        validateStatus: () => true,
      })
      const connected = response.status >= 200 && response.status < 300

      if (!connected) {
        this.logConnectionDiagnostic('[LCU connection] endpoint probe rejected', {
          context,
          port: this.port,
          status: response.status,
          durationMs: Date.now() - startedAt,
          timeoutMs: LCU_ENDPOINT_PROBE_TIMEOUT_MS,
          diagnosticHint: response.status === 401
            ? 'The discovered token is stale or belongs to another League client instance.'
            : 'The LCU endpoint responded, but the auth probe did not return a success status.',
        })
      }

      return connected
    } catch (error) {
      this.logConnectionDiagnostic('[LCU connection] endpoint probe failed', {
        context,
        durationMs: Date.now() - startedAt,
        timeoutMs: LCU_ENDPOINT_PROBE_TIMEOUT_MS,
        ...summarizeLcuRequestError(error),
        port: this.port,
        diagnosticHint: getLcuRequestErrorCode(error) === 'ECONNREFUSED'
          ? 'No process is listening on the discovered LCU port; the lockfile/log may be stale or League Client is not fully running.'
          : 'Check League Client state, local security software, proxy settings, and privilege level.',
      })
      return false
    }
  }

  private async loadAndVerifyAuth(): Promise<LCUAuthResult | null> {
    const [token, port] = await getLcuToken()

    if (!token || !port) {
      logger.debug('Unable to get LCU token; game client may not be running')
      this.setVars(null, null, null)
      this.lastFailTime = Date.now()
      return null
    }

    const url = `https://127.0.0.1:${port}`
    this.setVars(token, port, url)

    if (!await this.probeCurrentConnection('auth-candidate-verification')) {
      this.invalidateAuth('auth-candidate-unreachable', null, true)
      return null
    }

    this.lastTokenFetchTime = Date.now()
    this.lastFailTime = 0
    logger.info('[LCU connection] auth candidate verified', {
      port,
      sensitiveValuesLogged: false,
    })
    return { token, port, url }
  }

  private async recoverFromConnectionFailure(
    context: string,
    error: unknown
  ): Promise<boolean> {
    if (!isRecoverableLcuRequestError(error)) {
      return false
    }

    const previousPort = this.invalidateAuth(`${context}:transport-failure`, error, false)
    const refreshed = await this.getAuthToken(true)
    const connected = Boolean(refreshed)
    const result = {
      context,
      connected,
      previousPort,
      discoveredPort: refreshed?.port || null,
      rediscoveredSamePort: Boolean(previousPort && refreshed?.port === previousPort),
      trigger: summarizeLcuRequestError(error),
      sensitiveValuesLogged: false,
    }

    if (connected) {
      logger.info('[LCU connection] forced rediscovery recovered connection', result)
    } else {
      this.logConnectionDiagnostic('[LCU connection] forced rediscovery did not recover', result)
    }

    return connected
  }

  /**
   * 获取认证 token（带缓存和失败冷却机制）
   * @param forceRefresh - 是否强制刷新 token
   */
  async getAuthToken(forceRefresh: boolean = false): Promise<LCUAuthResult | null> {
    const now = Date.now()

    // 如果在失败冷却期内，直接返回 null
    if (!forceRefresh && this.lastFailTime && now - this.lastFailTime < this.failCooldown) {
      return null
    }

    const needRefresh =
      forceRefresh || !this.active || now - this.lastTokenFetchTime > this.tokenCacheDuration

    // 如果已有有效的连接且不需要刷新，直接返回
    if (this.active && !needRefresh && this.token && this.url) {
      return { token: this.token, port: this.port!, url: this.url }
    }

    if (this.authRefreshPromise) {
      return this.authRefreshPromise
    }

    this.authRefreshPromise = this.loadAndVerifyAuth()
    try {
      return await this.authRefreshPromise
    } catch (error) {
      logger.error('LCU 连接失败:', summarizeLcuRequestError(error))
      this.invalidateAuth('auth-refresh-error', error, true)
      return null
    } finally {
      this.authRefreshPromise = null
    }
  }

  /**
   * 检查 LCU 状态
   */
  async getLcuStatus(): Promise<boolean> {
    if (!this.urls || !this.auth || !this.active) {
      return false
    }

    const connected = await this.probeCurrentConnection('status-check')
    if (!connected) {
      this.invalidateAuth('status-check-failed', null, true)
    }
    return connected
  }

  /**
   * 获取当前选人会话
   */
  async getCurrentSession(): Promise<ChampSelectSession | null> {
    if (!this.active || !this.urls || !this.auth) {
      return null
    }

    try {
      const res = await axios.get<ChampSelectSession>(this.urls.curSession, {
        ...this.auth,
        httpsAgent: this.httpsAgent,
        validateStatus: (status) => status < 500,
      })

      // 如果状态码是 404 或 401，说明认证失效或不在选人阶段
      if (res.status === 404 || res.status === 401) {
        if (res.status === 401) {
          logger.warn('LCU 认证失效，需要重新连接')
          this.invalidateAuth('champ-select-session:unauthorized', null, false)
          await this.getAuthToken(true)
        }
        return null
      }

      return res.data
    } catch (error) {
      if (!await this.recoverFromConnectionFailure('champ-select-session', error)) {
        const err = error as Error
        logger.debug('LCU champ-select session request failed:', err.message)
      }
      return null
    }
  }

  /**
   * 获取标准化后的只读选人快照。
   * 该入口只读取 gameflow 和 champ-select session，不执行任何选人写入操作。
   */
  async getChampSelectSnapshot(): Promise<ChampSelectSnapshot> {
    const gameflowPhase = await this.getGameflowPhase()
    const session = gameflowPhase === 'ChampSelect' ? await this.getCurrentSession() : null

    this.champSelectSnapshot = buildChampSelectSnapshot({
      connected: this.active,
      gameflowPhase,
      session,
    })
    logChampSelectSessionDiagnostic(session, this.champSelectSnapshot)

    return this.champSelectSnapshot
  }

  /**
   * 获取最近一次选人快照缓存。不会访问 LCU。
   */
  getCachedChampSelectSnapshot(): ChampSelectSnapshot {
    return this.champSelectSnapshot
  }

  /**
   * 获取当前符文页
   */
  async getCurPerk(): Promise<PerkPage | null> {
    if (!this.urls || !this.auth) {
      return null
    }

    try {
      const res = await axios.get<PerkPage>(this.urls.curPerk, {
        ...this.auth,
        httpsAgent: this.httpsAgent,
      })
      logger.debug('Current rune page:', res.data)
      return res.data
    } catch (error) {
      const err = error as Error
      logger.warn('获取当前符文页失败:', err.message)
      return null
    }
  }

  /**
   * 获取符文页列表
   */
  async getPerkList(): Promise<PerkPage[]> {
    if (!this.urls || !this.auth) {
      return []
    }

    try {
      const res = await axios.get<PerkPage[]>(this.urls.perks, {
        ...this.auth,
        httpsAgent: this.httpsAgent,
      })
      return res.data
    } catch (error) {
      const err = error as Error
      logger.warn('获取符文页列表失败:', err.message)
      return []
    }
  }

  /**
   * Read the short-lived entitlement bearer token used by the logged-in client
   * for SGP requests. The value must remain in memory and must never be logged.
   */
  async getEntitlementsAccessToken(): Promise<string | null> {
    if (!this.active || !this.url) {
      await this.getAuthToken()
    }

    if (!this.active || !this.url || !this.auth) {
      return null
    }

    try {
      const response = await axios.get(`${this.url}/entitlements/v1/token`, {
        ...this.auth,
        httpsAgent: this.httpsAgent,
        proxy: false,
        timeout: LCU_ENTITLEMENTS_TIMEOUT_MS,
        validateStatus: (status) => status < 500,
      })
      if (response.status >= 200 && response.status < 300) {
        const accessToken = typeof response.data?.accessToken === 'string'
          ? response.data.accessToken.trim()
          : ''
        return accessToken || null
      }

      if (response.status === 401) {
        this.invalidateAuth('entitlements-token:unauthorized', null, false)
        await this.getAuthToken(true)
      }
      logger.debug('[LCU] entitlements token endpoint rejected', { status: response.status })
      return null
    } catch (error) {
      if (!await this.recoverFromConnectionFailure('entitlements-token', error)) {
        logger.debug('[LCU] entitlements token endpoint failed', {
          code: getLcuRequestErrorCode(error),
          sensitiveValuesLogged: false,
        })
      }
      return null
    }
  }

  async getCurrentSummoner(): Promise<any | null> {
    if (!this.active || !this.url) {
      await this.getAuthToken()
    }

    if (!this.urls || !this.auth) {
      return null
    }

    try {
      const res = await axios.get(this.urls.currentSummoner, {
        ...this.auth,
        httpsAgent: this.httpsAgent,
        validateStatus: (status) => status < 500,
        timeout: 5000,
      })

      return res.status >= 200 && res.status < 300 ? res.data : null
    } catch (error) {
      const err = error as Error
      const recovered = await this.recoverFromConnectionFailure('current-summoner', error)
      logger.warn('获取当前召唤师失败:', {
        error: err.message,
        code: getLcuRequestErrorCode(error),
        recoveryAttempted: isRecoverableLcuRequestError(error),
        recovered,
      })
      return null
    }
  }

  async syncItemSets(itemSets: any[]): Promise<{
    success: boolean
    summonerId?: number
    status?: number
    method?: 'put'
    removedCount?: number
    itemSetCount?: number
    error?: string
  }> {
    const managedItemSets = Array.isArray(itemSets)
      ? itemSets.filter((itemSet) => itemSet && typeof itemSet === 'object')
      : []

    if (!this.active || !this.url) {
      await this.getAuthToken()
    }

    if (!this.urls || !this.auth) {
      return { success: false, error: 'LCU 未连接' }
    }

    const summoner = await this.getCurrentSummoner()
    const summonerId = Number(summoner?.summonerId ?? summoner?.accountId ?? summoner?.id)
    if (!Number.isFinite(summonerId) || summonerId <= 0) {
      return { success: false, error: '未获取到当前召唤师 ID' }
    }

    const endpoint = `${this.urls.itemSets}/${summonerId}/sets`
    const firstItemSet = managedItemSets[0] || null
    const championId = Number(firstItemSet?.associatedChampions?.[0] || 0)
    const isManagedAramggItemSet = (set: any) => {
      const setUid = String(set?.uid || '')
      const setTitle = String(set?.title || '')
      const blocks = Array.isArray(set?.blocks) ? set.blocks : []

      return (
        setUid.startsWith('aramgg-') ||
        setTitle.startsWith('ARAMGG ARAM ') ||
        blocks.some((block: any) => String(block?.type || '').startsWith('ARAMGG '))
      )
    }

    try {
      const current = await axios.get(endpoint, {
        ...this.auth,
        httpsAgent: this.httpsAgent,
        validateStatus: (status) => status < 500,
        timeout: 5000,
      })
      const currentPayload = current.data && typeof current.data === 'object' ? current.data : {}
      const currentItemSets = Array.isArray(currentPayload.itemSets) ? currentPayload.itemSets : []
      const nextItemSets = currentItemSets.filter((set: any) => !isManagedAramggItemSet(set))
      const removedCount = currentItemSets.length - nextItemSets.length

      nextItemSets.unshift(...managedItemSets)

      const payload = {
        ...currentPayload,
        accountId: Number(currentPayload.accountId ?? summonerId),
        itemSets: nextItemSets,
        timestamp: Date.now(),
      }

      logger.info('[LCU] item set sync payload prepared', {
        summonerId,
        championId,
        incomingCount: managedItemSets.length,
        uids: managedItemSets.map((itemSet) => itemSet?.uid || null),
        titles: managedItemSets.map((itemSet) => itemSet?.title || null),
        sortRanks: managedItemSets.map((itemSet) => itemSet?.sortrank ?? itemSet?.sortRank ?? null),
        currentCount: currentItemSets.length,
        removedCount,
        nextCount: nextItemSets.length,
        blockCounts: managedItemSets.map((itemSet) =>
          Array.isArray(itemSet?.blocks) ? itemSet.blocks.length : 0
        ),
      })

      const putResult = await axios.put(endpoint, payload, {
        ...this.auth,
        httpsAgent: this.httpsAgent,
        validateStatus: (status) => status < 500,
        timeout: 5000,
      })

      if (putResult.status >= 200 && putResult.status < 300) {
        return {
          success: true,
          summonerId,
          status: putResult.status,
          method: 'put',
          removedCount,
          itemSetCount: nextItemSets.length,
        }
      }

      logger.warn('[LCU] item set PUT failed', {
        status: putResult.status,
        data: putResult.data || null,
      })

      return {
        success: false,
        summonerId,
        status: putResult.status,
        method: 'put',
        removedCount,
        itemSetCount: nextItemSets.length,
        error: `LCU item set PUT failed: ${putResult.status}`,
      }
    } catch (error) {
      const err = error as Error
      logger.warn('[LCU] item set PUT failed:', err.message)
      return {
        success: false,
        summonerId,
        method: 'put',
        error: err.message,
      }
    }
  }

  async syncItemSet(itemSet: any): Promise<{
    success: boolean
    summonerId?: number
    status?: number
    method?: 'put'
    removedCount?: number
    itemSetCount?: number
    error?: string
  }> {
    return this.syncItemSets([itemSet])
  }

  /**
   * 删除符文页
   */
  async deletePerk(id: number): Promise<boolean> {
    if (!this.urls || !this.auth) {
      return false
    }

    try {
      await axios.delete(`${this.urls.perks}/${id}`, {
        ...this.auth,
        httpsAgent: this.httpsAgent,
      })
      return true
    } catch (error) {
      const err = error as Error
      logger.warn('删除符文页失败:', { id, error: err.message })
      return false
    }
  }

  /**
   * 创建符文页
   */
  async createPerk(data: any): Promise<boolean> {
    if (!this.urls || !this.auth) {
      return false
    }

    try {
      await axios.post(this.urls.perks, data, {
        ...this.auth,
        httpsAgent: this.httpsAgent,
      })
      return true
    } catch (error) {
      const err = error as Error
      logger.warn('创建符文页失败:', err.message)
      return false
    }
  }

  /**
   * 应用符文页
   * 先删除当前可删除的符文页，再创建新的
   */
  async applyPerk(data: any): Promise<boolean> {
    const list = await this.getPerkList()
    const current = list.find((i) => i.current && i.isDeletable)

    if (current) {
      const deleted = await this.deletePerk(current.id)
      if (!deleted) {
        logger.warn('应用符文页已中止：当前可删除符文页删除失败', { id: current.id })
        return false
      }

      return this.createPerk(data)
    }

    return this.createPerk(data)
  }

  /**
   * 获取当前游戏阶段
   * 返回值例如: "ChampSelect", "GameStart", "InProgress", "EndOfGame" 等
   */
  async getGameflowPhase(): Promise<GameflowPhase | null> {
    // 如果连接不活跃，尝试重新连接
    if (!this.active || !this.url) {
      await this.getAuthToken()
    }

    if (!this.active || !this.urls || !this.auth) {
      return null
    }

    try {
      const res = await axios.get<GameflowPhase>(this.urls.gameflowPhase, {
        ...this.auth,
        httpsAgent: this.httpsAgent,
        validateStatus: (status) => status < 500,
        timeout: 5000, // 添加超时
      })

      if (res.status === 404 || res.status === 401) {
        // 重新获取 token
        logger.warn('LCU 认证失效，尝试重新连接...')
        this.invalidateAuth(`gameflow-phase:http-${res.status}`, null, false)
        await this.getAuthToken(true)
        return null
      }

      logger.debug('Current gameflow phase:', res.data)
      return res.data
    } catch (error) {
      if (!await this.recoverFromConnectionFailure('gameflow-phase', error)) {
        const err = error as Error
        logger.warn('获取游戏阶段失败:', err.message)
      }
      return null
    }
  }

  /**
   * 获取游戏会话信息
   * 包含游戏 ID、地区、队伍信息等
   */
  async getGameflowSession(): Promise<any> {
    if (!this.urls || !this.auth) {
      return null
    }

    try {
      const res = await axios.get(this.urls.gameflowSession, {
        ...this.auth,
        httpsAgent: this.httpsAgent,
        validateStatus: (status) => status < 500,
      })
      logger.debug('Gameflow session:', res.data)
      return res.data
    } catch (error) {
      const err = error as Error
      logger.error('获取游戏会话失败:', err.message)
      return null
    }
  }

  /**
   * 读取当前登录玩家的战绩索引。该接口只读取 LCU 本地数据，不向 Riot/第三方写入数据。
   */
  async getCurrentSummonerMatchHistory(beginIndex = 0, endIndex = 19): Promise<any | null> {
    const range = normalizeMatchHistoryRange(beginIndex, endIndex)
    return this.getMatchHistoryEndpoint(
      '/lol-match-history/v1/products/lol/current-summoner/matches',
      range,
      'current-summoner-match-history'
    )
  }

  /**
   * 读取指定 PUUID 的战绩索引。仅供受控的本地只读采集流程使用。
   */
  async getSummonerMatchHistory(
    puuid: string,
    beginIndex = 0,
    endIndex = 19
  ): Promise<any | null> {
    if (!isValidPuuid(puuid)) {
      throw new Error('Invalid match-history PUUID')
    }

    const range = normalizeMatchHistoryRange(beginIndex, endIndex)
    return this.getMatchHistoryEndpoint(
      `/lol-match-history/v1/products/lol/${encodeURIComponent(puuid)}/matches`,
      range,
      'player-match-history'
    )
  }

  /** 获取一场对局的完整参与者、终局装备和海克斯字段。 */
  async getMatchHistoryGame(gameId: number): Promise<any | null> {
    const normalizedGameId = toPositiveInteger(gameId)
    if (!normalizedGameId) {
      throw new Error('Invalid match-history game ID')
    }

    return this.getMatchHistoryEndpoint(
      `/lol-match-history/v1/games/${normalizedGameId}`,
      undefined,
      'match-history-game'
    )
  }

  private async getMatchHistoryEndpoint(
    endpointPath: string,
    params: Record<string, number> | undefined,
    context: string
  ): Promise<any | null> {
    if (!this.active || !this.url) {
      await this.getAuthToken()
    }

    if (!this.active || !this.url || !this.auth) {
      return null
    }

    try {
      const response = await axios.get(`${this.url}${endpointPath}`, {
        ...this.auth,
        httpsAgent: this.httpsAgent,
        params: params
          ? { begIndex: params.begin, endIndex: params.end }
          : undefined,
        proxy: false,
        timeout: LCU_MATCH_HISTORY_TIMEOUT_MS,
        validateStatus: (status) => status < 500,
      })

      if (response.status >= 200 && response.status < 300) {
        return response.data
      }

      if (response.status === 401) {
        this.invalidateAuth(`${context}:unauthorized`, null, false)
        await this.getAuthToken(true)
      }

      logger.debug('[LCU] match-history endpoint rejected', {
        context,
        status: response.status,
      })
      return null
    } catch (error) {
      if (!await this.recoverFromConnectionFailure(context, error)) {
        logger.debug('[LCU] match-history endpoint failed', {
          context,
          code: getLcuRequestErrorCode(error),
          sensitiveValuesLogged: false,
        })
      }
      return null
    }
  }

  /**
   * 只读读取 LCU JSON 端点，用于阶段诊断和确认客户端是否暴露海克斯相关字段。
   */
  async getReadOnlyJsonEndpoint(endpointPath: string): Promise<{ status: number; data: any } | null> {
    if (!endpointPath.startsWith('/')) {
      throw new Error(`Invalid LCU endpoint path: ${endpointPath}`)
    }

    if (!this.active || !this.url) {
      await this.getAuthToken()
    }

    if (!this.active || !this.url || !this.auth) {
      return null
    }

    try {
      const res = await axios.get(`${this.url}${endpointPath}`, {
        ...this.auth,
        httpsAgent: this.httpsAgent,
        validateStatus: (status) => status < 500,
        timeout: 2500,
      })

      return {
        status: res.status,
        data: res.data,
      }
    } catch (error) {
      const err = error as Error
      logger.debug(`LCU read-only endpoint failed (${endpointPath}):`, err.message)
      return null
    }
  }

  /**
   * 读取游戏内 Live Client Data。该接口无写操作，仅用于排查游戏中是否有海克斯选择状态。
   */
  async getLiveClientAllGameData(): Promise<{ status: number; data: any } | null> {
    try {
      const res = await axios.get('https://127.0.0.1:2999/liveclientdata/allgamedata', {
        httpsAgent: this.httpsAgent,
        validateStatus: (status) => status < 500,
        timeout: 2500,
      })

      return {
        status: res.status,
        data: res.data,
      }
    } catch (error) {
      const err = error as Error
      logger.debug('Live Client Data read failed:', err.message)
      return null
    }
  }

  /**
   * 轮询游戏阶段（用于监听阶段变化）
   * @param callback - 阶段变化时的回调函数
   * @param interval - 轮询间隔（毫秒），默认1000ms
   * @returns 定时器ID，可用于后续停止轮询
   */
  pollGameflowPhase(callback: (phase: GameflowPhase) => void, interval: number = 1000): NodeJS.Timeout {
    let lastPhase: GameflowPhase | null = null

    const timer = setInterval(async () => {
      try {
        const phase = await this.getGameflowPhase()
        if (phase && phase !== lastPhase) {
          logger.info(`📍 游戏阶段变化: ${lastPhase} → ${phase}`)
          lastPhase = phase
          callback(phase)
        }
      } catch (error) {
        const err = error as Error
        logger.warn('轮询游戏阶段出错:', err.message)
      }
    }, interval)

    return timer
  }

  /**
   * 停止轮询游戏阶段
   * @param timerId - 由 pollGameflowPhase 返回的定时器ID
   */
  stopPollGameflowPhase(timerId: NodeJS.Timeout): void {
    if (timerId) {
      clearInterval(timerId)
      logger.info('⏹️ 停止游戏阶段轮询')
    }
  }

  /**
   * 订阅 LCU WAMP OnJsonApiEvent 中的 gameflow phase 变化。
   * 该订阅只读取事件，不调用任何会改变游戏或选人状态的接口。
   */
  async subscribeGameflowPhase(
    callback: (
      phase: GameflowPhase,
      event: LcuJsonApiEvent<GameflowPhase>
    ) => void | Promise<void>,
    options: GameflowPhaseSubscriptionOptions = {}
  ): Promise<GameflowPhaseSubscription | null> {
    await this.getAuthToken(options.forceRefresh ?? false)

    if (!this.active || !this.token || !this.port) {
      return null
    }

    const socket = new LcuWampSocket({
      token: this.token,
      port: this.port,
      onGameflowPhase: async (phase, event) => {
        await callback(phase as GameflowPhase, event as LcuJsonApiEvent<GameflowPhase>)
      },
      onOpen: options.onOpen,
      onClose: options.onClose,
      onError: options.onError,
    })

    socket.connect()

    return {
      close: () => socket.close(),
      isConnected: () => socket.isConnected(),
    }
  }

  /**
   * 获取服务状态
   */
  isActive(): boolean {
    return this.active
  }

  /**
   * 获取当前 URL
   */
  getUrl(): string | null {
    return this.url
  }

}

// 全局单例实例缓存
const instances = new Map<string, LCUService>()

/**
 * 获取或创建 LCU 服务实例（单例模式）
 * @param options - 配置选项
 */
export function getLCUServiceInstance(
  options?: Partial<LCUServiceOptions>
): LCUService {
  const instanceKey = '__auto__'
  if (!instances.has(instanceKey)) {
    instances.set(
      instanceKey,
      new LCUService({
        ...options,
      })
    )
  }
  return instances.get(instanceKey)!
}

/**
 * 清除所有实例缓存
 */
export function clearLCUServiceInstances(): void {
  instances.clear()
}

export default LCUService
