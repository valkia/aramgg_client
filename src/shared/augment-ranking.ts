export type AugmentRankingRecord = {
  id?: unknown
  augmentId?: unknown
  rank?: unknown
  total?: unknown
  tier?: unknown
  pickRate?: unknown
  pick_rate?: unknown
  winRate?: unknown
  win_rate?: unknown
  recommendScore?: unknown
}

function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null
  }

  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function toPositiveInteger(value: unknown): number | null {
  const number = toFiniteNumber(value)
  return number != null && Number.isInteger(number) && number > 0 ? number : null
}

function compareNullableAscending(left: number | null, right: number | null): number {
  if (left == null) return right == null ? 0 : 1
  if (right == null) return -1
  return left - right
}

function compareNullableDescending(left: number | null, right: number | null): number {
  if (left == null) return right == null ? 0 : 1
  if (right == null) return -1
  return right - left
}

function getPickRate(record: AugmentRankingRecord): number | null {
  return toFiniteNumber(record.pickRate ?? record.pick_rate)
}

function getWinRate(record: AugmentRankingRecord): number | null {
  return toFiniteNumber(record.winRate ?? record.win_rate)
}

function getStableId(record: AugmentRankingRecord): number | null {
  return toFiniteNumber(record.augmentId ?? record.id)
}

function compareByTierAndPickRate(
  left: AugmentRankingRecord,
  right: AugmentRankingRecord,
): number {
  const tierDifference = compareNullableAscending(
    toPositiveInteger(left.tier),
    toPositiveInteger(right.tier),
  )
  if (tierDifference !== 0) {
    return tierDifference
  }

  const pickRateDifference = compareNullableDescending(getPickRate(left), getPickRate(right))
  if (pickRateDifference !== 0) {
    return pickRateDifference
  }

  return compareNullableAscending(getStableId(left), getStableId(right))
}

function compareByLegacyScore(
  left: AugmentRankingRecord,
  right: AugmentRankingRecord,
): number {
  const scoreDifference = compareNullableDescending(
    toFiniteNumber(left.recommendScore),
    toFiniteNumber(right.recommendScore),
  )
  return scoreDifference !== 0 ? scoreDifference : compareByTierAndPickRate(left, right)
}

export function compareAugmentPriority(
  left: AugmentRankingRecord,
  right: AugmentRankingRecord,
): number {
  const leftRank = toPositiveInteger(left.rank)
  const rightRank = toPositiveInteger(right.rank)
  if (leftRank != null && rightRank != null && leftRank !== rightRank) {
    return leftRank - rightRank
  }

  if (toPositiveInteger(left.tier) != null || toPositiveInteger(right.tier) != null) {
    return compareByTierAndPickRate(left, right)
  }

  if (getWinRate(left) != null || getWinRate(right) != null) {
    return compareByLegacyScore(left, right)
  }

  return compareByTierAndPickRate(left, right)
}

function getRankPercentile(rank: number, total: number): number {
  if (total <= 1) {
    return 1
  }

  return Math.max(0, Math.min(1, (total - rank) / (total - 1)))
}

export function rankAugmentRecommendations<T extends AugmentRankingRecord>(
  records: T[],
): Array<T & { rank: number; total: number; recommendScore: number }> {
  const useAuthoritativeRank = records.length > 0
    && records.every(record => toPositiveInteger(record.rank) != null)
  const useTierPriority = !useAuthoritativeRank
    && records.some(record => toPositiveInteger(record.tier) != null)
  const useLegacyScore = !useAuthoritativeRank
    && !useTierPriority
    && records.some(record => getWinRate(record) != null)
  const sorted = [...records].sort((left, right) => {
    if (useAuthoritativeRank) {
      return Number(left.rank) - Number(right.rank)
    }
    if (useTierPriority) {
      return compareByTierAndPickRate(left, right)
    }
    if (useLegacyScore) {
      return compareByLegacyScore(left, right)
    }
    return compareByTierAndPickRate(left, right)
  })
  const fallbackTotal = sorted.length

  return sorted.map((record, index) => {
    const rank = useAuthoritativeRank ? toPositiveInteger(record.rank) ?? index + 1 : index + 1
    const total = useAuthoritativeRank ? toPositiveInteger(record.total) ?? fallbackTotal : fallbackTotal
    const recommendScore = useAuthoritativeRank || useTierPriority
      ? getRankPercentile(rank, total)
      : toFiniteNumber(record.recommendScore) ?? getRankPercentile(rank, total)
    return {
      ...record,
      rank,
      total,
      recommendScore,
    }
  })
}
