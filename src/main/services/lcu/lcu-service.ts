/**
 * 统一的 LCU (League Client Update) 服务
 *
 * 合并自：
 * - src/service/lcu.js (LCUService)
 * - electron/modules/app-config.js (MainProcessLCU)
 * - electron/modules/ipc-handlers.js (IpcLCUService)
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
import logger from '../../modules/logger.js'
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
  /** 游戏安装路径 */
  lolPath: string
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
  private lolPath: string
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

  // HTTPS Agent（禁用证书验证，LCU 使用自签名证书）
  private httpsAgent = new https.Agent({
    rejectUnauthorized: false,
  })

  constructor(options: LCUServiceOptions) {
    this.lolPath = options.lolPath
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

    try {
      const [token, port] = await getLcuToken(this.lolPath)

      if (!token || !port) {
        logger.debug('Unable to get LCU token; game client may not be running')
        this.setVars(null, null, null)
        this.lastFailTime = now
        return null
      }

      const url = `https://127.0.0.1:${port}`
      this.setVars(token, port, url)
      this.lastTokenFetchTime = now
      this.lastFailTime = 0 // 清除失败时间

      logger.debug(`LCU connected (port: ${port})`)
      return { token, port, url }
    } catch (error) {
      const err = error as Error
      logger.error('LCU 连接失败:', err.message)
      this.setVars(null, null, null)
      this.lastFailTime = now
      return null
    }
  }

  /**
   * 检查 LCU 状态
   */
  async getLcuStatus(): Promise<boolean> {
    if (!this.urls || !this.auth) {
      return false
    }

    try {
      const res = await axios.get(this.urls.authToken, {
        ...this.auth,
        httpsAgent: this.httpsAgent,
      })
      return !!res
    } catch (error) {
      return false
    }
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
          this.active = false
          this.lastFailTime = Date.now()
        }
        return null
      }

      return res.data
    } catch (error) {
      // 连接被拒绝说明客户端可能未运行或端口已失效
      const err = error as any
      if (err.code === 'ECONNREFUSED') {
        this.active = false
        this.lastFailTime = Date.now()
        logger.debug('LCU connection lost')
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
        this.active = false
        await this.getAuthToken()
        return null
      }

      logger.debug('Current gameflow phase:', res.data)
      return res.data
    } catch (error) {
      const err = error as any
      // 连接失败时尝试重新认证
      if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        logger.debug('LCU connection lost, trying to reconnect')
        this.active = false
        await this.getAuthToken()
      } else {
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

  /**
   * 获取游戏路径
   */
  getLolPath(): string {
    return this.lolPath
  }
}

// 全局单例实例缓存
const instances = new Map<string, LCUService>()

/**
 * 获取或创建 LCU 服务实例（单例模式）
 * @param lolPath - 游戏安装路径
 * @param options - 配置选项
 */
export function getLCUServiceInstance(
  lolPath: string,
  options?: Partial<LCUServiceOptions>
): LCUService {
  if (!instances.has(lolPath)) {
    instances.set(
      lolPath,
      new LCUService({
        lolPath,
        ...options,
      })
    )
  }
  return instances.get(lolPath)!
}

/**
 * 清除所有实例缓存
 */
export function clearLCUServiceInstances(): void {
  instances.clear()
}

export default LCUService
