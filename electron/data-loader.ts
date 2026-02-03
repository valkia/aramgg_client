import fs from 'fs'
import path from 'path'
import { app } from 'electron'

/** 海克斯胜率数据 */
interface AugmentWinrateData {
  win_rate: string | number;
  pick_rate: string | number;
  num_games: string | number;
  num_win_games: string | number;
  [key: string]: any;
}

/** 海克斯统计数据（计算后） */
interface AugmentStats {
  augmentId: number;
  name: string;
  rarity: string;
  iconUrl: string | null;
  winRate: number;
  pickRate: number;
  playCount: number;
  winCount: number;
  recommendScore: number;
}

/** 英雄海克斯映射 */
interface ChampionAugments {
  [augmentId: string]: AugmentWinrateData;
}

/** 海克斯基础信息 */
interface AugmentBase {
  id: number;
  name: string;
  rarity: string;
  iconUrl?: string;
  [key: string]: any;
}

// Cache for loaded data
const cache = new Map<string, any>()

/**
 * Get the data directory path
 * Works in both development and production (Electron app)
 */
function getDataPath(filename: string): string {
  // In Electron production: use resourcesPath
  if (typeof process !== 'undefined' && (process as any).resourcesPath) {
    const resourcePath = path.join((process as any).resourcesPath, 'data', filename)
    if (fs.existsSync(resourcePath)) {
      return resourcePath
    }
  }

  // Development: get project root directory
  let appPath = app.getAppPath()

  // If appPath ends with 'electron', go up one level to get project root
  if (appPath.endsWith('electron')) {
    appPath = path.dirname(appPath)
  }

  return path.resolve(appPath, 'electron', 'data', filename)
}

/**
 * Load and cache JSON file
 */
function loadJsonFile<T = any>(filename: string): T {
  if (cache.has(filename)) {
    return cache.get(filename) as T
  }

  const filePath = getDataPath(filename)

  if (!fs.existsSync(filePath)) {
    throw new Error(`Data file not found: ${filePath}`)
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const data = JSON.parse(content) as T

  cache.set(filename, data)
  return data
}

/**
 * Load champion stats data
 * @param championId - Champion ID
 * @returns Champion stats object
 */
export function loadChampionStats(championId: string | number): any {
  const allStats = loadJsonFile('champions-stats.json')
  const stat = (allStats as any[]).find((s: any) => s.championId === String(championId))

  if (!stat) {
    throw new Error(`Champion stats not found for ID: ${championId}`)
  }

  return stat
}

/**
 * Load augment base data (list of all augments with names and rarity)
 * @returns Array of augment objects
 */
export function loadAugmentBase(): AugmentBase[] {
  return loadJsonFile<AugmentBase[]>('augments-base.json')
}

/**
 * Load augment details (descriptions, tags, etc.)
 * @returns Augment details object keyed by augment ID
 */
export function loadAugmentDetail(): Record<string, any> {
  return loadJsonFile('augment-detail.json')
}

/**
 * Load champion-specific augment stats
 * @param championId - Champion ID
 * @returns Augment stats for the champion
 */
export function loadChampionAugments(championId: string | number): ChampionAugments {
  const championIdStr = String(championId)
  const filename = `champion-augments/${championIdStr}.json`

  try {
    const allData = loadJsonFile<any[]>(filename)

    // Parse the data structure [[championId, JSON string]]
    if (Array.isArray(allData) && allData.length > 0) {
      const firstElement = allData[0]
      if (Array.isArray(firstElement) && firstElement.length >= 2) {
        const augmentDataStr = firstElement[1]
        const augmentData = JSON.parse(augmentDataStr)
        return augmentData.augments || {}
      }
    }

    return {}
  } catch (error) {
    console.warn(
      `Failed to load augments for champion ${championId}:`,
      error instanceof Error ? error.message : String(error)
    )
    return {}
  }
}

/**
 * Load champion build data
 * @param championId - Champion ID
 * @returns Build data for the champion
 */
export function loadChampionBuild(championId: string | number): any {
  const championIdStr = String(championId)
  const filename = `builds_aram/${championIdStr}.json`

  try {
    const buildData = loadJsonFile<any>(filename)

    // Extract the core build data from the result
    if (buildData.data && buildData.data.result && buildData.data.result.dataArray) {
      const rows = buildData.data.result.dataArray
      if (rows.length > 0) {
        // Parse the build row data
        const row = rows[0]
        const builds = {
          patch: row[0],
          championId: row[1],
          queue: row[2],
          role: row[3],
          matchup: row[4],
          metadata: row[6],
          tags: row[7] ? JSON.parse(row[7]) : {},
          recommended: row[8] ? JSON.parse(row[8]) : [],
          itemSequences: row[9] ? JSON.parse(row[9]) : {},
        }

        return builds
      }
    }

    return null
  } catch (error) {
    console.warn(
      `Failed to load build for champion ${championId}:`,
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}

/**
 * Load items data
 * @returns Items data keyed by item ID
 */
export function loadItems(): Record<string, any> {
  return loadJsonFile('items-i18n.json')
}

/**
 * Get all champion detail data at once
 * @param championId - Champion ID
 * @returns Complete data object with stats, augments, and builds
 */
export function getChampionDetailData(championId: string | number): any {
  return {
    stats: loadChampionStats(championId),
    augmentBase: loadAugmentBase(),
    augmentDetail: loadAugmentDetail(),
    augments: loadChampionAugments(championId),
    build: loadChampionBuild(championId),
    items: loadItems(),
  }
}

/**
 * 获取英雄的单个海克斯胜率数据
 * @param championId - 英雄ID
 * @param augmentId - 海克斯ID
 * @returns 海克斯胜率数据或null
 */
export function getAugmentWinrate(
  championId: string | number,
  augmentId: string | number
): Partial<AugmentStats> | null {
  const augments = loadChampionAugments(championId)
  const augmentIdStr = String(augmentId)

  if (!augments[augmentIdStr]) {
    return null
  }

  const winrateData = augments[augmentIdStr]
  return {
    augmentId: parseInt(augmentIdStr),
    winRate: parseFloat(String(winrateData.win_rate)) || 0,
    pickRate: parseFloat(String(winrateData.pick_rate)) || 0,
    playCount: parseInt(String(winrateData.num_games)) || 0,
    winCount: parseInt(String(winrateData.num_win_games)) || 0,
  }
}

/**
 * 获取英雄的所有海克斯胜率数据（已排序）
 * @param championId - 英雄ID
 * @returns 按胜率排序的海克斯数组
 */
export function getChampionAugmentStats(championId: string | number): AugmentStats[] {
  const championIdStr = String(championId)
  const augments = loadChampionAugments(championIdStr)
  const augmentBase = loadAugmentBase()

  // 组合胜率和基础信息
  const augmentStats: AugmentStats[] = Object.entries(augments)
    .map(([augmentId, data]) => {
      const baseInfo = augmentBase.find((a) => a.id === parseInt(augmentId))
      const winRate = parseFloat(String(data.win_rate)) || 0
      const pickRate = parseFloat(String(data.pick_rate)) || 0
      const numGames = parseInt(String(data.num_games)) || 0

      return {
        augmentId: parseInt(augmentId),
        name: baseInfo?.name || '未知',
        rarity: baseInfo?.rarity || 'unknown',
        iconUrl: baseInfo?.iconUrl || null,
        winRate,
        pickRate,
        playCount: numGames,
        winCount: parseInt(String(data.num_win_games)) || 0,
        // 推荐指数 = 胜率 * 0.6 + 选择率 * 0.2 + min(场次/1000, 1) * 0.2
        recommendScore: winRate * 0.6 + pickRate * 0.2 + Math.min(numGames / 1000, 1) * 0.2,
      }
    })
    .sort((a, b) => b.recommendScore - a.recommendScore)

  return augmentStats
}

/**
 * 按稀有度筛选海克斯
 * @param augmentStats - 海克斯统计数组
 * @param rarity - 稀有度过滤（'gold'|'purple'|'blue'|null）
 * @returns 筛选后的数组
 */
export function filterAugmentsByRarity(
  augmentStats: AugmentStats[],
  rarity: string | null
): AugmentStats[] {
  if (!rarity || rarity === 'all') {
    return augmentStats
  }

  return augmentStats.filter((a) => a.rarity === rarity)
}

/**
 * Clear cache (useful for memory management in long-running apps)
 */
export function clearCache(): void {
  cache.clear()
}
