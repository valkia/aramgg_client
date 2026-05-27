import { app, globalShortcut, BrowserWindow } from 'electron'
import Store from 'electron-store'
import { captureScreenshot, getLolGameStatus } from '../screenshot.js'
import { analyzeScreenshot } from '../image-analyzer.js'
import { registerIpcHandlers } from './ipc-handlers.js'
import {
    applyBenchWindowLayout,
    applyFloatingWindowLayout,
    createBenchWindow,
    createMainWindow,
    createPopupWindow,
    createFloatingWindow,
    getBenchWindow,
    toggleMainWindow,
    getFloatingWindow,
} from './window-manager.js'
import autoScreenshotService from '../auto-screenshot-service.js'
import { getLCUServiceInstance } from '../services/lcu/lcu-service.ts'
import { checkForClientUpdate } from '../version-checker.js'
import logger from './logger.js'
import { getAppDataDir, getConfigDir } from './app-paths.js'

const __dirname = import.meta.dirname
const store = new Store({ cwd: getConfigDir() })

// 全局游戏流程监控状态
let lcuPollingTimer = null
let lcuGameflowSubscription = null
let lcuGameflowReconnectTimer = null
let lcuGameflowMonitorStopping = false
const AUTO_SCREENSHOT_INTERVAL_MS = 200
const AUTO_SCREENSHOT_MAX_CAPTURES = 100
const GAME_WINDOW_STATUS_LOG_INTERVAL_MS = 30000
const GAMEFLOW_AUGMENT_ANALYSIS_PHASE = 'InProgress'
const GAMEFLOW_POLL_FALLBACK_INTERVAL_MS = 1000
const GAMEFLOW_TOKEN_REFRESH_INTERVAL_MS = 60000
const GAMEFLOW_WS_STALE_MS = 15000
const GAMEFLOW_WS_RECONNECT_BASE_MS = 2000
const GAMEFLOW_WS_RECONNECT_MAX_MS = 30000
const AUGMENT_CLEAR_PHASES = new Set([
    'Lobby',
    'Matchmaking',
    'ReadyCheck',
    'ChampSelect',
    'GameStart',
    'WaitingForStats',
    'PreEndOfGame',
    'EndOfGame',
])
let autoScreenshotManagedByGameFlow = false
let lastGameWindowStatusKey = null
let lastGameWindowStatusLogAt = 0

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
    logger.info('App runtime context:', {
        version: app.getVersion(),
        packaged: app.isPackaged,
        isDev,
        platform: process.platform,
        arch: process.arch,
        appDataDir: getAppDataDir(),
        logFile: logger.getCurrentLogFile(),
    })

    const mainWindow = await createMainWindow(isDev, devServerUrl)
    const popupWindow = await createPopupWindow(isDev, devServerUrl)
    const benchWindow = await createBenchWindow(isDev, devServerUrl)
    const floatingWindow = await createFloatingWindow(isDev, devServerUrl)
    logger.info('窗口已创建:', {
        main: !!mainWindow,
        popup: !!popupWindow,
        bench: !!benchWindow,
        floating: !!floatingWindow
    })

    setTimeout(() => {
        checkForClientUpdate(mainWindow).catch((error) => {
            logger.warn('Client update check failed:', error.message)
        })
    }, 1000)

    // 初始化游戏流程监控（延迟初始化，避免阻塞应用启动）
    logger.info('将在后台初始化游戏流程监控...')
    setTimeout(() => {
        initGameFlowMonitor()
    }, 2000)

    // 注册 F1 全局快捷键
    registerF1Shortcut()

    // 注册其他应用事件
    registerAppEvents()

    return { mainWindow, popupWindow, benchWindow, toggleMainWindow }
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
    if (store.get('autoScreenshotGameflowControl') === false) {
        logger.info(`Auto screenshot gameflow start skipped: disabled by config (${reason})`)
        return false
    }

    if (autoScreenshotService.isRunning) {
        return false
    }

    autoScreenshotService.setConfig({
        interval: AUTO_SCREENSHOT_INTERVAL_MS,
        maxScreenshots: AUTO_SCREENSHOT_MAX_CAPTURES,
    })

    const startedAt = Date.now()
    const success = await autoScreenshotService.start(AUTO_SCREENSHOT_INTERVAL_MS, 'gameflow')
    if (success) {
        autoScreenshotManagedByGameFlow = true
        logger.info('Auto screenshot service started by game monitor', {
            reason,
            durationMs: Date.now() - startedAt,
            intervalMs: AUTO_SCREENSHOT_INTERVAL_MS,
            pollFallbackIntervalMs: GAMEFLOW_POLL_FALLBACK_INTERVAL_MS,
        })
    }

    return success
}

function stopAutoScreenshotForGame(reason) {
    if (!autoScreenshotService.isRunning) {
        autoScreenshotManagedByGameFlow = false
        return false
    }

    if (!autoScreenshotManagedByGameFlow && autoScreenshotService.getConfig().controlOwner !== 'gameflow') {
        return false
    }

    const success = autoScreenshotService.stop('gameflow')
    if (success) {
        autoScreenshotManagedByGameFlow = false
        logger.info(`Auto screenshot service stopped by game monitor: ${reason}`)
    } else if (autoScreenshotService.getConfig().controlOwner === 'manual') {
        autoScreenshotManagedByGameFlow = false
    }

    return success
}

function clearAugmentOverlayForPhase(phase) {
    if (!AUGMENT_CLEAR_PHASES.has(phase)) {
        return
    }

    autoScreenshotService.clearAugmentState(`LCU phase ${phase}`)
}

function showBenchWindowForChampSelect() {
    const benchWindow = getBenchWindow()
    if (!benchWindow || benchWindow.isDestroyed()) {
        logger.warn('Bench recommendation window is unavailable')
        return
    }

    applyBenchWindowLayout()
    if (!benchWindow.isVisible()) {
        benchWindow.show()
        logger.info('显示 ARAM 选人席位推荐弹窗')
    }
}

function hideBenchWindow(reason) {
    const benchWindow = getBenchWindow()
    if (benchWindow && !benchWindow.isDestroyed() && benchWindow.isVisible()) {
        benchWindow.hide()
        logger.info(`隐藏 ARAM 选人席位推荐弹窗: ${reason}`)
    }
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

function stopGameflowWebSocket(reason) {
    if (lcuGameflowReconnectTimer) {
        clearTimeout(lcuGameflowReconnectTimer)
        lcuGameflowReconnectTimer = null
    }

    if (lcuGameflowSubscription) {
        lcuGameflowSubscription.close()
        lcuGameflowSubscription = null
        logger.info(`LCU gameflow WebSocket subscription stopped: ${reason}`)
    }
}

/**
 * 简化的游戏流程监控 - 直接在主进程中实现
 * 避免与其他服务的兼容性问题
 */
async function initGameFlowMonitor() {
    try {
        if (lcuPollingTimer) {
            logger.info('Game flow monitor already running')
            return
        }

        lcuGameflowMonitorStopping = false

        // 获取游戏目录（从 store 中读取）
        let lolPath = store.get('lolPath')

        logger.info('============ 初始化游戏流程监控 ============')
        logger.debug('读取配置的游戏目录:', lolPath ? '<configured>' : null)

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
        logger.debug('初始化 LCU 服务...')
        const lcuService = getLCUServiceInstance(lolPath)
        logger.debug('获取 LCU Token...')
        let currentAuth = await lcuService.getAuthToken()
        let lastAuthUrl = currentAuth?.url || lcuService.getUrl()

        if (!lcuService.isActive()) {
            logger.error('LCU 连接失败！')
            logger.warn('可能的原因:')
            logger.warn('   1. 游戏客户端未运行 - 请启动 League of Legends 客户端')
            logger.warn('   2. LeagueClientUx.log 文件不存在 - 请重启游戏客户端')
            logger.warn('   3. 游戏目录配置错误 - 请在应用设置中检查')
            logger.info('调试步骤:')
            logger.info('   1. 运行: node src/main/lcu-debug.js "你的游戏目录"')
            logger.info('   2. 检查输出中是否找到了 LeagueClientUx.log')
            logger.info('   3. 检查日志中是否包含 LCU URL')
            logger.info('将继续低频重试 LCU 连接')
        } else {
            logger.debug('LCU Token 获取成功')
        }

        let lastPhase = null
        let lastTokenRefreshAt = Date.now()
        let websocketConnected = false
        let websocketLastEventAt = 0
        let websocketReconnectAttempts = 0
        let websocketConnecting = false

        const handleGameflowPhase = async (phase, source) => {
            if (!phase) {
                return
            }

            autoScreenshotService.setGameflowPhase(phase)

            if (phase && phase !== lastPhase) {
                const prevPhase = lastPhase
                lastPhase = phase
                logger.info(`游戏阶段变化(${source}): ${prevPhase || 'unknown'} → ${phase}`)
                notifyAllWindows('game-phase-changed', { phase, prevPhase })
                clearAugmentOverlayForPhase(phase)

                // 特定阶段处理
                switch (phase) {
                    case 'Lobby':
                    case 'Matchmaking':
                    case 'ReadyCheck':
                        hideBenchWindow(`LCU phase ${phase}`)
                        stopAutoScreenshotForGame(`LCU phase ${phase}`)
                        break
                    case 'ChampSelect':
                        logger.info('进入选人阶段 - 暂停游戏内海克斯 OCR')
                        notifyAllWindows('champ-select-start', {})
                        showBenchWindowForChampSelect()
                        stopAutoScreenshotForGame('LCU phase ChampSelect')
                        break
                    case 'GameStart':
                        logger.info('游戏开始加载')
                        notifyAllWindows('game-started', {})
                        hideBenchWindow('LCU phase GameStart')
                        stopAutoScreenshotForGame('LCU phase GameStart')
                        break
                    case 'InProgress':
                        logger.info('游戏进行中 - 启动自动截图来检测海克斯选择')
                        notifyAllWindows('game-in-progress', {})
                        hideBenchWindow('LCU phase InProgress')
                        await startAutoScreenshotForGame('LCU phase InProgress')
                        break
                    case 'WaitingForStats':
                        logger.info('游戏已结束')
                        notifyAllWindows('game-ended', {})
                        hideBenchWindow('LCU phase WaitingForStats')
                        stopAutoScreenshotForGame('LCU phase WaitingForStats')
                        break
                    case 'PreEndOfGame':
                        logger.info('游戏结束统计阶段')
                        hideBenchWindow('LCU phase PreEndOfGame')
                        stopAutoScreenshotForGame('LCU phase PreEndOfGame')
                        break
                    case 'EndOfGame':
                        logger.info('游戏完全结束')
                        notifyAllWindows('end-of-game', {})
                        hideBenchWindow('LCU phase EndOfGame')
                        stopAutoScreenshotForGame('LCU phase EndOfGame')
                        break
                }
            }

            if (phase === GAMEFLOW_AUGMENT_ANALYSIS_PHASE) {
                await startAutoScreenshotForGame('LCU phase InProgress')
            } else if (phase === 'None') {
                hideBenchWindow('LCU phase None')
                await reconcileAutoScreenshotWithLolWindow(phase)
            } else if (phase) {
                if (phase !== 'ChampSelect') {
                    hideBenchWindow(`LCU phase ${phase}`)
                }
                stopAutoScreenshotForGame(`LCU phase ${phase}`)
            }
        }

        const scheduleWebSocketReconnect = (reason) => {
            if (lcuGameflowMonitorStopping || lcuGameflowReconnectTimer) {
                return
            }

            const delay = Math.min(
                GAMEFLOW_WS_RECONNECT_BASE_MS * 2 ** websocketReconnectAttempts,
                GAMEFLOW_WS_RECONNECT_MAX_MS
            )
            websocketReconnectAttempts += 1
            logger.debug(`LCU gameflow WebSocket 将在 ${delay}ms 后重连: ${reason}`)

            lcuGameflowReconnectTimer = setTimeout(() => {
                lcuGameflowReconnectTimer = null
                void connectGameflowWebSocket(true)
            }, delay)
        }

        const connectGameflowWebSocket = async (forceRefresh = false) => {
            if (lcuGameflowMonitorStopping || websocketConnecting) {
                return
            }

            if (lcuGameflowSubscription?.isConnected()) {
                return
            }

            websocketConnecting = true
            try {
                const subscription = await lcuService.subscribeGameflowPhase(
                    async (phase) => {
                        websocketLastEventAt = Date.now()
                        await handleGameflowPhase(phase, 'websocket')
                    },
                    {
                        forceRefresh,
                        onOpen: () => {
                            websocketConnected = true
                            websocketLastEventAt = Date.now()
                            websocketReconnectAttempts = 0
                            logger.info('LCU OnJsonApiEvent WebSocket 已订阅 gameflow phase')
                        },
                        onClose: (reason) => {
                            websocketConnected = false
                            lcuGameflowSubscription = null
                            if (!lcuGameflowMonitorStopping) {
                                logger.debug(`LCU OnJsonApiEvent WebSocket 已关闭: ${reason}`)
                                scheduleWebSocketReconnect(reason)
                            }
                        },
                        onError: (error) => {
                            logger.debug('LCU OnJsonApiEvent WebSocket 错误:', error.message)
                        },
                    }
                )

                if (!subscription) {
                    websocketConnected = false
                    scheduleWebSocketReconnect('lcu-auth-unavailable')
                    return
                }

                lcuGameflowSubscription = subscription
            } catch (error) {
                websocketConnected = false
                logger.debug('LCU OnJsonApiEvent WebSocket 初始化失败:', error.message)
                scheduleWebSocketReconnect('connect-error')
            } finally {
                websocketConnecting = false
            }
        }

        const initialPhase = await lcuService.getGameflowPhase()
        await handleGameflowPhase(initialPhase, 'initial')
        void connectGameflowWebSocket()

        lcuPollingTimer = setInterval(async () => {
            try {
                const now = Date.now()

                if (now - lastTokenRefreshAt >= GAMEFLOW_TOKEN_REFRESH_INTERVAL_MS || !lcuService.isActive()) {
                    logger.debug('定期刷新 LCU token...')
                    currentAuth = await lcuService.getAuthToken(!lcuService.isActive())
                    lastTokenRefreshAt = now

                    if (currentAuth && currentAuth.url !== lastAuthUrl) {
                        lastAuthUrl = currentAuth.url
                        websocketConnected = false
                        stopGameflowWebSocket('LCU auth endpoint changed')
                        scheduleWebSocketReconnect('LCU auth endpoint changed')
                    }
                }

                const websocketFresh =
                    websocketConnected &&
                    lcuGameflowSubscription?.isConnected() &&
                    now - websocketLastEventAt <= GAMEFLOW_WS_STALE_MS

                if (!websocketFresh) {
                    const phase = await lcuService.getGameflowPhase()
                    await handleGameflowPhase(phase, 'poll')

                    if (!lcuGameflowSubscription && !lcuGameflowReconnectTimer) {
                        scheduleWebSocketReconnect('fallback-poll')
                    }
                }
            } catch (error) {
                logger.warn('游戏流程轮询出错:', error.message)
            }
        }, GAMEFLOW_POLL_FALLBACK_INTERVAL_MS)

        logger.info(
            `游戏流程监控已启动 (OnJsonApiEvent WebSocket + ${GAMEFLOW_POLL_FALLBACK_INTERVAL_MS / 1000}s 轮询兜底，每 ${GAMEFLOW_TOKEN_REFRESH_INTERVAL_MS / 1000}s 刷新 token)`
        )
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

        lcuGameflowMonitorStopping = true
        stopGameflowWebSocket('app will quit')

        // 停止游戏流程轮询
        if (lcuPollingTimer) {
            clearInterval(lcuPollingTimer)
            lcuPollingTimer = null
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
        logger.info('所有窗口已关闭，正在退出应用...')
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
