/**
 * 截图分析测试脚本
 * 用于批量测试 screenshots 目录中的所有截图
 *
 * 使用方法:
 *   node tests/electron/test-screenshot-analysis.js
 */

import fs from 'fs-extra'
import path from 'path'
import os from 'os'
import { analyzeScreenshot, shutdownImageAnalyzer } from '../../src/main/image-analyzer.js'
import logger from '../../src/main/modules/logger.js'

// 截图目录
const SCREENSHOT_DIR = path.join(os.homedir(), '.aramgg_client', 'screenshots')

// 颜色输出工具
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
}

function colorize(text, color) {
    return `${colors[color]}${text}${colors.reset}`
}

/**
 * 获取所有截图文件
 */
async function getAllScreenshots() {
    try {
        if (!await fs.pathExists(SCREENSHOT_DIR)) {
            logger.error(colorize('❌ 截图目录不存在:', 'red'), SCREENSHOT_DIR)
            return []
        }

        const files = await fs.readdir(SCREENSHOT_DIR)
        const screenshots = files
            .filter(f => f.endsWith('.png'))
            .map(f => ({
                filename: f,
                filepath: path.join(SCREENSHOT_DIR, f),
            }))
            .sort((a, b) => b.filename.localeCompare(a.filename)) // 按时间倒序

        return screenshots
    } catch (error) {
        logger.error(colorize('❌ 读取截图目录失败:', 'red'), error.message)
        return []
    }
}

/**
 * 格式化检测结果
 */
function formatResult(result) {
    if (!result.success) {
        return {
            status: colorize('❌ 分析失败', 'red'),
            detail: result.error || '未知错误',
        }
    }

    const { cardCount, confidence, isAugmentPhase, cardColors } = result.analysis

    let status
    let statusColor

    if (cardCount === 3 && isAugmentPhase && confidence > 0.9) {
        status = '✅ 高置信度检测'
        statusColor = 'green'
    } else if (cardCount === 3 && isAugmentPhase) {
        status = '⚠️  检测但置信度低'
        statusColor = 'yellow'
    } else if (cardCount > 0) {
        status = '⚠️  部分检测（未通过验证）'
        statusColor = 'yellow'
    } else {
        status = '❌ 未检测到有效卡片'
        statusColor = 'red'
    }

    return {
        status: colorize(status, statusColor),
        detail: `卡片: ${cardCount}, 颜色: [${cardColors.join(', ')}], 置信度: ${(confidence * 100).toFixed(1)}%, 验证通过: ${isAugmentPhase ? '是' : '否'}`,
    }
}

/**
 * 测试单个截图
 */
async function testScreenshot(screenshot, index, total) {
    logger.info(colorize(`\n[${ index + 1 }/${total}] 测试截图: ${screenshot.filename}`, 'cyan'))
    logger.info('━'.repeat(80))

    const startTime = Date.now()
    const result = await analyzeScreenshot(screenshot.filepath)
    const duration = Date.now() - startTime

    const formatted = formatResult(result)

    logger.info(`状态: ${formatted.status}`)
    logger.info(`详情: ${formatted.detail}`)
    logger.info(`耗时: ${colorize(`${duration}ms`, 'blue')}`)

    // 如果是成功的高置信度检测，显示更多信息
    if (result.success && result.analysis.cardCount === 3 &&
        result.analysis.isAugmentPhase && result.analysis.confidence > 0.9) {
        logger.info(colorize('🎯 推荐的海克斯:', 'green'))
        result.analysis.augments.forEach((aug, i) => {
            logger.info(`  ${i + 1}. ${aug.name} (${aug.rarity})`)
        })
    }

    return {
        filename: screenshot.filename,
        result,
        formatted,
        duration,
    }
}

/**
 * 生成统计报告
 */
function generateReport(testResults) {
    logger.info(colorize('\n' + '='.repeat(80), 'bright'))
    logger.info(colorize('📊 测试统计报告', 'bright'))
    logger.info('='.repeat(80))

    const total = testResults.length
    const successful = testResults.filter(r =>
        r.result.success &&
        r.result.analysis.cardCount === 3 &&
        r.result.analysis.isAugmentPhase &&
        r.result.analysis.confidence > 0.9
    ).length

    const partialDetection = testResults.filter(r =>
        r.result.success &&
        r.result.analysis.cardCount > 0 &&
        (r.result.analysis.cardCount < 3 || !r.result.analysis.isAugmentPhase || r.result.analysis.confidence <= 0.9)
    ).length

    const noDetection = testResults.filter(r =>
        r.result.success &&
        r.result.analysis.cardCount === 0
    ).length

    const failed = testResults.filter(r => !r.result.success).length

    const avgDuration = testResults.reduce((sum, r) => sum + r.duration, 0) / total

    logger.info(`总测试数: ${colorize(total, 'cyan')}`)
    logger.info(`高置信度检测: ${colorize(successful, 'green')} (${(successful / total * 100).toFixed(1)}%)`)
    logger.info(`部分检测: ${colorize(partialDetection, 'yellow')} (${(partialDetection / total * 100).toFixed(1)}%)`)
    logger.info(`未检测: ${colorize(noDetection, 'red')} (${(noDetection / total * 100).toFixed(1)}%)`)
    logger.info(`分析失败: ${colorize(failed, 'red')} (${(failed / total * 100).toFixed(1)}%)`)
    logger.info(`平均耗时: ${colorize(`${avgDuration.toFixed(0)}ms`, 'blue')}`)

    // 显示高置信度检测的截图列表
    if (successful > 0) {
        logger.info(colorize('\n✅ 高置信度检测的截图:', 'green'))
        testResults
            .filter(r =>
                r.result.success &&
                r.result.analysis.cardCount === 3 &&
                r.result.analysis.isAugmentPhase &&
                r.result.analysis.confidence > 0.9
            )
            .forEach((r, i) => {
                const colors = r.result.analysis.cardColors.join(', ')
                logger.info(`  ${i + 1}. ${r.filename} - [${colors}] - ${(r.result.analysis.confidence * 100).toFixed(1)}%`)
            })
    }

    // 显示部分检测的截图列表
    if (partialDetection > 0) {
        logger.info(colorize('\n⚠️  部分检测的截图（可能的误检）:', 'yellow'))
        testResults
            .filter(r =>
                r.result.success &&
                r.result.analysis.cardCount > 0 &&
                (r.result.analysis.cardCount < 3 || !r.result.analysis.isAugmentPhase || r.result.analysis.confidence <= 0.9)
            )
            .forEach((r, i) => {
                const { cardCount, isAugmentPhase, confidence } = r.result.analysis
                logger.info(`  ${i + 1}. ${r.filename} - 卡片:${cardCount}, 验证:${isAugmentPhase?'通过':'失败'}, 置信度:${(confidence*100).toFixed(1)}%`)
            })
    }

    logger.info('\n' + '='.repeat(80))
}

/**
 * 主函数
 */
async function main() {
    logger.info(colorize('🧪 截图分析测试工具', 'bright'))
    logger.info(colorize('测试目录:', 'cyan'), SCREENSHOT_DIR)
    logger.info()

    // 获取所有截图
    const screenshots = await getAllScreenshots()

    if (screenshots.length === 0) {
        logger.info(colorize('⚠️  未找到任何截图文件', 'yellow'))
        logger.info('请先进行一些截图，或者检查目录路径')
        return
    }

    logger.info(colorize(`找到 ${screenshots.length} 个截图文件`, 'cyan'))

    // 询问用户是否要测试所有截图
    const MAX_AUTO_TEST = 100
    let screenshotsToTest = screenshots

    if (screenshots.length > MAX_AUTO_TEST) {
        logger.info(colorize(`\n⚠️  截图数量较多 (${screenshots.length}), 建议只测试最近的 ${MAX_AUTO_TEST} 张`, 'yellow'))
        logger.info(colorize('将测试最近的 ' + MAX_AUTO_TEST + ' 张截图', 'cyan'))
        screenshotsToTest = screenshots.slice(0, MAX_AUTO_TEST)
    }

    // 执行测试
    const testResults = []

    for (let i = 0; i < screenshotsToTest.length; i++) {
        const result = await testScreenshot(screenshotsToTest[i], i, screenshotsToTest.length)
        testResults.push(result)
    }

    // 生成报告
    generateReport(testResults)

    logger.info(colorize('\n✅ 测试完成！', 'green'))
}

// 运行测试
main()
    .catch(error => {
        logger.error(colorize('❌ 测试失败:', 'red'), error)
        process.exitCode = 1
    })
    .finally(() => shutdownImageAnalyzer())
