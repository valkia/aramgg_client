/**
 * 测试 demo 图片的海克斯检测
 */

import path from 'path'
import { analyzeScreenshot } from '../../src/main/image-analyzer.js'
import { fileURLToPath } from 'url'
import logger from '../../src/main/modules/logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const demoImages = [
    path.join(__dirname, '../../docs/demo1.png'),
    path.join(__dirname, '../../docs/demo2.png'),
    path.join(__dirname, '../../docs/demo3.png'),
]

async function testDemoImages() {
    logger.info('🧪 测试 Demo 海克斯图片\n')

    for (let i = 0; i < demoImages.length; i++) {
        const imagePath = demoImages[i]
        const filename = path.basename(imagePath)

        logger.info(`\n${'='.repeat(80)}`)
        logger.info(`[${i + 1}/3] 测试: ${filename}`)
        logger.info('='.repeat(80))

        try {
            const result = await analyzeScreenshot(imagePath)

            logger.info('\n📊 分析结果:')
            logger.info(`  成功: ${result.success}`)

            if (result.success) {
                const { cardCount, confidence, isAugmentPhase, cardColors, augments } = result.analysis

                logger.info(`  检测到的卡片数: ${cardCount}`)
                logger.info(`  卡片颜色: [${cardColors.join(', ')}]`)
                logger.info(`  验证通过: ${isAugmentPhase ? '是' : '否'}`)
                logger.info(`  置信度: ${(confidence * 100).toFixed(1)}%`)

                if (augments && augments.length > 0) {
                    logger.info('\n  🎯 识别的海克斯:')
                    augments.forEach((aug, idx) => {
                        logger.info(`    ${idx + 1}. ${aug.name} (${aug.rarity})`)
                    })
                }

                // 显示卡片位置信息
                if (result.analysis.cardPositions && result.analysis.cardPositions.length > 0) {
                    logger.info('\n  📍 卡片位置:')
                    result.analysis.cardPositions.forEach((pos, idx) => {
                        logger.info(`    卡片 ${idx + 1}: x=${pos.x}, y=${pos.y}, 宽=${pos.width}, 高=${pos.height}`)
                    })
                }

                // 判断结果
                if (cardCount === 3 && isAugmentPhase && confidence > 0.9) {
                    logger.info('\n  ✅ 检测成功！高置信度识别')
                } else if (cardCount === 3) {
                    logger.info('\n  ⚠️  检测到3张卡片，但验证失败或置信度低')
                } else if (cardCount > 0) {
                    logger.info('\n  ⚠️  部分检测，未通过验证')
                } else {
                    logger.info('\n  ❌ 未检测到有效卡片')
                }
            } else {
                logger.info(`  错误: ${result.error}`)
            }

        } catch (error) {
            logger.error(`❌ 测试失败:`, error.message)
        }
    }

    logger.info('\n' + '='.repeat(80))
    logger.info('测试完成')
}

testDemoImages().catch(console.error)
