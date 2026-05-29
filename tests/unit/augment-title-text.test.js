import { describe, expect, it } from 'vitest'
import { isLikelyTitleSlotText } from '../../src/main/image-analyzer.js'

describe('isLikelyTitleSlotText', () => {
  it('accepts title text with a short trait label', () => {
    expect(isLikelyTitleSlotText('速度恶魔 速度', { name: '速度恶魔' })).toBe(true)
    expect(isLikelyTitleSlotText('海克斯科技龙魂 复原力', { name: '海克斯科技龙魂' })).toBe(true)
  })

  it('rejects description text that merely contains an augment name', () => {
    expect(isLikelyTitleSlotText('裁决红包会每24（） 持续3秒的100移', { name: '红包' })).toBe(false)
  })
})
