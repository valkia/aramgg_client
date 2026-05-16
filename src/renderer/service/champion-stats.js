import log from '@/native/logger.js'
import { electronAPI } from '@/native/electron-api.js'

const cache = new Map()

async function loadChampionData(championId) {
  if (cache.has(championId)) {
    return cache.get(championId)
  }

  const result = await electronAPI.winrate.loadChampionData(championId)
  if (!result.success) {
    throw new Error(result.error || `Champion data load failed for ID: ${championId}`)
  }

  cache.set(championId, result.data)
  return result.data
}

export async function loadChampionStats(championId) {
  return (await loadChampionData(championId)).stats
}

export async function loadAugmentBase(championId) {
  return (await loadChampionData(championId)).augments
}

export async function loadAugmentDetail() {
  log.warn('loadAugmentDetail is not exposed in the renderer; use main-process data APIs instead.')
  return {}
}

export async function loadChampionAugments(championId) {
  return (await loadChampionData(championId)).augmentStats
}

export async function loadChampionBuild(championId) {
  return (await loadChampionData(championId)).build
}

export async function loadItems(championId) {
  return (await loadChampionData(championId)).items
}

export async function getChampionDetailData(championId) {
  return loadChampionData(championId)
}

export function clearCache() {
  cache.clear()
}
