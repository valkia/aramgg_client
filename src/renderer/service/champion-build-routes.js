export const toFiniteNumber = (value, fallback = 0) => {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

export const normalizeRateValue = (value) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null
  }

  return numberValue > 1 ? numberValue / 100 : numberValue
}

export const normalizeItemIds = (itemIds) => {
  if (Array.isArray(itemIds)) {
    return itemIds.map(id => String(id).trim()).filter(Boolean)
  }

  if (itemIds != null && itemIds !== '') {
    return [String(itemIds).trim()].filter(Boolean)
  }

  return []
}

export const getRecordItemIds = (record = {}) => normalizeItemIds(
  record.itemIds ?? record.items ?? record.itemId ?? record.id
)

export const normalizeBuildRecord = (record = {}) => {
  const stats = record.stats || {}
  const items = getRecordItemIds(record)
  const games = toFiniteNumber(record.games ?? record.num_games ?? stats.games ?? stats.num_games)
  const wins = toFiniteNumber(record.wins ?? record.num_win_games ?? stats.wins ?? stats.num_win_games)
  const winRate = normalizeRateValue(record.winRate ?? record.win_rate ?? stats.winRate ?? stats.win_rate)
    ?? (games > 0 ? wins / games : null)

  return {
    ...record,
    items,
    itemIds: items,
    itemId: items[0] || '',
    games,
    wins,
    pickRate: normalizeRateValue(record.pickRate ?? record.pick_rate ?? stats.pickRate ?? stats.pick_rate) ?? 0,
    winRate,
    distinctiveScore: toFiniteNumber(
      record.distinctiveScore ?? record.distinctive_score ?? record.averageIndex
    ),
  }
}

export const compareBuildRecords = (left, right) => {
  const gamesDiff = toFiniteNumber(right.games) - toFiniteNumber(left.games)
  if (gamesDiff !== 0) {
    return gamesDiff
  }

  const pickDiff = toFiniteNumber(right.pickRate) - toFiniteNumber(left.pickRate)
  if (pickDiff !== 0) {
    return pickDiff
  }

  return toFiniteNumber(right.winRate) - toFiniteNumber(left.winRate)
}

export const compareSituationalRecords = (left, right) => {
  const scoreDiff = toFiniteNumber(right.distinctiveScore) - toFiniteNumber(left.distinctiveScore)
  return scoreDiff !== 0 ? scoreDiff : compareBuildRecords(left, right)
}

export const normalizeBuildRecords = (records = []) => {
  if (!Array.isArray(records)) {
    return []
  }

  return records
    .map(normalizeBuildRecord)
    .filter(record => record.items.length > 0)
    .sort(compareBuildRecords)
}

export const normalizeSingleItemRecords = (
  records = [],
  compareRecords = compareBuildRecords
) => {
  if (!Array.isArray(records)) {
    return []
  }

  const seen = new Set()
  return records
    .flatMap(record => {
      const normalized = normalizeBuildRecord(record)
      return normalized.items.map(itemId => ({
        ...normalized,
        itemId,
        itemIds: [itemId],
        items: [itemId],
      }))
    })
    .filter(record => record.itemId)
    .sort(compareRecords)
    .filter(record => {
      if (seen.has(record.itemId)) {
        return false
      }

      seen.add(record.itemId)
      return true
    })
}

export const getBuildTags = (build = {}) => {
  const rawTagValues = build.tags && typeof build.tags === 'object'
    ? Object.values(build.tags)
    : []
  const values = [
    build.buildTags,
    ...rawTagValues,
  ]
  const seen = new Set()

  return values
    .flatMap(value => String(value || '').split(','))
    .map(value => value.trim())
    .filter(value => {
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

export const getBuildTitle = (build, index) => {
  const tags = getBuildTags(build)
  if (tags.length) {
    return tags.join(' / ')
  }

  return build?.tier || build?.role || `路线 ${index + 1}`
}

export const collectBuildRoutes = (build) => {
  if (!build || (typeof build !== 'object' && !Array.isArray(build))) {
    return []
  }

  const builds = Array.isArray(build)
    ? build
    : Array.isArray(build.builds)
      ? build.builds
      : []
  const seen = new Set()

  return builds
    .filter(route => route && typeof route === 'object' && !Array.isArray(route))
    .filter((route) => {
      const coreKey = Array.isArray(route.coreItems)
        ? route.coreItems
          .slice(0, 3)
          .map(record => getRecordItemIds(record).join('-'))
          .join('|')
        : ''
      const key = `${getBuildTags(route).join('|')}:${coreKey}:${route.role || ''}:${route.tier || ''}`
      if (seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    })
}

export const getBuildStats = (build = {}) => {
  const stats = build.stats || {}
  return {
    games: toFiniteNumber(build.games ?? stats.games ?? stats.num_games),
    winRate: normalizeRateValue(build.winRate ?? build.win_rate ?? stats.winRate ?? stats.win_rate),
    pickRate: normalizeRateValue(build.pickRate ?? build.pick_rate ?? stats.pickRate ?? stats.pick_rate),
  }
}

const parseRecommendationRecords = (value) => {
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

const normalizePositiveIntegerIds = (value) => {
  if (!Array.isArray(value)) {
    return []
  }

  const ids = value.map(Number)
  return ids.every(id => Number.isInteger(id) && id > 0) ? ids : []
}

const normalizeRecommendationStats = (record = {}) => {
  const stats = record.stats || {}
  return {
    ...record,
    games: toFiniteNumber(record.games ?? record.num_games ?? stats.games ?? stats.num_games),
    wins: toFiniteNumber(record.wins ?? record.num_win_games ?? stats.wins ?? stats.num_win_games),
    pickRate: normalizeRateValue(
      record.pickRate ?? record.pick_rate ?? stats.pickRate ?? stats.pick_rate
    ),
    winRate: normalizeRateValue(
      record.winRate ?? record.win_rate ?? stats.winRate ?? stats.win_rate
    ),
  }
}

const compareRecommendations = (left, right) =>
  toFiniteNumber(right.games) - toFiniteNumber(left.games) ||
  toFiniteNumber(right.pickRate) - toFiniteNumber(left.pickRate)

export const normalizeSummonerSpellRecommendations = (build = {}) => {
  return parseRecommendationRecords(build.summonerSpells)
    .flatMap((record) => {
      const summonerSpellIds = normalizePositiveIntegerIds(
        record?.summonerSpellIds ?? record?.spellIds
      )
      if (summonerSpellIds.length !== 2) {
        return []
      }

      return [{
        ...normalizeRecommendationStats(record),
        summonerSpellIds,
      }]
    })
    .sort(compareRecommendations)
}

export const normalizeSkillOrderRecommendations = (build = {}) => {
  return parseRecommendationRecords(build.skillOrders)
    .flatMap((record) => {
      const skillOrder = normalizePositiveIntegerIds(record?.skillOrder ?? record?.order)
      if (
        skillOrder.length < 15 ||
        skillOrder.length > 18 ||
        skillOrder.some(skill => skill > 4)
      ) {
        return []
      }

      return [{
        ...normalizeRecommendationStats(record),
        skillOrder,
      }]
    })
    .sort(compareRecommendations)
}

const SKILL_KEYS = ['Q', 'W', 'E']

export const getSkillPriority = (skillOrder = []) => {
  const rankedSkills = SKILL_KEYS
    .map((key, index) => {
      const skillNumber = index + 1
      let learnedCount = 0
      let maxedAt = Number.POSITIVE_INFINITY

      for (let levelIndex = 0; levelIndex < skillOrder.length; levelIndex += 1) {
        if (skillOrder[levelIndex] === skillNumber) {
          learnedCount += 1
          if (learnedCount === 5) {
            maxedAt = levelIndex
            break
          }
        }
      }

      return { key, maxedAt }
    })
    .sort((left, right) => left.maxedAt - right.maxedAt)

  return rankedSkills.map(skill => skill.key)
}

export const getSkillKey = (skillNumber) => ['Q', 'W', 'E', 'R'][Number(skillNumber) - 1] || '?'

export const createBuildRoutes = (build) => collectBuildRoutes(build)
  .map((route, index) => {
    const stats = getBuildStats(route)
    const startingItems = normalizeBuildRecords(route.startingItems || [])
    const coreItems = normalizeBuildRecords(route.coreItems || route.recommended || [])
    const fullItems = normalizeBuildRecords(route.fullItems || [])
    const itemExtensions = normalizeSingleItemRecords(route.itemExtensions || [])
    const situationalItems = normalizeSingleItemRecords(
      route.situationalItems || [],
      compareSituationalRecords
    )
    const summonerSpells = normalizeSummonerSpellRecommendations(route)
    const skillOrders = normalizeSkillOrderRecommendations(route)
    const hasAnyItems = startingItems.length > 0 ||
      coreItems.length > 0 ||
      fullItems.length > 0 ||
      itemExtensions.length > 0 ||
      situationalItems.length > 0

    return {
      key: `${index}-${getBuildTitle(route, index)}`,
      title: getBuildTitle(route, index),
      subtitle: route.patch ? `版本 ${route.patch}` : '',
      winRate: stats.winRate,
      pickRate: stats.pickRate,
      games: stats.games,
      startingItems,
      coreItems,
      fullItems,
      itemExtensions,
      situationalItems,
      summonerSpells,
      skillOrders,
      hasAnyItems,
    }
  })
  .filter(route => route.hasAnyItems)
