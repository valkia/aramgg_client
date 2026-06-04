/**
 * LCU (League Client Update) 服务类型定义
 * 主进程和渲染进程共享
 */

/** LCU 认证结果 */
export interface LCUAuthResult {
  token: string
  port: string
  url: string
}

/** LCU 连接配置 */
export interface LCUAuthConfig {
  auth: {
    username: 'riot'
    password: string
  }
}

/** LCU API URL 集合 */
export interface LCUUrls {
  authToken: string
  curSession: string
  curPerk: string
  perks: string
  currentSummoner: string
  itemSets: string
  position1: string
  position2: string
  gameflowPhase: string
  gameflowSession: string
}

/** 只读选人快照状态 */
export type ChampSelectSnapshotStatus =
  | 'unavailable'
  | 'not-in-champ-select'
  | 'empty'
  | 'ready'

/** 游戏流程阶段 */
export type GameflowPhase =
  | 'None'
  | 'Lobby'
  | 'Matchmaking'
  | 'CheckedIntoGame'
  | 'ReadyCheck'
  | 'ChampSelect'
  | 'GameStart'
  | 'InProgress'
  | 'WaitingForStats'
  | 'PreEndOfGame'
  | 'EndOfGame'

/** 选人会话中的队员信息 */
export interface TeamMember {
  cellId: number
  championId: number
  summonerId?: number
  spell1Id?: number
  spell2Id?: number
  championPickIntent?: number
  [key: string]: unknown
}

/** 选人会话中的操作信息 */
export interface ChampSelectAction {
  actorCellId: number
  championId: number
  type: string
  completed: boolean
  id?: number
  [key: string]: unknown
}

/** 大乱斗 bench 英雄信息 */
export interface ChampSelectBenchChampion {
  championId: number
  isPriority?: boolean
  [key: string]: unknown
}

/** 选人计时器信息 */
export interface ChampSelectTimer {
  adjustedTimeLeftInPhase?: number
  internalNowInEpochMs?: number
  phase?: string
  totalTimeInPhase?: number
  [key: string]: unknown
}

/** 选人会话数据 */
export interface ChampSelectSession {
  localPlayerCellId: number
  myTeam: TeamMember[]
  theirTeam: TeamMember[]
  actions: ChampSelectAction[][]
  benchEnabled?: boolean
  benchChampions?: ChampSelectBenchChampion[]
  timer?: ChampSelectTimer
  errorCode?: string
  [key: string]: unknown
}

/** 标准化后的只读选人快照 */
export interface ChampSelectSnapshot {
  connected: boolean
  gameflowPhase: GameflowPhase | null
  isInChampSelect: boolean
  champSelectSession: ChampSelectSession | null
  localPlayerCellId: number | null
  selfChampionId: number | null
  benchEnabled: boolean
  benchChampions: ChampSelectBenchChampion[]
  myTeam: TeamMember[]
  actions: ChampSelectAction[][]
  timer: ChampSelectTimer | null
  status: ChampSelectSnapshotStatus
  reason: string | null
  updatedAt: number
}

/** 符文页数据 */
export interface PerkPage {
  id: number
  name: string
  current: boolean
  isDeletable: boolean
  selectedPerkIds: number[]
  primaryStyleId: number
  subStyleId: number
}

/** LCU 服务缓存配置 */
export interface LCUCacheConfig {
  tokenCacheDuration: number
  failCooldown: number
}

/** 获取英雄ID的结果 */
export interface ChampionIdResult {
  success: boolean
  championId: number | null
  error?: string
}

/** Token 加载结果（三元组） */
export type TokenLoadResult = [
  token: string | null,
  port: string | null,
  urlWithAuth: string | null,
]
