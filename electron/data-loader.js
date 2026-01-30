import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Cache for loaded data
const cache = new Map()

/**
 * Get the data directory path
 * Works in both development and production (Electron app)
 */
function getDataPath(filename) {
  // In Electron main/preload context
  if (typeof process !== 'undefined' && process.resourcesPath) {
    const resourcePath = path.join(process.resourcesPath, 'data', filename)
    // Check if path exists
    if (fs.existsSync(resourcePath)) {
      return resourcePath
    }
  }

  // Development: use relative path from electron/ to electron/data
  return path.resolve(__dirname, 'data', filename)
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
    console.warn(`Failed to load augments for champion ${championId}:`, error.message)
    return {}
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
          itemSequences: row[9] ? JSON.parse(row[9]) : {}
        }

        return builds
      }
    }

    return null
  } catch (error) {
    console.warn(`Failed to load build for champion ${championId}:`, error.message)
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
 * Clear cache (useful for memory management in long-running apps)
 */
export function clearCache() {
  cache.clear()
}
