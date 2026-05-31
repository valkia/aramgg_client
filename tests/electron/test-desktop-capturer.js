/**
 * 测试脚本：验证 desktopCapturer 截图功能
 *
 * 使用方法：在 Electron 主进程中运行此脚本
 * 注意：此脚本需要在 Electron 环境中运行，不能直接用 node 执行
 */

import { desktopCapturer } from 'electron'
import fs from 'fs-extra'
import path from 'path'
import os from 'os'
import logger from '../../src/main/modules/logger.ts'

/**
 * 查找游戏窗口
 */
const findGameWindow = (sources) => {
    return sources.find(source => {
        const name = source.name.toLowerCase()
        return (
            name.includes('league of legends') ||
            name.includes('英雄联盟') ||
            name.includes('lol') ||
            (name.includes('league') && name.includes('client'))
        )
    }) || null
}

/**
 * 测试 desktopCapturer 功能
 */
export const testDesktopCapturer = async () => {
    logger.info('\n========== 开始测试 desktopCapturer ==========\n')

    try {
        // 1. 获取所有窗口和屏幕源
        logger.info('📋 正在获取所有窗口和屏幕源...')
        const sources = await desktopCapturer.getSources({
            types: ['window', 'screen'],
            thumbnailSize: { width: 1920, height: 1080 }
        })

        logger.info(`✅ 找到 ${sources.length} 个源:\n`)

        // 2. 列出所有窗口
        const windows = sources.filter(s => !s.id.startsWith('screen:'))
        const screens = sources.filter(s => s.id.startsWith('screen:'))

        logger.info(`🪟 窗口 (${windows.length} 个):`)
        windows.forEach((s, idx) => {
            const size = s.thumbnail.getSize()
            logger.info(`  ${idx + 1}. ${s.name}`)
            logger.info(`     ID: ${s.id}`)
            logger.info(`     尺寸: ${size.width}x${size.height}`)
        })

        logger.info(`\n🖥️  屏幕 (${screens.length} 个):`)
        screens.forEach((s, idx) => {
            const size = s.thumbnail.getSize()
            logger.info(`  ${idx + 1}. ${s.name}`)
            logger.info(`     ID: ${s.id}`)
            logger.info(`     尺寸: ${size.width}x${size.height}`)
        })

        // 3. 查找游戏窗口
        logger.info('\n🎮 查找游戏窗口...')
        const gameWindow = findGameWindow(sources)

        if (gameWindow) {
            const size = gameWindow.thumbnail.getSize()
            logger.info(`✅ 找到游戏窗口:`)
            logger.info(`   名称: ${gameWindow.name}`)
            logger.info(`   ID: ${gameWindow.id}`)
            logger.info(`   尺寸: ${size.width}x${size.height}`)

            // 4. 保存测试截图
            const testDir = path.join(os.homedir(), '.aramgg_client', 'test-screenshots')
            await fs.ensureDir(testDir)
            const testPath = path.join(testDir, `test-game-window-${Date.now()}.png`)

            const pngBuffer = gameWindow.thumbnail.toPNG()
            await fs.writeFile(testPath, pngBuffer)

            logger.info(`\n📸 测试截图已保存: ${testPath}`)
        } else {
            logger.info(`⚠️  未找到游戏窗口`)
            logger.info(`   提示：请确保游戏正在运行`)
        }

        logger.info('\n========== 测试完成 ==========\n')
        return {
            success: true,
            totalSources: sources.length,
            windowCount: windows.length,
            screenCount: screens.length,
            hasGameWindow: !!gameWindow,
            gameWindowName: gameWindow?.name
        }
    } catch (error) {
        logger.error('\n❌ 测试失败:', error)
        return {
            success: false,
            error: error.message
        }
    }
}

// 如果直接运行此脚本，执行测试
if (import.meta.url === `file://${process.argv[1]}`) {
    logger.info('⚠️  此脚本需要在 Electron 主进程中运行')
    logger.info('   请在 src/main/main.ts 中调用 testDesktopCapturer()')
}
