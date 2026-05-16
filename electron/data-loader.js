import logger from './modules/logger.js';
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

// Cache for loaded data
const cache = new Map()

/**
 * Get the data directory path
 * Works in both development and production (Electron app)
 */
function getDataPath(filename) {
  // In Electron production: use resourcesPath
  if (typeof process !== 'undefined' && process.resourcesPath) {
    const resourcePath = path.join(process.resourcesPath, 'data', filename)
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
function loadJsonFile(filename) {
  if (cache.has(filename)) {
    return cache.get(filename)
  }

  const filePath = getDataPath(filename)

  if (!fs.existsSync(filePath)) {
    throw new Error(`Data file not found: ${filePath}`)
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const data = JSON.parse(content)

  cache.set(filename, data)
  return data
}

/**
 * Load champion stats data
 * @param {string|number} championId - Champion ID
 * @returns {Object} Champion stats object
 */
export function loadChampionStats(championId) {
  const allStats = loadJsonFile('champions-stats.json')
  const stat = allStats.find(s => s.championId === String(championId))

  if (!stat) {
    throw new Error(`Champion stats not found for ID: ${championId}`)
  }

  return stat
}

/**
 * Load champion name by ID
 * @param {string|number} championId - Champion ID
 * @returns {Object} Champion name object with nameCN, nameEN, title
 */
export function loadChampionName(championId) {
  const names = loadJsonFile('champions-names-cn.json')
  const champion = names[String(championId)]

  if (!champion) {
    return { nameCN: `英雄 ${championId}`, nameEN: '', title: '' }
  }

  return champion
}

/**
 * Load augment base data (list of all augments with names and rarity)
 * @returns {Array} Array of augment objects
 */
export function loadAugmentBase() {
  return loadJsonFile('augments-base.json')
}

/**
 * Load augment details (descriptions, tags, etc.)
 * @returns {Object} Augment details object keyed by augment ID
 */
export function loadAugmentDetail() {
  return loadJsonFile('augment-detail.json')
}

/**
 * Load champion-specific augment stats
 * @param {string|number} championId - Champion ID
 * @returns {Object} Augment stats for the champion
 */
export function loadChampionAugments(championId) {
  const championIdStr = String(championId)
  const filename = `champion-augments/${championIdStr}.json`

  try {
    const allData = loadJsonFile(filename)

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
    logger.warn(`Failed to load augments for champion ${championId}:`, error.message)
    return {}
  }
}

/**
 * 解析单行出装数据
 * @param {Array} row - 数据行
 * @returns {Object} 解析后的出装数据
 */
function parseBuildRow(row) {
  return {
    patch: row[0],
    championId: row[1],
    buildTags: row[7] ? (JSON.parse(row[7])?.primary_tags_f3pie || '') : '',
    coreItems: row[8] ? JSON.parse(row[8]) : [],
    situationalItems: row[10] ? JSON.parse(row[10]) : [],
    startingItems: row[11] ? JSON.parse(row[11]) : [],
    games: parseInt(row[12]) || 0,
    wins: parseInt(row[13]) || 0,
    pickRate: parseFloat(row[14]) || 0,
    winRate: parseFloat(row[15]) || 0,
  }
}

/**
 * Load champion build data
 * @param {string|number} championId - Champion ID
 * @returns {Object} Build data for the champion
 */
export function loadChampionBuild(championId) {
  const championIdStr = String(championId)
  const filename = `builds_aram/${championIdStr}.json`

  try {
    const buildData = loadJsonFile(filename)

    if (buildData.data && buildData.data.result && buildData.data.result.dataArray) {
      const rows = buildData.data.result.dataArray
      if (rows.length > 0) {
        // 解析所有出装方案，按场次降序排列
        const builds = rows.map(parseBuildRow)
          .sort((a, b) => b.games - a.games)

        // 兼容旧字段：保留 recommended 指向第一套出装的核心装备
        return {
          ...builds[0],
          recommended: builds[0].coreItems,
          allBuilds: builds,
        }
      }
    }

    return null
  } catch (error) {
    logger.warn(`Failed to load build for champion ${championId}:`, error.message)
    return null
  }
}

/**
 * Load items data
 * @returns {Object} Items data keyed by item ID
 */
export function loadItems() {
  return loadJsonFile('items-i18n.json')
}

/**
 * Get all champion detail data at once
 * @param {string|number} championId - Champion ID
 * @returns {Object} Complete data object with stats, augments, and builds
 */
export function getChampionDetailData(championId) {
  return {
    stats: loadChampionStats(championId),
    augmentBase: loadAugmentBase(),
    augmentDetail: loadAugmentDetail(),
    augments: loadChampionAugments(championId),
    build: loadChampionBuild(championId),
    items: loadItems()
  }
}

/**
 * 获取英雄的单个海克斯胜率数据
 * @param {string|number} championId - 英雄ID
 * @param {string|number} augmentId - 海克斯ID
 * @returns {Object|null} 海克斯胜率数据或null
 */
export function getAugmentWinrate(championId, augmentId) {
  const augments = loadChampionAugments(championId)
  const augmentIdStr = String(augmentId)

  if (!augments[augmentIdStr]) {
    return null
  }

  const winrateData = augments[augmentIdStr]
  return {
    augmentId: augmentIdStr,
    winRate: parseFloat(winrateData.win_rate) || 0,
    pickRate: parseFloat(winrateData.pick_rate) || 0,
    playCount: parseInt(winrateData.num_games) || 0,
    winCount: parseInt(winrateData.num_win_games) || 0
  }
}

/**
 * 获取英雄的所有海克斯胜率数据（已排序）
 * @param {string|number} championId - 英雄ID
 * @returns {Array} 按胜率排序的海克斯数组
 */
export function getChampionAugmentStats(championId) {
  const championIdStr = String(championId)
  const augments = loadChampionAugments(championIdStr)
  const augmentBase = loadAugmentBase()

  // 组合胜率和基础信息
  const augmentStats = Object.entries(augments)
    .map(([augmentId, data]) => {
      const baseInfo = augmentBase.find(a => a.id === parseInt(augmentId))

      return {
        augmentId: parseInt(augmentId),
        name: baseInfo?.name || '未知',
        rarity: baseInfo?.rarity || 'unknown',
        iconUrl: baseInfo?.iconUrl || null,
        winRate: parseFloat(data.win_rate) || 0,
        pickRate: parseFloat(data.pick_rate) || 0,
        playCount: parseInt(data.num_games) || 0,
        winCount: parseInt(data.num_win_games) || 0,
        // 推荐指数 = 胜率 * 0.6 + 选择率 * 0.2 + min(场次/1000, 1) * 0.2
        recommendScore:
          parseFloat(data.win_rate) * 0.6 +
          parseFloat(data.pick_rate) * 0.2 +
          Math.min(parseInt(data.num_games) / 1000, 1) * 0.2
      }
    })
    .sort((a, b) => b.recommendScore - a.recommendScore)

  return augmentStats
}

/**
 * 按稀有度筛选海克斯
 * @param {Array} augmentStats - 海克斯统计数组
 * @param {string|null} rarity - 稀有度过滤（'gold'|'purple'|'blue'|null）
 * @returns {Array} 筛选后的数组
 */
export function filterAugmentsByRarity(augmentStats, rarity) {
  if (!rarity || rarity === 'all') {
    return augmentStats
  }

  return augmentStats.filter(a => a.rarity === rarity)
}

/**
 * Clear cache (useful for memory management in long-running apps)
 */
export function clearCache() {
  cache.clear()
}
