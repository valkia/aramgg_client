import { describe, expect, it } from 'vitest'
import {
  createEmptyAramBenchRecommendation,
  getAramBenchRecommendation,
} from '../../src/main/services/aram/bench-recommendation.ts'

const stats = (winRate = 0.5) => ({ name: 'Champion', winRate, pickRate: 0.1, numGames: 1_000, tier: 2 })
const snapshot = (overrides = {}) => ({
  gameflowPhase: 'ChampSelect' as const,
  selfChampionId: 63,
  localPlayerCellId: 1,
  benchChampions: [{ championId: 99 }],
  myTeam: [{ cellId: 1, championId: 63 }],
  ...overrides,
})

describe('ARAM recommendation evidence', () => {
  it('retains the relative strength weights without a game-count dimension', () => {
    const result = getAramBenchRecommendation(snapshot(), { 63: stats(), 99: stats(0.56) })
    expect(result.decisionReason).toBe('bench-higher')
    expect(result.recommendedChampion?.championId).toBe(99)
    expect(result.recommendedChampion?.score).toBeCloseTo((0.56 * 0.74 + 0.1 * 0.08 + 0.8 * 0.08) / 0.9)
    expect(result.deltaScore).toBeCloseTo(0.06 * 0.74 / 0.9)
    expect(result.readOnly).toBe(true)
  })

  it('distinguishes keeping the best current champion from a small positive difference', () => {
    expect(getAramBenchRecommendation(snapshot(), { 63: stats(0.6), 99: stats() }).decisionReason).toBe('current-best')
    const close = getAramBenchRecommendation(snapshot(), { 63: stats(), 99: stats(0.518) })
    expect(close.recommendedChampion?.championId).toBe(99)
    expect(close.deltaScore).toBeGreaterThan(0)
    expect(close.deltaScore).toBeLessThan(0.015)
    expect(close.decisionReason).toBe('small-difference')
    expect(getAramBenchRecommendation(snapshot(), { 63: stats(), 99: stats(0.519) }).decisionReason).toBe('bench-higher')
  })

  it.each([null, 0, 1, 1_000_000])('does not let game counts alone alter ranking or field availability: %s', (games) => {
    const baseline = getAramBenchRecommendation(snapshot(), { 63: stats(), 99: stats(0.56) })
    const result = getAramBenchRecommendation(snapshot(), {
      63: { ...stats(), numGames: games }, 99: { ...stats(0.56), numGames: null },
    })
    expect(result.decisionReason).toBe(baseline.decisionReason)
    expect(result.deltaScore).toBe(baseline.deltaScore)
    expect(result.candidates.map(({ championId, score, confidence, dataAvailable }) => ({ championId, score, confidence, dataAvailable })))
      .toEqual(baseline.candidates.map(({ championId, score, confidence, dataAvailable }) => ({ championId, score, confidence, dataAvailable })))
    expect(result.currentChampion?.games).toBe(games)
    expect(result.currentChampion?.confidence).toBeCloseTo(1)
    expect(result.currentChampion?.reasons.join(' ')).not.toContain('样本')
  })

  it('requires strength metrics for available data and still lowers availability for missing metrics', () => {
    const result = getAramBenchRecommendation(snapshot(), { 63: { numGames: 1_000 }, 99: { ...stats(), winRate: null } })
    expect(result.currentChampion).toMatchObject({ games: 1_000, dataAvailable: false, score: 0.45 })
    expect(result.candidates.find((candidate) => candidate.championId === 99)?.confidence).toBeLessThan(1)
  })

  it('keeps teammate candidates and distinguishes their discussion-only recommendation', () => {
    const result = getAramBenchRecommendation(snapshot({
      myTeam: [{ cellId: 1, championId: 63 }, { cellId: 2, championId: 103 }],
    }), { 63: stats(), 99: stats(0.52), 103: stats(0.6) })
    expect(result.decisionReason).toBe('teammate-higher')
    expect(result.recommendedChampion?.source).toBe('teammate')
    expect(result.candidates.map((candidate) => candidate.championId)).toEqual([103, 99, 63])
  })

  it('describes missing current, missing alternatives and empty or inactive sessions', () => {
    expect(getAramBenchRecommendation(snapshot({ selfChampionId: null }), { 99: stats() }).decisionReason).toBe('no-current-champion')
    expect(getAramBenchRecommendation(snapshot({ benchChampions: [] }), { 63: stats() }).decisionReason).toBe('no-alternatives')
    expect(getAramBenchRecommendation(snapshot({ selfChampionId: null, benchChampions: [], myTeam: [] })).decisionReason).toBe('no-candidates')
    expect(getAramBenchRecommendation({ gameflowPhase: 'Lobby' }).decisionReason).toBeNull()
    expect(createEmptyAramBenchRecommendation().decisionReason).toBeNull()
  })

  it('preserves missing fields separately from real zeroes and accepts supported aliases', () => {
    const result = getAramBenchRecommendation(snapshot(), {
      63: { win_rate: '56', pick_rate: '0.12', games: '12', tier: '1' },
      99: { winRate: 0, pickRate: 0, numGames: 0, tier: 3 },
    })
    expect(result.currentChampion).toMatchObject({ winRate: 0.56, pickRate: 0.12, games: 12, tier: 1, dataAvailable: true })
    expect(result.currentChampion?.availableStatsFields).toEqual(['winRate', 'pickRate', 'numGames', 'tier'])
    expect(result.candidates.find((candidate) => candidate.championId === 99)).toMatchObject({ winRate: 0, pickRate: 0, games: 0, tier: 3 })
    const missing = getAramBenchRecommendation(snapshot()).currentChampion
    expect(missing).toMatchObject({ winRate: null, pickRate: null, games: null, tier: null, dataAvailable: false, score: 0.45 })
    expect(missing?.availableStatsFields).toEqual([])
  })

  it.each([
    { winRate: -0.1, pickRate: 101, numGames: -2, tier: 0 },
    { winRate: Infinity, pickRate: NaN, numGames: Infinity, tier: -1 },
    { winRate: true, pickRate: [], numGames: 1.2, tier: 1.2 },
    { winRate: ' ', pickRate: {}, numGames: Number.MAX_SAFE_INTEGER + 1, tier: '' },
  ])('treats invalid statistics as missing and keeps finite fallback scores: %j', (invalidStats) => {
    const result = getAramBenchRecommendation(snapshot(), { 63: invalidStats, 99: stats() })
    expect(result.currentChampion).toMatchObject({ winRate: null, pickRate: null, games: null, tier: null, dataAvailable: false })
    expect(Number.isFinite(result.currentChampion?.score)).toBe(true)
    expect(Number.isFinite(result.deltaScore)).toBe(true)
    expect(result.currentChampion?.availableStatsFields).toEqual([])
  })
})
