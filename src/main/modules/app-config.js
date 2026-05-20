import { app, globalShortcut, BrowserWindow, ipcMain } from 'electron'
import Store from 'electron-store'
import { captureScreenshot, getLolGameStatus } from '../screenshot.js'
import { analyzeScreenshot } from '../image-analyzer.js'
import { registerIpcHandlers } from './ipc-handlers.js'
import { applyFloatingWindowLayout, createMainWindow, createPopupWindow, createFloatingWindow, toggleMainWindow, getFloatingWindow } from './window-manager.js'
import autoScreenshotService from '../auto-screenshot-service.js'
import { getLCUServiceInstance } from '../services/lcu/lcu-service.ts'
import { checkForClientUpdate } from '../version-checker.js'
import logger from './logger.js'

const __dirname = import.meta.dirname
const store = new Store()

// 全局游戏流程轮询定时器
let lcuPollingTimer = null
const AUTO_SCREENSHOT_INTERVAL_MS = 200
const AUTO_SCREENSHOT_MAX_CAPTURES = 100
const GAME_WINDOW_STATUS_LOG_INTERVAL_MS = 30000
let autoScreenshotManagedByGameFlow = false
let lastGameWindowStatusKey = null
let lastGameWindowStatusLogAt = 0
let backgroundMonitoringEnabled = true
let gameFlowMonitorInitializing = false

/**
 * 初始化应用
 */
export async function init() {
    logger.info(`${'='.repeat(50)}`)
    logger.info(`ChampR 应用启动中...`)
    logger.info(`${'='.repeat(50)}`)

    // 设置应用菜单为空
    const { Menu } = await import('electron')
    Menu.setApplicationMenu(null)

    // 注册 IPC 处理器
    registerIpcHandlers(process.env.NODE_ENV === 'development')

    // 创建主窗口
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
    const devServerUrl = isDev
        ? process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
        : ''

    const mainWindow = await createMainWindow(isDev, devServerUrl)
    const popupWindow = await createPopupWindow(isDev, devServerUrl)
    const floatingWindow = await createFloatingWindow(isDev, devServerUrl)
    logger.info('窗口已创建:', {
        main: !!mainWindow,
        popup: !!popupWindow,
        floating: !!floatingWindow
    })

    setTimeout(() => {
        checkForClientUpdate(mainWindow).catch((error) => {
            logger.warn('Client update check failed:', error.message)
        })
    }, 1000)

    registerBackgroundMonitoringIpc()

    // 初始化游戏流程监控（延迟初始化，避免阻塞应用启动）
    logger.info('将在后台初始化游戏流程监控...')
    setTimeout(() => {
        startGameFlowMonitor('startup')
    }, 2000)

    // 注册 F1 全局快捷键
    registerF1Shortcut()

    // 注册其他应用事件
    registerAppEvents()

    return { mainWindow, popupWindow, toggleMainWindow }
}

/**
 * 自动检测游戏目录
 */
async function autoDetectLolPath() {
    const fs = await import('fs')

    // 常见的游戏安装目录
    const commonPaths = [
        'C:\\Riot Games\\League of Legends',
        'C:\\Program Files\\League of Legends',
        'D:\\Riot Games\\League of Legends',
        'D:\\Games\\League of Legends',
        'E:\\wegame\\英雄联盟(26)', // 用户的路径
    ]

    for (const checkPath of commonPaths) {
        if (fs.existsSync(checkPath)) {
            logger.info(`自动检测到游戏目录: ${checkPath}`)
            return checkPath
        }
    }

    return null
}

async function startAutoScreenshotForGame(reason) {
    if (autoScreenshotService.isRunning) {
        return false
    }

    autoScreenshotService.setConfig({
        interval: AUTO_SCREENSHOT_INTERVAL_MS,
        maxScreenshots: AUTO_SCREENSHOT_MAX_CAPTURES,
    })

    const success = await autoScreenshotService.start(AUTO_SCREENSHOT_INTERVAL_MS)
    if (success) {
        autoScreenshotManagedByGameFlow = true
        logger.info(`Auto screenshot service started by game monitor: ${reason}`)
    }

    return success
}

function stopAutoScreenshotForGame(reason, force = false) {
    if (!autoScreenshotService.isRunning) {
        autoScreenshotManagedByGameFlow = false
        return false
    }

    if (!force && !autoScreenshotManagedByGameFlow) {
        return false
    }

    const success = autoScreenshotService.stop()
    if (success) {
        autoScreenshotManagedByGameFlow = false
        logger.info(`Auto screenshot service stopped by game monitor: ${reason}`)
    }

    return success
}

async function startGameFlowMonitor(reason) {
    if (!backgroundMonitoringEnabled) {
        logger.info(`Game flow monitor start skipped while disabled: ${reason}`)
        return false
    }

    if (lcuPollingTimer || gameFlowMonitorInitializing) {
        return false
    }

    gameFlowMonitorInitializing = true
    try {
        await initGameFlowMonitor()
        return !!lcuPollingTimer
    } finally {
        gameFlowMonitorInitializing = false
    }
}

function stopGameFlowMonitor(reason) {
    let stopped = false

    if (lcuPollingTimer) {
        clearInterval(lcuPollingTimer)
        lcuPollingTimer = null
        logger.info(`Game flow polling stopped: ${reason}`)
        stopped = true
    }

    if (autoScreenshotService && autoScreenshotService.isRunning) {
        autoScreenshotService.stop()
        autoScreenshotManagedByGameFlow = false
        logger.info(`Auto screenshot service stopped: ${reason}`)
        stopped = true
    }

    return stopped
}

async function setBackgroundMonitoringEnabled(enabled, reason) {
    backgroundMonitoringEnabled = enabled

    if (!enabled) {
        stopGameFlowMonitor(reason)
    } else {
        await startGameFlowMonitor(reason)
    }

    return {
        success: true,
        enabled: backgroundMonitoringEnabled,
        polling: !!lcuPollingTimer,
        autoScreenshot: !!autoScreenshotService?.isRunning,
    }
}

function registerBackgroundMonitoringIpc() {
    ipcMain.handle('set-background-monitoring-enabled', async (_event, enabled) => {
        return setBackgroundMonitoringEnabled(Boolean(enabled), 'renderer visibility changed')
    })
}

function logLolGameStatus(status, phase) {
    const processState = status.processRunning === null
        ? 'unknown'
        : status.processRunning
            ? 'running'
            : 'missing'
    const windowState = status.found ? status.name : 'missing'
    const statusKey = `${phase}:${processState}:${windowState}:${autoScreenshotService.isRunning}`
    const now = Date.now()

    if (
        statusKey !== lastGameWindowStatusKey ||
        now - lastGameWindowStatusLogAt > GAME_WINDOW_STATUS_LOG_INTERVAL_MS
    ) {
        logger.info(
            `LoL game status: phase=${phase || 'unknown'}, process=${processState}, window=${windowState}, autoScreenshot=${autoScreenshotService.isRunning}`
        )
        lastGameWindowStatusKey = statusKey
        lastGameWindowStatusLogAt = now
    }
}

async function reconcileAutoScreenshotWithLolWindow(phase) {
    const status = await getLolGameStatus()
    logLolGameStatus(status, phase)

    if (status.isGameOpen) {
        await startAutoScreenshotForGame(
            `LoL game process/window fallback while LCU phase is ${phase || 'unknown'} (${status.name})`
        )
        return
    }

    stopAutoScreenshotForGame('LoL game process/window not found')
}

/**
 * 简化的游戏流程监控 - 直接在主进程中实现
 * 避免与其他服务的兼容性问题
 */
async function initGameFlowMonitor() {
    try {
        if (!backgroundMonitoringEnabled) {
            logger.info('Game flow monitor initialization skipped while disabled')
            return
        }

        if (lcuPollingTimer) {
            logger.info('Game flow monitor already running')
            return
        }

        // 获取游戏目录（从 store 中读取）
        let lolPath = store.get('lolPath')

        logger.info('============ 初始化游戏流程监控 ============')
        logger.info('读取配置的游戏目录:', lolPath)

        // 如果没有配置，尝试自动检测
        if (!lolPath) {
            logger.info('未设置游戏目录，正在尝试自动检测...')
            lolPath = await autoDetectLolPath()

            if (lolPath) {
                logger.info('自动检测成功，已保存配置')
                store.set('lolPath', lolPath)
            } else {
                logger.warn('无法自动检测游戏目录')
                logger.info('请在应用设置中配置游戏目录')
                return
            }
        }

        // 初始化 LCU 服务（使用统一的 LCU 服务）
        logger.info('初始化 LCU 服务...')
        const lcuService = getLCUServiceInstance(lolPath)
        logger.info('获取 LCU Token...')
        await lcuService.getAuthToken()

        if (!lcuService.isActive()) {
            logger.error('LCU 连接失败！')
            logger.warn('可能的原因:')
            logger.warn('   1. 游戏客户端未运行 - 请启动 League of Legends 客户端')
            logger.warn('   2. LeagueClientUx.log 文件不存在 - 请重启游戏客户端')
            logger.warn('   3. 游戏目录配置错误 - 请在应用设置中检查')
            logger.info('调试步骤:')
            logger.info('   1. 运行: node electron/lcu-debug.js "你的游戏目录"')
            logger.info('   2. 检查输出中是否找到了 LeagueClientUx.log')
            logger.info('   3. 检查日志中是否包含 LCU URL')
            return
        }

        logger.info('LCU Token 获取成功')

        // 启动游戏流程轮询
        logger.info('启动游戏阶段轮询...')
        let lastPhase = null
        let tokenRefreshCounter = 0

        lcuPollingTimer = setInterval(async () => {
            try {
                // 每60次轮询（即60秒）刷新一次 LCU token（确保连接保持活跃）
                tokenRefreshCounter++
                if (tokenRefreshCounter >= 60) {
                    logger.info('定期刷新 LCU token...')
                    await lcuService.getAuthToken()
                    tokenRefreshCounter = 0
                }

                const phase = await lcuService.getGameflowPhase()
                if (phase && phase !== lastPhase) {
                    lastPhase = phase
                    logger.info(`游戏阶段变化: → ${phase}`)
                    notifyAllWindows('game-phase-changed', { phase, prevPhase: null })

                    // 特定阶段处理
                    switch (phase) {
                        case 'GameStart':
                            logger.info('游戏开始加载')
                            notifyAllWindows('game-started', {})
                            break
                        case 'InProgress':
                            logger.info('游戏进行中 - 启动自动截图来检测海克斯选择')
                            notifyAllWindows('game-in-progress', {})
                            await startAutoScreenshotForGame('LCU phase InProgress')
                            break
                        case 'WaitingForStats':
                            logger.info('游戏已结束')
                            notifyAllWindows('game-ended', {})
                            stopAutoScreenshotForGame('LCU phase WaitingForStats', true)
                            break
                        case 'EndOfGame':
                            logger.info('游戏完全结束')
                            notifyAllWindows('end-of-game', {})
                            break
                    }
                }

                if (phase === 'InProgress') {
                    await startAutoScreenshotForGame('LCU phase InProgress')
                } else if (phase === 'None') {
                    await reconcileAutoScreenshotWithLolWindow(phase)
                }
            } catch (error) {
                logger.warn('游戏流程轮询出错:', error.message)
            }
        }, 1000)

        logger.info('游戏流程监控已启动 (每1秒检查一次，每60秒刷新一次token)')
    } catch (error) {
        logger.error('初始化游戏流程监控失败:', error)
    }
}

/**
 * 注册 F1 快捷键
 */
function registerF1Shortcut() {
    const f1Ret = globalShortcut.register('F1', async () => {
        logger.info('F1 pressed, capturing screenshot...')
        try {
            const result = await captureScreenshot()
            logger.debug('Screenshot result:', result)

            if (result.success) {
                logger.info(`Screenshot captured: ${result.width}x${result.height}`)

                // 异步执行分析和查询（不阻塞主线程）
                setImmediate(async () => {
                    try {
                        // 分析截图（海克斯检测 + OCR）- 直接传入 buffer
                        const analysisResult = await analyzeScreenshot(result.buffer)
                        logger.debug('Analysis result:', analysisResult)

                        if (analysisResult.success && analysisResult.analysis.augments.length > 0) {
                            // 构建胜率查询数据（从识别的海克斯）
                            const augments = analysisResult.analysis.augments.slice(0, 3)

                            // 从store获取缓存的英雄ID（游戏进行中时LCU可能无法获取选人会话）
                            const cachedChampionId = store.get('lastSelectedChampionId')
                            if (cachedChampionId) {
                                logger.info(`使用缓存的英雄ID: ${cachedChampionId}`)
                            }

                            const winrateData = {
                                success: true,
                                gamePhase: 'augment-select',
                                augments: augments.map(aug => ({
                                    id: aug.id,
                                    name: aug.name,
                                    rarity: aug.rarity,
                                    confidence: aug.confidence,
                                })),
                                championId: cachedChampionId || null,
                                analysisConfidence: analysisResult.analysis.confidence,
                                timestamp: Date.now(),
                                dataSource: 'local-analysis',
                            }

                            logger.info('海克斯识别成功:', winrateData)

                            // 通知所有渲染进程
                            notifyAllWindows('augment-detected', winrateData)
                        } else {
                            logger.info('未识别到海克斯，使用兼容数据')
                            // 发送兼容数据（以支持之前的功能）
                            const fallbackData = {
                                success: true,
                                champion: {
                                    name: 'Unknown',
                                    position: 'Unknown',
                                    winrate: 0,
                                },
                                stats: {
                                    winrate: '-',
                                    pickRate: '-',
                                    banRate: '-',
                                },
                                runes: [],
                                items: [],
                                dataSource: 'fallback',
                            }
                            notifyAllWindows('winrate-updated', fallbackData)
                        }
                    } catch (error) {
                        logger.error('Error analyzing screenshot:', error)
                    }
                })


            } else {
                logger.error('Screenshot failed:', result.error)
            }
        } catch (error) {
            logger.error('F1 shortcut handler error:', error)
        }
    })

    if (!f1Ret) {
        logger.error('Failed to register F1 shortcut')
    } else {
        logger.info('F1 shortcut registered successfully')
    }
}

/**
 * 注册应用事件
 */
function registerAppEvents() {
    // 应用即将退出时的清理
    app.on('will-quit', async () => {
        logger.info('App will quit, cleaning up...')

        // 停止游戏流程轮询
        if (lcuPollingTimer) {
            clearInterval(lcuPollingTimer)
            logger.info('游戏流程轮询已停止')
        }

        // 停止自动截图
        if (autoScreenshotService && autoScreenshotService.isRunning) {
            autoScreenshotService.stop()
            logger.info('自动截图服务已停止')
        }
        
        // 清理旧日志
        await logger.cleanupOldLogs(7)
    })

    // 应用退出时的清理
    app.on('quit', () => {
        logger.info('App quit')
        // 注销所有全局快捷键
        globalShortcut.unregisterAll()
    })

    // 窗口全部关闭时退出应用
    app.on('window-all-closed', function () {
        logger.info('All windows closed, quitting app...')
        app.quit()
    })

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow(process.env.NODE_ENV === 'development', 'http://localhost:5173')
        }
    })
}

/**
 * 通知所有窗口
 */
async function notifyAllWindows(channel, data) {
    const { BrowserWindow } = await import('electron')

    // 如果是海克斯检测事件，找到并显示浮动窗口
    if (channel === 'augment-detected') {
        const floatingWin = getFloatingWindow()

        if (floatingWin && !floatingWin.isDestroyed()) {
            applyFloatingWindowLayout()
            // 显示浮动窗口
            if (!floatingWin.isVisible()) {
                floatingWin.show()
                logger.info('✨ 显示海克斯浮动窗口')
            }
            // 发送数据到浮动窗口
            floatingWin.webContents.send(channel, data)
            return
        } else {
            logger.warn('⚠️ 浮动窗口不存在或已销毁')
        }
    }

    // 通知所有打开的窗口（兜底）
    BrowserWindow.getAllWindows().forEach(window => {
        if (!window.isDestroyed()) {
            window.webContents.send(channel, data)
        }
    })
}
