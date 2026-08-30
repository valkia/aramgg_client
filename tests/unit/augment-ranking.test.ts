import { describe, expect, it } from 'vitest'
import {
  compareAugmentPriority,
  rankAugmentRecommendations,
} from '../../src/shared/augment-ranking.ts'

describe('augment recommendation ranking', () => {
  it('uses tier before pick rate when win rate and rank are unavailable', () => {
    const ranked = rankAugmentRecommendations([
      { id: 1, tier: 2, pickRate: 0.5, winRate: null },
      { id: 2, tier: 1, pickRate: 0.01, winRate: null },
      { id: 3, tier: 1, pickRate: 0.2, winRate: null },
    ])

    expect(ranked.map(item => item.id)).toEqual([3, 2, 1])
    expect(ranked.map(item => item.rank)).toEqual([1, 2, 3])
    expect(ranked.map(item => item.total)).toEqual([3, 3, 3])
    expect(ranked.map(item => item.recommendScore)).toEqual([1, 0.5, 0])
  })

  it('prefers an authoritative rank when every record provides one', () => {
    const ranked = rankAugmentRecommendations([
      { id: 1, rank: 2, total: 10, tier: 1, pickRate: 0.8 },
      { id: 2, rank: 1, total: 10, tier: 4, pickRate: 0.001 },
    ])

    expect(ranked.map(item => item.id)).toEqual([2, 1])
    expect(ranked.map(item => item.rank)).toEqual([1, 2])
    expect(ranked[0].recommendScore).toBe(1)
    expect(ranked[1].recommendScore).toBeCloseTo(8 / 9)
  })

  it('derives the displayed score from authoritative rank even when legacy score exists', () => {
    const ranked = rankAugmentRecommendations([
      { id: 1, rank: 2, total: 10, winRate: 0.6, recommendScore: 0.4 },
      { id: 2, rank: 1, total: 10, winRate: 0.5, recommendScore: 0.55 },
    ])

    expect(ranked.map(item => item.id)).toEqual([2, 1])
    expect(ranked[0].recommendScore).toBe(1)
    expect(ranked[1].recommendScore).toBeCloseTo(8 / 9)
  })

  it('uses tier-derived scores before legacy win-rate scores when tier data exists', () => {
    const ranked = rankAugmentRecommendations([
      { id: 1, tier: 1, winRate: 0.6, recommendScore: 0.4 },
      { id: 2, tier: 2, winRate: 0.5, recommendScore: 0.7 },
    ])

    expect(ranked.map(item => item.id)).toEqual([1, 2])
    expect(ranked.map(item => item.recommendScore)).toEqual([1, 0])
  })

  it('keeps the legacy score order when cached data lacks official rank and tier', () => {
    const ranked = rankAugmentRecommendations([
      { id: 1, winRate: 0.6, recommendScore: 0.4 },
      { id: 2, winRate: 0.5, recommendScore: 0.7 },
    ])

    expect(ranked.map(item => item.id)).toEqual([2, 1])
    expect(ranked.map(item => item.recommendScore)).toEqual([0.7, 0.4])
  })

  it('selects the lower rank over a higher pick rate', () => {
    expect(compareAugmentPriority(
      { rank: 2, tier: 1, pickRate: 0.01 },
      { rank: 30, tier: 2, pickRate: 0.5 },
    )).toBeLessThan(0)
  })
})
