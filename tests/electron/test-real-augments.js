/**
 * 测试真实海克斯截图 (q1.png - q17.png)
 */

import path from 'path'
import os from 'os'
import { analyzeScreenshot, shutdownImageAnalyzer } from '../../src/main/image-analyzer.ts'
import logger from '../../src/main/modules/logger.ts'

// 真实海克斯截图列表（在 ~/.aramgg_client/screenshots 目录中）
const screenshotDir = path.join(os.homedir(), '.aramgg_client', 'screenshots')
const realAugments = []
for (let i = 1; i <= 17; i++) {
    realAugments.push(path.join(screenshotDir, `q${i}.png`))
}

async function testRealAugments() {
    logger.info('🎯 测试真实海克斯截图（q1-q17）\n')

    let successCount = 0
    const detectedCards = []

    for (let i = 0; i < realAugments.length; i++) {
        const imagePath = realAugments[i]
        const filename = path.basename(imagePath)

        logger.info(`\n${'='.repeat(80)}`)
        logger.info(`[${i + 1}/17] 测试: ${filename}`)
        logger.info('='.repeat(80))

        try {
            const result = await analyzeScreenshot(imagePath)

            if (result.success) {
                const { cardCount, confidence, isAugmentPhase, cardColors } = result.analysis

                logger.info('\n📊 分析结果:')
                logger.info(`  检测到的卡片数: ${cardCount}`)
                logger.info(`  卡片颜色: [${cardColors.join(', ')}]`)
                logger.info(`  验证通过: ${isAugmentPhase ? '是' : '否'}`)
                logger.info(`  置信度: ${(confidence * 100).toFixed(1)}%`)

                if (cardCount === 3 && isAugmentPhase && confidence > 0.9) {
                    logger.info('\n✅ 检测成功！')
                    successCount++
                    detectedCards.push({
                        filename,
                        colors: cardColors.join(', '),
                        confidence: (confidence * 100).toFixed(1)
                    })
                } else if (cardCount === 3 && isAugmentPhase) {
                    logger.info('\n⚠️  检测到3张卡片但置信度低')
                    detectedCards.push({
                        filename,
                        colors: cardColors.join(', '),
                        confidence: (confidence * 100).toFixed(1)
                    })
                } else if (cardCount > 0) {
                    logger.info('\n⚠️  部分检测（卡片数量或验证失败）')
                } else {
                    logger.info('\n❌ 未检测到有效卡片')
                }
            } else {
                logger.info(`❌ 分析失败: ${result.error}`)
            }

        } catch (error) {
            logger.error(`❌ 测试失败:`, error.message)
        }
    }

    logger.info('\n' + '='.repeat(80))
    logger.info('📊 测试总结')
    logger.info('='.repeat(80))
    logger.info(`高置信度检测: ${successCount}/17 (${(successCount / 17 * 100).toFixed(1)}%)`)

    if (successCount === 17) {
        logger.info('\n✅ 完美！所有真实海克斯截图都被正确检测')
    } else if (successCount >= 15) {
        logger.info(`\n⚠️  检测率良好，但还有 ${17 - successCount} 张未被检测`)
    } else {
        logger.info(`\n❌ 检测率过低，需要调整算法`)
    }

    if (detectedCards.length > 0) {
        logger.info('\n✅ 检测成功的截图:')
        detectedCards.forEach((card, idx) => {
            logger.info(`  ${idx + 1}. ${card.filename} - [${card.colors}] - ${card.confidence}%`)
        })
    }
}

testRealAugments()
    .catch(console.error)
    .finally(() => shutdownImageAnalyzer())
