import type { AugmentSlotCount } from '../shared/augment-slots.ts'

export type AugmentCardLayout = {
    slotCount: AugmentSlotCount
    cardWidthRatio: number
    gapRatio: number
    modern: boolean
}

export const LEGACY_THREE_CARD_LAYOUT: AugmentCardLayout = {
    slotCount: 3, cardWidthRatio: 0.168, gapRatio: 0.0175, modern: false,
}

// 16.23 footage shows the same card width and spacing for both groups.
export const FOUR_CARD_LAYOUT: AugmentCardLayout = {
    slotCount: 4, cardWidthRatio: 0.174, gapRatio: 0.026, modern: true,
}
export const COMPACT_FOUR_CARD_LAYOUT: AugmentCardLayout = {
    ...LEGACY_THREE_CARD_LAYOUT, slotCount: 4, modern: true,
}
export const THREE_CARD_LAYOUT: AugmentCardLayout = { ...FOUR_CARD_LAYOUT, slotCount: 3 }

export function getAugmentCardGeometry(width: number, layout: AugmentCardLayout) {
    const cardWidth = width * layout.cardWidthRatio
    const cardGap = width * layout.gapRatio
    const groupWidth = cardWidth * layout.slotCount + cardGap * (layout.slotCount - 1)
    const groupLeft = (width - groupWidth) / 2
    return { cardWidth, cardGap, groupWidth, groupLeft }
}
