// @ts-nocheck
const READY_STATUS = 'ready'
const INACTIVE_STATUS = 'inactive'
const NO_CURRENT_STATUS = 'no-current-champion'
const NO_BENCH_STATUS = 'no-bench'
const NO_CANDIDATES_STATUS = 'no-candidates'

function toPositiveInteger(value) {
  const numberValue = Number(value)
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null
}

function toNullableNumber(value) {
  if (value == null || value === '') {
    return null
  }

  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function normalizeRate(value) {
  const numberValue = toNullableNumber(value)
  if (numberValue == null) {
    return null
  }

  return numberValue > 1 ? numberValue / 100 : numberValue
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function getStatsField(stats, fields) {
  for (const field of fields) {
    if (stats?.[field] != null) {
      return stats[field]
    }
  }

  return null
}

function getChampionStats(championStatsById, championId) {
  if (!championStatsById) {
    return null
  }

  if (championStatsById instanceof Map) {
    return championStatsById.get(championId) || championStatsById.get(String(championId)) || null
  }

  return championStatsById[championId] || championStatsById[String(championId)] || null
}

function getChampionDisplayName(championId, stats) {
  return (
    stats?.nameCN ||
    stats?.name ||
    stats?.alias ||
    stats?.nameEN ||
    `英雄 ${championId}`
  )
}

function getAvailableStatsFields(stats) {
  if (!stats) {
    return []
  }

  return ['winRate', 'pickRate', 'numGames', 'tier', 'iconUrl'].filter((field) => stats[field] != null)
}

function scoreChampionStats(stats) {
  const winRate = normalizeRate(getStatsField(stats, ['winRate', 'win_rate']))
  const pickRate = normalizeRate(getStatsField(stats, ['pickRate', 'pick_rate']))
  const games = toNullableNumber(getStatsField(stats, ['numGames', 'games', 'playCount', 'num_games']))
  const tier = toNullableNumber(stats?.tier)

  const winRateScore = winRate ?? 0.5
  const pickRateScore = pickRate ?? 0
  const sampleScore = games ? clamp01(Math.log10(games + 1) / 4) : 0
  const tierScore = tier ? clamp01((6 - Math.min(tier, 6)) / 5) : 0

  const dataAvailable = winRate != null || pickRate != null || games != null || tier != null
  const score = dataAvailable
    ? clamp01(winRateScore * 0.74 + pickRateScore * 0.08 + sampleScore * 0.1 + tierScore * 0.08)
    : 0.45

  let confidence = 0.15
  if (winRate != null) confidence += 0.45
  if (pickRate != null) confidence += 0.1
  if (games != null && games > 0) confidence += 0.2
  if (tier != null) confidence += 0.1

  return {
    winRate,
    pickRate,
    games,
    tier,
    score,
    confidence: clamp01(confidence),
    dataAvailable,
  }
}

function buildCandidate(championId, source, snapshot, championStatsById) {
  const stats = getChampionStats(championStatsById, championId)
  const scoredStats = scoreChampionStats(stats)
  const isCurrent = championId === snapshot.selfChampionId
  const reasons = []

  if (scoredStats.winRate != null) {
    reasons.push(`胜率 ${(scoredStats.winRate * 100).toFixed(1)}%`)
  }
  if (scoredStats.games != null) {
    reasons.push(`样本 ${Math.round(scoredStats.games)}`)
  }
  if (scoredStats.tier != null) {
    reasons.push(`梯队 ${scoredStats.tier}`)
  }
  if (!reasons.length) {
    reasons.push('统计数据暂缺')
  }

  return {
    championId,
    source,
    isCurrent,
    name: getChampionDisplayName(championId, stats),
    iconUrl: stats?.iconUrl || null,
    tier: scoredStats.tier,
    winRate: scoredStats.winRate,
    pickRate: scoredStats.pickRate,
    games: scoredStats.games,
    score: scoredStats.score,
    confidence: scoredStats.confidence,
    dataAvailable: scoredStats.dataAvailable,
    availableStatsFields: getAvailableStatsFields(stats),
    reasons,
  }
}

function sortCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }

    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence
    }

    return Number(a.championId) - Number(b.championId)
  })
}

function buildBaseRecommendation(snapshot, status, reason) {
  return {
    readOnly: true,
    status,
    reason,
    gameflowPhase: snapshot?.gameflowPhase || null,
    benchEnabled: snapshot?.benchEnabled === true,
    currentChampion: null,
    recommendedChampion: null,
    candidates: [],
    deltaScore: 0,
    confidence: 0,
    reasons: reason ? [reason] : [],
    generatedAt: Date.now(),
  }
}

export function collectAramCandidateChampionIds(snapshot) {
  if (!snapshot || snapshot.gameflowPhase !== 'ChampSelect') {
    return []
  }

  const championIds = []
  const seenChampionIds = new Set()
  const addChampionId = (value) => {
    const championId = toPositiveInteger(value)
    if (!championId || seenChampionIds.has(championId)) {
      return
    }

    seenChampionIds.add(championId)
    championIds.push(championId)
  }

  addChampionId(snapshot.selfChampionId)

  if (snapshot.benchEnabled && Array.isArray(snapshot.benchChampions)) {
    snapshot.benchChampions.forEach((benchChampion) => addChampionId(benchChampion.championId))
  }

  return championIds
}

export function createEmptyAramBenchRecommendation(reason = 'lcu-unavailable') {
  return buildBaseRecommendation(null, INACTIVE_STATUS, reason)
}

export function getAramBenchRecommendation(snapshot, championStatsById = {}) {
  if (!snapshot || snapshot.gameflowPhase !== 'ChampSelect') {
    return buildBaseRecommendation(
      snapshot,
      INACTIVE_STATUS,
      snapshot?.reason || 'not-in-champ-select'
    )
  }

  const currentChampionId = toPositiveInteger(snapshot.selfChampionId)
  const benchChampionIds = Array.isArray(snapshot.benchChampions)
    ? snapshot.benchChampions.map((benchChampion) => toPositiveInteger(benchChampion.championId)).filter(Boolean)
    : []

  if (!currentChampionId && !benchChampionIds.length) {
    return buildBaseRecommendation(snapshot, NO_CANDIDATES_STATUS, 'no-champion-candidates')
  }

  const candidatesById = new Map()

  if (currentChampionId) {
    candidatesById.set(
      currentChampionId,
      buildCandidate(currentChampionId, 'current', snapshot, championStatsById)
    )
  }

  benchChampionIds.forEach((championId) => {
    if (!candidatesById.has(championId)) {
      candidatesById.set(
        championId,
        buildCandidate(championId, 'bench', snapshot, championStatsById)
      )
    }
  })

  const candidates = sortCandidates([...candidatesById.values()])
  const currentChampion = currentChampionId ? candidatesById.get(currentChampionId) || null : null
  const recommendedChampion = candidates[0] || null

  if (!currentChampion) {
    return {
      ...buildBaseRecommendation(snapshot, NO_CURRENT_STATUS, 'no-current-champion'),
      recommendedChampion,
      candidates,
      confidence: recommendedChampion?.confidence || 0,
      reasons: recommendedChampion
        ? [`当前英雄尚未稳定读取，席位中优先关注 ${recommendedChampion.name}`]
        : ['当前英雄尚未稳定读取'],
    }
  }

  const deltaScore = recommendedChampion ? recommendedChampion.score - currentChampion.score : 0
  const noBenchAvailable = !snapshot.benchEnabled || benchChampionIds.length === 0
  const status = noBenchAvailable ? NO_BENCH_STATUS : READY_STATUS
  const reasons = []

  if (noBenchAvailable) {
    reasons.push('没有可用席位英雄，建议保留当前英雄')
  } else if (!recommendedChampion || recommendedChampion.championId === currentChampion.championId || deltaScore < 0.015) {
    reasons.push(`${currentChampion.name} 当前评分最高或差距很小，建议保留`)
  } else {
    reasons.push(`${recommendedChampion.name} 综合评分高于当前英雄，建议优先关注`)
  }

  if (!candidates.some((candidate) => candidate.dataAvailable)) {
    reasons.push('统计数据暂缺，结果仅按候选列表降级展示')
  }

  return {
    readOnly: true,
    status,
    reason: null,
    gameflowPhase: snapshot.gameflowPhase,
    benchEnabled: snapshot.benchEnabled,
    currentChampion,
    recommendedChampion: recommendedChampion || currentChampion,
    candidates,
    deltaScore,
    confidence: recommendedChampion?.confidence || currentChampion.confidence,
    reasons,
    generatedAt: Date.now(),
  }
}
