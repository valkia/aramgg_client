import type {
  AramBenchRecommendation,
  AramRecommendationCandidate,
  AramRecommendationDecisionReason,
  GameflowPhase,
} from '../../../shared/ipc-contract.ts'

type CandidateSource = 'current' | 'bench' | 'teammate'

interface RecommendationSnapshot {
  status?: string
  reason?: string | null
  gameflowPhase?: GameflowPhase | null
  selfChampionId?: unknown
  localPlayerCellId?: unknown
  benchEnabled?: boolean
  benchChampions?: Array<{ championId?: unknown }>
  myTeam?: Array<{ cellId?: unknown; championId?: unknown }>
}

interface ChampionStats {
  nameCN?: string
  name?: string
  alias?: string
  nameEN?: string
  iconUrl?: string
  tier?: unknown
  [key: string]: unknown
}

type ChampionStatsById = Map<number | string, ChampionStats> | Record<string, ChampionStats>

const READY_STATUS = 'ready'
const INACTIVE_STATUS = 'inactive'
const NO_CURRENT_STATUS = 'no-current-champion'
const NO_BENCH_STATUS = 'no-bench'
const NO_CANDIDATES_STATUS = 'no-candidates'
const CANDIDATE_SOURCE_LABELS: Record<CandidateSource, string> = {
  current: '当前',
  bench: '席位',
  teammate: '队友',
}

function toPositiveInteger(value: unknown): number | null {
  const numberValue = Number(value)
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null
}

function toInteger(value: unknown): number | null {
  if (value == null || value === '') {
    return null
  }

  const numberValue = Number(value)
  return Number.isInteger(numberValue) ? numberValue : null
}

function toNullableNumber(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
    return null
  }

  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function normalizeRate(value: unknown): number | null {
  const numberValue = toNullableNumber(value)
  if (numberValue == null || numberValue < 0 || numberValue > 100) {
    return null
  }

  return numberValue > 1 ? numberValue / 100 : numberValue
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function getStatsField(stats: ChampionStats | null, fields: string[]): unknown {
  for (const field of fields) {
    if (stats?.[field] != null) {
      return stats[field]
    }
  }

  return null
}

function getChampionStats(
  championStatsById: ChampionStatsById | null | undefined,
  championId: number,
): ChampionStats | null {
  if (!championStatsById) {
    return null
  }

  if (championStatsById instanceof Map) {
    return championStatsById.get(championId) || championStatsById.get(String(championId)) || null
  }

  return championStatsById[championId] || championStatsById[String(championId)] || null
}

function getChampionDisplayName(championId: number, stats: ChampionStats | null): string {
  return (
    stats?.nameCN ||
    stats?.name ||
    stats?.alias ||
    stats?.nameEN ||
    `英雄 ${championId}`
  )
}

function getCandidateSourceLabel(source: CandidateSource): string {
  return CANDIDATE_SOURCE_LABELS[source]
}

function scoreChampionStats(stats: ChampionStats | null) {
  const winRate = normalizeRate(getStatsField(stats, ['winRate', 'win_rate']))
  const pickRate = normalizeRate(getStatsField(stats, ['pickRate', 'pick_rate']))
  const rawGames = toNullableNumber(getStatsField(stats, ['numGames', 'games', 'playCount', 'num_games']))
  const games = rawGames != null && Number.isSafeInteger(rawGames) && rawGames >= 0 ? rawGames : null
  const rawTier = toNullableNumber(stats?.tier)
  const tier = rawTier != null && Number.isInteger(rawTier) && rawTier > 0 ? rawTier : null

  const winRateScore = winRate ?? 0.5
  const pickRateScore = pickRate ?? 0
  const tierScore = tier ? clamp01((6 - Math.min(tier, 6)) / 5) : 0

  // Counts remain source metadata; only rate/tier fields affect ranking and availability.
  const dataAvailable = winRate != null || pickRate != null || tier != null
  const score = dataAvailable
    ? clamp01((winRateScore * 0.74 + pickRateScore * 0.08 + tierScore * 0.08) / 0.9)
    : 0.45

  let confidence = 0.15
  if (winRate != null) confidence += 0.45
  if (pickRate != null) confidence += 0.1
  if (tier != null) confidence += 0.1

  return {
    winRate,
    pickRate,
    games,
    tier,
    score,
    confidence: clamp01(confidence / 0.8),
    dataAvailable,
  }
}

function buildCandidate(
  championId: number,
  source: CandidateSource,
  snapshot: RecommendationSnapshot,
  championStatsById: ChampionStatsById,
): AramRecommendationCandidate {
  const stats = getChampionStats(championStatsById, championId)
  const scoredStats = scoreChampionStats(stats)
  const isCurrent = championId === toPositiveInteger(snapshot.selfChampionId)
  const reasons = []

  if (scoredStats.winRate != null) {
    reasons.push(`胜率 ${(scoredStats.winRate * 100).toFixed(1)}%`)
  }
  if (scoredStats.pickRate != null) {
    reasons.push(`登场率 ${(scoredStats.pickRate * 100).toFixed(1)}%`)
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
    sourceLabel: getCandidateSourceLabel(source),
    isCurrent,
    isBench: source === 'bench',
    isTeammate: source === 'teammate',
    name: getChampionDisplayName(championId, stats),
    iconUrl: stats?.iconUrl || null,
    tier: scoredStats.tier,
    winRate: scoredStats.winRate,
    pickRate: scoredStats.pickRate,
    games: scoredStats.games,
    score: scoredStats.score,
    confidence: scoredStats.confidence,
    dataAvailable: scoredStats.dataAvailable,
    availableStatsFields: [
      ...(scoredStats.winRate != null ? ['winRate'] : []),
      ...(scoredStats.pickRate != null ? ['pickRate'] : []),
      ...(scoredStats.games != null ? ['numGames'] : []),
      ...(scoredStats.tier != null ? ['tier'] : []),
      ...(stats?.iconUrl ? ['iconUrl'] : []),
    ],
    reasons,
  }
}

function sortCandidates(candidates: AramRecommendationCandidate[]): AramRecommendationCandidate[] {
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

function collectUniqueChampionIds(values: unknown[]): number[] {
  const championIds: number[] = []
  const seenChampionIds = new Set<number>()

  values.forEach((value) => {
    const championId = toPositiveInteger(value)
    if (!championId || seenChampionIds.has(championId)) {
      return
    }

    seenChampionIds.add(championId)
    championIds.push(championId)
  })

  return championIds
}

function collectBenchChampionIds(snapshot: RecommendationSnapshot): number[] {
  if (!Array.isArray(snapshot?.benchChampions)) {
    return []
  }

  return collectUniqueChampionIds(snapshot.benchChampions.map((benchChampion) => benchChampion?.championId))
}

function collectTeammateChampionIds(snapshot: RecommendationSnapshot): number[] {
  if (!Array.isArray(snapshot?.myTeam)) {
    return []
  }

  const localPlayerCellId = toInteger(snapshot.localPlayerCellId)
  const selfChampionId = toPositiveInteger(snapshot.selfChampionId)
  const championIds: number[] = []
  const seenChampionIds = new Set<number>()

  snapshot.myTeam.forEach((member) => {
    const cellId = toInteger(member?.cellId)
    if (localPlayerCellId != null && cellId === localPlayerCellId) {
      return
    }

    const championId = toPositiveInteger(member?.championId)
    if (!championId) {
      return
    }

    if (localPlayerCellId == null && selfChampionId && championId === selfChampionId) {
      return
    }

    if (seenChampionIds.has(championId)) {
      return
    }

    seenChampionIds.add(championId)
    championIds.push(championId)
  })

  return championIds
}

function getCandidateFocusName(candidate: AramRecommendationCandidate | null): string {
  if (!candidate) {
    return '候选英雄'
  }

  if (candidate.source === 'teammate') {
    return `队友已选英雄 ${candidate.name}`
  }

  if (candidate.source === 'bench') {
    return `席位英雄 ${candidate.name}`
  }

  return candidate.name
}

function buildBaseRecommendation(
  snapshot: RecommendationSnapshot | null,
  status: string,
  reason: string | null,
): AramBenchRecommendation {
  return {
    readOnly: true,
    status,
    reason,
    decisionReason: status === NO_CANDIDATES_STATUS ? 'no-candidates' : null,
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

export function collectAramCandidateChampionIds(snapshot: RecommendationSnapshot | null): number[] {
  if (!snapshot || snapshot.gameflowPhase !== 'ChampSelect') {
    return []
  }

  const championIds: number[] = []
  const seenChampionIds = new Set<number>()
  const addChampionId = (value: unknown) => {
    const championId = toPositiveInteger(value)
    if (!championId || seenChampionIds.has(championId)) {
      return
    }

    seenChampionIds.add(championId)
    championIds.push(championId)
  }

  addChampionId(snapshot.selfChampionId)

  collectBenchChampionIds(snapshot).forEach(addChampionId)
  collectTeammateChampionIds(snapshot).forEach(addChampionId)

  return championIds
}

export function createEmptyAramBenchRecommendation(reason = 'lcu-unavailable'): AramBenchRecommendation {
  return buildBaseRecommendation(null, INACTIVE_STATUS, reason)
}

export function getAramBenchRecommendation(
  snapshot: RecommendationSnapshot | null,
  championStatsById: ChampionStatsById = {},
): AramBenchRecommendation {
  if (!snapshot || snapshot.gameflowPhase !== 'ChampSelect') {
    return buildBaseRecommendation(
      snapshot,
      INACTIVE_STATUS,
      snapshot?.reason || 'not-in-champ-select'
    )
  }

  const currentChampionId = toPositiveInteger(snapshot.selfChampionId)
  const benchChampionIds = collectBenchChampionIds(snapshot)
  const teammateChampionIds = collectTeammateChampionIds(snapshot)

  if (!currentChampionId && !benchChampionIds.length && !teammateChampionIds.length) {
    return buildBaseRecommendation(snapshot, NO_CANDIDATES_STATUS, 'no-champion-candidates')
  }

  const candidatesById = new Map<number, AramRecommendationCandidate>()

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

  teammateChampionIds.forEach((championId) => {
    if (!candidatesById.has(championId)) {
      candidatesById.set(
        championId,
        buildCandidate(championId, 'teammate', snapshot, championStatsById)
      )
    }
  })

  const candidates = sortCandidates([...candidatesById.values()])
  const currentChampion = currentChampionId ? candidatesById.get(currentChampionId) || null : null
  const recommendedChampion = candidates[0] || null

  if (!currentChampion) {
    return {
      ...buildBaseRecommendation(snapshot, NO_CURRENT_STATUS, 'no-current-champion'),
      decisionReason: 'no-current-champion',
      recommendedChampion,
      candidates,
      confidence: recommendedChampion?.confidence || 0,
      reasons: recommendedChampion
        ? [`当前英雄尚未稳定读取，候选中优先关注 ${getCandidateFocusName(recommendedChampion)}`]
        : ['当前英雄尚未稳定读取'],
    }
  }

  const deltaScore = recommendedChampion ? recommendedChampion.score - currentChampion.score : 0
  const alternativeCandidateCount = candidates.filter((candidate) => !candidate.isCurrent).length
  const noAlternativeCandidates = alternativeCandidateCount === 0
  const status = noAlternativeCandidates ? NO_BENCH_STATUS : READY_STATUS
  const reasons = []
  let decisionReason: AramRecommendationDecisionReason

  if (noAlternativeCandidates) {
    decisionReason = 'no-alternatives'
    reasons.push('没有可用席位或队友已选英雄，建议保留当前英雄')
  } else if (!recommendedChampion || recommendedChampion.championId === currentChampion.championId || deltaScore < 0.015) {
    decisionReason = !recommendedChampion || recommendedChampion.championId === currentChampion.championId
      ? 'current-best'
      : 'small-difference'
    reasons.push(`${currentChampion.name} 当前评分最高或差距很小，建议保留`)
  } else if (recommendedChampion.source === 'teammate') {
    decisionReason = 'teammate-higher'
    reasons.push(`${recommendedChampion.name} 是队友已选英雄，综合评分高于当前英雄，可作为只读沟通参考`)
  } else {
    decisionReason = 'bench-higher'
    reasons.push(`${getCandidateFocusName(recommendedChampion)} 综合评分高于当前英雄，建议优先关注`)
  }

  if (!benchChampionIds.length && teammateChampionIds.length) {
    reasons.push('当前没有席位英雄，队友已选英雄仅作只读参考')
  }

  if (!candidates.some((candidate) => candidate.dataAvailable)) {
    reasons.push('统计数据暂缺，结果仅按候选列表降级展示')
  }

  return {
    readOnly: true,
    status,
    reason: null,
    decisionReason,
    gameflowPhase: snapshot.gameflowPhase,
    benchEnabled: snapshot.benchEnabled || benchChampionIds.length > 0,
    currentChampion,
    recommendedChampion: recommendedChampion || currentChampion,
    candidates,
    deltaScore,
    confidence: recommendedChampion?.confidence || currentChampion.confidence,
    reasons,
    generatedAt: Date.now(),
  }
}
