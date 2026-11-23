import { COMPACT_FOUR_CARD_LAYOUT, FOUR_CARD_LAYOUT, getAugmentCardGeometry, LEGACY_THREE_CARD_LAYOUT, THREE_CARD_LAYOUT } from './augment-card-layout.ts'
import type { AugmentCardLayout } from './augment-card-layout.ts'

type RawFrame = { buffer: Buffer; width: number; height: number; channels: number }

// Frame edges select the crop geometry and can retain an open overlay. They do
// not identify augments or open an overlay without the title/button gate.
export function hasVisibleAugmentCardFrames(frame: RawFrame, layout = LEGACY_THREE_CARD_LAYOUT): boolean {
    const { buffer, width, height, channels } = frame
    if (width < 48 || height < 32 || channels < 3 || buffer.length < width * height * channels) {
        return false
    }

    const { cardWidth, cardGap, groupLeft } = getAugmentCardGeometry(width, layout)
    const [minR, minG, minB] = layout.modern ? [110, 95, 75] : [130, 110, 80]
    const offsetAt = (x: number, y: number) =>
        (Math.min(height - 1, Math.max(0, Math.round(y))) * width +
            Math.min(width - 1, Math.max(0, Math.round(x)))) * channels
    const isBorder = (x: number, y: number) => {
        const offset = offsetAt(x, y)
        const r = buffer[offset], g = buffer[offset + 1], b = buffer[offset + 2]
        return r >= minR && g >= minG && b >= minB && Math.max(r, g, b) - Math.min(r, g, b) <= 120
    }

    const hasCardAt = (left: number) => {
        let topCoverage = 0
        for (let row = 0; row < 32; row++) {
            let hits = 0
            for (let col = 0; col < 48; col++) {
                if (isBorder(left + cardWidth * (0.15 + col / 47 * 0.7),
                    height * (0.14 + row / 31 * 0.09))) hits++
            }
            topCoverage = Math.max(topCoverage, hits / 48)
        }
        if (topCoverage < 0.8) return false

        for (const edge of [0, 0.91]) {
            let edgeCoverage = 0
            for (let col = 0; col < 16; col++) {
                let hits = 0
                for (let row = 0; row < 32; row++) {
                    if (isBorder(left + cardWidth * (edge + col / 15 * 0.09),
                        height * (0.24 + row / 31 * 0.11))) hits++
                }
                edgeCoverage = Math.max(edgeCoverage, hits / 32)
            }
            if (edgeCoverage < 0.8) return false
        }

        let darkInterior = 0
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const offset = offsetAt(left + cardWidth * (0.2 + col / 7 * 0.6), height * (0.5 + row / 7 * 0.1))
                if (Math.max(buffer[offset], buffer[offset + 1], buffer[offset + 2]) < 85) darkInterior++
            }
        }
        return darkInterior / 64 >= 0.5
    }

    // Three intact frames at the four-column positions still identify the
    // layout when a tooltip or reroll animation covers the remaining card.
    let visible = 0
    for (let slot = 0; slot < layout.slotCount; slot++) {
        if (hasCardAt(groupLeft + slot * (cardWidth + cardGap))) visible++
        if (visible === 3) return true
        if (visible + layout.slotCount - slot - 1 < 3) return false
    }
    return false
}

export function detectAugmentCardLayout(frame: RawFrame): AugmentCardLayout | null {
    for (const layout of [FOUR_CARD_LAYOUT, LEGACY_THREE_CARD_LAYOUT, THREE_CARD_LAYOUT, COMPACT_FOUR_CARD_LAYOUT]) {
        if (hasVisibleAugmentCardFrames(frame, layout)) return layout
    }
    return null
}
