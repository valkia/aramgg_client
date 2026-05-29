import { describe, expect, it } from 'vitest'
import {
  getTopPickKey,
  mergeWinrateWithDetectedSlots
} from '../../src/renderer/service/augment-display.js'

const detected = (id, detectedSlot, extra = {}) => ({
  id,
  name: `augment-${id}`,
  rarity: 'gold',
  detectedSlot,
  ...extra,
})

const displayed = (id, detectedSlot, recommendScore) => ({
  id,
  augmentId: id,
  name: `augment-${id}`,
  rarity: 'gold',
  detectedSlot,
  recommendScore,
  winRate: recommendScore,
  pickRate: 0.1,
})

describe('augment floating display merge', () => {
  it('keeps unchanged slot stats while a rerolled slot is waiting for winrate data', () => {
    const previous = [
      displayed(101, 0, 0.42),
      displayed(102, 1, 0.48),
      displayed(103, 2, 0.63),
    ]
    const result = mergeWinrateWithDetectedSlots([], [
      detected(101, 0),
      detected(202, 1),
      detected(103, 2),
    ], previous)

    expect(result.map(augment => augment.id)).toEqual([101, 202, 103])
    expect(result[0].recommendScore).toBe(0.42)
    expect(result[1].recommendScore).toBeNull()
    expect(result[2].recommendScore).toBe(0.63)
    expect(getTopPickKey(result)).toBe(103)
  })

  it('does not show a top pick when only OCR fallback data is available', () => {
    const result = mergeWinrateWithDetectedSlots([], [
      detected(101, 0),
      detected(102, 1),
      detected(103, 2),
    ])

    expect(result.map(augment => augment.recommendScore)).toEqual([null, null, null])
    expect(getTopPickKey(result)).toBeNull()
  })

  it('keeps unread slots empty instead of carrying stale data', () => {
    const previous = [
      displayed(101, 0, 0.42),
      displayed(102, 1, 0.74),
      displayed(103, 2, 0.63),
    ]
    const result = mergeWinrateWithDetectedSlots([], [
      detected(101, 0),
      { id: null, missing: true, detectedSlot: 1 },
      detected(103, 2),
    ], previous)

    expect(result[1].missing).toBe(true)
    expect(result[1].id).toBeNull()
    expect(getTopPickKey(result)).toBe(103)
  })
})
