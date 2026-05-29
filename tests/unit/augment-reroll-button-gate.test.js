import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { detectAugmentRerollButtons } from '../../src/main/image-analyzer.js'

describe('augment reroll button gate', () => {
  it('detects active and disabled reroll buttons in demo augment screens', async () => {
    for (const demo of ['docs/demo1.png', 'docs/demo2.png', 'docs/demo3.png', 'docs/demo4.png']) {
      const result = await detectAugmentRerollButtons(readFileSync(demo))

      expect(result.visible, demo).toBe(true)
      expect(result.activeSlots.length, demo).toBeGreaterThanOrEqual(2)
    }
  })
})
