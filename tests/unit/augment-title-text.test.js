import { describe, expect, it } from 'vitest'
import { isLikelyTitleSlotText, matchAugmentDatabase } from '../../src/main/image-analyzer.ts'

describe('isLikelyTitleSlotText', () => {
  it('accepts title text with a short trait label', () => {
    expect(isLikelyTitleSlotText('速度恶魔 速度', { name: '速度恶魔' })).toBe(true)
    expect(isLikelyTitleSlotText('海克斯科技龙魂 复原力', { name: '海克斯科技龙魂' })).toBe(true)
  })

  it('rejects description text that merely contains an augment name', () => {
    expect(isLikelyTitleSlotText('裁决红包会每24（） 持续3秒的100移', { name: '红包' })).toBe(false)
  })

  it('matches a known OCR alias when a title drops its first character', async () => {
    const matches = await matchAugmentDatabase('板一眼 伤告')

    expect(matches[0]?.name).toBe('一板一眼')
  })
})
