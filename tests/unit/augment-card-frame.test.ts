import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { hasVisibleAugmentCardFrames } from '../../src/main/augment-card-frame.ts'

async function visible(input: Buffer | string, width = 1024, height = 576) {
    const { data, info } = await sharp(input).resize(width, height).ensureAlpha().raw()
        .toBuffer({ resolveWithObject: true })
    return hasVisibleAugmentCardFrames({ buffer: data, ...info })
}

describe('augment card frame retention evidence', () => {
    it('recognizes actual gold and silver card frames across capture sizes', async () => {
        for (const file of ['docs/demo1.png', 'docs/demo2.png', 'docs/demo4.png',
            'tests/fixtures/augment-ocr/full-three-cards.png']) {
            expect(await visible(file), file).toBe(true)
        }
        const silver = await sharp('docs/demo3.png')
            .extract({ left: 320, top: 180, width: 1920, height: 1080 }).png().toBuffer()
        expect(await visible(silver)).toBe(true)
        expect(await visible(silver, 640, 360)).toBe(true)
    })

    it('retains real cards when a hover tooltip hides titles and reroll buttons', async () => {
        expect(await visible('tests/fixtures/augment-ocr/hover-tooltip-card-frames.png')).toBe(true)
    })

    it('rejects ordinary assistant UI and blank/bright frames', async () => {
        expect(await visible('docs/image0.png')).toBe(false)
        for (const background of ['#000000', '#dddddd']) {
            const image = await sharp({ create: { width: 1024, height: 576, channels: 3, background } })
                .png().toBuffer()
            expect(await visible(image)).toBe(false)
        }
    })

    it('rejects a frame with the selection cards removed while the HUD remains', async () => {
        const blank = await sharp({ create: { width: 600, height: 370, channels: 3, background: '#101820' } })
            .png().toBuffer()
        const image = await sharp('tests/fixtures/augment-ocr/full-three-cards.png')
            .resize(1024, 576).composite([{ input: blank, left: 212, top: 70 }]).png().toBuffer()
        expect(await visible(image)).toBe(false)
    })
})
