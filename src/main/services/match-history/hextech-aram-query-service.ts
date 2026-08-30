import type {
  HextechAramMatchHistoryAsset,
  HextechAramMatchHistoryMatch,
  HextechAramMatchHistoryPage,
  HextechAramMatchHistoryQuery,
} from '../../../shared/ipc-contract.ts'
import { loadAugmentDetail, loadChampionRoster, loadItems } from '../../data-loader.ts'
import logger from '../../modules/logger.ts'
import type LCUService from '../lcu/lcu-service.ts'
import { normalizeGame } from './local-match-history-service.ts'
import { isHextechAramGame } from './statistics.ts'
import { SgpMatchHistoryService } from './sgp-match-history-service.ts'
import type { StoredMatchHistoryGame } from './types.ts'

export const DEFAULT_HEXTECH_ARAM_QUERY_COUNT = 10
export const MAX_HEXTECH_ARAM_QUERY_COUNT = 20
export const MAX_HEXTECH_ARAM_QUERY_START_INDEX = 1_000

type AnyRecord = Record<string, unknown>

type AssetLabel = {
  name?: string
  iconUrl?: string
}

export type HextechAramQueryLabels = {
  champions?: ReadonlyMap<number, AssetLabel>
  augments?: ReadonlyMap<number, AssetLabel>
  items?: ReadonlyMap<number, AssetLabel>
}

type BuildPageOptions = {
  games: StoredMatchHistoryGame[]
  currentPuuid: string
  playerName: string
  platformId: string
  startIndex: number
  count: number
  scannedCount: number
  queriedAt: number
  labels?: HextechAramQueryLabels
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isValidPuuid(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value)
}

function normalizePlatformId(value: unknown): string {
  const platformId = asString(value).toUpperCase()
  return /^[A-Z0-9-]{2,24}$/.test(platformId) ? platformId : ''
}

function formatPlayerName(gameName: string, tagLine: string): string {
  if (!gameName) return ''
  return tagLine ? `${gameName}#${tagLine}` : gameName
}

function getPlayerName(currentSummoner: AnyRecord): string {
  return formatPlayerName(
    asString(currentSummoner.gameName) || asString(currentSummoner.displayName),
    asString(currentSummoner.tagLine),
  )
}

function getBootstrapPlatformId(payload: unknown): string {
  if (!isRecord(payload)) return ''

  const direct = normalizePlatformId(payload.platformId)
  if (direct) return direct

  const gamesContainer = isRecord(payload.games) ? payload.games : null
  const firstGame = gamesContainer && Array.isArray(gamesContainer.games)
    ? gamesContainer.games.find(isRecord)
    : null
  if (!firstGame) return ''

  const fromGame = normalizePlatformId(firstGame.platformId)
  if (fromGame) return fromGame

  const identities = Array.isArray(firstGame.participantIdentities)
    ? firstGame.participantIdentities
    : []
  for (const identity of identities) {
    if (!isRecord(identity) || !isRecord(identity.player)) continue
    const fromPlayer = normalizePlatformId(identity.player.platformId ?? identity.player.currentPlatformId)
    if (fromPlayer) return fromPlayer
  }

  return ''
}

function toAsset(id: number, labels?: ReadonlyMap<number, AssetLabel>): HextechAramMatchHistoryAsset {
  const label = labels?.get(id)
  return {
    id,
    ...(label?.name ? { name: label.name } : {}),
    ...(label?.iconUrl ? { iconUrl: label.iconUrl } : {}),
  }
}

function toMatch(
  game: StoredMatchHistoryGame,
  currentPuuid: string,
  labels: HextechAramQueryLabels,
): HextechAramMatchHistoryMatch | null {
  if (!isHextechAramGame(game)) return null

  const participant = game.participants.find((entry) => entry.puuid === currentPuuid)
  if (!participant) return null

  const champion = labels.champions?.get(participant.championId)
  const isRemake = game.endOfGameResult.startsWith('Abort_') || participant.gameEndedInEarlySurrender
  return {
    gameId: game.gameId,
    gameCreation: game.gameCreation,
    gameDuration: game.gameDuration,
    gameVersion: game.gameVersion,
    championId: participant.championId,
    ...(champion?.name ? { championName: champion.name } : {}),
    ...(champion?.iconUrl ? { championIconUrl: champion.iconUrl } : {}),
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    result: isRemake ? 'remake' : participant.win ? 'win' : 'loss',
    augments: participant.augments.map((id) => toAsset(id, labels.augments)),
    items: participant.items.map((id) => toAsset(id, labels.items)),
  }
}

function getLocalizedItemName(item: AnyRecord): string {
  if (typeof item.name === 'string') return item.name
  if (!isRecord(item.name)) return ''
  return asString(item.name.zh_CN) || asString(item.name.zh_cn) || asString(item.name.en_us)
}

export function normalizeHextechAramQuery(
  query: HextechAramMatchHistoryQuery | null | undefined,
): Required<HextechAramMatchHistoryQuery> {
  const requestedStartIndex = Number(query?.startIndex)
  const requestedCount = Number(query?.count)
  const startIndex = Number.isInteger(requestedStartIndex) && requestedStartIndex >= 0
    ? Math.min(requestedStartIndex, MAX_HEXTECH_ARAM_QUERY_START_INDEX)
    : 0
  const count = Number.isInteger(requestedCount) && requestedCount > 0
    ? Math.min(requestedCount, MAX_HEXTECH_ARAM_QUERY_COUNT)
    : DEFAULT_HEXTECH_ARAM_QUERY_COUNT

  return { startIndex, count }
}

export function buildHextechAramMatchHistoryPage(
  options: BuildPageOptions,
): HextechAramMatchHistoryPage {
  const labels = options.labels || {}
  const seenGameIds = new Set<number>()
  const matches = [...options.games]
    .sort((left, right) => right.gameCreation - left.gameCreation)
    .flatMap((game) => {
      if (seenGameIds.has(game.gameId)) return []
      seenGameIds.add(game.gameId)
      const match = toMatch(game, options.currentPuuid, labels)
      return match ? [match] : []
    })

  return {
    playerName: options.playerName,
    platformId: options.platformId,
    queriedAt: options.queriedAt,
    startIndex: options.startIndex,
    count: options.count,
    returnedCount: matches.length,
    hasPrevious: options.startIndex > 0,
    hasMore: options.scannedCount >= options.count,
    matches,
  }
}

export class HextechAramQueryService {
  private readonly sgpMatchHistoryService: SgpMatchHistoryService

  constructor(private readonly lcuService: LCUService) {
    this.sgpMatchHistoryService = new SgpMatchHistoryService(lcuService)
  }

  async queryCurrent(
    query?: HextechAramMatchHistoryQuery,
  ): Promise<HextechAramMatchHistoryPage> {
    const range = normalizeHextechAramQuery(query)
    const currentSummoner = await this.lcuService.getCurrentSummoner()
    if (!isRecord(currentSummoner) || !isValidPuuid(currentSummoner.puuid)) {
      throw new Error('请先登录英雄联盟客户端')
    }

    const currentPuuid = currentSummoner.puuid
    let platformId = normalizePlatformId(currentSummoner.platformId ?? currentSummoner.currentPlatformId)
    if (!platformId) {
      platformId = getBootstrapPlatformId(
        await this.lcuService.getCurrentSummonerMatchHistory(0, 0),
      )
    }
    if (!platformId) {
      throw new Error('无法识别当前账号所在区服')
    }

    const rawGames = await this.sgpMatchHistoryService.getHextechAramSummaries(
      currentPuuid,
      platformId,
      range.startIndex,
      range.count,
    )
    const queriedAt = Date.now()
    const normalizedGames = rawGames.flatMap((game) => {
      const normalized = normalizeGame(game, platformId, queriedAt)
      return normalized ? [normalized] : []
    })
    const labels = await this.loadLabels()

    return buildHextechAramMatchHistoryPage({
      games: normalizedGames,
      currentPuuid,
      playerName: getPlayerName(currentSummoner),
      platformId,
      startIndex: range.startIndex,
      count: range.count,
      scannedCount: rawGames.length,
      queriedAt,
      labels,
    })
  }

  private async loadLabels(): Promise<HextechAramQueryLabels> {
    try {
      const [champions, augmentsById, items] = await Promise.all([
        loadChampionRoster(),
        loadAugmentDetail(),
        loadItems(),
      ])
      return {
        champions: new Map(champions.map((champion: AnyRecord) => [
          Number(champion.championId ?? champion.id),
          {
            name: asString(champion.nameCN) || asString(champion.nameEN),
            iconUrl: asString(champion.iconUrl),
          },
        ])),
        augments: new Map(Object.entries(augmentsById).map(([id, value]) => {
          const augment = isRecord(value) ? value : {}
          return [Number(id), {
            name: asString(augment.name),
            iconUrl: asString(augment.iconUrl),
          }]
        })),
        items: new Map(items.map((value: unknown) => {
          const item = isRecord(value) ? value : {}
          return [Number(item.id), {
            name: getLocalizedItemName(item),
            iconUrl: asString(item.iconUrl),
          }]
        })),
      }
    } catch (error) {
      logger.debug('[match-history] query labels unavailable:', error instanceof Error ? error.message : String(error))
      return {}
    }
  }
}

let sharedHextechAramQueryService: HextechAramQueryService | null = null

export function getHextechAramQueryService(lcuService: LCUService): HextechAramQueryService {
  if (!sharedHextechAramQueryService) {
    sharedHextechAramQueryService = new HextechAramQueryService(lcuService)
  }
  return sharedHextechAramQueryService
}
