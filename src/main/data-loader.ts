import { mkdir, readFile, readdir, rename, stat, writeFile } from 'fs/promises'
import path from 'path'
import logger from './modules/logger.ts'
import { getAppDataDir } from './modules/app-paths.ts'
import {
  getClientDataUrlPathname,
  normalizeClientDataPath,
  resolveClientDataFilePath,
  resolveTrustedClientDataUrl,
} from '../shared/client-data-security.ts'
import { rankAugmentRecommendations } from '../shared/augment-ranking.ts'

declare const fetch: any

type FetchJsonOptions = {
  force?: boolean
  ttlMs?: number
  timeoutMs?: number
  locale?: string
}

type JsonDocument = {
  data: any
  sourceText: string
}

type SupportedDataLocale = 'zh-CN' | 'en-US' | 'zh-TW'

export type MatchHistoryUploadConfig = {
  enabled?: boolean
  sessionPath?: string
  batchPath?: string
  maxBatchSize?: number
}

export type ClientConfig = {
  service?: string
  apiVersion?: string
  locale?: string
  gamePatch?: string
  dataVersion?: string
  generatedAt?: string
  publishedAt?: string
  apiRelease?: unknown
  manifest?: string
  changelog?: unknown
  releaseNotes?: unknown
  client?: {
    latestVersion?: string
    minimumVersion?: string
    downloadUrl?: string
    autoUpdateEnabled?: boolean
    updateFeedUrl?: string
    changelog?: unknown
    releaseNotes?: unknown
  }
  electron?: {
    latestVersion?: string
    minimumVersion?: string
    downloadUrl?: string
    autoUpdateEnabled?: boolean
    updateFeedUrl?: string
    changelog?: unknown
    releaseNotes?: unknown
  }
  analytics?: {
    enabled?: boolean
    provider?: string
    firebaseConfig?: Record<string, string>
    sampleRate?: number
  }
  matchHistoryUpload?: MatchHistoryUploadConfig
}

type ActiveDataSet = {
  config: ClientConfig
  dataVersion: string
  manifest: any
  locale: SupportedDataLocale
}

type ManifestLoadResult = {
  manifest: any
  locale: SupportedDataLocale
}

type PreparedDataLocale = {
  locale: SupportedDataLocale
  dataVersion: string
}

type OcrAugmentLocaleData = PreparedDataLocale & {
  augments: any[]
  source: 'cache' | 'bundled' | 'local-version' | 'remote'
}

export const DATA_API_ORIGIN =
  process.env.ARAMGG_DATA_API_ORIGIN || 'https://data.dtodo.cn'
const DATA_ALLOWED_ORIGINS = process.env.ARAMGG_DATA_ALLOWED_ORIGINS || ''
export const DATA_API_PREFIX = '/api/client/v1'
export const DATA_API_CONFIG_PATH = `${DATA_API_PREFIX}/config`
export const DEFAULT_DATA_LOCALE: SupportedDataLocale = 'zh-CN'
export const SUPPORTED_DATA_LOCALES: Array<{
  code: SupportedDataLocale
  label: string
  nativeLabel: string
}> = [
  { code: 'zh-CN', label: 'Simplified Chinese', nativeLabel: '简体中文' },
  { code: 'en-US', label: 'English', nativeLabel: 'English' },
  { code: 'zh-TW', label: 'Traditional Chinese', nativeLabel: '繁體中文' },
]

const CONFIG_TTL_MS = 5 * 60 * 1000
const DATA_TTL_MS = 12 * 60 * 60 * 1000
const DATA_FETCH_TIMEOUT_MS = 10 * 1000
const CHAMPION_DETAIL_FETCH_TIMEOUT_MS = 5 * 1000
const DATA_BACKGROUND_REFRESH_ERROR_LOG_INTERVAL_MS = 5 * 60 * 1000
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
const activeDataSetPromises = new Map<SupportedDataLocale, Promise<ActiveDataSet>>()
const activeDataSetCaches = new Map<SupportedDataLocale, { data: ActiveDataSet; createdAt: number }>()
const activeDataSetRefreshPromises = new Map<SupportedDataLocale, Promise<ActiveDataSet | null>>()
const backgroundRefreshErrors = new Map<SupportedDataLocale, { signature: string; loggedAt: number }>()
let electronFetch: any = null
let dataRootDirPromise: Promise<string> | null = null
let activeDataLocale: SupportedDataLocale = DEFAULT_DATA_LOCALE

const rarityMap: Record<string, string> = {
  0: 'kSilver',
  1: 'kGold',
  2: 'kPrismatic',
  silver: 'kSilver',
  gold: 'kGold',
  prismatic: 'kPrismatic',
}

const localeAliases = new Map<string, SupportedDataLocale>([
  ['zh', 'zh-CN'],
  ['zh-cn', 'zh-CN'],
  ['zh-hans', 'zh-CN'],
  ['zh-sg', 'zh-CN'],
  ['cn', 'zh-CN'],
  ['en', 'en-US'],
  ['en-us', 'en-US'],
  ['en-gb', 'en-US'],
  ['us', 'en-US'],
  ['zh-tw', 'zh-TW'],
  ['zh-hant', 'zh-TW'],
  ['zh-hk', 'zh-TW'],
  ['zh-mo', 'zh-TW'],
  ['tw', 'zh-TW'],
])

export function tryNormalizeDataLocale(value: unknown): SupportedDataLocale | null {
  const normalized = String(value || '')
    .trim()
    .replace(/_/g, '-')
    .toLowerCase()

  return localeAliases.get(normalized) || null
}

export function normalizeDataLocale(value: unknown): SupportedDataLocale {
  return tryNormalizeDataLocale(value) || DEFAULT_DATA_LOCALE
}

export function getDataLocale(): SupportedDataLocale {
  return activeDataLocale
}

export function setDataLocale(locale: unknown): SupportedDataLocale {
  const normalized = normalizeDataLocale(locale)
  activeDataLocale = normalized
  return activeDataLocale
}

function isLocaleDirectoryName(value: string): boolean {
  const normalized = String(value || '')
    .trim()
    .replace(/_/g, '-')
    .toLowerCase()

  return localeAliases.has(normalized)
}

function getClientConfigLocale(
  config: ClientConfig | null | undefined,
  fallbackLocale: unknown = activeDataLocale
): SupportedDataLocale {
  if (config?.locale) {
    return normalizeDataLocale(config.locale)
  }

  return normalizeDataLocale(fallbackLocale)
}

function getVersionedDataCacheKey(
  locale: SupportedDataLocale,
  dataVersion: string,
  dataPath: string
): string {
  return `${locale}:${dataVersion}:${normalizeDataPath(dataPath)}`
}

function setVersionedDataCache(
  locale: SupportedDataLocale,
  dataVersion: string,
  dataPath: string,
  payload: any
): void {
  cache.set(getVersionedDataCacheKey(locale, dataVersion, dataPath), {
    data: payload,
    createdAt: Date.now(),
  })
}

function getApiUrl(resourcePath: string): string {
  const p = resourcePath.startsWith('/') ? resourcePath : `${DATA_API_PREFIX}/${resourcePath}`
  return resolveTrustedClientDataUrl(p, DATA_API_ORIGIN, DATA_ALLOWED_ORIGINS)
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

async function requestJsonDocument(
  resourcePath: string,
  options: FetchJsonOptions = {}
): Promise<JsonDocument> {
  const url = getApiUrl(resourcePath)
  const transportFetch = await getTransportFetch()
  const timeoutMs = options.timeoutMs ?? DATA_FETCH_TIMEOUT_MS
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeout = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null

  try {
    const response = await transportFetch(url, {
      headers: {
        accept: 'application/json',
      },
      signal: controller?.signal,
    })

    if (!response.ok) {
      throw new Error(`Remote data request failed: ${response.status} ${response.statusText}`)
    }

    if (typeof response.text === 'function') {
      const sourceText = await response.text()
      return {
        data: JSON.parse(sourceText),
        sourceText,
      }
    }

    const data = await response.json()
    return {
      data,
      sourceText: JSON.stringify(data),
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`Remote data request timed out after ${timeoutMs}ms: ${url}`, {
        cause: error,
      })
    }

    throw error
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
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

  const request = requestJsonDocument(resourcePath, options)
    .then(({ data }) => {
      cache.set(url, { data, createdAt: Date.now() })
      return data
    })
    .finally(() => {
      pendingRequests.delete(url)
    })

  pendingRequests.set(url, request)
  return request
}

function sanitizePathPart(value: string | number): string {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_')
}

function compareDataVersions(left: string, right: string): number {
  const tokenize = (value: string): Array<number | string> =>
    String(value || '')
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()))

  const leftParts = tokenize(left)
  const rightParts = tokenize(right)
  const maxLength = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0

    if (leftPart === rightPart) {
      continue
    }

    if (typeof leftPart === 'number' && typeof rightPart === 'number') {
      return leftPart - rightPart
    }

    return String(leftPart).localeCompare(String(rightPart), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  }

  return 0
}

function normalizeDataPath(value: string): string {
  return normalizeClientDataPath(value)
}

function normalizeManifestResourcePath(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  if (/^https?:\/\//i.test(normalized) || normalized.startsWith('/')) {
    return normalized
  }

  return normalizeDataPath(normalized)
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

async function readLocalDataVersionDirs(
  dataRootDir: string,
  locale: SupportedDataLocale = activeDataLocale
): Promise<string[]> {
  const normalizedLocale = normalizeDataLocale(locale)
  const versionsRoots = normalizedLocale === DEFAULT_DATA_LOCALE
    ? [
        path.join(dataRootDir, 'versions'),
        path.join(dataRootDir, 'versions', DEFAULT_DATA_LOCALE),
      ]
    : [path.join(dataRootDir, 'versions', sanitizePathPart(normalizedLocale))]
  const versions = new Set<string>()

  for (const versionsRoot of versionsRoots) {
    const isRootVersionsDir = path.basename(versionsRoot) === 'versions'
    try {
      const entries = await readdir(versionsRoot, { withFileTypes: true })
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter(Boolean)
        .filter((entryName) => !isRootVersionsDir || !isLocaleDirectoryName(entryName))
        .forEach((entryName) => versions.add(entryName))
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.warn(`Failed to read local data versions from ${versionsRoot}:`, error.message)
      }
    }
  }

  return [...versions]
}

function getBundledDataRootDirs(): string[] {
  const candidates: string[] = []

  if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, BUNDLED_DATA_DIR_NAME))
  }

  candidates.push(path.join(process.cwd(), 'resources', BUNDLED_DATA_DIR_NAME))

  return candidates
}

async function listLocalDataVersions(locale: SupportedDataLocale = activeDataLocale): Promise<string[]> {
  const versions = new Set<string>()
  const dataRootDir = await getDataRootDir()

  const rootVersions = await readLocalDataVersionDirs(dataRootDir, locale)
  rootVersions.forEach((version) => versions.add(version))

  return [...versions].sort(compareDataVersions).reverse()
}

async function getVersionDir(
  dataVersion: string,
  locale: SupportedDataLocale = activeDataLocale
): Promise<string> {
  const dataRootDir = await getDataRootDir()
  const normalizedLocale = normalizeDataLocale(locale)
  const versionDir = normalizedLocale === DEFAULT_DATA_LOCALE
    ? path.join(dataRootDir, 'versions', sanitizePathPart(dataVersion))
    : path.join(dataRootDir, 'versions', sanitizePathPart(normalizedLocale), sanitizePathPart(dataVersion))
  await mkdir(versionDir, { recursive: true })
  return versionDir
}

async function getDataFileCandidatePaths(
  dataVersion: string,
  dataPath: string,
  locale: SupportedDataLocale = activeDataLocale
): Promise<string[]> {
  const dataRootDir = await getDataRootDir()
  const normalizedPath = normalizeDataPath(dataPath)
  const normalizedLocale = normalizeDataLocale(locale)
  const versionPathCandidates = normalizedLocale === DEFAULT_DATA_LOCALE
    ? [
        path.join('versions', sanitizePathPart(DEFAULT_DATA_LOCALE), sanitizePathPart(dataVersion), normalizedPath),
        path.join('versions', sanitizePathPart(dataVersion), normalizedPath),
      ]
    : [
        path.join('versions', sanitizePathPart(normalizedLocale), sanitizePathPart(dataVersion), normalizedPath),
      ]

  const candidates = [
    ...versionPathCandidates.map((relativePath) => path.join(dataRootDir, relativePath)),
    ...getBundledDataRootDirs().flatMap((bundledDataRootDir) =>
      versionPathCandidates.map((relativePath) => path.join(bundledDataRootDir, relativePath))
    ),
  ]

  return [...new Set(candidates)]
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
  await writeTextFileAtomic(filePath, JSON.stringify(payload))
}

async function writeTextFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, content, 'utf8')
  await rename(tempPath, filePath)
}

function getCurrentDataFileNames(locale: SupportedDataLocale): string[] {
  const normalizedLocale = normalizeDataLocale(locale)
  if (normalizedLocale === DEFAULT_DATA_LOCALE) {
    return [CURRENT_DATA_FILE, `current.${DEFAULT_DATA_LOCALE}.json`]
  }

  return [`current.${normalizedLocale}.json`]
}

function getWritableCurrentDataFileName(locale: SupportedDataLocale): string {
  const normalizedLocale = normalizeDataLocale(locale)
  return normalizedLocale === DEFAULT_DATA_LOCALE
    ? CURRENT_DATA_FILE
    : `current.${normalizedLocale}.json`
}

async function readCachedCurrentDataPointer(
  locale: SupportedDataLocale = activeDataLocale
): Promise<any | null> {
  const dataRootDir = await getDataRootDir()
  for (const fileName of getCurrentDataFileNames(locale)) {
    const pointer = await readJsonFile(path.join(dataRootDir, fileName))
    if (pointer) {
      return pointer
    }
  }

  return null
}

async function readBundledCurrentDataPointers(
  locale: SupportedDataLocale = activeDataLocale
): Promise<any[]> {
  const pointers: any[] = []
  for (const bundledDataRootDir of getBundledDataRootDirs()) {
    for (const fileName of getCurrentDataFileNames(locale)) {
      const bundledPointer = await readJsonFile(path.join(bundledDataRootDir, fileName))
      if (bundledPointer) {
        logger.debug('[data-loader] bundled data pointer found', {
          dataVersion: bundledPointer.dataVersion || null,
          locale: bundledPointer.locale || locale,
          fileName,
        })
        pointers.push(bundledPointer)
      }
    }
  }

  return pointers
}

async function readCurrentDataPointerCandidates(
  locale: SupportedDataLocale = activeDataLocale
): Promise<Array<{ pointer: any; source: string }>> {
  const candidates: Array<{ pointer: any; source: string }> = []
  const cachedPointer = await readCachedCurrentDataPointer(locale)
  if (cachedPointer) {
    candidates.push({ pointer: cachedPointer, source: 'cache' })
  }

  const bundledPointers = await readBundledCurrentDataPointers(locale)
  bundledPointers.forEach((pointer) => candidates.push({ pointer, source: 'bundled' }))

  return candidates.sort((left, right) => {
    const versionComparison = compareDataVersions(
      String(right.pointer?.dataVersion || ''),
      String(left.pointer?.dataVersion || '')
    )
    if (versionComparison !== 0) {
      return versionComparison
    }

    for (const field of ['generatedAt', 'activatedAt']) {
      const leftTimestamp = Date.parse(String(left.pointer?.[field] || '')) || 0
      const rightTimestamp = Date.parse(String(right.pointer?.[field] || '')) || 0
      if (leftTimestamp !== rightTimestamp) {
        return rightTimestamp - leftTimestamp
      }
    }

    return left.source === right.source ? 0 : left.source === 'cache' ? -1 : 1
  })
}

async function writeCurrentDataPointer(
  config: ClientConfig,
  locale: SupportedDataLocale = getClientConfigLocale(config)
): Promise<void> {
  const dataRootDir = await getDataRootDir()
  const normalizedLocale = normalizeDataLocale(locale)
  await writeJsonFileAtomic(path.join(dataRootDir, getWritableCurrentDataFileName(normalizedLocale)), {
    schemaVersion: DATA_CACHE_SCHEMA_VERSION,
    locale: normalizedLocale,
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

function getManifestEntryLogicalPath(entry: any): string {
  const directPath = String(entry?.path || entry?.logicalPath || '').trim()
  if (directPath) {
    return normalizeDataPath(directPath)
  }

  const urlPath = normalizeDataPath(
    getClientDataUrlPathname(String(entry?.url || ''), DATA_API_ORIGIN)
  )
  for (const marker of [
    'champion-shards/',
    'champions/',
  ]) {
    const markerIndex = urlPath.indexOf(marker)
    if (markerIndex >= 0) {
      return urlPath.slice(markerIndex)
    }
  }

  for (const fileName of ['augments.json', 'champions.json', 'items.json', 'manifest.json']) {
    if (urlPath.endsWith(`/${fileName}`) || urlPath === fileName) {
      return fileName
    }
  }

  return urlPath
}

function findManifestEntry(manifest: any, logicalPath: string): any | null {
  const normalized = normalizeDataPath(logicalPath)
  return getManifestFileEntries(manifest).find((file: any) => {
    const filePath = getManifestEntryLogicalPath(file)
    return filePath === normalized || filePath.endsWith(`/${normalized}`)
  }) || null
}

function findManifestPath(manifest: any, logicalPath: string): string {
  const normalized = normalizeDataPath(logicalPath)
  const entry = findManifestEntry(manifest, normalized)

  return normalizeManifestResourcePath(String(entry?.url || entry?.path || normalized))
}

function findManifestPathIfExists(manifest: any, logicalPath: string): string | null {
  const entry = findManifestEntry(manifest, logicalPath)
  return entry ? normalizeManifestResourcePath(String(entry.url || entry.path || logicalPath)) : null
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
      path: getManifestEntryLogicalPath(entry),
      bytes: Number(entry.bytes || 0),
    }))
    .filter((entry: any) => entry.path && isRequiredBundledDataPath(entry.path))
    .forEach((entry: any) => filesByPath.set(entry.path, entry))

  return [...filesByPath.values()].sort((left, right) => left.path.localeCompare(right.path))
}

async function hasDataFile(
  dataVersion: string,
  dataPath: string,
  expectedBytes = 0,
  locale: SupportedDataLocale = activeDataLocale
): Promise<boolean> {
  for (const filePath of await getDataFileCandidatePaths(dataVersion, dataPath, locale)) {
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

async function isCompleteVersionDataSet(
  dataVersion: string,
  manifest: any,
  locale: SupportedDataLocale = activeDataLocale
): Promise<boolean> {
  const requiredFiles = collectRequiredVersionDataFiles(manifest)
  for (const file of requiredFiles) {
    if (!await hasDataFile(dataVersion, file.path, file.bytes, locale)) {
      logger.debug('[data-loader] data version completeness check missing file', {
        locale,
        dataVersion,
        path: file.path,
        expectedBytes: file.bytes || null,
      })
      return false
    }
  }

  return true
}

async function readDataFileFromDisk(
  dataVersion: string,
  dataPath: string,
  locale: SupportedDataLocale = activeDataLocale
): Promise<any | null> {
  const normalizedPath = normalizeDataPath(dataPath)
  for (const filePath of await getDataFileCandidatePaths(dataVersion, normalizedPath, locale)) {
    const payload = await readJsonFile(filePath)
    if (payload != null) {
      return payload
    }
  }

  return null
}

async function writeDataTextToDisk(
  dataVersion: string,
  dataPath: string,
  sourceText: string,
  locale: SupportedDataLocale = activeDataLocale
): Promise<void> {
  const versionDir = await getVersionDir(dataVersion, locale)
  await writeTextFileAtomic(resolveClientDataFilePath(versionDir, dataPath), sourceText)
}

async function readCachedVersionedDataFile(
  dataVersion: string,
  dataPath: string,
  locale: SupportedDataLocale = activeDataLocale
): Promise<any | null> {
  const normalizedLocale = normalizeDataLocale(locale)
  const normalizedPath = normalizeDataPath(dataPath)
  const cacheKey = getVersionedDataCacheKey(normalizedLocale, dataVersion, normalizedPath)
  const cached = cache.get(cacheKey)
  if (cached) {
    return cached.data
  }

  const payload = await readDataFileFromDisk(dataVersion, normalizedPath, normalizedLocale)
  if (payload != null) {
    cache.set(cacheKey, { data: payload, createdAt: Date.now() })
  }

  return payload
}

async function fetchVersionedDataFile(
  dataVersion: string,
  dataPath: string,
  resourcePath?: string,
  options: FetchJsonOptions = {}
): Promise<any> {
  const startedAt = Date.now()
  const locale = normalizeDataLocale(options.locale || activeDataLocale)
  const normalizedPath = normalizeDataPath(dataPath)
  const cacheKey = getVersionedDataCacheKey(locale, dataVersion, normalizedPath)
  const force = options.force === true
  const cached = cache.get(cacheKey)
  if (!force && cached && Date.now() - cached.createdAt < DATA_TTL_MS) {
    logger.debug('[data-loader] memory cache hit', {
      locale,
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
      const diskPayload = await readDataFileFromDisk(dataVersion, normalizedPath, locale)
      if (diskPayload != null) {
        cache.set(cacheKey, { data: diskPayload, createdAt: Date.now() })
        logger.debug('[data-loader] disk cache hit', {
          locale,
          dataVersion,
          path: normalizedPath,
          durationMs: getElapsedMs(startedAt),
        })
        return diskPayload
      }
    }

    try {
      const resolvedResourcePath = resolveVersionResourcePath(dataVersion, resourcePath || normalizedPath)
      logger.debug('[data-loader] remote fetch start', {
        locale,
        dataVersion,
        path: normalizedPath,
        resourcePath: resolvedResourcePath,
        force,
      })
      const document = await requestJsonDocument(
        resolvedResourcePath,
        { force, ttlMs: options.ttlMs, timeoutMs: options.timeoutMs }
      )
      const payload = document.data
      await writeDataTextToDisk(dataVersion, normalizedPath, document.sourceText, locale)
      cache.set(cacheKey, { data: payload, createdAt: Date.now() })
      logger.debug('[data-loader] remote fetch completed', {
        locale,
        dataVersion,
        path: normalizedPath,
        durationMs: getElapsedMs(startedAt),
      })
      return payload
    } catch (error: any) {
      const diskPayload = await readDataFileFromDisk(dataVersion, normalizedPath, locale)
      if (diskPayload != null) {
        logger.warn(`Failed to refresh ${locale}/${normalizedPath}; using cached data:`, error.message)
        cache.set(cacheKey, { data: diskPayload, createdAt: Date.now() })
        logger.debug('[data-loader] disk fallback hit', {
          locale,
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

function getDataApiConfigCandidates(locale: SupportedDataLocale): string[] {
  if (locale === DEFAULT_DATA_LOCALE) {
    return [DATA_API_CONFIG_PATH]
  }

  return [
    `${DATA_API_CONFIG_PATH}?locale=${encodeURIComponent(locale)}`,
    `${DATA_API_CONFIG_PATH}?lang=${encodeURIComponent(locale)}`,
    `${DATA_API_CONFIG_PATH}?language=${encodeURIComponent(locale)}`,
    `${DATA_API_PREFIX}/${encodeURIComponent(locale)}/config`,
    `${DATA_API_CONFIG_PATH}/${encodeURIComponent(locale)}`,
    DATA_API_CONFIG_PATH,
  ]
}

function isRemoteNotFoundError(error: any): boolean {
  const message = String(error?.message || error || '')
  return /\b404\b/.test(message) || /not_found/i.test(message)
}

function normalizeClientConfig(
  config: ClientConfig,
  fallbackLocale: SupportedDataLocale
): ClientConfig {
  return {
    ...config,
    locale: normalizeDataLocale(config.locale || fallbackLocale),
  }
}

export async function loadDataApiConfig(options: FetchJsonOptions = {}): Promise<ClientConfig> {
  const locale = normalizeDataLocale(options.locale || activeDataLocale)
  const candidates = getDataApiConfigCandidates(locale)
  let fallbackConfig: ClientConfig | null = null
  let lastError: any = null

  for (const resourcePath of candidates) {
    try {
      const config = await fetchJson(resourcePath, {
        ...options,
        ttlMs: options.ttlMs ?? CONFIG_TTL_MS,
      })
      const declaredLocale = tryNormalizeDataLocale(config?.locale)
      const configLocale = declaredLocale || DEFAULT_DATA_LOCALE
      const normalizedConfig = normalizeClientConfig(config, configLocale)

      if (configLocale === locale && (locale === DEFAULT_DATA_LOCALE || declaredLocale)) {
        return normalizedConfig
      }

      if (!fallbackConfig) {
        fallbackConfig = normalizedConfig
      }

      logger.debug('[data-loader] remote config locale mismatch; trying next candidate', {
        requestedLocale: locale,
        configLocale,
        resourcePath,
      })
    } catch (error: any) {
      lastError = error
      if (!isRemoteNotFoundError(error)) {
        break
      }

      logger.debug('[data-loader] remote config candidate not found', {
        locale,
        resourcePath,
      })
    }
  }

  if (fallbackConfig) {
    logger.warn('[data-loader] requested data locale unavailable; using returned locale', {
      requestedLocale: locale,
      configLocale: fallbackConfig.locale || null,
    })
    return fallbackConfig
  }

  if (lastError) {
    throw lastError
  }

  return fetchJson(DATA_API_CONFIG_PATH, {
    ...options,
    ttlMs: options.ttlMs ?? CONFIG_TTL_MS,
  })
}

function getManifestResourceCandidates(
  config: ClientConfig,
  dataVersion: string,
  locale: SupportedDataLocale
): string[] {
  const candidates = [
    config.manifest || '',
  ]

  if (locale !== DEFAULT_DATA_LOCALE) {
    candidates.push(
      `${getVersionDataPrefix(dataVersion)}/${encodeURIComponent(locale)}/manifest.json`,
      `${DATA_API_PREFIX}/data/${encodeURIComponent(locale)}/${encodeURIComponent(dataVersion)}/manifest.json`,
      `${getVersionDataPrefix(dataVersion)}/manifest.${encodeURIComponent(locale)}.json`
    )
  }

  candidates.push(`${getVersionDataPrefix(dataVersion)}/manifest.json`)

  return [...new Set(candidates.filter(Boolean))]
}

async function loadManifestForConfig(
  config: ClientConfig,
  locale: SupportedDataLocale
): Promise<ManifestLoadResult> {
  const dataVersion = String(config.dataVersion || '')
  if (!dataVersion) {
    throw new Error('Remote client data config is missing dataVersion')
  }

  const candidates = getManifestResourceCandidates(config, dataVersion, locale)
  let fallbackManifest: (JsonDocument & { manifest: any }) | null = null
  let lastError: any = null

  for (const manifestPath of candidates) {
    try {
      const document = await requestJsonDocument(manifestPath, {
        force: true,
        ttlMs: DATA_TTL_MS,
        timeoutMs: DATA_FETCH_TIMEOUT_MS,
      })
      const manifest = document.data
      const declaredLocale = tryNormalizeDataLocale(manifest?.locale)
      const manifestLocale = declaredLocale || DEFAULT_DATA_LOCALE
      if (manifestLocale === locale && (locale === DEFAULT_DATA_LOCALE || declaredLocale)) {
        await writeDataTextToDisk(dataVersion, 'manifest.json', document.sourceText, locale)
        setVersionedDataCache(locale, dataVersion, 'manifest.json', manifest)
        return { manifest, locale }
      }

      if (!fallbackManifest) {
        fallbackManifest = {
          ...document,
          manifest,
        }
      }

      logger.debug('[data-loader] manifest locale mismatch; trying next candidate', {
        requestedLocale: locale,
        manifestLocale,
        manifestPath,
      })
    } catch (error: any) {
      lastError = error
      if (!isRemoteNotFoundError(error)) {
        break
      }
    }
  }

  if (fallbackManifest) {
    const manifest = fallbackManifest.manifest
    const fallbackLocale = tryNormalizeDataLocale(manifest?.locale) || DEFAULT_DATA_LOCALE
    await writeDataTextToDisk(
      dataVersion,
      'manifest.json',
      fallbackManifest.sourceText,
      fallbackLocale
    )
    setVersionedDataCache(fallbackLocale, dataVersion, 'manifest.json', manifest)
    logger.warn('[data-loader] requested manifest locale unavailable; using returned locale', {
      requestedLocale: locale,
      manifestLocale: manifest.locale || null,
    })
    return { manifest, locale: fallbackLocale }
  }

  throw lastError || new Error(`Remote client data manifest not found for ${locale}/${dataVersion}`)
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

async function prepareDataVersion(
  config: ClientConfig,
  requestedLocale: SupportedDataLocale = activeDataLocale
): Promise<ActiveDataSet> {
  const dataVersion = String(config.dataVersion || '')
  const initialLocale = getClientConfigLocale(config, requestedLocale)
  const manifestResult = await loadManifestForConfig(config, initialLocale)
  const locale = manifestResult.locale
  const manifest = manifestResult.manifest
  const normalizedConfig = normalizeClientConfig(config, locale)
  const requiredDataPaths = collectRequiredVersionDataFiles(manifest)
    .map((file) => file.path)
    .filter((dataPath) => dataPath !== 'manifest.json')

  await runLimited(requiredDataPaths, DATA_REFRESH_CONCURRENCY, async (dataPath) => {
    await fetchVersionedDataFile(dataVersion, dataPath, findManifestPath(manifest, dataPath), {
        force: true,
        locale,
      })
  })
  await writeCurrentDataPointer(normalizedConfig, locale)

  logger.debug('[data-loader] data version files prepared', {
    locale,
    dataVersion,
    fileCount: requiredDataPaths.length + 1,
  })

  return { config: normalizedConfig, dataVersion, manifest, locale }
}

async function loadCachedActiveDataSet(
  locale: SupportedDataLocale = activeDataLocale
): Promise<ActiveDataSet | null> {
  const requestedLocale = normalizeDataLocale(locale)
  for (const candidate of await readCurrentDataPointerCandidates(requestedLocale)) {
    const current = candidate.pointer
    const dataVersion = String(current?.dataVersion || '')
    if (!dataVersion) {
      continue
    }

    const pointerLocale = getClientConfigLocale(current, requestedLocale)
    if (pointerLocale !== requestedLocale) {
      logger.warn('[data-loader] data pointer locale mismatch; skipping foreground use', {
        requestedLocale,
        pointerLocale,
        dataVersion,
        source: candidate.source,
      })
      continue
    }

    const manifest = await readDataFileFromDisk(dataVersion, 'manifest.json', pointerLocale)
    if (!manifest) {
      continue
    }

    const manifestLocale = tryNormalizeDataLocale(manifest.locale)
    if (
      (requestedLocale !== DEFAULT_DATA_LOCALE && manifestLocale !== requestedLocale) ||
      (manifestLocale && manifestLocale !== requestedLocale)
    ) {
      logger.warn('[data-loader] manifest locale mismatch; skipping foreground use', {
        requestedLocale,
        manifestLocale: manifestLocale || null,
        dataVersion,
        source: candidate.source,
      })
      continue
    }

    if (!await isCompleteVersionDataSet(dataVersion, manifest, pointerLocale)) {
      logger.warn('[data-loader] cached data version is incomplete; skipping foreground use', {
        locale: pointerLocale,
        dataVersion,
        source: candidate.source,
      })
      continue
    }

    return {
      config: {
        locale: pointerLocale,
        dataVersion,
        gamePatch: current.gamePatch || '',
        generatedAt: current.generatedAt || '',
        manifest: current.manifest || `${getVersionDataPrefix(dataVersion)}/manifest.json`,
      },
      dataVersion,
      manifest,
      locale: pointerLocale,
    }
  }

  return null
}

function refreshLatestDataVersionInBackground(
  currentDataSet: ActiveDataSet,
  requestedLocale: SupportedDataLocale = activeDataLocale
): void {
  const locale = normalizeDataLocale(requestedLocale)
  if (activeDataSetRefreshPromises.has(locale)) {
    return
  }

  const refreshPromise = (async () => {
    const config = await loadDataApiConfig({ locale })
    const remoteDataVersion = String(config?.dataVersion || '')
    const remoteLocale = getClientConfigLocale(config, locale)
    if (
      !remoteDataVersion ||
      (remoteDataVersion === currentDataSet.dataVersion && remoteLocale === currentDataSet.locale)
    ) {
      return currentDataSet
    }

    logger.debug('[data-loader] remote data version refresh queued', {
      requestedLocale: locale,
      currentLocale: currentDataSet.locale,
      remoteLocale,
      cachedDataVersion: currentDataSet.dataVersion,
      remoteDataVersion,
    })

    const dataSet = await prepareDataVersion(config, locale)
    if (!await isCompleteVersionDataSet(dataSet.dataVersion, dataSet.manifest, dataSet.locale)) {
      throw new Error(`Prepared data version ${dataSet.dataVersion} is incomplete`)
    }

    return dataSet
  })()
    .then((dataSet) => {
      if (
        !dataSet ||
        (dataSet.dataVersion === currentDataSet.dataVersion && dataSet.locale === currentDataSet.locale)
      ) {
        return dataSet
      }

      activeDataSetCaches.set(locale, {
        data: dataSet,
        createdAt: Date.now(),
      })
      logger.info('[data-loader] active data version refreshed in background', {
        requestedLocale: locale,
        locale: dataSet.locale,
        dataVersion: dataSet.dataVersion,
      })
      return dataSet
    })
    .catch((error: any) => {
      const message = error?.message || String(error)
      const now = Date.now()
      const previousError = backgroundRefreshErrors.get(locale)
      const shouldLogWarning =
        message !== previousError?.signature ||
        now - (previousError?.loggedAt || 0) >= DATA_BACKGROUND_REFRESH_ERROR_LOG_INTERVAL_MS

      if (shouldLogWarning) {
        backgroundRefreshErrors.set(locale, { signature: message, loggedAt: now })
        logger.warn('[data-loader] background data refresh failed:', message)
      } else {
        logger.debug('[data-loader] background data refresh failed (suppressed):', message)
      }

      return null
    })
    .finally(() => {
      activeDataSetRefreshPromises.delete(locale)
    })

  activeDataSetRefreshPromises.set(locale, refreshPromise)
}

async function resolveActiveDataSet(
  requestedLocale: SupportedDataLocale = activeDataLocale
): Promise<ActiveDataSet> {
  const locale = normalizeDataLocale(requestedLocale)
  const startedAt = Date.now()
  let cachedDataSet: ActiveDataSet | null = null

  try {
    cachedDataSet = await loadCachedActiveDataSet(locale)
    if (cachedDataSet) {
      logger.debug('[data-loader] active data version resolved from complete local data', {
        requestedLocale: locale,
        locale: cachedDataSet.locale,
        dataVersion: cachedDataSet.dataVersion,
        durationMs: getElapsedMs(startedAt),
      })
      refreshLatestDataVersionInBackground(cachedDataSet, locale)
      return cachedDataSet
    }

    const config = await loadDataApiConfig({ locale })
    const remoteDataVersion = String(config?.dataVersion || '')

    if (!remoteDataVersion) {
      throw new Error('Remote client data config is missing dataVersion')
    }

    const preparedDataSet = await prepareDataVersion(config, locale)
    logger.info('[data-loader] active data version prepared', {
      requestedLocale: locale,
      locale: preparedDataSet.locale,
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

    const fallbackDataSet =
      await loadCachedActiveDataSet(locale) ||
      (locale !== DEFAULT_DATA_LOCALE ? await loadCachedActiveDataSet(DEFAULT_DATA_LOCALE) : null)
    if (fallbackDataSet) {
      logger.warn(
        `Failed to load remote client data; using cached ${fallbackDataSet.locale} data version ${fallbackDataSet.dataVersion}:`,
        error.message
      )
      return fallbackDataSet
    }

    throw error
  }
}

async function getActiveDataSet(
  requestedLocale: SupportedDataLocale = activeDataLocale
): Promise<ActiveDataSet> {
  const locale = normalizeDataLocale(requestedLocale)
  const cached = activeDataSetCaches.get(locale)
  if (cached && Date.now() - cached.createdAt < CONFIG_TTL_MS) {
    return cached.data
  }

  let activeDataSetPromise = activeDataSetPromises.get(locale)
  if (!activeDataSetPromise) {
    activeDataSetPromise = resolveActiveDataSet(locale)
      .then((dataSet) => {
        activeDataSetCaches.set(locale, {
          data: dataSet,
          createdAt: Date.now(),
        })
        return dataSet
      })
      .finally(() => {
        activeDataSetPromises.delete(locale)
      })
    activeDataSetPromises.set(locale, activeDataSetPromise)
  }

  return activeDataSetPromise
}

export async function prepareDataLocale(locale: unknown): Promise<PreparedDataLocale> {
  const requestedLocale = normalizeDataLocale(locale)
  const dataSet = await getActiveDataSet(requestedLocale)
  if (dataSet.locale !== requestedLocale) {
    activeDataSetCaches.delete(requestedLocale)
    throw new Error(
      `Requested data locale ${requestedLocale} is unavailable; effective locale is ${dataSet.locale}`
    )
  }

  return {
    locale: dataSet.locale,
    dataVersion: dataSet.dataVersion,
  }
}

export async function getActiveDataStatus(
  locale: unknown = activeDataLocale
): Promise<PreparedDataLocale & { gamePatch: string; generatedAt: string }> {
  const dataSet = await getActiveDataSet(normalizeDataLocale(locale))
  return {
    locale: dataSet.locale,
    dataVersion: dataSet.dataVersion,
    gamePatch: dataSet.config.gamePatch || '',
    generatedAt: dataSet.config.generatedAt || '',
  }
}

async function loadDataFile(
  logicalPath: string,
  requestedLocale: SupportedDataLocale = activeDataLocale
): Promise<any> {
  const dataSet = await getActiveDataSet(requestedLocale)
  return fetchVersionedDataFile(
    dataSet.dataVersion,
    logicalPath,
    findManifestPath(dataSet.manifest, logicalPath),
    { locale: dataSet.locale }
  )
}

async function loadChampionsPayload(locale: SupportedDataLocale = activeDataLocale): Promise<any> {
  return loadDataFile('champions.json', locale)
}

async function loadAugmentsPayload(locale: SupportedDataLocale = activeDataLocale): Promise<any> {
  return loadDataFile('augments.json', locale)
}

async function loadItemsPayload(locale: SupportedDataLocale = activeDataLocale): Promise<any> {
  return loadDataFile('items.json', locale)
}

async function loadChampionShardIndexForDataSet(
  dataSet: ActiveDataSet,
  options: FetchJsonOptions = {}
): Promise<any | null> {
  try {
    return fetchVersionedDataFile(
      dataSet.dataVersion,
      'champion-shards/index.json',
      findManifestPath(dataSet.manifest, 'champion-shards/index.json'),
      { ...options, locale: dataSet.locale }
    )
  } catch (error: any) {
    logger.warn(`Failed to load champion shard index for ${dataSet.dataVersion}:`, error.message)
    return null
  }
}

async function loadCachedChampionShardIndexForDataSet(dataSet: ActiveDataSet): Promise<any | null> {
  const logicalPath = 'champion-shards/index.json'
  const manifestPath = findManifestPath(dataSet.manifest, logicalPath)
  const payload =
    await readCachedVersionedDataFile(dataSet.dataVersion, logicalPath, dataSet.locale) ||
    (manifestPath !== logicalPath && !/^https?:\/\//i.test(manifestPath) && !manifestPath.startsWith('/')
      ? await readCachedVersionedDataFile(dataSet.dataVersion, manifestPath, dataSet.locale)
      : null)

  return payload
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

function cacheChampionShardDetails(
  dataVersion: string,
  locale: SupportedDataLocale,
  champions: Record<string, any>
): void {
  Object.entries(champions).forEach(([id, championDetail]) => {
    detailCache.set(`${locale}:${dataVersion}:champion:${id}`, championDetail)
  })
}

async function loadChampionDetailFromShard(
  dataSet: ActiveDataSet,
  championId: string | number,
  shardPath: string,
  source: 'cached' | 'remote',
  options: FetchJsonOptions = {}
): Promise<any | null> {
  const shardPayload = source === 'cached'
    ? await readCachedVersionedDataFile(dataSet.dataVersion, shardPath, dataSet.locale)
    : await fetchVersionedDataFile(
      dataSet.dataVersion,
      shardPath,
      findManifestPath(dataSet.manifest, shardPath),
      { ...options, locale: dataSet.locale }
    )
  const shardData = shardPayload ? unwrapEnvelope(shardPayload) : null
  const champions = shardData?.champions || shardPayload?.champions || {}
  const detail = champions[String(championId)] || champions[Number(championId)]

  if (!detail) {
    return null
  }

  cacheChampionShardDetails(dataSet.dataVersion, dataSet.locale, champions)
  return detail
}

async function loadSingleChampionDetailFromDataSet(
  dataSet: ActiveDataSet,
  championId: string | number,
  options: FetchJsonOptions = {}
): Promise<any | null> {
  const singleChampionPath = `champions/${championId}.json`
  const manifestSingleChampionPath = findManifestPathIfExists(dataSet.manifest, singleChampionPath)
  if (!manifestSingleChampionPath) {
    logger.debug('[data-loader] champion detail single fetch skipped', {
      dataVersion: dataSet.dataVersion,
      championId,
      path: singleChampionPath,
      reason: 'not-in-manifest',
    })
    return null
  }

  logger.debug('[data-loader] champion detail single fetch start', {
    dataVersion: dataSet.dataVersion,
    championId,
    path: manifestSingleChampionPath,
  })
  const payload = await fetchVersionedDataFile(
    dataSet.dataVersion,
    singleChampionPath,
    manifestSingleChampionPath,
    { ...options, locale: dataSet.locale }
  )
  const detail = unwrapEnvelope(payload)
  detailCache.set(`${dataSet.locale}:${dataSet.dataVersion}:champion:${championId}`, detail)
  logger.debug('[data-loader] champion detail single fetch completed', {
    dataVersion: dataSet.dataVersion,
    championId,
  })
  return detail
}

async function loadCachedSingleChampionDetailFromDataSet(
  dataSet: ActiveDataSet,
  championId: string | number
): Promise<any | null> {
  const singleChampionPath = `champions/${championId}.json`
  const manifestSingleChampionPath = findManifestPathIfExists(dataSet.manifest, singleChampionPath)
  if (!manifestSingleChampionPath) {
    return null
  }

  const payload =
    await readCachedVersionedDataFile(dataSet.dataVersion, singleChampionPath, dataSet.locale) ||
    (manifestSingleChampionPath !== singleChampionPath &&
      !/^https?:\/\//i.test(manifestSingleChampionPath) &&
      !manifestSingleChampionPath.startsWith('/')
      ? await readCachedVersionedDataFile(dataSet.dataVersion, manifestSingleChampionPath, dataSet.locale)
      : null)

  if (!payload) {
    return null
  }

  const detail = unwrapEnvelope(payload)
  detailCache.set(`${dataSet.locale}:${dataSet.dataVersion}:champion:${championId}`, detail)
  return detail
}

async function loadCachedChampionDetailPayload(
  dataSet: ActiveDataSet,
  championId: string | number,
): Promise<any | null> {
  const cacheKey = `${dataSet.locale}:${dataSet.dataVersion}:champion:${championId}`
  if (detailCache.has(cacheKey)) {
    logger.debug('[data-loader] champion detail memory cache hit', {
      dataVersion: dataSet.dataVersion,
      championId,
    })
    return detailCache.get(cacheKey)
  }

  const shardIndex = await loadCachedChampionShardIndexForDataSet(dataSet)
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

  return loadCachedSingleChampionDetailFromDataSet(dataSet, championId)
}

async function loadCachedLatestChampionDetailPayload(
  championId: string | number,
  activeDataSet: ActiveDataSet,
  activeShardPath: string | null
): Promise<any | null> {
  const localVersions = await listLocalDataVersions(activeDataSet.locale)
  const newerVersions = localVersions.filter((dataVersion) =>
    compareDataVersions(dataVersion, activeDataSet.dataVersion) > 0
  )

  for (const dataVersion of newerVersions) {
    const manifest = await readCachedVersionedDataFile(dataVersion, 'manifest.json', activeDataSet.locale)
    if (!manifest) {
      continue
    }

    const latestDataSet: ActiveDataSet = {
      config: {
        locale: activeDataSet.locale,
        dataVersion,
        manifest: `${getVersionDataPrefix(dataVersion)}/manifest.json`,
      },
      dataVersion,
      manifest,
      locale: activeDataSet.locale,
    }
    const triedShardPaths = new Set<string>()
    const tryCachedShard = async (shardPath: string): Promise<any | null> => {
      triedShardPaths.add(shardPath)
      const cachedShardDetail = await loadChampionDetailFromShard(latestDataSet, championId, shardPath, 'cached')
      if (cachedShardDetail) {
        logger.debug('[data-loader] champion detail loaded from newer local shard', {
          activeDataVersion: activeDataSet.dataVersion,
          dataVersion,
          championId,
          shardPath,
        })
        return cachedShardDetail
      }

      return null
    }

    if (activeShardPath) {
      const activePathDetail = await tryCachedShard(activeShardPath)
      if (activePathDetail) {
        return activePathDetail
      }
    }

    const latestShardIndex = await loadCachedChampionShardIndexForDataSet(latestDataSet)
    const latestShardPath = latestShardIndex ? findShardPathForChampion(latestShardIndex, championId) : null
    const shardPath = latestShardPath || activeShardPath

    if (shardPath && !triedShardPaths.has(shardPath)) {
      const cachedShardDetail = await tryCachedShard(shardPath)
      if (cachedShardDetail) {
        return cachedShardDetail
      }
    }

    const singleChampionDetail = await loadCachedSingleChampionDetailFromDataSet(latestDataSet, championId)
    if (singleChampionDetail) {
      logger.debug('[data-loader] champion detail loaded from newer local single detail', {
        activeDataVersion: activeDataSet.dataVersion,
        dataVersion,
        championId,
      })
      return singleChampionDetail
    }
  }

  return null
}

async function loadChampionDetailPayload(
  championId: string | number,
  requestedLocale: SupportedDataLocale = activeDataLocale
): Promise<any | null> {
  const dataSet = await getActiveDataSet(normalizeDataLocale(requestedLocale))
  const shardIndex = await loadChampionShardIndexForDataSet(dataSet)
  const shardPath = shardIndex ? findShardPathForChampion(shardIndex, championId) : null

  const latestCachedDetail = await loadCachedLatestChampionDetailPayload(championId, dataSet, shardPath)
  if (latestCachedDetail) {
    return latestCachedDetail
  }

  const cachedDetail = await loadCachedChampionDetailPayload(dataSet, championId)
  if (cachedDetail) {
    return cachedDetail
  }

  try {
    const detail = await loadSingleChampionDetailFromDataSet(dataSet, championId, {
      timeoutMs: CHAMPION_DETAIL_FETCH_TIMEOUT_MS,
    })
    if (detail) {
      return detail
    }
  } catch (error: any) {
    logger.warn(`Failed to load single champion detail ${championId}; trying shard fallback:`, error.message)
  }

  if (shardPath) {
    try {
      logger.debug('[data-loader] champion detail shard fallback fetch start', {
        dataVersion: dataSet.dataVersion,
        championId,
        shardPath,
      })
      const detail = await loadChampionDetailFromShard(dataSet, championId, shardPath, 'remote')
      if (detail) {
        logger.debug('[data-loader] champion detail shard fallback completed', {
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

function hasItemSequence(record: any): boolean {
  return Array.isArray(record?.itemIds) || Array.isArray(record?.items)
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
    rank: toNullableNumber(stats.rank ?? augment?.rank),
    total: toNullableNumber(stats.total ?? augment?.total),
    num_win_games: toNullableNumber(stats.wins ?? stats.num_win_games),
    win_rate: toNullableNumber(stats.winRate ?? stats.win_rate),
    num_games: toNullableNumber(stats.games ?? stats.num_games),
    pick_rate: toNullableNumber(stats.pickRate ?? stats.pick_rate),
    gamePatch: stats.gamePatch || null,
    date: stats.date || null,
  }
}

function getLegacyAugmentRecommendScore(stats: any): number | null {
  const winRate = toNullableNumber(stats.win_rate)
  if (winRate == null) {
    return null
  }

  const pickRate = toNullableNumber(stats.pick_rate) ?? 0
  const games = toNullableNumber(stats.num_games) ?? 0
  return winRate * 0.6 + pickRate * 0.2 + Math.min(games / 1000, 1) * 0.2
}

function mapPublicAugmentRecommendation(
  augment: any,
  augmentBaseById: Record<string, any> = {}
): any {
  const augmentId = augment?.id
  const augmentBase = mapAugmentWithBase(augmentId, augmentBaseById)
  const stats = mapPublicAugmentStats(augment)
  const winRate = toNullableNumber(stats.win_rate)
  const pickRate = toNullableNumber(stats.pick_rate)
  const games = toNullableNumber(stats.num_games)

  return {
    ...augmentBase,
    tier: stats.tier,
    rank: stats.rank,
    total: stats.total,
    winRate,
    pickRate,
    playCount: games,
    winCount: toNullableNumber(stats.num_win_games),
    win_rate: winRate,
    pick_rate: pickRate,
    num_games: games,
    num_win_games: toNullableNumber(stats.num_win_games),
    recommendScore: getLegacyAugmentRecommendScore(stats),
  }
}

function mapBuildSet(record: any): any {
  const stats = record?.stats || record || {}
  const ids = normalizeItemIds(record?.itemIds ?? record?.items ?? record?.itemId ?? record?.id)

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
  const itemId = normalizeItemIds(record?.itemIds ?? record?.items ?? record?.itemId ?? record?.id)[0]

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

function parseBuildRecommendationRecords(value: any): any[] {
  if (Array.isArray(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return []
  }

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function normalizePositiveIntegerIds(value: any): number[] {
  if (!Array.isArray(value)) {
    return []
  }

  const ids = value.map(Number)
  return ids.every((id) => Number.isInteger(id) && id > 0) ? ids : []
}

function mapBuildRecommendationStats(record: any): any {
  const stats = record?.stats || {}

  return {
    games: toNumber(record?.games ?? record?.num_games ?? stats.games ?? stats.num_games),
    wins: toNumber(record?.wins ?? record?.num_win_games ?? stats.wins ?? stats.num_win_games),
    pickRate: toNumber(
      record?.pickRate ?? record?.pick_rate ?? stats.pickRate ?? stats.pick_rate
    ),
    winRate: toNumber(
      record?.winRate ?? record?.win_rate ?? stats.winRate ?? stats.win_rate
    ),
  }
}

function mapSummonerSpellRecommendations(value: any): any[] {
  return parseBuildRecommendationRecords(value)
    .map((record) => {
      const summonerSpellIds = normalizePositiveIntegerIds(
        record?.summonerSpellIds ?? record?.spellIds
      )
      if (summonerSpellIds.length !== 2) {
        return null
      }

      return {
        ...record,
        summonerSpellIds,
        ...mapBuildRecommendationStats(record),
      }
    })
    .filter(Boolean)
    .sort((left, right) =>
      right.games - left.games || right.pickRate - left.pickRate
    )
}

function mapSkillOrderRecommendations(value: any): any[] {
  return parseBuildRecommendationRecords(value)
    .map((record) => {
      const skillOrder = normalizePositiveIntegerIds(
        record?.skillOrder ?? record?.order
      )
      if (
        skillOrder.length < 15
        || skillOrder.length > 18
        || skillOrder.some((skill) => skill > 4)
      ) {
        return null
      }

      return {
        ...record,
        skillOrder,
        ...mapBuildRecommendationStats(record),
      }
    })
    .filter(Boolean)
    .sort((left, right) =>
      right.games - left.games || right.pickRate - left.pickRate
    )
}

function mapPublicBuild(publicBuild: any, championId: string | number): any {
  if (!publicBuild) {
    return null
  }

  const coreItems = (publicBuild.coreItems || [])
    .filter((record: any) => hasItemSequence(record))
    .map((record: any) => mapBuildSet(record))
  const fullItems = (publicBuild.fullItems || [])
    .filter((record: any) => hasItemSequence(record))
    .map((record: any) => mapBuildSet(record))
  const startingItems = (publicBuild.startingItems || [])
    .filter((record: any) => hasItemSequence(record))
    .map((record: any) => mapBuildSet(record))
  const situationalItems = (publicBuild.situationalItems || [])
    .filter((record: any) =>
      hasItemSequence(record) || record?.itemId != null || record?.id != null
    )
    .map(mapSituationalItem)
  const itemExtensions = (publicBuild.itemExtensions || [])
    .filter((record: any) => hasItemSequence(record))
    .map((record: any) => mapBuildSet(record))
  const summonerSpells = mapSummonerSpellRecommendations(publicBuild.summonerSpells)
  const skillOrders = mapSkillOrderRecommendations(publicBuild.skillOrders)

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
    fullItems,
    recommended: coreItems,
    itemSequences: {},
    itemExtensions,
    situationalItems,
    startingItems,
    summonerSpells,
    skillOrders,
    games: toNumber(publicBuild.stats?.games),
    wins: toNumber(publicBuild.stats?.wins),
    pickRate: toNumber(publicBuild.stats?.pickRate),
    winRate: toNumber(publicBuild.stats?.winRate),
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

  const seen = new Set<string>()
  return candidates.filter((build) => {
    const coreKey = Array.isArray(build?.coreItems)
      ? build.coreItems
        .slice(0, 3)
        .map((record: any) => normalizeItemIds(record?.itemIds ?? record?.items).join('-'))
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

export function mapChampionBuilds(detail: any, championId: string | number): any {
  const builds = collectPublicBuildCandidates(detail)
    .map((build) => mapPublicBuild(build, championId))
    .filter(Boolean)

  if (!builds.length) {
    return null
  }

  return {
    ...builds[0],
    builds,
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

export async function loadChampionStats(
  championId: string | number,
  requestedLocale: SupportedDataLocale = activeDataLocale
): Promise<any> {
  const dataSet = await getActiveDataSet(normalizeDataLocale(requestedLocale))
  const championsPayload = await loadChampionsPayload(dataSet.locale)
  const champions = extractList(championsPayload, 'champions')
  const champion = findChampionInList(champions, championId)

  if (champion) {
    const stats = mapPublicChampionStats(champion, getPayloadMeta(championsPayload, dataSet.config))
    if (stats.championId) {
      return stats
    }
  }

  const detail = await loadChampionDetailPayload(championId, dataSet.locale)
  if (detail?.champion) {
    const stats = mapPublicChampionStats(detail.champion, getPayloadMeta(detail, dataSet.config))
    if (stats.championId) {
      return stats
    }
  }

  throw new Error(`Champion stats not found for ID: ${championId}`)
}

export async function loadChampionName(
  championId: string | number,
  requestedLocale: SupportedDataLocale = activeDataLocale
): Promise<any> {
  try {
    const locale = normalizeDataLocale(requestedLocale)
    const championsPayload = await loadChampionsPayload(locale)
    const champions = extractList(championsPayload, 'champions')
    const champion = findChampionInList(champions, championId)

    if (champion) {
      return mapPublicChampionName(champion)
    }

    const detail = await loadChampionDetailPayload(championId, locale)
    if (detail?.champion) {
      return mapPublicChampionName(detail.champion)
    }

    return { nameCN: `英雄 ${championId}`, nameEN: '', title: '', roles: [], iconUrl: null }
  } catch (error: any) {
    logger.warn(`Failed to load champion name for ${championId}:`, error.message)
    return { nameCN: `英雄 ${championId}`, nameEN: '', title: '', roles: [], iconUrl: null }
  }
}

export async function loadChampionLinks(
  championId: string | number,
  requestedLocale: SupportedDataLocale = activeDataLocale
): Promise<any> {
  try {
    const locale = normalizeDataLocale(requestedLocale)
    const championsPayload = await loadChampionsPayload(locale)
    const champions = extractList(championsPayload, 'champions')
    const champion = findChampionInList(champions, championId)
    const detail = await loadChampionDetailPayload(championId, locale)
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

export async function loadAugmentBase(locale: SupportedDataLocale = activeDataLocale): Promise<any[]> {
  const augmentsPayload = await loadAugmentsPayload(normalizeDataLocale(locale))
  return extractList(augmentsPayload, 'augments').map(mapPublicAugmentBase)
}

export async function loadAugmentBaseForLocale(locale: unknown): Promise<any[]> {
  return loadAugmentBase(normalizeDataLocale(locale))
}

async function loadCachedOcrAugmentLocaleData(
  requestedLocale: SupportedDataLocale
): Promise<OcrAugmentLocaleData | null> {
  const dataVersions: Array<{
    dataVersion: string
    source: 'cache' | 'bundled' | 'local-version'
  }> = []
  for (const candidate of await readCurrentDataPointerCandidates(requestedLocale)) {
    const current = candidate.pointer
    const dataVersion = String(current?.dataVersion || '')
    if (!dataVersion) {
      continue
    }

    const pointerLocale = getClientConfigLocale(current, requestedLocale)
    if (pointerLocale !== requestedLocale) {
      continue
    }

    if (!dataVersions.some((entry) => entry.dataVersion === dataVersion)) {
      dataVersions.push({
        dataVersion,
        source: candidate.source === 'bundled' ? 'bundled' : 'cache',
      })
    }
  }

  for (const dataVersion of await listLocalDataVersions(requestedLocale)) {
    if (!dataVersions.some((entry) => entry.dataVersion === dataVersion)) {
      dataVersions.push({ dataVersion, source: 'local-version' })
    }
  }

  for (const candidate of dataVersions) {
    const { dataVersion, source } = candidate
    const manifest = await readDataFileFromDisk(dataVersion, 'manifest.json', requestedLocale)
    const declaredManifestLocale = tryNormalizeDataLocale(manifest?.locale)
    if (
      !manifest ||
      (requestedLocale !== DEFAULT_DATA_LOCALE && declaredManifestLocale !== requestedLocale) ||
      (declaredManifestLocale && declaredManifestLocale !== requestedLocale)
    ) {
      continue
    }

    const payload = await readDataFileFromDisk(dataVersion, 'augments.json', requestedLocale)
    if (!payload) {
      continue
    }

    return {
      locale: requestedLocale,
      dataVersion,
      augments: extractList(payload, 'augments').map(mapPublicAugmentBase),
      source,
    }
  }

  return null
}

export async function loadAugmentBaseForOcrLocale(locale: unknown): Promise<OcrAugmentLocaleData> {
  const requestedLocale = normalizeDataLocale(locale)
  const cached = await loadCachedOcrAugmentLocaleData(requestedLocale)
  if (cached) {
    return cached
  }

  const config = await loadDataApiConfig({ locale: requestedLocale })
  const configLocale = getClientConfigLocale(config, DEFAULT_DATA_LOCALE)
  if (configLocale !== requestedLocale) {
    throw new Error(
      `OCR augment locale ${requestedLocale} is unavailable; config locale is ${configLocale}`
    )
  }

  const dataVersion = String(config.dataVersion || '')
  if (!dataVersion) {
    throw new Error(`OCR augment config for ${requestedLocale} is missing dataVersion`)
  }

  const manifestResult = await loadManifestForConfig(config, requestedLocale)
  if (manifestResult.locale !== requestedLocale) {
    throw new Error(
      `OCR augment locale ${requestedLocale} is unavailable; manifest locale is ${manifestResult.locale}`
    )
  }

  const payload = await fetchVersionedDataFile(
    dataVersion,
    'augments.json',
    findManifestPath(manifestResult.manifest, 'augments.json'),
    { locale: requestedLocale }
  )

  return {
    locale: requestedLocale,
    dataVersion,
    augments: extractList(payload, 'augments').map(mapPublicAugmentBase),
    source: 'remote',
  }
}

export async function loadAugmentDetail(locale: SupportedDataLocale = activeDataLocale): Promise<Record<string, any>> {
  const dataSet = await getActiveDataSet(normalizeDataLocale(locale))
  const cacheKey = `${dataSet.locale}:${dataSet.dataVersion}:augment-detail`
  const cached = augmentDetailCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const augments = await loadAugmentBase(dataSet.locale)
  const detail = augments.reduce((result: Record<string, any>, augment: any) => {
    result[String(augment.id)] = augment
    return result
  }, {})
  augmentDetailCache.set(cacheKey, detail)
  return detail
}

export async function loadChampionAugments(
  championId: string | number,
  requestedLocale: SupportedDataLocale = activeDataLocale
): Promise<Record<string, any>> {
  try {
    const detail = await loadChampionDetailPayload(championId, normalizeDataLocale(requestedLocale))

    if (Array.isArray(detail?.augments)) {
      const rankedStats = rankAugmentRecommendations(
        detail.augments
          .filter((augment: any) => augment?.id != null)
          .map((augment: any) => {
            const stats = mapPublicAugmentStats(augment)
            return {
              augmentId: augment.id,
              ...stats,
              recommendScore: getLegacyAugmentRecommendScore(stats),
            }
          })
      )

      return rankedStats.reduce((result: Record<string, any>, stats: any) => {
        result[String(stats.augmentId)] = stats
        return result
      }, {})
    }

    return {}
  } catch (error: any) {
    logger.warn(`Failed to load augments for champion ${championId}:`, error.message)
    return {}
  }
}

export async function loadChampionAugmentTrios(
  championId: string | number,
  requestedLocale: SupportedDataLocale = activeDataLocale
): Promise<any[]> {
  try {
    const locale = normalizeDataLocale(requestedLocale)
    const [detail, augmentBaseById] = await Promise.all([
      loadChampionDetailPayload(championId, locale),
      loadAugmentDetail(locale),
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

export async function loadChampionBuild(
  championId: string | number,
  requestedLocale: SupportedDataLocale = activeDataLocale
): Promise<any> {
  try {
    const detail = await loadChampionDetailPayload(championId, normalizeDataLocale(requestedLocale))
    return mapChampionBuilds(detail, championId)
  } catch (error: any) {
    logger.warn(`Failed to load build for champion ${championId}:`, error.message)
    return null
  }
}

export async function loadItems(
  requestedLocale: SupportedDataLocale = activeDataLocale
): Promise<any[]> {
  const itemsPayload = await loadItemsPayload(normalizeDataLocale(requestedLocale))
  return extractList(itemsPayload, 'items').map(mapPublicItem)
}

export async function loadChampionRoster(
  requestedLocale: SupportedDataLocale = activeDataLocale
): Promise<any[]> {
  const dataSet = await getActiveDataSet(normalizeDataLocale(requestedLocale))
  const championsPayload = await loadChampionsPayload(dataSet.locale)
  const meta = getPayloadMeta(championsPayload, dataSet.config)

  return extractList(championsPayload, 'champions')
    .map((champion) => mapPublicChampionStats(champion, meta))
    .filter((champion) => champion.championId && Number(champion.championId) > 0)
}

export async function getChampionDetailData(
  championId: string | number,
  requestedLocale: SupportedDataLocale = activeDataLocale
): Promise<any> {
  const locale = normalizeDataLocale(requestedLocale)
  const dataSet = await getActiveDataSet(locale)
  const [stats, augmentBase, augmentDetail, augments, augmentTrios, buildData, items, championName, championLinks] =
    await Promise.all([
      loadChampionStats(championId, dataSet.locale),
      loadAugmentBase(dataSet.locale),
      loadAugmentDetail(dataSet.locale),
      loadChampionAugments(championId, dataSet.locale),
      loadChampionAugmentTrios(championId, dataSet.locale),
      loadChampionBuild(championId, dataSet.locale),
      loadItems(dataSet.locale),
      loadChampionName(championId, dataSet.locale),
      loadChampionLinks(championId, dataSet.locale),
    ])

  return {
    locale: dataSet.locale,
    dataVersion: dataSet.dataVersion,
    stats: {
      ...stats,
      relatedBlogs: stats?.relatedBlogs?.length ? stats.relatedBlogs : championLinks?.relatedBlogs || [],
    },
    augmentBase,
    augmentDetail,
    augments,
    augmentTrios,
    builds: Array.isArray(buildData?.builds) ? buildData.builds : [],
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
  augmentId: string | number,
  requestedLocale: SupportedDataLocale = activeDataLocale
): Promise<any> {
  const augments = await loadChampionAugments(championId, normalizeDataLocale(requestedLocale))
  const augmentIdStr = String(augmentId)

  if (!augments[augmentIdStr]) {
    return null
  }

  const winrateData = augments[augmentIdStr]
  return {
    augmentId: parseInt(augmentIdStr, 10),
    tier: toNullableNumber(winrateData.tier),
    rank: toNullableNumber(winrateData.rank),
    total: toNullableNumber(winrateData.total),
    winRate: toNullableNumber(winrateData.win_rate),
    pickRate: toNullableNumber(winrateData.pick_rate),
    playCount: toNullableNumber(winrateData.num_games),
    winCount: toNullableNumber(winrateData.num_win_games),
    recommendScore: toNullableNumber(winrateData.recommendScore),
  }
}

export async function getChampionAugmentStats(
  championId: string | number,
  requestedLocale: SupportedDataLocale = activeDataLocale
): Promise<any[]> {
  const dataSet = await getActiveDataSet(normalizeDataLocale(requestedLocale))
  const normalizedChampionId = String(championId)
  const cacheKey = `${dataSet.locale}:${dataSet.dataVersion}:champion-augment-stats:${normalizedChampionId}`
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
      loadChampionDetailPayload(normalizedChampionId, dataSet.locale),
      loadAugmentDetail(dataSet.locale),
    ])
    const augments = Array.isArray(detail?.augments) ? detail.augments : []

    const result = rankAugmentRecommendations(
      augments
        .filter((augment: any) => augment?.id != null)
        .map((augment: any) => mapPublicAugmentRecommendation(augment, augmentBaseById))
    )

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
  activeDataSetPromises.clear()
  activeDataSetCaches.clear()
  activeDataSetRefreshPromises.clear()
  backgroundRefreshErrors.clear()
}
