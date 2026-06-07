import { readdir, readFile, rm } from 'fs/promises'
import path from 'path'
import logger from '../../modules/logger.ts'
import {
  inspectLeagueInstallDirectory,
  normalizeLolPath,
} from '../../modules/lol-path.ts'
import { getLCUServiceInstance } from '../lcu/lcu-service.ts'
import {
  loadChampionBuild,
  loadChampionName,
} from '../../data-loader.ts'

type ItemSetInstallOptions = {
  lolPath: string
}

type SingleChampionItemSetInstallOptions = ItemSetInstallOptions & {
  championId: string | number
  build?: any
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

async function readJsonFileSafe(filePath: string): Promise<any | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    return null
  }
}

function isManagedAramggItemSet(payload: any): boolean {
  const uid = String(payload?.uid || '')
  const title = String(payload?.title || '')
  const blocks = Array.isArray(payload?.blocks) ? payload.blocks : []

  return (
    uid.startsWith('aramgg-') ||
    title.startsWith('ARAMGG ARAM ') ||
    blocks.some((block: any) => String(block?.type || '').startsWith('ARAMGG '))
  )
}

async function collectRecommendedJsonFiles(lolPath: string): Promise<string[]> {
  const configRoot = path.join(lolPath, 'Game', 'Config')
  const candidateDirs = [path.join(configRoot, 'Global', 'Recommended')]
  const championsRoot = path.join(configRoot, 'Champions')

  try {
    const championDirs = await readdir(championsRoot, { withFileTypes: true })
    championDirs
      .filter((entry) => entry.isDirectory())
      .forEach((entry) => {
        candidateDirs.push(path.join(championsRoot, entry.name, 'Recommended'))
      })
  } catch {
    // Champion-specific recommended files are optional.
  }

  const files: string[] = []
  for (const directoryPath of candidateDirs) {
    try {
      const entries = await readdir(directoryPath, { withFileTypes: true })
      entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
        .forEach((entry) => files.push(path.join(directoryPath, entry.name)))
    } catch {
      // Missing recommendation folders are fine.
    }
  }

  return files
}

async function cleanupLegacyLocalItemSetFiles(lolPath: string): Promise<{
  removedCount: number
  removedFiles: string[]
}> {
  const files = await collectRecommendedJsonFiles(lolPath)
  const removedFiles: string[] = []

  for (const filePath of files) {
    const payload = await readJsonFileSafe(filePath)
    if (!isManagedAramggItemSet(payload)) {
      continue
    }

    try {
      await rm(filePath, { force: true })
      removedFiles.push(filePath)
    } catch (error) {
      const err = error as Error
      logger.warn('[item-set] failed to remove legacy local ARAMGG item set:', {
        filePath,
        error: err.message,
      })
    }
  }

  return {
    removedCount: removedFiles.length,
    removedFiles,
  }
}

async function cleanupCurrentChampionRecommendedFiles(lolPath: string, championKey: string): Promise<{
  removedCount: number
  removedFiles: string[]
}> {
  const championDirName = String(championKey || '').replace(/[^a-zA-Z0-9]/g, '')
  if (!championDirName) {
    return {
      removedCount: 0,
      removedFiles: [],
    }
  }

  const championsRoot = path.resolve(lolPath, 'Game', 'Config', 'Champions')
  const recommendedDir = path.resolve(championsRoot, championDirName, 'Recommended')
  if (!recommendedDir.startsWith(`${championsRoot}${path.sep}`)) {
    return {
      removedCount: 0,
      removedFiles: [],
    }
  }

  const removedFiles: string[] = []
  try {
    const entries = await readdir(recommendedDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) {
        continue
      }

      const filePath = path.join(recommendedDir, entry.name)
      try {
        await rm(filePath, { force: true })
        removedFiles.push(filePath)
      } catch (error) {
        const err = error as Error
        logger.warn('[item-set] failed to remove current champion local item set:', {
          filePath,
          error: err.message,
        })
      }
    }
  } catch {
    // Champion-specific recommendation folders are optional.
  }

  return {
    removedCount: removedFiles.length,
    removedFiles,
  }
}

async function assertValidLolPath(lolPath: string): Promise<string> {
  const normalizedPath = normalizeLolPath(lolPath)

  if (!normalizedPath) {
    throw new Error('游戏路径未配置')
  }

  const installInfo = await inspectLeagueInstallDirectory(normalizedPath)

  if (!installInfo.exists) {
    throw new Error('游戏路径不存在')
  }

  if (!installInfo.isDirectory) {
    throw new Error('请选择英雄联盟安装目录，不要选择 exe 文件')
  }

  if (!installInfo.valid) {
    throw new Error('未找到 LeagueClient.exe 或 LeagueClient 文件夹，请选择英雄联盟安装目录')
  }

  return installInfo.normalizedPath
}

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

function collectBuildVariants(build: any): any[] {
  if (!build || typeof build !== 'object') {
    return []
  }

  const variants = [
    ...(Array.isArray(build.allBuilds) ? build.allBuilds : []),
    ...(Array.isArray(build.builds) ? build.builds : []),
    ...(Array.isArray(build.buildVariants) ? build.buildVariants : []),
  ]
  if (!variants.length) {
    variants.push(build)
  }

  const seen = new Set<string>()
  return variants
    .filter((variant) => variant && typeof variant === 'object')
    .filter((variant) => {
      const coreKey = Array.isArray(variant?.coreItems)
        ? variant.coreItems
          .slice(0, 3)
          .map((record: BuildRecord) => normalizeItemIds(record).join('-'))
          .join('|')
        : ''
      const key = `${getBuildTags(variant).join('|')}:${coreKey}:${variant?.role || ''}:${variant?.tier || ''}`
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

function createItemSets(champion: ChampionLike, championName: ChampionLike | null, build: any): {
  itemSets: any[]
  skippedBuilds: Array<{ title: string; reason: string }>
  totalBuilds: number
} {
  const variants = collectBuildVariants(build)
  const itemSets: any[] = []
  const skippedBuilds: Array<{ title: string; reason: string }> = []

  variants.forEach((variant, index) => {
    const title = getBuildTitleTag(variant, index)
    const skipReason = getBuildSkipReason(variant)
    if (skipReason) {
      skippedBuilds.push({ title, reason: skipReason })
      return
    }

    const itemSet = createItemSet(champion, championName, variant, index)
    if (itemSet) {
      itemSets.push(itemSet)
    } else {
      skippedBuilds.push({ title, reason: 'missing-build-blocks' })
    }
  })

  return {
    itemSets,
    skippedBuilds,
    totalBuilds: variants.length,
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

async function installCurrentItemSets(lolPath: string, itemSets: any[], championKey: string): Promise<{
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
    const service = getLCUServiceInstance(lolPath)
    logger.info('[item-set] LCU item set sync requested', {
      championKey,
      itemSetCount: managedItemSets.length,
      titles: managedItemSets.map((itemSet) => itemSet?.title || null),
      blockCounts: managedItemSets.map((itemSet) =>
        Array.isArray(itemSet?.blocks) ? itemSet.blocks.length : 0
      ),
    })
    const result = await service.syncItemSets(managedItemSets)
    let localRemovedCount = 0

    if (result.success) {
      const legacyCleanupResult = await cleanupLegacyLocalItemSetFiles(lolPath)
      const currentChampionCleanupResult = itemSets.length > 0
        ? await cleanupCurrentChampionRecommendedFiles(lolPath, championKey)
        : { removedCount: 0, removedFiles: [] }
      localRemovedCount =
        legacyCleanupResult.removedCount + currentChampionCleanupResult.removedCount

      if (legacyCleanupResult.removedCount > 0) {
        logger.info('[item-set] legacy local ARAMGG item sets removed after LCU sync', {
          removedCount: legacyCleanupResult.removedCount,
          removedFiles: legacyCleanupResult.removedFiles,
        })
      }
      if (currentChampionCleanupResult.removedCount > 0) {
        logger.info('[item-set] current champion local item sets removed after LCU sync', {
          championKey,
          removedCount: currentChampionCleanupResult.removedCount,
          removedFiles: currentChampionCleanupResult.removedFiles,
        })
      }
    }

    return {
      success: result.success,
      error: result.success ? null : result.error || 'LCU 装备同步失败',
      method: result.method || null,
      status: result.status || null,
      removedCount: result.removedCount ?? null,
      itemSetCount: result.itemSetCount ?? null,
      localRemovedCount,
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
  lolPath: string,
  champion: ChampionLike,
  providedBuild: any = null,
  providedChampionName: ChampionLike | null = null
): Promise<ChampionInstallResult> {
  const championId = getChampionId(champion)

  try {
    const hasProvidedBuild = providedBuild && typeof providedBuild === 'object'
    const hasProvidedChampionName = providedChampionName && typeof providedChampionName === 'object'
    const [build, championName] = await Promise.all([
      hasProvidedBuild ? Promise.resolve(providedBuild) : loadChampionBuild(championId),
      hasProvidedChampionName ? Promise.resolve(providedChampionName) : loadChampionName(championId),
    ])
    const championKey = getChampionKey(champion, championName)

    if (!championId || !championKey) {
      return {
        championId,
        championKey,
        success: false,
        skipped: true,
        reason: 'missing-champion-key',
      }
    }

    const buildItemSets = createItemSets(champion, championName, build)
    if (buildItemSets.skippedBuilds.length > 0) {
      logger.info('[item-set] build variants skipped', {
        championId,
        championKey,
        totalBuilds: buildItemSets.totalBuilds,
        skippedBuilds: buildItemSets.skippedBuilds,
      })
    }

    if (!buildItemSets.itemSets.length) {
      const clearResult = await installCurrentItemSets(lolPath, [], championKey)
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
        success: false,
        skipped: true,
        reason: buildItemSets.totalBuilds > 0
          ? 'low-confidence-build-data'
          : 'missing-build-data',
      }
    }

    const installResult = await installCurrentItemSets(lolPath, buildItemSets.itemSets, championKey)

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
      success: installResult.success,
      reason: installResult.success ? undefined : installResult.error || '装备推荐写入失败',
    }
  } catch (error) {
    const err = error as Error
    logger.warn(`[item-set] failed to install champion ${championId}:`, err.message)
    return {
      championId,
      championKey: getChampionKey(champion),
      success: false,
      reason: err.message,
    }
  }
}

export async function getAramItemSetInstallStatus(options: ItemSetInstallOptions) {
  await assertValidLolPath(options.lolPath)

  return {
    success: true,
    installed: false,
    installedCount: 0,
    mode: 'lcu',
  }
}

export async function installAramItemSetForChampion(options: SingleChampionItemSetInstallOptions) {
  const startedAt = Date.now()
  const lolPath = await assertValidLolPath(options.lolPath)
  const championId = Number(options.championId)

  if (!Number.isFinite(championId) || championId <= 0) {
    throw new Error('英雄 ID 无效')
  }

  const result = await installChampionItemSet(
    lolPath,
    { championId },
    options.build || null,
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
    skipped: result.skipped || false,
    reason: result.reason || null,
    error: result.success ? null : formatInstallError(result.reason),
    durationMs: Date.now() - startedAt,
  }
}
