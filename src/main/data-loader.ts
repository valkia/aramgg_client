import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import path from 'path'
import logger from './modules/logger.ts'
import { getAppDataDir } from './modules/app-paths.ts'

declare const fetch: any

type FetchJsonOptions = {
  force?: boolean
  ttlMs?: number
  timeoutMs?: number
}

type ClientConfig = {
  service?: string
  apiVersion?: string
  locale?: string
  gamePatch?: string
  dataVersion?: string
  generatedAt?: string
  publishedAt?: string
  manifest?: string
  client?: {
    latestVersion?: string
    minimumVersion?: string
    downloadUrl?: string
  }
  electron?: {
    latestVersion?: string
    downloadUrl?: string
  }
  analytics?: {
    enabled?: boolean
    provider?: string
    firebaseConfig?: Record<string, string>
    sampleRate?: number
  }
}

type ActiveDataSet = {
  config: ClientConfig
  dataVersion: string
  manifest: any
}

export const DATA_API_ORIGIN =
  process.env.ARAMGG_DATA_API_ORIGIN || 'https://data.dtodo.cn'
export const DATA_API_PREFIX = '/api/client/v1'
export const DATA_API_CONFIG_PATH = `${DATA_API_PREFIX}/config`

const CONFIG_TTL_MS = 5 * 60 * 1000
const DATA_TTL_MS = 12 * 60 * 60 * 1000
const DATA_FETCH_TIMEOUT_MS = 10 * 1000
const DATA_CACHE_DIR_NAME = 'data'
const CURRENT_DATA_FILE = 'current.json'
const DATA_CACHE_SCHEMA_VERSION = 3
const cache = new Map<string, { data: any; createdAt: number }>()
const pendingRequests = new Map<string, Promise<any>>()
const pendingDataFileRequests = new Map<string, Promise<any>>()
const detailCache = new Map<string, any>()
const augmentDetailCache = new Map<string, Record<string, any>>()
const championAugmentStatsCache = new Map<string, any[]>()
let electronFetch: any = null
let dataRootDirPromise: Promise<string> | null = null
let activeDataSetPromise: Promise<ActiveDataSet> | null = null
let activeDataSetCache: { data: ActiveDataSet; createdAt: number } | null = null

const rarityMap: Record<string, string> = {
  0: 'kSilver',
  1: 'kGold',
  2: 'kPrismatic',
  silver: 'kSilver',
  gold: 'kGold',
  prismatic: 'kPrismatic',
}

function getApiUrl(resourcePath: string): string {
  if (/^https?:\/\//i.test(resourcePath)) {
    return resourcePath
  }

  const p = resourcePath.startsWith('/') ? resourcePath : `${DATA_API_PREFIX}/${resourcePath}`
  return new URL(p, DATA_API_ORIGIN).toString()
}

async function getTransportFetch(): Promise<any> {
  if (process.versions?.electron) {
    if (!electronFetch) {
      const { net } = await import('electron')
      electronFetch = net.fetch.bind(net)
    }

    return electronFetch
  }

  return fetch
}

async function fetchJson(resourcePath: string, options: FetchJsonOptions = {}): Promise<any> {
  const url = getApiUrl(resourcePath)
  const force = options.force === true
  const ttlMs = options.ttlMs ?? DATA_TTL_MS
  const cached = cache.get(url)
  if (!force && cached && Date.now() - cached.createdAt < ttlMs) {
    return cached.data
  }

  const pending = pendingRequests.get(url)
  if (pending) {
    return pending
  }

  const transportFetch = await getTransportFetch()
  const timeoutMs = options.timeoutMs ?? DATA_FETCH_TIMEOUT_MS
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeout = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null

  const request = transportFetch(url, {
    headers: {
      accept: 'application/json',
    },
    signal: controller?.signal,
  })
    .then(async (response: any) => {
      if (!response.ok) {
        throw new Error(`Remote data request failed: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      cache.set(url, { data, createdAt: Date.now() })
      return data
    })
    .catch((error: any) => {
      if (error?.name === 'AbortError') {
        throw new Error(`Remote data request timed out after ${timeoutMs}ms: ${url}`)
      }

      throw error
    })
    .finally(() => {
      if (timeout) {
        clearTimeout(timeout)
      }
      pendingRequests.delete(url)
    })

  pendingRequests.set(url, request)
  return request
}

function sanitizePathPart(value: string | number): string {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_')
}

function normalizeDataPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '')
}

function getVersionDataPrefix(dataVersion: string): string {
  return `${DATA_API_PREFIX}/data/${encodeURIComponent(dataVersion)}`
}

function resolveVersionResourcePath(dataVersion: string, dataPath: string): string {
  if (/^https?:\/\//i.test(dataPath) || dataPath.startsWith('/')) {
    return dataPath
  }

  return `${getVersionDataPrefix(dataVersion)}/${normalizeDataPath(dataPath)}`
}

async function resolveDataRootDir(): Promise<string> {
  const dataRootDir = path.join(getAppDataDir(), DATA_CACHE_DIR_NAME)
  await mkdir(dataRootDir, { recursive: true })
  return dataRootDir
}

async function getDataRootDir(): Promise<string> {
  if (!dataRootDirPromise) {
    dataRootDirPromise = resolveDataRootDir()
  }

  return dataRootDirPromise
}

async function getVersionDir(dataVersion: string): Promise<string> {
  const dataRootDir = await getDataRootDir()
  const versionDir = path.join(dataRootDir, 'versions', sanitizePathPart(dataVersion))
  await mkdir(versionDir, { recursive: true })
  return versionDir
}

async function readJsonFile(filePath: string): Promise<any | null> {
  try {
    const content = await readFile(filePath, 'utf8')
    return JSON.parse(content)
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      logger.warn(`Failed to read JSON file ${filePath}:`, error.message)
    }

    return null
  }
}

async function writeJsonFileAtomic(filePath: string, payload: any): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, JSON.stringify(payload), 'utf8')
  await rename(tempPath, filePath)
}

async function readCurrentDataPointer(): Promise<any | null> {
  const dataRootDir = await getDataRootDir()
  return readJsonFile(path.join(dataRootDir, CURRENT_DATA_FILE))
}

async function writeCurrentDataPointer(config: ClientConfig): Promise<void> {
  const dataRootDir = await getDataRootDir()
  await writeJsonFileAtomic(path.join(dataRootDir, CURRENT_DATA_FILE), {
    schemaVersion: DATA_CACHE_SCHEMA_VERSION,
    dataVersion: config.dataVersion,
    gamePatch: config.gamePatch || '',
    generatedAt: config.generatedAt || '',
    manifest: config.manifest || '',
    activatedAt: new Date().toISOString(),
  })
}

function unwrapEnvelope(payload: any): any {
  return payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload
}

function getPayloadDataVersion(payload: any, fallbackVersion = ''): string {
  return payload?.meta?.dataVersion || payload?.dataVersion || fallbackVersion || ''
}

function getElapsedMs(startedAt: number): number {
  return Date.now() - startedAt
}

function getPayloadMeta(payload: any, config: ClientConfig = {}): any {
  return {
    ...(payload?.meta || {}),
    dataVersion: getPayloadDataVersion(payload, config.dataVersion),
    gamePatch: payload?.meta?.gamePatch || config.gamePatch || '',
    generatedAt: payload?.meta?.generatedAt || config.generatedAt || '',
    publishedAt: payload?.meta?.publishedAt || config.publishedAt || config.generatedAt || '',
  }
}

function getManifestFileEntries(manifest: any): any[] {
  if (Array.isArray(manifest?.files)) {
    return manifest.files
  }

  if (manifest?.files && typeof manifest.files === 'object') {
    return Object.entries(manifest.files).map(([filePath, value]) => ({
      path: filePath,
      ...(value && typeof value === 'object' ? value : {}),
    }))
  }

  return []
}

function findManifestPath(manifest: any, logicalPath: string): string {
  const normalized = normalizeDataPath(logicalPath)
  const entry = getManifestFileEntries(manifest).find((file: any) => {
    const filePath = normalizeDataPath(String(file.path || file.url || ''))
    return filePath === normalized || filePath.endsWith(`/${normalized}`)
  })

  return normalizeDataPath(String(entry?.path || normalized))
}

async function readDataFileFromDisk(dataVersion: string, dataPath: string): Promise<any | null> {
  const versionDir = await getVersionDir(dataVersion)
  return readJsonFile(path.join(versionDir, normalizeDataPath(dataPath)))
}

async function writeDataFileToDisk(dataVersion: string, dataPath: string, payload: any): Promise<void> {
  const versionDir = await getVersionDir(dataVersion)
  await writeJsonFileAtomic(path.join(versionDir, normalizeDataPath(dataPath)), payload)
}

async function fetchVersionedDataFile(
  dataVersion: string,
  dataPath: string,
  resourcePath?: string,
  options: FetchJsonOptions = {}
): Promise<any> {
  const startedAt = Date.now()
  const normalizedPath = normalizeDataPath(dataPath)
  const cacheKey = `${dataVersion}:${normalizedPath}`
  const force = options.force === true
  const cached = cache.get(cacheKey)
  if (!force && cached && Date.now() - cached.createdAt < DATA_TTL_MS) {
    logger.debug('[data-loader] memory cache hit', {
      dataVersion,
      path: normalizedPath,
      durationMs: getElapsedMs(startedAt),
    })
    return cached.data
  }

  const pendingKey = `${cacheKey}:${force ? 'force' : 'normal'}`
  const pending = pendingDataFileRequests.get(pendingKey)
  if (pending) {
    return pending
  }

  const request = (async () => {
    if (!force) {
      const diskPayload = await readDataFileFromDisk(dataVersion, normalizedPath)
      if (diskPayload != null) {
        cache.set(cacheKey, { data: diskPayload, createdAt: Date.now() })
        logger.debug('[data-loader] disk cache hit', {
          dataVersion,
          path: normalizedPath,
          durationMs: getElapsedMs(startedAt),
        })
        return diskPayload
      }
    }

    try {
      const resolvedResourcePath = resolveVersionResourcePath(dataVersion, resourcePath || normalizedPath)
      logger.info('[data-loader] remote fetch start', {
        dataVersion,
        path: normalizedPath,
        resourcePath: resolvedResourcePath,
        force,
      })
      const payload = await fetchJson(
        resolvedResourcePath,
        { force, ttlMs: options.ttlMs }
      )
      await writeDataFileToDisk(dataVersion, normalizedPath, payload)
      cache.set(cacheKey, { data: payload, createdAt: Date.now() })
      logger.info('[data-loader] remote fetch completed', {
        dataVersion,
        path: normalizedPath,
        durationMs: getElapsedMs(startedAt),
      })
      return payload
    } catch (error: any) {
      const diskPayload = await readDataFileFromDisk(dataVersion, normalizedPath)
      if (diskPayload != null) {
        logger.warn(`Failed to refresh ${normalizedPath}; using cached data:`, error.message)
        cache.set(cacheKey, { data: diskPayload, createdAt: Date.now() })
        logger.debug('[data-loader] disk fallback hit', {
          dataVersion,
          path: normalizedPath,
          durationMs: getElapsedMs(startedAt),
        })
        return diskPayload
      }

      throw error
    }
  })().finally(() => {
    pendingDataFileRequests.delete(pendingKey)
  })

  pendingDataFileRequests.set(pendingKey, request)
  return request
}

export async function loadDataApiConfig(options: FetchJsonOptions = {}): Promise<ClientConfig> {
  return fetchJson(DATA_API_CONFIG_PATH, {
    ...options,
    ttlMs: options.ttlMs ?? CONFIG_TTL_MS,
  })
}

async function loadManifestForConfig(config: ClientConfig): Promise<any> {
  const dataVersion = String(config.dataVersion || '')
  if (!dataVersion) {
    throw new Error('Remote client data config is missing dataVersion')
  }

  const manifestPath = config.manifest || `${getVersionDataPrefix(dataVersion)}/manifest.json`
  return fetchVersionedDataFile(dataVersion, 'manifest.json', manifestPath, { force: true })
}

async function prepareDataVersion(config: ClientConfig): Promise<ActiveDataSet> {
  const dataVersion = String(config.dataVersion || '')
  const manifest = await loadManifestForConfig(config)
  const requiredDataPaths = [
    'augments.json',
    'champions.json',
    'items.json',
    'champion-shards/index.json',
  ]

  await Promise.all(
    requiredDataPaths.map((dataPath) =>
      fetchVersionedDataFile(dataVersion, dataPath, findManifestPath(manifest, dataPath), {
        force: true,
      })
    )
  )
  await writeCurrentDataPointer(config)

  return { config, dataVersion, manifest }
}

async function loadCachedActiveDataSet(): Promise<ActiveDataSet | null> {
  const current = await readCurrentDataPointer()
  const dataVersion = String(current?.dataVersion || '')
  if (!dataVersion) {
    return null
  }

  const manifest = await readDataFileFromDisk(dataVersion, 'manifest.json')
  if (!manifest) {
    return null
  }

  return {
    config: {
      dataVersion,
      gamePatch: current.gamePatch || '',
      generatedAt: current.generatedAt || '',
      manifest: current.manifest || `${getVersionDataPrefix(dataVersion)}/manifest.json`,
    },
    dataVersion,
    manifest,
  }
}

async function resolveActiveDataSet(): Promise<ActiveDataSet> {
  const startedAt = Date.now()
  let cachedDataSet: ActiveDataSet | null = null

  try {
    cachedDataSet = await loadCachedActiveDataSet()
    const config = await loadDataApiConfig()
    const remoteDataVersion = String(config?.dataVersion || '')

    if (!remoteDataVersion) {
      throw new Error('Remote client data config is missing dataVersion')
    }

    if (cachedDataSet && cachedDataSet.dataVersion === remoteDataVersion) {
      logger.debug('[data-loader] active data version resolved from cache', {
        dataVersion: remoteDataVersion,
        durationMs: getElapsedMs(startedAt),
      })
      return {
        ...cachedDataSet,
        config: {
          ...cachedDataSet.config,
          ...config,
        },
      }
    }

    const preparedDataSet = await prepareDataVersion(config)
    logger.info('[data-loader] active data version prepared', {
      dataVersion: preparedDataSet.dataVersion,
      durationMs: getElapsedMs(startedAt),
    })
    return preparedDataSet
  } catch (error: any) {
    if (cachedDataSet) {
      logger.warn(
        `Failed to refresh client data; using cached data version ${cachedDataSet.dataVersion}:`,
        error.message
      )
      return cachedDataSet
    }

    const fallbackDataSet = await loadCachedActiveDataSet()
    if (fallbackDataSet) {
      logger.warn(
        `Failed to load remote client data; using cached data version ${fallbackDataSet.dataVersion}:`,
        error.message
      )
      return fallbackDataSet
    }

    throw error
  }
}

async function getActiveDataSet(): Promise<ActiveDataSet> {
  if (activeDataSetCache && Date.now() - activeDataSetCache.createdAt < CONFIG_TTL_MS) {
    return activeDataSetCache.data
  }

  if (!activeDataSetPromise) {
    activeDataSetPromise = resolveActiveDataSet()
      .then((dataSet) => {
        activeDataSetCache = {
          data: dataSet,
          createdAt: Date.now(),
        }
        return dataSet
      })
      .finally(() => {
        activeDataSetPromise = null
      })
  }

  return activeDataSetPromise
}

async function loadDataFile(logicalPath: string): Promise<any> {
  const dataSet = await getActiveDataSet()
  return fetchVersionedDataFile(
    dataSet.dataVersion,
    logicalPath,
    findManifestPath(dataSet.manifest, logicalPath)
  )
}

async function loadChampionsPayload(): Promise<any> {
  return loadDataFile('champions.json')
}

async function loadAugmentsPayload(): Promise<any> {
  return loadDataFile('augments.json')
}

async function loadItemsPayload(): Promise<any> {
  return loadDataFile('items.json')
}

async function loadChampionShardIndex(): Promise<any | null> {
  try {
    return loadDataFile('champion-shards/index.json')
  } catch (error: any) {
    logger.warn('Failed to load champion shard index:', error.message)
    return null
  }
}

function extractList(payload: any, key: string): any[] {
  const data = unwrapEnvelope(payload)
  const value = Array.isArray(data) ? data : data?.[key] ?? payload?.[key]
  return Array.isArray(value) ? value : []
}

function findChampionInList(champions: any[], championId: string | number): any {
  const id = Number(championId)
  return champions.find((c: any) => Number(c.id ?? c.championId) === id) || null
}

function findShardPathForChampion(shardIndex: any, championId: string | number): string | null {
  const id = Number(championId)
  const idString = String(championId)
  const shards = Array.isArray(shardIndex?.shards) ? shardIndex.shards : []
  const shard = shards.find((entry: any) => {
    const championIds = Array.isArray(entry?.championIds) ? entry.championIds : []
    return championIds.some((candidate: any) => Number(candidate) === id || String(candidate) === idString)
  })

  return shard?.path ? normalizeDataPath(String(shard.path)) : null
}

async function loadChampionDetailPayload(championId: string | number): Promise<any | null> {
  const dataSet = await getActiveDataSet()
  const cacheKey = `${dataSet.dataVersion}:champion:${championId}`
  if (detailCache.has(cacheKey)) {
    logger.debug('[data-loader] champion detail memory cache hit', {
      dataVersion: dataSet.dataVersion,
      championId,
    })
    return detailCache.get(cacheKey)
  }

  const shardIndex = await loadChampionShardIndex()
  const shardPath = shardIndex ? findShardPathForChampion(shardIndex, championId) : null

  if (shardPath) {
    const shardCacheKey = `${dataSet.dataVersion}:${shardPath}`
    const cachedShard = cache.get(shardCacheKey)?.data || await readDataFileFromDisk(dataSet.dataVersion, shardPath)
    const cachedShardData = cachedShard ? unwrapEnvelope(cachedShard) : null
    const cachedShardChampions = cachedShardData?.champions || cachedShard?.champions || {}
    const cachedShardDetail = cachedShardChampions[String(championId)] || cachedShardChampions[Number(championId)]

    if (cachedShardDetail) {
      Object.entries(cachedShardChampions).forEach(([id, championDetail]) => {
        detailCache.set(`${dataSet.dataVersion}:champion:${id}`, championDetail)
      })
      logger.debug('[data-loader] champion detail loaded from cached shard', {
        dataVersion: dataSet.dataVersion,
        championId,
        shardPath,
      })
      return cachedShardDetail
    }
  }

  try {
    const fallbackPath = `champions/${championId}.json`
    logger.debug('[data-loader] champion detail single fetch start', {
      dataVersion: dataSet.dataVersion,
      championId,
      path: fallbackPath,
    })
    const payload = await fetchVersionedDataFile(
      dataSet.dataVersion,
      fallbackPath,
      findManifestPath(dataSet.manifest, fallbackPath)
    )
    const detail = unwrapEnvelope(payload)
    detailCache.set(cacheKey, detail)
    logger.debug('[data-loader] champion detail single fetch completed', {
      dataVersion: dataSet.dataVersion,
      championId,
    })
    return detail
  } catch (error: any) {
    logger.warn(`Failed to load single champion detail ${championId}; trying shard fallback:`, error.message)
  }

  if (shardPath) {
    try {
      logger.info('[data-loader] champion detail shard fallback fetch start', {
        dataVersion: dataSet.dataVersion,
        championId,
        shardPath,
      })
      const shardPayload = await fetchVersionedDataFile(
        dataSet.dataVersion,
        shardPath,
        findManifestPath(dataSet.manifest, shardPath)
      )
      const shardData = unwrapEnvelope(shardPayload)
      const champions = shardData?.champions || shardPayload?.champions || {}
      const detail = champions[String(championId)] || champions[Number(championId)]

      if (detail) {
        Object.entries(champions).forEach(([id, championDetail]) => {
          detailCache.set(`${dataSet.dataVersion}:champion:${id}`, championDetail)
        })
        logger.info('[data-loader] champion detail shard fallback completed', {
          dataVersion: dataSet.dataVersion,
          championId,
          shardPath,
        })
        return detail
      }
    } catch (error: any) {
      logger.warn(`Failed to load champion detail shard fallback ${championId}:`, error.message)
    }
  }

  return null
}

function toNumber(value: any, fallback = 0): number {
  if (value == null || value === '') {
    return fallback
  }

  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

function toNullableNumber(value: any): number | null {
  if (value == null || value === '') {
    return null
  }

  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function normalizeRarity(augment: any): string {
  const byName = rarityMap[String(augment?.rarityName || '').toLowerCase()]
  if (byName) {
    return byName
  }

  return rarityMap[String(Number(augment?.rarity))] || 'unknown'
}

function normalizeItemIds(itemIds: any): string[] {
  if (Array.isArray(itemIds)) {
    return itemIds.map((id) => String(id).trim()).filter(Boolean)
  }

  return []
}

function mapAugmentWithBase(augmentId: any, augmentBaseById: Record<string, any> = {}): any {
  const base = augmentBaseById[String(augmentId)] || {}

  return {
    id: augmentId,
    augmentId,
    name: base.name || '未知',
    rarity: base.rarity || 'unknown',
    rarityName: base.rarityName || null,
    rarityDisplayName: base.rarityDisplayName || null,
    iconPath: base.iconPath || null,
    iconUrl: base.iconUrl || null,
  }
}

function mapPublicAugmentBase(augment: any): any {
  return {
    id: augment.id,
    name: augment.name,
    rarity: normalizeRarity(augment),
    rarityName: augment.rarityName || null,
    rarityDisplayName: augment.rarityDisplayName || null,
    iconPath: augment.iconUrl || null,
    iconUrl: augment.iconUrl || null,
    key: augment.key || null,
    enabled: augment.enabled ?? null,
    description: augment.description || null,
    tooltip: augment.tooltip || null,
  }
}

function mapPublicChampionStats(champion: any, meta: any = {}): any {
  const stats = champion?.stats || champion || {}
  const championId = champion?.id ?? champion?.championId

  return {
    championId: String(championId),
    id: championId,
    alias: champion?.alias || champion?.nameEN || '',
    nameCN: champion?.name || champion?.nameCN || '',
    nameEN: champion?.alias || champion?.nameEN || '',
    title: champion?.title || '',
    roles: champion?.roles || [],
    iconUrl: champion?.iconUrl || null,
    tier: toNullableNumber(stats.tier),
    winRate: toNumber(stats.winRate),
    numWinGames: toNumber(stats.wins ?? stats.numWinGames),
    numGames: toNumber(stats.games ?? stats.numGames),
    pickRate: toNumber(stats.pickRate),
    version: stats.gamePatch || meta.gamePatch || '',
    date: stats.date || meta.publishedAt || meta.generatedAt || '',
  }
}

function mapPublicChampionName(champion: any): any {
  const championId = champion?.id ?? champion?.championId

  return {
    id: championId,
    title: champion?.title || '',
    nameCN: champion?.name || champion?.nameCN || `英雄 ${championId || ''}`,
    nameEN: champion?.alias || champion?.nameEN || '',
    roles: champion?.roles || [],
    iconUrl: champion?.iconUrl || null,
  }
}

function mapPublicAugmentStats(augment: any): any {
  const stats = augment?.stats || augment || {}

  return {
    tier: toNullableNumber(stats.tier),
    num_win_games: toNumber(stats.wins ?? stats.num_win_games),
    win_rate: toNumber(stats.winRate ?? stats.win_rate),
    num_games: toNumber(stats.games ?? stats.num_games),
    pick_rate: toNumber(stats.pickRate ?? stats.pick_rate),
    gamePatch: stats.gamePatch || null,
    date: stats.date || null,
  }
}

function mapPublicAugmentRecommendation(
  augment: any,
  augmentBaseById: Record<string, any> = {}
): any {
  const augmentId = augment?.id
  const augmentBase = mapAugmentWithBase(augmentId, augmentBaseById)
  const stats = mapPublicAugmentStats(augment)
  const winRate = toNumber(stats.win_rate)
  const pickRate = toNumber(stats.pick_rate)
  const games = toNumber(stats.num_games)

  return {
    ...augmentBase,
    tier: stats.tier,
    winRate,
    pickRate,
    playCount: games,
    winCount: toNumber(stats.num_win_games),
    win_rate: winRate,
    pick_rate: pickRate,
    num_games: games,
    num_win_games: toNumber(stats.num_win_games),
    recommendScore: winRate * 0.6 + pickRate * 0.2 + Math.min(games / 1000, 1) * 0.2,
  }
}

function mapBuildSet(record: any): any {
  const stats = record?.stats || record || {}
  const ids = normalizeItemIds(record?.itemIds)

  return {
    ...record,
    itemIds: ids,
    items: ids,
    games: toNumber(stats.games ?? stats.num_games),
    wins: toNumber(stats.wins ?? stats.num_win_games),
    pick_rate: toNumber(stats.pickRate ?? stats.pick_rate),
    pickRate: toNumber(stats.pickRate ?? stats.pick_rate),
    winRate: toNumber(stats.winRate ?? stats.win_rate),
  }
}

function mapSituationalItem(record: any): any {
  const stats = record?.stats || record || {}
  const itemId = normalizeItemIds(record?.itemIds)[0]

  return {
    ...record,
    itemId: String(itemId || ''),
    id: itemId,
    games: toNumber(stats.games ?? stats.num_games),
    wins: toNumber(stats.wins ?? stats.num_win_games),
    pick_rate: toNumber(stats.pickRate ?? stats.pick_rate),
    pickRate: toNumber(stats.pickRate ?? stats.pick_rate),
    winRate: toNumber(stats.winRate ?? stats.win_rate),
    distinctive_score: toNumber(stats.averageIndex ?? stats.distinctive_score, toNumber(stats.pickRate ?? stats.pick_rate)),
  }
}

function normalizeAugmentIds(augmentIds: any): string[] {
  if (Array.isArray(augmentIds)) {
    return augmentIds.map((id) => String(id).trim()).filter(Boolean)
  }

  return []
}

function mapPublicAugmentTrio(record: any, augmentBaseById: Record<string, any> = {}): any {
  const stats = record?.stats || record || {}
  const augmentIds = normalizeAugmentIds(record?.augmentIds)

  return {
    ...record,
    augmentIds,
    augments: augmentIds.map((augmentId) => mapAugmentWithBase(augmentId, augmentBaseById)),
    games: toNumber(stats.games ?? stats.num_games),
    wins: toNumber(stats.wins ?? stats.num_win_games),
    pickRate: toNumber(stats.pickRate ?? stats.pick_rate),
    winRate: toNumber(stats.winRate ?? stats.win_rate),
  }
}

function mapPublicBuild(publicBuild: any, championId: string | number): any {
  if (!publicBuild) {
    return null
  }

  const coreItems = (publicBuild.coreItems || [])
    .filter((record: any) => Array.isArray(record?.itemIds))
    .map((record: any) => mapBuildSet(record))
  const startingItems = (publicBuild.startingItems || [])
    .filter((record: any) => Array.isArray(record?.itemIds))
    .map((record: any) => mapBuildSet(record))
  const situationalItems = (publicBuild.situationalItems || [])
    .filter((record: any) => Array.isArray(record?.itemIds))
    .map(mapSituationalItem)

  return {
    patch: publicBuild.patch || '',
    championId: String(championId),
    queue: publicBuild.queueId || 'HOWLING_ABYSS_ARAM',
    role: publicBuild.role || 'ALL',
    tier: publicBuild.tier || null,
    tags: publicBuild.tags || {},
    buildTags: Array.isArray(publicBuild.tags)
      ? publicBuild.tags.join(', ')
      : Object.values(publicBuild.tags || {}).join(', '),
    coreItems,
    recommended: coreItems,
    itemSequences: {},
    itemExtensions: publicBuild.itemExtensions || [],
    situationalItems,
    startingItems,
    games: toNumber(publicBuild.stats?.games),
    wins: toNumber(publicBuild.stats?.wins),
    pickRate: toNumber(publicBuild.stats?.pickRate),
    winRate: toNumber(publicBuild.stats?.winRate),
    allBuilds: [],
  }
}

function mapPublicItem(item: any): any {
  return {
    ...item,
    id: item.id,
    name: {
      zh_cn: item.name,
      zh_CN: item.name,
      en_us: item.name,
    },
    description: {
      zh_cn: item.description || '',
      zh_CN: item.description || '',
      en_us: item.description || '',
    },
    iconPath: item.iconUrl || null,
    iconUrl: item.iconUrl || null,
  }
}

export async function loadChampionStats(championId: string | number): Promise<any> {
  const championsPayload = await loadChampionsPayload()
  const dataSet = await getActiveDataSet()
  const champions = extractList(championsPayload, 'champions')
  const champion = findChampionInList(champions, championId)

  if (champion) {
    const stats = mapPublicChampionStats(champion, getPayloadMeta(championsPayload, dataSet.config))
    if (stats.championId) {
      return stats
    }
  }

  const detail = await loadChampionDetailPayload(championId)
  if (detail?.champion) {
    const stats = mapPublicChampionStats(detail.champion, getPayloadMeta(detail, dataSet.config))
    if (stats.championId) {
      return stats
    }
  }

  throw new Error(`Champion stats not found for ID: ${championId}`)
}

export async function loadChampionName(championId: string | number): Promise<any> {
  try {
    const championsPayload = await loadChampionsPayload()
    const champions = extractList(championsPayload, 'champions')
    const champion = findChampionInList(champions, championId)

    if (champion) {
      return mapPublicChampionName(champion)
    }

    const detail = await loadChampionDetailPayload(championId)
    if (detail?.champion) {
      return mapPublicChampionName(detail.champion)
    }

    return { nameCN: `英雄 ${championId}`, nameEN: '', title: '', roles: [], iconUrl: null }
  } catch (error: any) {
    logger.warn(`Failed to load champion name for ${championId}:`, error.message)
    return { nameCN: `英雄 ${championId}`, nameEN: '', title: '', roles: [], iconUrl: null }
  }
}

export async function loadAugmentBase(): Promise<any[]> {
  const augmentsPayload = await loadAugmentsPayload()
  return extractList(augmentsPayload, 'augments').map(mapPublicAugmentBase)
}

export async function loadAugmentDetail(): Promise<Record<string, any>> {
  const dataSet = await getActiveDataSet()
  const cacheKey = `${dataSet.dataVersion}:augment-detail`
  const cached = augmentDetailCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const augments = await loadAugmentBase()
  const detail = augments.reduce((result: Record<string, any>, augment: any) => {
    result[String(augment.id)] = augment
    return result
  }, {})
  augmentDetailCache.set(cacheKey, detail)
  return detail
}

export async function loadChampionAugments(championId: string | number): Promise<Record<string, any>> {
  try {
    const detail = await loadChampionDetailPayload(championId)

    if (detail?.augments) {
      return (detail.augments as any[]).reduce((result: Record<string, any>, augment: any) => {
        const augmentId = augment?.id
        if (augmentId != null) {
          result[String(augmentId)] = mapPublicAugmentStats(augment)
        }
        return result
      }, {})
    }

    return {}
  } catch (error: any) {
    logger.warn(`Failed to load augments for champion ${championId}:`, error.message)
    return {}
  }
}

export async function loadChampionAugmentTrios(championId: string | number): Promise<any[]> {
  try {
    const [detail, augmentBaseById] = await Promise.all([
      loadChampionDetailPayload(championId),
      loadAugmentDetail(),
    ])

    if (Array.isArray(detail?.augmentTrios)) {
      return detail.augmentTrios.map((record: any) => mapPublicAugmentTrio(record, augmentBaseById))
    }

    return []
  } catch (error: any) {
    logger.warn(`Failed to load augment trios for champion ${championId}:`, error.message)
    return []
  }
}

export async function loadChampionBuild(championId: string | number): Promise<any> {
  try {
    const detail = await loadChampionDetailPayload(championId)
    if (detail?.build) {
      return mapPublicBuild(detail.build, championId)
    }

    return null
  } catch (error: any) {
    logger.warn(`Failed to load build for champion ${championId}:`, error.message)
    return null
  }
}

export async function loadItems(): Promise<any[]> {
  const itemsPayload = await loadItemsPayload()
  return extractList(itemsPayload, 'items').map(mapPublicItem)
}

export async function loadChampionRoster(): Promise<any[]> {
  const championsPayload = await loadChampionsPayload()
  const dataSet = await getActiveDataSet()
  const meta = getPayloadMeta(championsPayload, dataSet.config)

  return extractList(championsPayload, 'champions')
    .map((champion) => mapPublicChampionStats(champion, meta))
    .filter((champion) => champion.championId && Number(champion.championId) > 0)
}

export async function getChampionDetailData(championId: string | number): Promise<any> {
  const [stats, augmentBase, augmentDetail, augments, augmentTrios, build, items, championName] =
    await Promise.all([
      loadChampionStats(championId),
      loadAugmentBase(),
      loadAugmentDetail(),
      loadChampionAugments(championId),
      loadChampionAugmentTrios(championId),
      loadChampionBuild(championId),
      loadItems(),
      loadChampionName(championId),
    ])

  return {
    stats,
    augmentBase,
    augmentDetail,
    augments,
    augmentTrios,
    build,
    items,
    championName,
  }
}

export async function getAugmentWinrate(
  championId: string | number,
  augmentId: string | number
): Promise<any> {
  const augments = await loadChampionAugments(championId)
  const augmentIdStr = String(augmentId)

  if (!augments[augmentIdStr]) {
    return null
  }

  const winrateData = augments[augmentIdStr]
  return {
    augmentId: parseInt(augmentIdStr, 10),
    winRate: toNumber(winrateData.win_rate),
    pickRate: toNumber(winrateData.pick_rate),
    playCount: toNumber(winrateData.num_games),
    winCount: toNumber(winrateData.num_win_games),
  }
}

export async function getChampionAugmentStats(championId: string | number): Promise<any[]> {
  const dataSet = await getActiveDataSet()
  const cacheKey = `${dataSet.dataVersion}:champion-augment-stats:${championId}`
  const cached = championAugmentStatsCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const [detail, augmentBaseById] = await Promise.all([
    loadChampionDetailPayload(championId),
    loadAugmentDetail(),
  ])
  const augments = Array.isArray(detail?.augments) ? detail.augments : []

  const result = augments
    .filter((augment: any) => augment?.id != null)
    .map((augment: any) => mapPublicAugmentRecommendation(augment, augmentBaseById))
    .sort((a: any, b: any) => b.recommendScore - a.recommendScore)

  championAugmentStatsCache.set(cacheKey, result)
  return result
}

export function filterAugmentsByRarity(augmentStats: any[], rarity: string | null): any[] {
  if (!rarity || rarity === 'all') {
    return augmentStats
  }

  return augmentStats.filter((augment) => augment.rarity === rarity)
}

export function clearCache(): void {
  cache.clear()
  pendingRequests.clear()
  pendingDataFileRequests.clear()
  detailCache.clear()
  augmentDetailCache.clear()
  championAugmentStatsCache.clear()
  activeDataSetPromise = null
  activeDataSetCache = null
}
