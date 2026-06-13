import logger from '../../modules/logger.ts'
import { getLCUServiceInstance } from '../lcu/lcu-service.ts'
import {
  loadChampionBuild,
  loadChampionName,
} from '../../data-loader.ts'

type SingleChampionItemSetInstallOptions = {
  championId: string | number
  builds?: any[]
  championName?: ChampionLike | null
}

type ChampionLike = {
  championId?: string | number
  id?: string | number
  nameEN?: string
  alias?: string
  nameCN?: string
}

type BuildRecord = {
  id?: string | number
  itemId?: string | number
  itemIds?: Array<string | number>
  items?: Array<string | number>
  winRate?: number
  pick_rate?: number
  win_rate?: number
  pickRate?: number
  games?: number
  averageIndex?: number
}

type ChampionInstallResult = {
  championId: number
  championKey: string
  lcuSuccess?: boolean
  lcuError?: string | null
  lcuMethod?: string | null
  lcuStatus?: number | null
  lcuRemovedCount?: number | null
  lcuItemSetCount?: number | null
  localRemovedCount?: number | null
  localWrittenCount?: number | null
  writtenItemSetCount?: number | null
  success: boolean
  skipped?: boolean
  reason?: string
}

const SUMMONERS_RIFT_MAP_ID = 11
const ARAM_MAP_ID = 12
const MIN_RECOMMENDATION_GAMES = 2
const MIN_BUILD_GAMES = 300
const MIN_CORE_SEQUENCE_GAMES = 20
const MAX_ITEM_SETS_PER_CHAMPION = 4

function getChampionId(champion: ChampionLike): number {
  return Number(champion.championId ?? champion.id ?? 0)
}

function getChampionKey(champion: ChampionLike, championName: ChampionLike | null = null): string {
  const rawKey = champion.alias || champion.nameEN || championName?.alias || championName?.nameEN || ''
  return String(rawKey).replace(/[^a-zA-Z0-9]/g, '')
}

function getChampionLabel(champion: ChampionLike, championName: ChampionLike | null = null): string {
  return getChampionKey(champion, championName) || String(getChampionId(champion))
}

function normalizeItemIds(record: BuildRecord): string[] {
  const ids = Array.isArray(record?.itemIds) ? record.itemIds : record?.items
  if (Array.isArray(ids)) {
    return ids.map((id) => String(id).trim()).filter(Boolean)
  }

  const singleId = record?.itemId ?? record?.id
  if (singleId != null && singleId !== '') {
    return [String(singleId).trim()].filter(Boolean)
  }

  return []
}

function getRecordGames(record: BuildRecord): number {
  const games = Number(record?.games || 0)
  return Number.isFinite(games) ? games : 0
}

function hasEnoughGames(record: BuildRecord): boolean {
  return getRecordGames(record) >= MIN_RECOMMENDATION_GAMES
}

function compareRecordsByConfidence(left: BuildRecord, right: BuildRecord): number {
  const gamesDiff = getRecordGames(right) - getRecordGames(left)
  if (gamesDiff !== 0) {
    return gamesDiff
  }

  const pickDiff = Number(right?.pickRate || 0) - Number(left?.pickRate || 0)
  if (pickDiff !== 0) {
    return pickDiff
  }

  return Number(right?.winRate || 0) - Number(left?.winRate || 0)
}

function getTrustedRecords(records: BuildRecord[]): BuildRecord[] {
  return records
    .filter(hasEnoughGames)
    .sort(compareRecordsByConfidence)
}

function getBestCoreGames(records: BuildRecord[]): number {
  return records.reduce((best, record) => Math.max(best, getRecordGames(record)), 0)
}

function getBuildGames(build: any): number {
  const games = Number(build?.games ?? build?.stats?.games ?? 0)
  return Number.isFinite(games) ? games : 0
}

function getBuildTags(build: any): string[] {
  const rawTags = build?.tags && typeof build.tags === 'object'
    ? Object.values(build.tags)
    : []
  const values = [
    build?.buildTags,
    ...(rawTags as any[]),
  ]
  const seen = new Set<string>()

  return values
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter((value) => {
      if (!value) {
        return false
      }

      const key = value.toLowerCase()
      if (seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    })
}

function getBuildTitleTag(build: any, index: number): string {
  const tags = getBuildTags(build)
  if (tags.length) {
    return tags.join(', ')
  }

  return build?.tier || build?.role || `Build ${index + 1}`
}

function getBuildSkipReason(build: any): string | null {
  const coreRecords = build?.coreItems || build?.recommended || []
  const buildGames = getBuildGames(build)
  const bestCoreGames = getBestCoreGames(coreRecords)

  if (buildGames < MIN_BUILD_GAMES) {
    return `low-build-games:${buildGames}`
  }

  if (bestCoreGames < MIN_CORE_SEQUENCE_GAMES) {
    return `low-core-games:${bestCoreGames}`
  }

  return null
}

function collectBuilds(builds: any): any[] {
  const records: any[] = Array.isArray(builds)
    ? builds
    : Array.isArray(builds?.builds)
      ? builds.builds
      : []

  const seen = new Set<string>()
  return records
    .filter((build) => build && typeof build === 'object' && !Array.isArray(build))
    .filter((build) => {
      const coreKey = Array.isArray(build?.coreItems)
        ? build.coreItems
          .slice(0, 3)
          .map((record: BuildRecord) => normalizeItemIds(record).join('-'))
          .join('|')
        : ''
      const key = `${getBuildTags(build).join('|')}:${coreKey}:${build?.role || ''}:${build?.tier || ''}`
      if (seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    })
    .slice(0, MAX_ITEM_SETS_PER_CHAMPION)
}

function normalizePercent(value: unknown): number | null {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null
  }

  return numberValue <= 1 ? numberValue * 100 : numberValue
}

function formatPercent(value: unknown): string | null {
  const normalized = normalizePercent(value)
  return normalized == null ? null : `${normalized.toFixed(2)}%`
}

function formatBlockStats(record: BuildRecord): string {
  const parts = []
  const pickRate = formatPercent(record.pickRate)
  const winRate = formatPercent(record.winRate)

  if (record.games) {
    parts.push(`Games ${Math.round(record.games)}`)
  }

  if (pickRate) {
    parts.push(`Pick ${pickRate}`)
  }

  if (winRate) {
    parts.push(`Win ${winRate}`)
  }

  return parts.length ? `, ${parts.join(', ')}` : ''
}

function toBlockItems(itemIds: string[]) {
  return itemIds.map((id) => ({
    id,
    count: 1,
  }))
}

function createSequenceBlocks(records: BuildRecord[], label: string, limit: number) {
  return getTrustedRecords(records)
    .map((record) => ({
      record,
      itemIds: normalizeItemIds(record),
    }))
    .filter(({ itemIds }) => itemIds.length > 0)
    .slice(0, limit)
    .map(({ record, itemIds }, index) => ({
      type: `ARAMGG ${label} #${index + 1}${formatBlockStats(record)}`,
      items: toBlockItems(itemIds),
    }))
}

function createSingleItemBlock(
  records: BuildRecord[],
  label: string,
  limit: number,
  excludedItemIds: Set<string> = new Set()
) {
  const seen = new Set<string>()
  const itemIds = getTrustedRecords(records)
    .map((record) => normalizeItemIds(record)[0])
    .filter((itemId) => {
      if (!itemId || seen.has(itemId) || excludedItemIds.has(itemId)) {
        return false
      }

      seen.add(itemId)
      return true
    })
    .slice(0, limit)

  if (!itemIds.length) {
    return []
  }

  return [
    {
      type: `ARAMGG ${label}`,
      items: toBlockItems(itemIds),
    },
  ]
}

function collectBlockedItemIds(records: BuildRecord[], limit: number): Set<string> {
  const blocked = new Set<string>()
  getTrustedRecords(records)
    .slice(0, limit)
    .forEach((record) => {
      normalizeItemIds(record).forEach((itemId) => blocked.add(itemId))
    })
  return blocked
}

function createItemSet(
  champion: ChampionLike,
  championName: ChampionLike | null,
  build: any,
  index: number
) {
  const championId = getChampionId(champion)
  const championLabel = getChampionLabel(champion, championName)
  const buildTag = getBuildTitleTag(build, index)
  const coreRecords = build?.coreItems || build?.recommended || []
  const blockedSituationalItemIds = collectBlockedItemIds(coreRecords, 5)
  const blocks = [
    ...createSequenceBlocks(build?.startingItems || [], 'Starter', 3),
    ...createSequenceBlocks(coreRecords, 'Core', 5),
    ...createSingleItemBlock(build?.itemExtensions || [], 'Next Items', 12),
    ...createSingleItemBlock(
      build?.situationalItems || [],
      'Situational Items',
      18,
      blockedSituationalItemIds
    ),
  ]

  if (!championId || !blocks.length) {
    return null
  }

  return {
    title: `ARAMGG ARAM ${championLabel} ${buildTag}${build?.patch ? ` ${build.patch}` : ''}`,
    associatedMaps: [SUMMONERS_RIFT_MAP_ID, ARAM_MAP_ID],
    associatedChampions: [championId],
    blocks,
    map: 'any',
    mode: 'any',
    preferredItemSlots: [],
    sortrank: 0,
    sortRank: 0,
    startedFrom: 'blank',
    type: 'custom',
  }
}

export function createItemSets(champion: ChampionLike, championName: ChampionLike | null, builds: any): {
  itemSets: any[]
  skippedBuilds: Array<{ title: string; reason: string }>
  totalBuilds: number
} {
  const trustedBuilds = collectBuilds(builds)
  const itemSets: any[] = []
  const skippedBuilds: Array<{ title: string; reason: string }> = []

  trustedBuilds.forEach((build, index) => {
    const title = getBuildTitleTag(build, index)
    const skipReason = getBuildSkipReason(build)
    if (skipReason) {
      skippedBuilds.push({ title, reason: skipReason })
      return
    }

    const itemSet = createItemSet(champion, championName, build, index)
    if (itemSet) {
      itemSets.push(itemSet)
    } else {
      skippedBuilds.push({ title, reason: 'missing-build-blocks' })
    }
  })

  return {
    itemSets,
    skippedBuilds,
    totalBuilds: trustedBuilds.length,
  }
}

function withItemSetUid(itemSet: any, index = 0): any {
  return {
    ...itemSet,
    uid: index === 0 ? 'aramgg-aram-current' : `aramgg-aram-current-${index + 1}`,
  }
}

function formatInstallError(reason: string | null | undefined): string {
  if (reason === 'low-confidence-build-data') {
    return '出装样本不足，已跳过写入'
  }

  if (reason === 'missing-build-data' || reason === 'missing-build-blocks') {
    return '没有可用的出装数据'
  }

  if (reason === 'missing-champion-key') {
    return '未识别到英雄名称，无法写入出装'
  }

  return reason || '装备推荐写入失败'
}

async function installCurrentItemSets(itemSets: any[], championKey: string): Promise<{
  success: boolean
  error: string | null
  method: string | null
  status: number | null
  removedCount: number | null
  itemSetCount: number | null
  localRemovedCount: number | null
  localWrittenCount: number | null
}> {
  const managedItemSets = itemSets.map((itemSet, index) => withItemSetUid(itemSet, index))

  try {
    const service = getLCUServiceInstance()
    logger.info('[item-set] LCU item set sync requested', {
      championKey,
      itemSetCount: managedItemSets.length,
      titles: managedItemSets.map((itemSet) => itemSet?.title || null),
      blockCounts: managedItemSets.map((itemSet) =>
        Array.isArray(itemSet?.blocks) ? itemSet.blocks.length : 0
      ),
    })
    const result = await service.syncItemSets(managedItemSets)

    return {
      success: result.success,
      error: result.success ? null : result.error || 'LCU 装备同步失败',
      method: result.method || null,
      status: result.status || null,
      removedCount: result.removedCount ?? null,
      itemSetCount: result.itemSetCount ?? null,
      localRemovedCount: 0,
      localWrittenCount: 0,
    }
  } catch (error) {
    const err = error as Error
    return {
      success: false,
      error: err.message,
      method: null,
      status: null,
      removedCount: null,
      itemSetCount: null,
      localRemovedCount: 0,
      localWrittenCount: 0,
    }
  }
}

async function installChampionItemSet(
  champion: ChampionLike,
  providedBuilds: any[] | null = null,
  providedChampionName: ChampionLike | null = null
): Promise<ChampionInstallResult> {
  const championId = getChampionId(champion)

  try {
    const hasProvidedBuilds = Array.isArray(providedBuilds)
    const hasProvidedChampionName = providedChampionName && typeof providedChampionName === 'object'
    const [buildData, championName] = await Promise.all([
      hasProvidedBuilds ? Promise.resolve(null) : loadChampionBuild(championId),
      hasProvidedChampionName ? Promise.resolve(providedChampionName) : loadChampionName(championId),
    ])
    const builds = hasProvidedBuilds ? providedBuilds : buildData?.builds
    const championKey = getChampionKey(champion, championName)

    if (!championId || !championKey) {
      return {
        championId,
        championKey,
        writtenItemSetCount: 0,
        success: false,
        skipped: true,
        reason: 'missing-champion-key',
      }
    }

    const buildItemSets = createItemSets(champion, championName, builds)
    if (buildItemSets.skippedBuilds.length > 0) {
      logger.info('[item-set] builds skipped', {
        championId,
        championKey,
        totalBuilds: buildItemSets.totalBuilds,
        skippedBuilds: buildItemSets.skippedBuilds,
      })
    }

    if (!buildItemSets.itemSets.length) {
      const clearResult = await installCurrentItemSets([], championKey)
      return {
        championId,
        championKey,
        lcuSuccess: clearResult.success,
        lcuError: clearResult.error,
        lcuMethod: clearResult.method,
        lcuStatus: clearResult.status,
        lcuRemovedCount: clearResult.removedCount,
        lcuItemSetCount: clearResult.itemSetCount,
        localRemovedCount: clearResult.localRemovedCount,
        localWrittenCount: clearResult.localWrittenCount,
        writtenItemSetCount: 0,
        success: false,
        skipped: true,
        reason: buildItemSets.totalBuilds > 0
          ? 'low-confidence-build-data'
          : 'missing-build-data',
      }
    }

    const installResult = await installCurrentItemSets(buildItemSets.itemSets, championKey)

    if (!installResult.success) {
      logger.warn('[item-set] item set install failed:', installResult.error)
    }

    return {
      championId,
      championKey,
      lcuSuccess: installResult.success,
      lcuError: installResult.error,
      lcuMethod: installResult.method,
      lcuStatus: installResult.status,
      lcuRemovedCount: installResult.removedCount,
      lcuItemSetCount: installResult.itemSetCount,
      localRemovedCount: installResult.localRemovedCount,
      localWrittenCount: installResult.localWrittenCount,
      writtenItemSetCount: installResult.success ? buildItemSets.itemSets.length : 0,
      success: installResult.success,
      reason: installResult.success ? undefined : installResult.error || '装备推荐写入失败',
    }
  } catch (error) {
    const err = error as Error
    logger.warn(`[item-set] failed to install champion ${championId}:`, err.message)
    return {
      championId,
      championKey: getChampionKey(champion),
      writtenItemSetCount: 0,
      success: false,
      reason: err.message,
    }
  }
}

export async function getAramItemSetInstallStatus() {
  return {
    success: true,
    installed: false,
    installedCount: 0,
    mode: 'lcu',
  }
}

export async function installAramItemSetForChampion(options: SingleChampionItemSetInstallOptions) {
  const startedAt = Date.now()
  const championId = Number(options.championId)

  if (!Number.isFinite(championId) || championId <= 0) {
    throw new Error('英雄 ID 无效')
  }

  const result = await installChampionItemSet(
    { championId },
    Array.isArray(options.builds) ? options.builds : null,
    options.championName || null
  )

  logger.info('[item-set] ARAM item set install completed', {
    championId,
    championKey: result.championKey || null,
    success: result.success,
    skipped: result.skipped || false,
    reason: result.reason || null,
    lcuSuccess: result.lcuSuccess || false,
    lcuError: result.lcuError || null,
    lcuMethod: result.lcuMethod || null,
    lcuStatus: result.lcuStatus || null,
    lcuRemovedCount: result.lcuRemovedCount ?? null,
    lcuItemSetCount: result.lcuItemSetCount ?? null,
    localRemovedCount: result.localRemovedCount ?? null,
    localWrittenCount: result.localWrittenCount ?? null,
    writtenItemSetCount: result.writtenItemSetCount ?? null,
    durationMs: Date.now() - startedAt,
  })

  return {
    success: result.success,
    championId,
    championKey: result.championKey,
    mode: 'lcu',
    lcuSuccess: result.lcuSuccess || false,
    lcuError: result.lcuError || null,
    lcuMethod: result.lcuMethod || null,
    lcuStatus: result.lcuStatus || null,
    lcuRemovedCount: result.lcuRemovedCount ?? null,
    lcuItemSetCount: result.lcuItemSetCount ?? null,
    localRemovedCount: result.localRemovedCount ?? null,
    localWrittenCount: result.localWrittenCount ?? null,
    writtenItemSetCount: result.writtenItemSetCount ?? null,
    skipped: result.skipped || false,
    reason: result.reason || null,
    error: result.success ? null : formatInstallError(result.reason),
    durationMs: Date.now() - startedAt,
  }
}
