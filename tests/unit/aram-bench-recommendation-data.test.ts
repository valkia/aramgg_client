import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadChampionStatsForRecommendation } from '../../src/main/services/aram/bench-recommendation-data.ts'
import { getAramBenchRecommendation } from '../../src/main/services/aram/bench-recommendation.ts'
import { mapChampionRankings } from '../../src/main/services/champion-rankings.ts'
import type { ChampionRankings, SupportedDataLocale } from '../../src/shared/ipc-contract.ts'

const { getDataLocale, loadChampionRankings, warn } = vi.hoisted(() => ({
  getDataLocale: vi.fn(), loadChampionRankings: vi.fn(), warn: vi.fn(),
}))
vi.mock('../../src/main/data-loader.ts', () => ({ getDataLocale, loadChampionRankings }))
vi.mock('../../src/main/modules/logger.ts', () => ({ default: { warn } }))

function index(locale: SupportedDataLocale = 'en-US') {
  return mapChampionRankings({ data: [
    { id: 67, name: locale === 'en-US' ? 'Vayne' : '薇恩', alias: 'Vayne', stats: { tier: 1, winRate: 0.5732, pickRate: 0.1388, games: null } },
    { id: 99, alias: 'Lux', stats: { tier: 2, winRate: 0, pickRate: 0, games: 0 } },
    { id: 63, stats: { tier: 0, winRate: 105, pickRate: -1, games: -2 } },
  ] }, { locale, dataVersion: 'fixture' })
}
beforeEach(() => {
  vi.clearAllMocks()
  getDataLocale.mockReturnValue('en-US')
  loadChampionRankings.mockResolvedValue(index())
})

describe('ARAM recommendation index loading', () => {
  it('reads one index for the candidate batch and preserves missing fields and true zeroes into recommendations', async () => {
    const data = await loadChampionStatsForRecommendation([67, 99, 63, 999_999])
    expect(getDataLocale).toHaveBeenCalledTimes(1)
    expect(loadChampionRankings).toHaveBeenCalledExactlyOnceWith('en-US')
    const recommendation = getAramBenchRecommendation({
      gameflowPhase: 'ChampSelect', selfChampionId: 67,
      benchChampions: [{ championId: 99 }, { championId: 63 }, { championId: 999_999 }],
    }, data)
    expect(recommendation.currentChampion).toMatchObject({ name: 'Vayne', games: null, winRate: 0.5732 })
    expect(recommendation.candidates.find((candidate) => candidate.championId === 99)).toMatchObject({ name: 'Lux', games: 0, winRate: 0, pickRate: 0, tier: 2 })
    for (const id of [63, 999_999]) {
      expect(recommendation.candidates.find((candidate) => candidate.championId === id)).toMatchObject({ name: String(id), games: null, winRate: null, pickRate: null, tier: null, dataAvailable: false, score: 0.45 })
    }
    expect(recommendation.candidates).toHaveLength(4)
    expect(recommendation.candidates.every((candidate) => Number.isFinite(candidate.score))).toBe(true)
  })

  it('pins the locale once while the index is loading and uses its localized names', async () => {
    getDataLocale.mockReturnValue('zh-CN')
    let resolve!: (value: ChampionRankings) => void
    loadChampionRankings.mockImplementation(() => new Promise((done) => { resolve = done }))
    const pending = loadChampionStatsForRecommendation([67])
    await vi.waitFor(() => expect(loadChampionRankings).toHaveBeenCalledExactlyOnceWith('zh-CN'))
    getDataLocale.mockReturnValue('en-US')
    resolve(index('zh-CN'))
    expect((await pending)['67'].name).toBe('薇恩')
    expect(getDataLocale).toHaveBeenCalledTimes(1)
  })

  it('retains all candidate identities with neutral labels and missing statistics if the index fails', async () => {
    loadChampionRankings.mockRejectedValue(new Error('offline'))
    const data = await loadChampionStatsForRecommendation([67, 99])
    expect(Object.keys(data)).toEqual(['67', '99'])
    expect(data['67']).toMatchObject({ name: '67', tier: null, winRate: null, pickRate: null, numGames: null })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('does not load any dataset when there are no candidates', async () => {
    expect(await loadChampionStatsForRecommendation([])).toEqual({})
    expect(getDataLocale).not.toHaveBeenCalled()
    expect(loadChampionRankings).not.toHaveBeenCalled()
  })
})
