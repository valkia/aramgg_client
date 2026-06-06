import { mkdir, readFile, rename, stat, writeFile } from 'fs/promises'
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
const CHAMPION_DETAIL_FETCH_TIMEOUT_MS = 5 * 1000
const DATA_CACHE_DIR_NAME = 'data'
const BUNDLED_DATA_DIR_NAME = 'client-data'
const CURRENT_DATA_FILE = 'current.json'
const DATA_CACHE_SCHEMA_VERSION = 3
const DATA_REFRESH_CONCURRENCY = 4
const REQUIRED_VERSION_DATA_PATHS = new Set([
  'augments.json',
  'champions.json',
  'items.json',
  'manifest.json',
  'champion-shards/index.json',
])
const cache = new Map<string, { data: any; createdAt: number }>()
const pendingRequests = new Map<string, Promise<any>>()
const pendingDataFileRequests = new Map<string, Promise<any>>()
const detailCache = new Map<string, any>()
const augmentDetailCache = new Map<string, Record<string, any>>()
const championAugmentStatsCache = new Map<string, any[]>()
const championAugmentStatsPending = new Map<string, Promise<any[]>>()
let electronFetch: any = null
let dataRootDirPromise: Promise<string> | null = null
let activeDataSetPromise: Promise<ActiveDataSet> | null = null
let activeDataSetCache: { data: ActiveDataSet; createdAt: number } | null = null
let activeDataSetRefreshPromise: Promise<ActiveDataSet | null> | null = null

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

function getBundledDataRootDirs(): string[] {
  const candidates: string[] = []

  if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, BUNDLED_DATA_DIR_NAME))
  }

  candidates.push(path.join(process.cwd(), 'resources', BUNDLED_DATA_DIR_NAME))

  return candidates
}

async function getVersionDir(dataVersion: string): Promise<string> {
  const dataRootDir = await getDataRootDir()
  const versionDir = path.join(dataRootDir, 'versions', sanitizePathPart(dataVersion))
  await mkdir(versionDir, { recursive: true })
  return versionDir
}

async function getDataFileCandidatePaths(dataVersion: string, dataPath: string): Promise<string[]> {
  const dataRootDir = await getDataRootDir()
  const normalizedPath = normalizeDataPath(dataPath)
  return [
    path.join(dataRootDir, 'versions', sanitizePathPart(dataVersion), normalizedPath),
    ...getBundledDataRootDirs().map((bundledDataRootDir) =>
      path.join(bundledDataRootDir, 'versions', sanitizePathPart(dataVersion), normalizedPath)
    ),
  ]
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

async function getJsonFileSize(filePath: string): Promise<number | null> {
  try {
    return (await stat(filePath)).size
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      logger.warn(`Failed to stat JSON file ${filePath}:`, error.message)
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

async function readCachedCurrentDataPointer(): Promise<any | null> {
  const dataRootDir = await getDataRootDir()
  return readJsonFile(path.join(dataRootDir, CURRENT_DATA_FILE))
}

async function readBundledCurrentDataPointers(): Promise<any[]> {
  const pointers: any[] = []
  for (const bundledDataRootDir of getBundledDataRootDirs()) {
    const bundledPointer = await readJsonFile(path.join(bundledDataRootDir, CURRENT_DATA_FILE))
    if (bundledPointer) {
      logger.info('[data-loader] bundled data pointer found', {
        dataVersion: bundledPointer.dataVersion || null,
      })
      pointers.push(bundledPointer)
    }
  }

  return pointers
}

async function readCurrentDataPointerCandidates(): Promise<Array<{ pointer: any; source: string }>> {
  const candidates: Array<{ pointer: any; source: string }> = []
  const cachedPointer = await readCachedCurrentDataPointer()
  if (cachedPointer) {
    candidates.push({ pointer: cachedPointer, source: 'cache' })
  }

  const bundledPointers = await readBundledCurrentDataPointers()
  bundledPointers.forEach((pointer) => candidates.push({ pointer, source: 'bundled' }))

  return candidates
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

function findManifestEntry(manifest: any, logicalPath: string): any | null {
  const normalized = normalizeDataPath(logicalPath)
  return getManifestFileEntries(manifest).find((file: any) => {
    const filePath = normalizeDataPath(String(file.path || file.url || ''))
    return filePath === normalized || filePath.endsWith(`/${normalized}`)
  }) || null
}

function findManifestPath(manifest: any, logicalPath: string): string {
  const normalized = normalizeDataPath(logicalPath)
  const entry = findManifestEntry(manifest, normalized)

  return normalizeDataPath(String(entry?.path || normalized))
}

function findManifestPathIfExists(manifest: any, logicalPath: string): string | null {
  const entry = findManifestEntry(manifest, logicalPath)
  return entry ? normalizeDataPath(String(entry.path || entry.url || logicalPath)) : null
}

function isRequiredBundledDataPath(dataPath: string): boolean {
  const normalizedPath = normalizeDataPath(dataPath)
  return REQUIRED_VERSION_DATA_PATHS.has(normalizedPath) || normalizedPath.startsWith('champion-shards/')
}

function collectRequiredVersionDataFiles(manifest: any): Array<{ path: string; bytes: number }> {
  const filesByPath = new Map<string, { path: string; bytes: number }>()
  for (const dataPath of REQUIRED_VERSION_DATA_PATHS) {
    filesByPath.set(dataPath, { path: dataPath, bytes: 0 })
  }

  getManifestFileEntries(manifest)
    .map((entry: any) => ({
      path: normalizeDataPath(String(entry.path || entry.url || '')),
      bytes: Number(entry.bytes || 0),
    }))
    .filter((entry: any) => entry.path && isRequiredBundledDataPath(entry.path))
    .forEach((entry: any) => filesByPath.set(entry.path, entry))

  return [...filesByPath.values()].sort((left, right) => left.path.localeCompare(right.path))
}

async function hasDataFile(dataVersion: string, dataPath: string, expectedBytes = 0): Promise<boolean> {
  for (const filePath of await getDataFileCandidatePaths(dataVersion, dataPath)) {
    const fileSize = await getJsonFileSize(filePath)
    if (fileSize == null) {
      continue
    }

    if (expectedBytes > 0 && fileSize !== expectedBytes) {
      continue
    }

    return true
  }

  return false
}

async function isCompleteVersionDataSet(dataVersion: string, manifest: any): Promise<boolean> {
  const requiredFiles = collectRequiredVersionDataFiles(manifest)
  for (const file of requiredFiles) {
    if (!await hasDataFile(dataVersion, file.path, file.bytes)) {
      logger.debug('[data-loader] data version completeness check missing file', {
        dataVersion,
        path: file.path,
        expectedBytes: file.bytes || null,
      })
      return false
    }
  }

  return true
}

async function readDataFileFromDisk(dataVersion: string, dataPath: string): Promise<any | null> {
  const normalizedPath = normalizeDataPath(dataPath)
  for (const filePath of await getDataFileCandidatePaths(dataVersion, normalizedPath)) {
    const payload = await readJsonFile(filePath)
    if (payload != null) {
      return payload
    }
  }

  return null
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
        { force, ttlMs: options.ttlMs, timeoutMs: options.timeoutMs }
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

async function runLimited<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      await worker(item)
    }
  })

  await Promise.all(workers)
}

async function prepareDataVersion(config: ClientConfig): Promise<ActiveDataSet> {
  const dataVersion = String(config.dataVersion || '')
  const manifest = await loadManifestForConfig(config)
  const requiredDataPaths = collectRequiredVersionDataFiles(manifest)
    .map((file) => file.path)
    .filter((dataPath) => dataPath !== 'manifest.json')

  await runLimited(requiredDataPaths, DATA_REFRESH_CONCURRENCY, async (dataPath) => {
    await fetchVersionedDataFile(dataVersion, dataPath, findManifestPath(manifest, dataPath), {
        force: true,
      })
  })
  await writeCurrentDataPointer(config)

  logger.info('[data-loader] data version files prepared', {
    dataVersion,
    fileCount: requiredDataPaths.length + 1,
  })

  return { config, dataVersion, manifest }
}

async function loadCachedActiveDataSet(): Promise<ActiveDataSet | null> {
  for (const candidate of await readCurrentDataPointerCandidates()) {
    const current = candidate.pointer
    const dataVersion = String(current?.dataVersion || '')
    if (!dataVersion) {
      continue
    }

    const manifest = await readDataFileFromDisk(dataVersion, 'manifest.json')
    if (!manifest) {
      continue
    }

    if (!await isCompleteVersionDataSet(dataVersion, manifest)) {
      logger.warn('[data-loader] cached data version is incomplete; skipping foreground use', {
        dataVersion,
        source: candidate.source,
      })
      continue
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

  return null
}

function refreshLatestDataVersionInBackground(currentDataSet: ActiveDataSet): void {
  if (activeDataSetRefreshPromise) {
    return
  }

  activeDataSetRefreshPromise = (async () => {
    const config = await loadDataApiConfig()
    const remoteDataVersion = String(config?.dataVersion || '')
    if (!remoteDataVersion || remoteDataVersion === currentDataSet.dataVersion) {
      return currentDataSet
    }

    logger.info('[data-loader] remote data version refresh queued', {
      cachedDataVersion: currentDataSet.dataVersion,
      remoteDataVersion,
    })

    const dataSet = await prepareDataVersion(config)
    if (!await isCompleteVersionDataSet(dataSet.dataVersion, dataSet.manifest)) {
      throw new Error(`Prepared data version ${dataSet.dataVersion} is incomplete`)
    }

    return dataSet
  })()
    .then((dataSet) => {
      if (!dataSet || dataSet.dataVersion === currentDataSet.dataVersion) {
        return dataSet
      }

      activeDataSetCache = {
        data: dataSet,
        createdAt: Date.now(),
      }
      logger.info('[data-loader] active data version refreshed in background', {
        dataVersion: dataSet.dataVersion,
      })
      return dataSet
    })
    .catch((error: any) => {
      logger.warn('[data-loader] background data refresh failed:', error.message)
      return null
    })
    .finally(() => {
      activeDataSetRefreshPromise = null
    })
}

async function resolveActiveDataSet(): Promise<ActiveDataSet> {
  const startedAt = Date.now()
  let cachedDataSet: ActiveDataSet | null = null

  try {
    cachedDataSet = await loadCachedActiveDataSet()
    if (cachedDataSet) {
      logger.info('[data-loader] active data version resolved from complete local data', {
        dataVersion: cachedDataSet.dataVersion,
        durationMs: getElapsedMs(startedAt),
      })
      refreshLatestDataVersionInBackground(cachedDataSet)
      return cachedDataSet
    }

    const config = await loadDataApiConfig()
    const remoteDataVersion = String(config?.dataVersion || '')

    if (!remoteDataVersion) {
      throw new Error('Remote client data config is missing dataVersion')
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

function cacheChampionShardDetails(dataVersion: string, champions: Record<string, any>): void {
  Object.entries(champions).forEach(([id, championDetail]) => {
    detailCache.set(`${dataVersion}:champion:${id}`, championDetail)
  })
}

async function loadChampionDetailFromShard(
  dataSet: ActiveDataSet,
  championId: string | number,
  shardPath: string,
  source: 'cached' | 'remote'
): Promise<any | null> {
  const shardPayload = source === 'cached'
    ? cache.get(`${dataSet.dataVersion}:${shardPath}`)?.data || await readDataFileFromDisk(dataSet.dataVersion, shardPath)
    : await fetchVersionedDataFile(
      dataSet.dataVersion,
      shardPath,
      findManifestPath(dataSet.manifest, shardPath)
    )
  const shardData = shardPayload ? unwrapEnvelope(shardPayload) : null
  const champions = shardData?.champions || shardPayload?.champions || {}
  const detail = champions[String(championId)] || champions[Number(championId)]

  if (!detail) {
    return null
  }

  cacheChampionShardDetails(dataSet.dataVersion, champions)
  return detail
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
    const cachedShardDetail = await loadChampionDetailFromShard(dataSet, championId, shardPath, 'cached')
    if (cachedShardDetail) {
      logger.debug('[data-loader] champion detail loaded from local shard', {
        dataVersion: dataSet.dataVersion,
        championId,
        shardPath,
      })
      return cachedShardDetail
    }
  }

  const singleChampionPath = `champions/${championId}.json`
  const manifestSingleChampionPath = findManifestPathIfExists(dataSet.manifest, singleChampionPath)
  if (manifestSingleChampionPath) {
    try {
      logger.debug('[data-loader] champion detail single fetch start', {
        dataVersion: dataSet.dataVersion,
        championId,
        path: manifestSingleChampionPath,
      })
      const payload = await fetchVersionedDataFile(
        dataSet.dataVersion,
        singleChampionPath,
        manifestSingleChampionPath,
        { timeoutMs: CHAMPION_DETAIL_FETCH_TIMEOUT_MS }
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
  } else {
    logger.debug('[data-loader] champion detail single fetch skipped', {
      dataVersion: dataSet.dataVersion,
      championId,
      path: singleChampionPath,
      reason: 'not-in-manifest',
    })
  }

  if (shardPath) {
    try {
      logger.info('[data-loader] champion detail shard fallback fetch start', {
        dataVersion: dataSet.dataVersion,
        championId,
        shardPath,
      })
      const detail = await loadChampionDetailFromShard(dataSet, championId, shardPath, 'remote')
      if (detail) {
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

  if (itemIds != null && itemIds !== '') {
    return [String(itemIds).trim()].filter(Boolean)
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
    relatedBlogs: getChampionRelatedBlogs(champion),
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
    relatedBlogs: getChampionRelatedBlogs(champion),
  }
}

function normalizeExternalUrl(value: any): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const url = value.trim()
  if (!/^https?:\/\//i.test(url)) {
    return null
  }

  return url
}

function normalizeRelatedBlog(record: any): any | null {
  const url = normalizeExternalUrl(record)
    || normalizeExternalUrl(record?.url)
    || normalizeExternalUrl(record?.href)
    || normalizeExternalUrl(record?.link)
  if (!url) {
    return null
  }

  const title = String(record?.title || record?.name || record?.label || '英雄攻略').trim()
  return {
    title: title || '英雄攻略',
    url,
  }
}

function getChampionRelatedBlogs(...sources: any[]): any[] {
  const blogs: any[] = []
  const seen = new Set<string>()

  for (const source of sources) {
    if (!source || typeof source !== 'object') {
      continue
    }

    const candidates = [
      source.relatedBlogs,
    ]

    for (const candidate of candidates) {
      const records = Array.isArray(candidate) ? candidate : candidate ? [candidate] : []
      for (const record of records) {
        const blog = normalizeRelatedBlog(record)
        if (!blog || seen.has(blog.url)) {
          continue
        }

        seen.add(blog.url)
        blogs.push(blog)
      }
    }
  }

  return blogs
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
  const itemId = normalizeItemIds(record?.itemIds ?? record?.itemId ?? record?.id)[0]

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
    .filter((record: any) =>
      Array.isArray(record?.itemIds) || record?.itemId != null || record?.id != null
    )
    .map(mapSituationalItem)
  const itemExtensions = (publicBuild.itemExtensions || [])
    .filter((record: any) => Array.isArray(record?.itemIds))
    .map((record: any) => mapBuildSet(record))

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
    itemExtensions,
    situationalItems,
    startingItems,
    games: toNumber(publicBuild.stats?.games),
    wins: toNumber(publicBuild.stats?.wins),
    pickRate: toNumber(publicBuild.stats?.pickRate),
    winRate: toNumber(publicBuild.stats?.winRate),
    allBuilds: [],
  }
}

function collectPublicBuildCandidates(detail: any): any[] {
  const candidates: any[] = []
  const addBuild = (build: any) => {
    if (build && typeof build === 'object' && !Array.isArray(build)) {
      candidates.push(build)
    }
  }
  const addBuilds = (builds: any) => {
    if (Array.isArray(builds)) {
      builds.forEach(addBuild)
    }
  }

  addBuilds(detail?.builds)
  addBuilds(detail?.allBuilds)
  addBuilds(detail?.buildVariants)
  addBuilds(detail?.buildOptions)
  addBuilds(detail?.build?.builds)
  addBuilds(detail?.build?.allBuilds)
  addBuilds(detail?.build?.variants)
  addBuild(detail?.build)

  const seen = new Set<string>()
  return candidates.filter((build) => {
    const coreKey = Array.isArray(build?.coreItems)
      ? build.coreItems
        .slice(0, 3)
        .map((record: any) => normalizeItemIds(record?.itemIds).join('-'))
        .join('|')
      : ''
    const tagKey = JSON.stringify(build?.tags || {})
    const key = `${tagKey}:${coreKey}:${build?.role || ''}:${build?.tier || ''}`
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function mapChampionBuilds(detail: any, championId: string | number): any {
  const builds = collectPublicBuildCandidates(detail)
    .map((build) => mapPublicBuild(build, championId))
    .filter(Boolean)

  if (!builds.length) {
    return null
  }

  return {
    ...builds[0],
    allBuilds: builds,
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

export async function loadChampionLinks(championId: string | number): Promise<any> {
  try {
    const championsPayload = await loadChampionsPayload()
    const champions = extractList(championsPayload, 'champions')
    const champion = findChampionInList(champions, championId)
    const detail = await loadChampionDetailPayload(championId)
    const relatedBlogs = getChampionRelatedBlogs(detail, detail?.champion, champion)

    return {
      relatedBlogs,
    }
  } catch (error: any) {
    logger.warn(`Failed to load champion links for ${championId}:`, error.message)
    return {
      relatedBlogs: [],
    }
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
    return mapChampionBuilds(detail, championId)
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
  const [stats, augmentBase, augmentDetail, augments, augmentTrios, build, items, championName, championLinks] =
    await Promise.all([
      loadChampionStats(championId),
      loadAugmentBase(),
      loadAugmentDetail(),
      loadChampionAugments(championId),
      loadChampionAugmentTrios(championId),
      loadChampionBuild(championId),
      loadItems(),
      loadChampionName(championId),
      loadChampionLinks(championId),
    ])

  return {
    stats: {
      ...stats,
      relatedBlogs: stats?.relatedBlogs?.length ? stats.relatedBlogs : championLinks?.relatedBlogs || [],
    },
    augmentBase,
    augmentDetail,
    augments,
    augmentTrios,
    build,
    items,
    championName: {
      ...championName,
      relatedBlogs: championName?.relatedBlogs?.length ? championName.relatedBlogs : championLinks?.relatedBlogs || [],
    },
    championLinks,
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
  const normalizedChampionId = String(championId)
  const cacheKey = `${dataSet.dataVersion}:champion-augment-stats:${normalizedChampionId}`
  const cached = championAugmentStatsCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const pending = championAugmentStatsPending.get(cacheKey)
  if (pending) {
    return pending
  }

  const request = (async () => {
    const [detail, augmentBaseById] = await Promise.all([
      loadChampionDetailPayload(normalizedChampionId),
      loadAugmentDetail(),
    ])
    const augments = Array.isArray(detail?.augments) ? detail.augments : []

    const result = augments
      .filter((augment: any) => augment?.id != null)
      .map((augment: any) => mapPublicAugmentRecommendation(augment, augmentBaseById))
      .sort((a: any, b: any) => b.recommendScore - a.recommendScore)

    championAugmentStatsCache.set(cacheKey, result)
    return result
  })().finally(() => {
    championAugmentStatsPending.delete(cacheKey)
  })

  championAugmentStatsPending.set(cacheKey, request)
  return request
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
  championAugmentStatsPending.clear()
  activeDataSetPromise = null
  activeDataSetCache = null
}
