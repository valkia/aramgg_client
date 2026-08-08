import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const fixturesDir = path.resolve(__dirname, '../fixtures/augment-ocr')
const manifestPath = path.join(fixturesDir, 'manifest.json')
const originalCwd = process.cwd()
const originalHome = process.env.HOME
const originalUserProfile = process.env.USERPROFILE
const originalOcrLocale = process.env.ARAMGG_OCR_LOCALE
let testRoot = null
let shutdownImageAnalyzer = null

async function writeJson(filePath, payload) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(payload), 'utf8')
}

async function seedFixtureData(manifest) {
    const dataRoot = path.join(testRoot, '.aramgg_client', 'data')
    const dataVersion = 'ocr-fixtures-v1'
    const augments = [...new Map(
        manifest.flatMap(sample => sample.expectedIds.map((id, index) => [
            Number(id),
            {
                id: Number(id),
                name: sample.expectedNames[index],
                rarity: 'kGold',
                iconPath: '',
            },
        ]))
    ).values()]

    for (const locale of ['zh-CN', 'en-US', 'zh-TW']) {
        const pointerName = locale === 'zh-CN' ? 'current.json' : `current.${locale}.json`
        const versionDir = locale === 'zh-CN'
            ? path.join(dataRoot, 'versions', dataVersion)
            : path.join(dataRoot, 'versions', locale, dataVersion)

        await writeJson(path.join(dataRoot, pointerName), {
            schemaVersion: 3,
            locale,
            dataVersion,
        })
        await writeJson(path.join(versionDir, 'manifest.json'), {
            locale,
            dataVersion,
            files: [{ path: 'augments.json' }],
        })
        await writeJson(path.join(versionDir, 'augments.json'), { augments })
    }
}

function idsOf(augments = []) {
    return augments.map(augment => Number(augment.id))
}

function namesOf(augments = []) {
    return augments.map(augment => String(augment.name))
}

function enginesOf(slotDiagnostics = []) {
    return [...new Set(slotDiagnostics.map(diagnostic => diagnostic.ocrEngine).filter(Boolean))]
}

async function assertFixtureResult(analyzeScreenshot, input, sample, variant) {
    const result = await analyzeScreenshot(input)

    assert.equal(result.success, true, `${sample.file} (${variant}): analysis should succeed`)
    assert.equal(
        result.analysis.cardCount,
        sample.expectedCardCount,
        `${sample.file} (${variant}): cardCount should match fixture expectation`
    )
    assert.deepEqual(
        idsOf(result.analysis.augments),
        sample.expectedIds,
        `${sample.file} (${variant}): augment ids should remain stable`
    )
    assert.deepEqual(
        namesOf(result.analysis.augments),
        sample.expectedNames,
        `${sample.file} (${variant}): augment names should remain stable`
    )

    const engines = enginesOf(result.analysis.slotDiagnostics)
    if (variant === '1280x720' || engines.length > 0) {
        assert.deepEqual(engines, ['paddleocr'], `${sample.file} (${variant}): OCR engine should be PaddleOCR only`)
    }

    console.log(JSON.stringify({
        file: sample.file,
        variant,
        cardCount: result.analysis.cardCount,
        ids: idsOf(result.analysis.augments),
        names: namesOf(result.analysis.augments),
        durationMs: result.metadata.analysisDurationMs,
    }))
}

async function assertGateResult(analyzeScreenshotGate, input, sample, variant) {
    const result = await analyzeScreenshotGate(input)

    assert.equal(result.success, true, `${sample.file} (${variant}): gate analysis should succeed`)
    assert.equal(
        result.likely,
        true,
        `${sample.file} (${variant}): title activity gate should pass for a card frame`
    )
    assert.equal(
        result.rerollVisible,
        true,
        `${sample.file} (${variant}): reroll button gate should pass for a card frame`
    )

    console.log(JSON.stringify({
        file: sample.file,
        variant,
        likely: result.likely,
        rerollVisible: result.rerollVisible,
        durationMs: result.durationMs,
    }))
}

async function main() {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aramgg-augment-ocr-'))
    process.env.HOME = testRoot
    process.env.USERPROFILE = testRoot
    process.env.ARAMGG_OCR_LOCALE = 'zh-CN'
    process.chdir(testRoot)
    await seedFixtureData(manifest)

    const imageAnalyzer = await import('../../src/main/image-analyzer.ts')
    const analyzeScreenshot = imageAnalyzer.analyzeScreenshot
    const analyzeScreenshotGate = imageAnalyzer.analyzeScreenshotGate
    shutdownImageAnalyzer = imageAnalyzer.shutdownImageAnalyzer

    for (const sample of manifest) {
        const imagePath = path.join(fixturesDir, sample.file)
        await assertFixtureResult(analyzeScreenshot, imagePath, sample, '1280x720')
        if (sample.expectedCardCount > 0) {
            const gateBuffer = await sharp(imagePath)
                .resize(640, 360, { fit: 'fill' })
                .png()
                .toBuffer()
            await assertGateResult(analyzeScreenshotGate, gateBuffer, sample, '640x360')
        }
        const automaticCaptureBuffer = await sharp(imagePath)
            .resize(1024, 576, { fit: 'fill' })
            .png()
            .toBuffer()
        await assertFixtureResult(analyzeScreenshot, automaticCaptureBuffer, sample, '1024x576')
    }
}

main()
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        if (shutdownImageAnalyzer) {
            await shutdownImageAnalyzer()
        }
        process.chdir(originalCwd)
        if (originalHome == null) {
            delete process.env.HOME
        } else {
            process.env.HOME = originalHome
        }
        if (originalUserProfile == null) {
            delete process.env.USERPROFILE
        } else {
            process.env.USERPROFILE = originalUserProfile
        }
        if (originalOcrLocale == null) {
            delete process.env.ARAMGG_OCR_LOCALE
        } else {
            process.env.ARAMGG_OCR_LOCALE = originalOcrLocale
        }
        if (testRoot) {
            await fs.rm(testRoot, { recursive: true, force: true })
        }
    })
