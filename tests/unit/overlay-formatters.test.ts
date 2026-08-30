import { describe, expect, it } from 'vitest'
import {
  formatAugmentTier,
  formatAugmentWinRate,
  formatDataSource,
  formatNumber,
  formatPercent,
  getLocalizedText,
  normalizeTooltipText,
} from '../../src/renderer/service/overlay-formatters.ts'

describe('overlay formatters', () => {
  it('normalizes fractional and percentage rate values', () => {
    expect(formatPercent(0.523)).toBe('52.3%')
    expect(formatPercent(52.3)).toBe('52.3%')
    expect(formatPercent(null)).toBe('--')
  })

  it('labels only missing augment win rates as insufficient games', () => {
    expect(formatAugmentWinRate(null)).toBe('场次不足')
    expect(formatAugmentWinRate(undefined)).toBe('场次不足')
    expect(formatAugmentWinRate('')).toBe('场次不足')
    expect(formatAugmentWinRate(0)).toBe('0.0%')
    expect(formatAugmentWinRate(0.523)).toBe('52.3%')
    expect(formatAugmentWinRate('invalid')).toBe('--')
  })

  it('formats augment tiers as compact T labels', () => {
    expect(formatAugmentTier(1)).toBe('T1')
    expect(formatAugmentTier('2')).toBe('T2')
    expect(formatAugmentTier(0)).toBe('--')
    expect(formatAugmentTier(null)).toBe('--')
  })

  it('uses stable localized text fallbacks and strips tooltip markup', () => {
    expect(getLocalizedText({ zh_CN: '中文', en_US: 'English' })).toBe('中文')
    expect(normalizeTooltipText('<p>造成&nbsp;伤害</p><br>持续 3 秒')).toBe('造成 伤害\n\n持续 3 秒')
  })

  it('formats compact counts and known data sources', () => {
    expect(formatNumber(12345)).toBe('1.2万')
    expect(formatNumber(0)).toBe('--')
    expect(formatDataSource('auto-analysis')).toBe('自动识别')
    expect(formatDataSource('custom')).toBe('custom')
  })
})
