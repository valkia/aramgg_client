import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeScreenshot, shutdownImageAnalyzer } from '../../src/main/image-analyzer.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const fixturesDir = path.resolve(__dirname, '../fixtures/augment-ocr')
const manifestPath = path.join(fixturesDir, 'manifest.json')

function idsOf(augments = []) {
    return augments.map(augment => Number(augment.id))
}

function namesOf(augments = []) {
    return augments.map(augment => String(augment.name))
}

function enginesOf(slotDiagnostics = []) {
    return [...new Set(slotDiagnostics.map(diagnostic => diagnostic.ocrEngine).filter(Boolean))]
}

async function main() {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))

    for (const sample of manifest) {
        const imagePath = path.join(fixturesDir, sample.file)
        const result = await analyzeScreenshot(imagePath)

        assert.equal(result.success, true, `${sample.file}: analysis should succeed`)
        assert.equal(
            result.analysis.cardCount,
            sample.expectedCardCount,
            `${sample.file}: cardCount should match fixture expectation`
        )
        assert.deepEqual(
            idsOf(result.analysis.augments),
            sample.expectedIds,
            `${sample.file}: augment ids should remain stable`
        )
        assert.deepEqual(
            namesOf(result.analysis.augments),
            sample.expectedNames,
            `${sample.file}: augment names should remain stable`
        )

        const engines = enginesOf(result.analysis.slotDiagnostics)
        assert.deepEqual(engines, ['paddleocr'], `${sample.file}: OCR engine should be PaddleOCR only`)

        console.log(JSON.stringify({
            file: sample.file,
            description: sample.description,
            cardCount: result.analysis.cardCount,
            ids: idsOf(result.analysis.augments),
            names: namesOf(result.analysis.augments),
            durationMs: result.metadata.analysisDurationMs,
        }))
    }
}

main()
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(() => shutdownImageAnalyzer())
