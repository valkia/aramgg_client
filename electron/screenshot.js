import { desktopCapturer } from 'electron'
import path from 'path'
import fs from 'fs-extra'
import os from 'os'
import logger from './modules/logger.js'

// 获取临时目录
const getScreenshotDir = () => {
    const tempDir = path.join(os.homedir(), '.lol-tips-client', 'screenshots')
    fs.ensureDirSync(tempDir)
    return tempDir
}

/**
 * 查找游戏窗口
 * @param {Array} sources - desktopCapturer 返回的源列表
 * @returns {Object|null} 匹配的游戏窗口源，未找到返回 null
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
 * 查找屏幕源（回退方案）
 * @param {Array} sources - desktopCapturer 返回的源列表
 * @returns {Object|null} 主屏幕源，未找到返回 null
 */
const findScreenSource = (sources) => {
    // 优先使用主显示器（screen:0:0 通常是主屏幕）
    const screens = sources.filter(s => s.id.startsWith('screen:'))
    return screens.length > 0 ? screens[0] : null
}

/**
 * 尝试通过 desktopCapturer 获取 LoL 游戏窗口 ID
 * @returns {Promise<string|null>} 游戏窗口 ID，未找到返回 null
 */
export const getLolGameWindowId = async () => {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['window']
        })
        const gameWindow = findGameWindow(sources)
        return gameWindow ? gameWindow.id : null
    } catch (error) {
        logger.error('获取游戏窗口 ID 失败:', error)
        return null
    }
}

/**
 * 截图当前屏幕（优先截取游戏窗口）
 * @param {Object} options - 截图选项
 * @returns {Promise<Object>} 截图结果
 */
export const captureScreenshot = async (options = {}) => {
    try {
        const screenshotDir = getScreenshotDir()
        const timestamp = Date.now()
        const filename = `screenshot-${timestamp}.png`
        const filepath = path.join(screenshotDir, filename)

        // 获取所有窗口和屏幕源
        const sources = await desktopCapturer.getSources({
            types: ['window', 'screen'],
            thumbnailSize: { width: 1920, height: 1080 }
        })

        // 查找游戏窗口
        const gameWindow = findGameWindow(sources)

        // 确定截图源：优先游戏窗口，否则使用全屏
        let captureSource = gameWindow
        let captureMode = 'window'

        if (!gameWindow) {
            captureSource = findScreenSource(sources)
            captureMode = 'screen'
        }

        if (!captureSource) {
            throw new Error('无法获取截图源')
        }

        // 获取截图
        const screenshot = captureSource.thumbnail

        if (!screenshot || screenshot.isEmpty()) {
            throw new Error('截图为空')
        }

        // 转换为 PNG Buffer 并保存
        const pngBuffer = screenshot.toPNG()
        await fs.writeFile(filepath, pngBuffer)

        const hasLolWindow = !!gameWindow
        const size = screenshot.getSize()

        if (gameWindow) {
            logger.info(`找到游戏窗口: ${gameWindow.name}`)
            logger.debug(`窗口尺寸: ${size.width}x${size.height}`)
        } else {
            logger.warn(`未找到游戏窗口，使用全屏截图`)
            logger.debug(`屏幕尺寸: ${size.width}x${size.height}`)
        }

        logger.info(`Screenshot saved: ${filepath}`)

        return {
            success: true,
            filepath,
            filename,
            timestamp,
            hasLolWindow,
            captureMode,
            windowName: gameWindow?.name,
            width: size.width,
            height: size.height
        }
    } catch (error) {
        logger.error('Screenshot capture failed:', error)
        return {
            success: false,
            error: error.message,
        }
    }
}

// 获取截图目录中的所有截图
export const getScreenshots = async () => {
    try {
        const screenshotDir = getScreenshotDir()
        const files = await fs.readdir(screenshotDir)
        return files.filter(f => f.endsWith('.png')).map(f => ({
            filename: f,
            filepath: path.join(screenshotDir, f),
        }))
    } catch (error) {
        logger.error('Failed to get screenshots:', error)
        return []
    }
}

// 清理旧截图（保留最新的N张）
export const cleanupOldScreenshots = async (keepCount = 10) => {
    try {
        const screenshotDir = getScreenshotDir()
        const files = await fs.readdir(screenshotDir)
        const pngFiles = files.filter(f => f.endsWith('.png'))

        if (pngFiles.length > keepCount) {
            // 按修改时间排序
            const fileStats = await Promise.all(
                pngFiles.map(async (f) => {
                    const filepath = path.join(screenshotDir, f)
                    const stats = await fs.stat(filepath)
                    return { f, mtime: stats.mtime.getTime() }
                })
            )

            fileStats.sort((a, b) => b.mtime - a.mtime)

            // 删除超出数量的文件
            for (let i = keepCount; i < fileStats.length; i++) {
                const filepath = path.join(screenshotDir, fileStats[i].f)
                await fs.remove(filepath)
                logger.info(`Deleted old screenshot: ${fileStats[i].f}`)
            }
        }
    } catch (error) {
        logger.error('Failed to cleanup screenshots:', error)
    }
}
