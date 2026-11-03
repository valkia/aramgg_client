type RawFrame = { buffer: Buffer; width: number; height: number; channels: number }

// Retention evidence only: never use card chrome to recognize or open an overlay.
export function hasVisibleAugmentCardFrames(frame: RawFrame): boolean {
    const { buffer, width, height, channels } = frame
    if (width < 48 || height < 32 || channels < 3 || buffer.length < width * height * channels) {
        return false
    }

    const cardWidth = width * 0.168
    const gap = width * 0.0175
    const groupLeft = (width - cardWidth * 3 - gap * 2) / 2
    const sample = (x: number, y: number) => {
        const offset = (Math.min(height - 1, Math.max(0, Math.round(y))) * width +
            Math.min(width - 1, Math.max(0, Math.round(x)))) * channels
        return [buffer[offset], buffer[offset + 1], buffer[offset + 2]]
    }
    const isBorder = (rgb: number[]) => rgb[0] >= 130 && rgb[1] >= 110 && rgb[2] >= 80 &&
        Math.max(...rgb) - Math.min(...rgb) <= 120

    for (let slot = 0; slot < 3; slot++) {
        const left = groupLeft + slot * (cardWidth + gap)
        let topCoverage = 0
        for (let row = 0; row < 32; row++) {
            let hits = 0
            for (let col = 0; col < 48; col++) {
                if (isBorder(sample(left + cardWidth * (0.15 + col / 47 * 0.7),
                    height * (0.14 + row / 31 * 0.09)))) hits++
            }
            topCoverage = Math.max(topCoverage, hits / 48)
        }
        if (topCoverage < 0.8) return false

        for (const edge of [0, 0.91]) {
            let edgeCoverage = 0
            for (let col = 0; col < 16; col++) {
                let hits = 0
                for (let row = 0; row < 32; row++) {
                    if (isBorder(sample(left + cardWidth * (edge + col / 15 * 0.09),
                        height * (0.24 + row / 31 * 0.11)))) hits++
                }
                edgeCoverage = Math.max(edgeCoverage, hits / 32)
            }
            if (edgeCoverage < 0.8) return false
        }

        let darkInterior = 0
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                if (Math.max(...sample(left + cardWidth * (0.2 + col / 7 * 0.6),
                    height * (0.5 + row / 7 * 0.1))) < 85) darkInterior++
            }
        }
        if (darkInterior / 64 < 0.5) return false
    }
    return true
}
