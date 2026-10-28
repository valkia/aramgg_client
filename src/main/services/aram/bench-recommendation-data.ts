import logger from '../../modules/logger.ts'
import type { ChampionRankingEntry } from '../../../shared/ipc-contract.ts'

type RecommendationStats = {
  name: string
  alias: string
  iconUrl?: string
  tier: number | null
  winRate: number | null
  pickRate: number | null
  numGames: number | null
}

/** Read one locale/version index; keep missing source statistics distinct from real zeroes. */
export async function loadChampionStatsForRecommendation(
  championIds: readonly number[],
): Promise<Record<string, RecommendationStats>> {
  if (!championIds.length) return {}

  const { getDataLocale, loadChampionRankings } = await import('../../data-loader.ts')
  const locale = getDataLocale()
  let champions: ChampionRankingEntry[] = []
  try {
    champions = (await loadChampionRankings(locale)).champions
  } catch (error) {
    logger.warn('[LCU] Failed to load ARAM recommendation index:', error instanceof Error ? error.message : String(error))
  }
  const byId = new Map(champions.map((champion) => [champion.championId, champion]))
  return Object.fromEntries(championIds.map((championId) => {
    const champion = byId.get(championId)
    return [String(championId), {
      name: champion?.name || champion?.alias || String(championId),
      alias: champion?.alias || '',
      iconUrl: champion?.iconUrl || undefined,
      tier: champion?.tier ?? null,
      winRate: champion?.winRate ?? null,
      pickRate: champion?.pickRate ?? null,
      numGames: champion?.numGames ?? null,
    }]
  }))
}
