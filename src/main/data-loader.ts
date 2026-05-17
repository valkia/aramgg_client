import logger from './modules/logger.js'

declare const fetch: any

export const DATA_API_ORIGIN =
  process.env.ARAMGG_DATA_API_ORIGIN || 'https://aramgg-data-api.djlinguge.workers.dev'
export const DATA_API_PREFIX = '/v1/zh-CN'

const CACHE_TTL_MS = 10 * 60 * 1000
const cache = new Map<string, { data: any; createdAt: number }>()
const pendingRequests = new Map<string, Promise<any>>()
let electronFetch: any = null

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

  const path = resourcePath.startsWith('/') ? resourcePath : `${DATA_API_PREFIX}/${resourcePath}`
  return new URL(path, DATA_API_ORIGIN).toString()
}

async function fetchJson(resourcePath: string): Promise<any> {
  const url = getApiUrl(resourcePath)
  const cached = cache.get(url)
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.data
  }

  const pending = pendingRequests.get(url)
  if (pending) {
    return pending
  }

  const transportFetch = await getTransportFetch()
  const request = transportFetch(url, {
    headers: {
      accept: 'application/json',
    },
  })
    .then(async (response: any) => {
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

function unwrapEnvelope(payload: any): any {
  return payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload
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

  if (typeof itemIds === 'string') {
    return itemIds.split(',').map((id) => id.trim()).filter(Boolean)
  }

  return []
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

function mapPublicChampionName(champion: any): any {
  return {
    id: champion?.id,
    title: champion?.title || '',
    nameCN: champion?.name || `英雄 ${champion?.id || ''}`,
    nameEN: champion?.alias || '',
    roles: champion?.roles || [],
    iconUrl: champion?.iconUrl || null,
  }
}

function mapPublicAugmentStats(augment: any): any {
  const stats = augment?.stats || {}

  return {
    tier: toNullableNumber(stats.tier),
    num_win_games: toNumber(stats.wins),
    win_rate: toNumber(stats.winRate),
    num_games: toNumber(stats.games),
    pick_rate: toNumber(stats.pickRate),
    gamePatch: stats.gamePatch || null,
    date: stats.date || null,
  }
}

function mapPublicAugmentRecommendation(augment: any): any {
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

function mapBuildSet(record: any, itemIdsAsString = false): any {
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

function mapPublicBuild(publicBuild: any, championId: string | number): any {
  if (!publicBuild) {
    return null
  }

  const coreItems = (publicBuild.coreItems || []).map((record: any) => mapBuildSet(record, true))
  const startingItems = (publicBuild.startingItems || []).map((record: any) => mapBuildSet(record))
  const situationalItems = (publicBuild.situationalItems || []).map((item: any) => ({
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

async function loadPublicChampionDetail(championId: string | number): Promise<any> {
  const payload = await fetchJson(`${DATA_API_PREFIX}/champions/${championId}.json`)
  return {
    meta: payload.meta || {},
    data: unwrapEnvelope(payload),
  }
}

export async function loadDataApiConfig(): Promise<any> {
  return fetchJson(`${DATA_API_PREFIX}/config.json`)
}

export async function loadChampionStats(championId: string | number): Promise<any> {
  const { meta, data } = await loadPublicChampionDetail(championId)
  const stats = mapPublicChampionStats(data.champion, meta)

  if (!stats.championId) {
    throw new Error(`Champion stats not found for ID: ${championId}`)
  }

  return stats
}

export async function loadChampionName(championId: string | number): Promise<any> {
  try {
    const { data } = await loadPublicChampionDetail(championId)
    return mapPublicChampionName(data.champion)
  } catch (error: any) {
    logger.warn(`Failed to load champion name for ${championId}:`, error.message)
    return { nameCN: `英雄 ${championId}`, nameEN: '', title: '', roles: [], iconUrl: null }
  }
}

export async function loadAugmentBase(): Promise<any[]> {
  const payload = await fetchJson(`${DATA_API_PREFIX}/augments.json`)
  return unwrapEnvelope(payload).map(mapPublicAugmentBase)
}

export async function loadAugmentDetail(): Promise<Record<string, any>> {
  const augments = await loadAugmentBase()
  return augments.reduce((result: Record<string, any>, augment: any) => {
    result[String(augment.id)] = augment
    return result
  }, {})
}

export async function loadChampionAugments(championId: string | number): Promise<Record<string, any>> {
  try {
    const { data } = await loadPublicChampionDetail(championId)
    return (data.augments || []).reduce((result: Record<string, any>, augment: any) => {
      result[String(augment.id)] = mapPublicAugmentStats(augment)
      return result
    }, {})
  } catch (error: any) {
    logger.warn(`Failed to load augments for champion ${championId}:`, error.message)
    return {}
  }
}

export async function loadChampionBuild(championId: string | number): Promise<any> {
  try {
    const { data } = await loadPublicChampionDetail(championId)
    return mapPublicBuild(data.build, championId)
  } catch (error: any) {
    logger.warn(`Failed to load build for champion ${championId}:`, error.message)
    return null
  }
}

export async function loadItems(): Promise<any[]> {
  const payload = await fetchJson(`${DATA_API_PREFIX}/items.json`)
  return unwrapEnvelope(payload).map(mapPublicItem)
}

export async function getChampionDetailData(championId: string | number): Promise<any> {
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
  const { data } = await loadPublicChampionDetail(championId)

  return (data.augments || [])
    .map(mapPublicAugmentRecommendation)
    .sort((a: any, b: any) => b.recommendScore - a.recommendScore)
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
}
