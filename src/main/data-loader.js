import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import logger from './modules/logger.js'

export const DATA_API_ORIGIN =
  process.env.ARAMGG_DATA_API_ORIGIN || 'https://aramgg-data-api.djlinguge.workers.dev'
export const DATA_API_PREFIX = '/v1/zh-CN'

const CACHE_TTL_MS = 10 * 60 * 1000
const DISK_CACHE_DIR_NAME = 'remote-data-cache'
const DISK_CACHE_SCHEMA_VERSION = 1
const cache = new Map()
const pendingRequests = new Map()
const versionedRequests = new Map()
let electronFetch = null
let diskCacheDirPromise = null

const rarityMap = {
  0: 'kSilver',
  1: 'kGold',
  2: 'kPrismatic',
  silver: 'kSilver',
  gold: 'kGold',
  prismatic: 'kPrismatic',
}

function getApiUrl(resourcePath) {
  if (/^https?:\/\//i.test(resourcePath)) {
    return resourcePath
  }

  const path = resourcePath.startsWith('/') ? resourcePath : `${DATA_API_PREFIX}/${resourcePath}`
  return new URL(path, DATA_API_ORIGIN).toString()
}

async function fetchJson(resourcePath, options = {}) {
  const url = getApiUrl(resourcePath)
  const force = options.force === true
  const cached = cache.get(url)
  if (!force && cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.data
  }

  if (pendingRequests.has(url)) {
    return pendingRequests.get(url)
  }

  const transportFetch = await getTransportFetch()
  const request = transportFetch(url, {
    headers: {
      accept: 'application/json',
    },
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Remote data request failed: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      cache.set(url, { data, createdAt: Date.now() })
      return data
    })
    .finally(() => {
      pendingRequests.delete(url)
    })

  pendingRequests.set(url, request)
  return request
}

function sanitizeCacheKey(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_')
}

async function resolveDiskCacheDir() {
  let basePath = null

  if (process.versions?.electron) {
    try {
      const { app } = await import('electron')
      basePath = app.isReady() ? app.getPath('userData') : app.getPath('temp')
    } catch (error) {
      logger.warn('Failed to resolve Electron cache path:', error.message)
    }
  }

  const cacheDir = path.join(basePath || path.join(os.tmpdir(), 'aramgg_client'), DISK_CACHE_DIR_NAME)
  await mkdir(cacheDir, { recursive: true })
  return cacheDir
}

async function getDiskCacheDir() {
  if (!diskCacheDirPromise) {
    diskCacheDirPromise = resolveDiskCacheDir()
  }

  return diskCacheDirPromise
}

async function readVersionedCache(cacheKey) {
  const cacheDir = await getDiskCacheDir()
  const filePath = path.join(cacheDir, `${sanitizeCacheKey(cacheKey)}.json`)

  try {
    const content = await readFile(filePath, 'utf8')
    const entry = JSON.parse(content)

    if (!entry || typeof entry !== 'object' || !entry.payload) {
      return null
    }

    return entry
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn(`Failed to read data cache ${cacheKey}:`, error.message)
    }

    return null
  }
}

async function writeVersionedCache(cacheKey, entry) {
  const cacheDir = await getDiskCacheDir()
  const filePath = path.join(cacheDir, `${sanitizeCacheKey(cacheKey)}.json`)
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`

  await writeFile(tempPath, JSON.stringify(entry), 'utf8')
  await rename(tempPath, filePath)
}

function getPayloadDataVersion(payload, fallbackVersion = '') {
  return payload?.meta?.dataVersion || payload?.dataVersion || fallbackVersion || ''
}

async function loadVersionedJson(resourcePath, cacheKey, label) {
  const requestKey = `${cacheKey}:${resourcePath}`
  const pending = versionedRequests.get(requestKey)
  if (pending) {
    return pending
  }

  const request = (async () => {
    const cachedEntry = await readVersionedCache(cacheKey)
    let latestDataVersion = ''

    try {
      const config = await loadDataApiConfig({ force: true })
      latestDataVersion = config?.dataVersion || ''
    } catch (error) {
      if (cachedEntry?.payload) {
        logger.warn(`Failed to check ${label} data version; using cached data:`, error.message)
        return cachedEntry.payload
      }

      logger.warn(`Failed to check ${label} data version; fetching remote data directly:`, error.message)
    }

    if (
      cachedEntry?.payload &&
      latestDataVersion &&
      cachedEntry.dataVersion === latestDataVersion
    ) {
      return cachedEntry.payload
    }

    try {
      const payload = await fetchJson(resourcePath, { force: true })
      const dataVersion = getPayloadDataVersion(payload, latestDataVersion)

      await writeVersionedCache(cacheKey, {
        schemaVersion: DISK_CACHE_SCHEMA_VERSION,
        dataVersion,
        savedAt: new Date().toISOString(),
        resourcePath,
        payload,
      })

      return payload
    } catch (error) {
      if (cachedEntry?.payload) {
        logger.warn(
          `Failed to refresh ${label}; using cached data version ${cachedEntry.dataVersion || 'unknown'}:`,
          error.message
        )
        return cachedEntry.payload
      }

      throw error
    }
  })().finally(() => {
    versionedRequests.delete(requestKey)
  })

  versionedRequests.set(requestKey, request)
  return request
}

async function getTransportFetch() {
  if (process.versions?.electron) {
    if (!electronFetch) {
      const { net } = await import('electron')
      electronFetch = net.fetch.bind(net)
    }

    return electronFetch
  }

  return fetch
}

function unwrapEnvelope(payload) {
  return payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload
}

function toNumber(value, fallback = 0) {
  if (value == null || value === '') {
    return fallback
  }

  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

function toNullableNumber(value) {
  if (value == null || value === '') {
    return null
  }

  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function normalizeRarity(augment) {
  const byName = rarityMap[String(augment?.rarityName || '').toLowerCase()]
  if (byName) {
    return byName
  }

  const byValue = rarityMap[Number(augment?.rarity)]
  return byValue || 'unknown'
}

function normalizeItemIds(itemIds) {
  if (Array.isArray(itemIds)) {
    return itemIds.map((id) => String(id).trim()).filter(Boolean)
  }

  if (typeof itemIds === 'string') {
    return itemIds.split(',').map((id) => id.trim()).filter(Boolean)
  }

  return []
}

function mapPublicAugmentBase(augment) {
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

function mapPublicChampionStats(champion, meta = {}) {
  const stats = champion?.stats || {}

  return {
    championId: String(champion?.id),
    id: champion?.id,
    alias: champion?.alias || '',
    nameCN: champion?.name || '',
    nameEN: champion?.alias || '',
    title: champion?.title || '',
    roles: champion?.roles || [],
    iconUrl: champion?.iconUrl || null,
    tier: toNullableNumber(stats.tier),
    winRate: toNumber(stats.winRate),
    numWinGames: toNumber(stats.wins),
    numGames: toNumber(stats.games),
    pickRate: toNumber(stats.pickRate),
    version: stats.gamePatch || meta.gamePatch || '',
    date: stats.date || meta.publishedAt || meta.generatedAt || '',
  }
}

function mapPublicChampionName(champion) {
  return {
    id: champion?.id,
    title: champion?.title || '',
    nameCN: champion?.name || `英雄 ${champion?.id || ''}`,
    nameEN: champion?.alias || '',
    roles: champion?.roles || [],
    iconUrl: champion?.iconUrl || null,
  }
}

function mapPublicAugmentStats(augment) {
  const stats = augment?.stats || {}
  const games = toNumber(stats.games)
  const wins = toNumber(stats.wins)
  const winRate = toNumber(stats.winRate)
  const pickRate = toNumber(stats.pickRate)
  const tier = toNullableNumber(stats.tier)

  return {
    tier,
    num_win_games: wins,
    win_rate: winRate,
    num_games: games,
    pick_rate: pickRate,
    gamePatch: stats.gamePatch || null,
    date: stats.date || null,
  }
}

function mapPublicAugmentRecommendation(augment) {
  const stats = mapPublicAugmentStats(augment)
  const winRate = toNumber(stats.win_rate)
  const pickRate = toNumber(stats.pick_rate)
  const games = toNumber(stats.num_games)

  return {
    augmentId: augment.id,
    id: augment.id,
    name: augment.name || '未知',
    rarity: normalizeRarity(augment),
    rarityName: augment.rarityName || null,
    iconPath: augment.iconUrl || null,
    iconUrl: augment.iconUrl || null,
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

function mapBuildSet(record, { itemIdsAsString = false } = {}) {
  const ids = normalizeItemIds(record?.itemIds)

  return {
    ...record,
    itemIds: itemIdsAsString ? ids.join(',') : ids,
    items: ids,
    games: toNumber(record?.games),
    wins: toNumber(record?.wins),
    pick_rate: toNumber(record?.pickRate),
    pickRate: toNumber(record?.pickRate),
    winRate: toNumber(record?.winRate),
  }
}

function mapPublicBuild(publicBuild, championId) {
  if (!publicBuild) {
    return null
  }

  const coreItems = (publicBuild.coreItems || []).map((record) =>
    mapBuildSet(record, { itemIdsAsString: true })
  )
  const startingItems = (publicBuild.startingItems || []).map((record) => mapBuildSet(record))
  const situationalItems = (publicBuild.situationalItems || []).map((item) => ({
    ...item,
    itemId: String(item.id),
    games: toNumber(item.games),
    wins: toNumber(item.wins),
    pick_rate: toNumber(item.pickRate),
    pickRate: toNumber(item.pickRate),
    winRate: toNumber(item.winRate),
    distinctive_score: toNumber(item.averageIndex, toNumber(item.pickRate)),
  }))

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

function mapPublicItem(item) {
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

async function loadPublicChampionDetail(championId) {
  const normalizedChampionId = sanitizeCacheKey(championId)
  const resourcePath = `${DATA_API_PREFIX}/champions/${championId}.json`
  const payload = await loadVersionedJson(
    resourcePath,
    `champion-detail-${normalizedChampionId}`,
    `champion ${championId}`
  )

  return {
    meta: payload.meta || {},
    data: unwrapEnvelope(payload),
  }
}

export async function loadDataApiConfig(options = {}) {
  return fetchJson(`${DATA_API_PREFIX}/config.json`, options)
}

export async function loadChampionStats(championId) {
  const { meta, data } = await loadPublicChampionDetail(championId)
  const stats = mapPublicChampionStats(data.champion, meta)

  if (!stats.championId) {
    throw new Error(`Champion stats not found for ID: ${championId}`)
  }

  return stats
}

export async function loadChampionName(championId) {
  try {
    const { data } = await loadPublicChampionDetail(championId)
    return mapPublicChampionName(data.champion)
  } catch (error) {
    logger.warn(`Failed to load champion name for ${championId}:`, error.message)
    return { nameCN: `英雄 ${championId}`, nameEN: '', title: '', roles: [], iconUrl: null }
  }
}

export async function loadAugmentBase() {
  const payload = await loadVersionedJson(
    `${DATA_API_PREFIX}/augments.json`,
    'augments',
    'augment base'
  )
  return unwrapEnvelope(payload).map(mapPublicAugmentBase)
}

export async function loadAugmentDetail() {
  const augments = await loadAugmentBase()
  return augments.reduce((result, augment) => {
    result[String(augment.id)] = augment
    return result
  }, {})
}

export async function loadChampionAugments(championId) {
  try {
    const { data } = await loadPublicChampionDetail(championId)
    return (data.augments || []).reduce((result, augment) => {
      result[String(augment.id)] = mapPublicAugmentStats(augment)
      return result
    }, {})
  } catch (error) {
    logger.warn(`Failed to load augments for champion ${championId}:`, error.message)
    return {}
  }
}

export async function loadChampionBuild(championId) {
  try {
    const { data } = await loadPublicChampionDetail(championId)
    return mapPublicBuild(data.build, championId)
  } catch (error) {
    logger.warn(`Failed to load build for champion ${championId}:`, error.message)
    return null
  }
}

export async function loadItems() {
  const payload = await loadVersionedJson(`${DATA_API_PREFIX}/items.json`, 'items', 'items')
  return unwrapEnvelope(payload).map(mapPublicItem)
}

export async function getChampionDetailData(championId) {
  const [stats, augmentBase, augmentDetail, augments, build, items, championName] =
    await Promise.all([
      loadChampionStats(championId),
      loadAugmentBase(),
      loadAugmentDetail(),
      loadChampionAugments(championId),
      loadChampionBuild(championId),
      loadItems(),
      loadChampionName(championId),
    ])

  return {
    stats,
    augmentBase,
    augmentDetail,
    augments,
    build,
    items,
    championName,
  }
}

export async function getAugmentWinrate(championId, augmentId) {
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

export async function getChampionAugmentStats(championId) {
  const { data } = await loadPublicChampionDetail(championId)

  return (data.augments || [])
    .map(mapPublicAugmentRecommendation)
    .sort((a, b) => b.recommendScore - a.recommendScore)
}

export function filterAugmentsByRarity(augmentStats, rarity) {
  if (!rarity || rarity === 'all') {
    return augmentStats
  }

  return augmentStats.filter((augment) => augment.rarity === rarity)
}

export function clearCache() {
  cache.clear()
  pendingRequests.clear()
  versionedRequests.clear()
}
