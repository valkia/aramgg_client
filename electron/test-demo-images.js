/**
 * 测试 demo 图片的海克斯检测
 */

import path from 'path'
import { analyzeScreenshot } from './image-analyzer.js'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const demoImages = [
    path.join(__dirname, '../docs/demo1.png'),
    path.join(__dirname, '../docs/demo2.png'),
    path.join(__dirname, '../docs/demo3.png'),
]

async function testDemoImages() {
    console.log('🧪 测试 Demo 海克斯图片\n')

    for (let i = 0; i < demoImages.length; i++) {
        const imagePath = demoImages[i]
        const filename = path.basename(imagePath)

        console.log(`\n${'='.repeat(80)}`)
        console.log(`[${i + 1}/3] 测试: ${filename}`)
        console.log('='.repeat(80))

        try {
            const result = await analyzeScreenshot(imagePath)

            console.log('\n📊 分析结果:')
            console.log(`  成功: ${result.success}`)

            if (result.success) {
                const { cardCount, confidence, isAugmentPhase, cardColors, augments } = result.analysis

                console.log(`  检测到的卡片数: ${cardCount}`)
                console.log(`  卡片颜色: [${cardColors.join(', ')}]`)
                console.log(`  验证通过: ${isAugmentPhase ? '是' : '否'}`)
                console.log(`  置信度: ${(confidence * 100).toFixed(1)}%`)

                if (augments && augments.length > 0) {
                    console.log('\n  🎯 识别的海克斯:')
                    augments.forEach((aug, idx) => {
                        console.log(`    ${idx + 1}. ${aug.name} (${aug.rarity})`)
                    })
                }

                // 显示卡片位置信息
                if (result.analysis.cardPositions && result.analysis.cardPositions.length > 0) {
                    console.log('\n  📍 卡片位置:')
                    result.analysis.cardPositions.forEach((pos, idx) => {
                        console.log(`    卡片 ${idx + 1}: x=${pos.x}, y=${pos.y}, 宽=${pos.width}, 高=${pos.height}`)
                    })
                }

                // 判断结果
                if (cardCount === 3 && isAugmentPhase && confidence > 0.9) {
                    console.log('\n  ✅ 检测成功！高置信度识别')
                } else if (cardCount === 3) {
                    console.log('\n  ⚠️  检测到3张卡片，但验证失败或置信度低')
                } else if (cardCount > 0) {
                    console.log('\n  ⚠️  部分检测，未通过验证')
                } else {
                    console.log('\n  ❌ 未检测到有效卡片')
                }
            } else {
                console.log(`  错误: ${result.error}`)
            }

        } catch (error) {
            console.error(`❌ 测试失败:`, error.message)
        }
    }

    console.log('\n' + '='.repeat(80))
    console.log('测试完成')
}

testDemoImages().catch(console.error)
