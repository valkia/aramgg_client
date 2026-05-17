import { execFile } from 'child_process'
import { desktopCapturer } from 'electron'
import logger from './modules/logger.js'

/**
 * 查找游戏窗口
 * @param {Array} sources - desktopCapturer 返回的源列表
 * @returns {Object|null} 匹配的游戏窗口源，未找到返回 null
 */
const findGameWindow = (sources) => {
    const candidates = sources.map(source => {
        const name = source.name.toLowerCase()
        const isOwnWindow =
            name.includes('aramgg_client') ||
            name.includes('lol_tips_client') ||
            name.includes('champr')

        if (isOwnWindow) {
            return { source, score: 0 }
        }

        if (name.includes('league of legends') && name.includes('client')) {
            return { source, score: 100 }
        }

        if (name.includes('league of legends') || name.includes('英雄联盟')) {
            return { source, score: 80 }
        }

        if (name.includes('league') && name.includes('client')) {
            return { source, score: 60 }
        }

        return { source, score: 0 }
    })

    candidates.sort((a, b) => b.score - a.score)
    return candidates[0]?.score > 0 ? candidates[0].source : null
}

const isLolGameProcessRunning = () => {
    if (process.platform !== 'win32') {
        return Promise.resolve(null)
    }

    return new Promise((resolve) => {
        execFile(
            'tasklist',
            ['/FI', 'IMAGENAME eq League of Legends.exe', '/FO', 'CSV', '/NH'],
            { timeout: 3000, windowsHide: true },
            (error, stdout = '') => {
                if (error) {
                    logger.debug('Unable to query LoL game process:', error.message)
                    resolve(false)
                    return
                }

                resolve(stdout.toLowerCase().includes('league of legends.exe'))
            }
        )
    })
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

export const getLolGameWindowInfo = async () => {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['window'],
            thumbnailSize: { width: 1, height: 1 },
        })
        const gameWindow = findGameWindow(sources)
        return {
            found: !!gameWindow,
            id: gameWindow?.id || null,
            name: gameWindow?.name || null,
        }
    } catch (error) {
        logger.error('Failed to query LoL game window:', error)
        return {
            found: false,
            id: null,
            name: null,
            error: error.message,
        }
    }
}

export const getLolGameStatus = async () => {
    const [processRunning, windowInfo] = await Promise.all([
        isLolGameProcessRunning(),
        getLolGameWindowInfo(),
    ])

    return {
        ...windowInfo,
        processRunning,
        isGameOpen: windowInfo.found && (processRunning === null || processRunning),
    }
}

/**
 * 截图当前屏幕（优先截取游戏窗口）
 * 截图直接返回内存Buffer，不进行磁盘I/O
 * @param {Object} options - 截图选项
 * @returns {Promise<Object>} 截图结果
 */
export const captureScreenshot = async (_options = {}) => {
    try {
        const timestamp = Date.now()

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

        // 转换为 PNG Buffer（内存中，不保存到文件）
        const pngBuffer = screenshot.toPNG()
        const hasLolWindow = !!gameWindow
        const size = screenshot.getSize()

        if (gameWindow) {
            logger.info(`找到游戏窗口: ${gameWindow.name}`)
            logger.debug(`窗口尺寸: ${size.width}x${size.height}`)
        } else {
            logger.warn(`未找到游戏窗口，使用全屏截图`)
            logger.debug(`屏幕尺寸: ${size.width}x${size.height}`)
        }

        logger.info(`Screenshot captured: ${size.width}x${size.height}, buffer size: ${(pngBuffer.length / 1024).toFixed(1)}KB`)

        return {
            success: true,
            buffer: pngBuffer,
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

// 截图模块已不再需要文件管理功能
// 所有截图直接保存在内存Buffer中进行OCR识别
// 如需调试保存截图，可在调用方自行处理
