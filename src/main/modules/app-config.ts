// @ts-nocheck
import { app, globalShortcut, BrowserWindow } from 'electron'
import { captureScreenshot, getLolGameStatus } from '../screenshot.ts'
import { analyzeScreenshot } from '../image-analyzer.ts'
import { registerIpcHandlers } from './ipc-handlers.ts'
import {
    applyFloatingWindowLayout,
    applyPopupWindowLayout,
    createMainWindow,
    createPopupWindow,
    createFloatingWindow,
    toggleMainWindow,
    getFloatingWindow,
    getPopupWindow,
} from './window-manager.ts'
import autoScreenshotService from '../auto-screenshot-service.ts'
import { getLCUServiceInstance } from '../services/lcu/lcu-service.ts'
import { checkForClientUpdate } from '../version-checker.ts'
import logger from './logger.ts'
import store from './app-store.ts'
import { getAppDataDir } from './app-paths.ts'

const __dirname = import.meta.dirname

// 全局游戏流程监控状态
let lcuPollingTimer = null
let lcuGameflowSubscription = null
let lcuGameflowReconnectTimer = null
let lcuGameflowMonitorStopping = false
let quitCleanupCompleted = false
let quitCleanupPromise = null
const AUTO_SCREENSHOT_INTERVAL_MS = 200
const AUTO_SCREENSHOT_MAX_CAPTURES = 100
const GAME_WINDOW_STATUS_LOG_INTERVAL_MS = 30000
const GAMEFLOW_AUGMENT_ANALYSIS_PHASE = 'InProgress'
const GAMEFLOW_POLL_FALLBACK_INTERVAL_MS = 1000
const GAMEFLOW_TOKEN_REFRESH_INTERVAL_MS = 60000
const GAMEFLOW_WS_STALE_MS = 15000
const GAMEFLOW_WS_RECONNECT_BASE_MS = 2000
const GAMEFLOW_WS_RECONNECT_MAX_MS = 30000
const GAME_API_DIAGNOSTIC_INTERVAL_MS = 15000
const GAME_API_DIAGNOSTIC_MAX_PATHS = 40
const GAME_API_DIAGNOSTIC_KEYWORDS = [
    'augment',
    'reroll',
    'choice',
    'select',
    'perk',
    'upgrade',
    'card',
]
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
let lastGameApiDiagnosticAt = 0
let gameApiDiagnosticInFlight = false

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
        lcuApiDiagnosticsLogFile: logger.getCurrentLcuApiDiagnosticsLogFile(),
    })

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

    // 初始化游戏流程监控（延迟初始化，避免阻塞应用启动）
    logger.info('将在后台初始化游戏流程监控...')
    setTimeout(() => {
        initGameFlowMonitor()
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

function getDiagnosticType(value) {
    if (Array.isArray(value)) {
        return 'array'
    }

    return value === null ? 'null' : typeof value
}

function sanitizeDiagnosticValue(value) {
    if (value == null || typeof value === 'number' || typeof value === 'boolean') {
        return value
    }

    if (typeof value === 'string') {
        return value.length > 80 ? `${value.slice(0, 77)}...` : value
    }

    if (Array.isArray(value)) {
        return `[${value.length}]`
    }

    if (typeof value === 'object') {
        return `{${Object.keys(value).slice(0, 8).join(',')}}`
    }

    return undefined
}

function collectKeywordPaths(value, path = '$', depth = 0, results = []) {
    if (results.length >= GAME_API_DIAGNOSTIC_MAX_PATHS || value == null || depth > 5) {
        return results
    }

    if (Array.isArray(value)) {
        value.slice(0, 3).forEach((item, index) => {
            collectKeywordPaths(item, `${path}[${index}]`, depth + 1, results)
        })
        return results
    }

    if (typeof value !== 'object') {
        return results
    }

    for (const [key, child] of Object.entries(value)) {
        if (results.length >= GAME_API_DIAGNOSTIC_MAX_PATHS) {
            break
        }

        const nextPath = `${path}.${key}`
        const lowerKey = key.toLowerCase()
        if (GAME_API_DIAGNOSTIC_KEYWORDS.some(keyword => lowerKey.includes(keyword))) {
            results.push({
                path: nextPath,
                type: getDiagnosticType(child),
                value: sanitizeDiagnosticValue(child),
            })
        }

        collectKeywordPaths(child, nextPath, depth + 1, results)
    }

    return results
}

function summarizeDiagnosticPayload(data) {
    const isArray = Array.isArray(data)
    const keys = data && typeof data === 'object' && !isArray
        ? Object.keys(data).slice(0, 40)
        : []

    return {
        type: getDiagnosticType(data),
        length: isArray ? data.length : undefined,
        keys,
        keywordPaths: collectKeywordPaths(data),
    }
}

function getLcuDiagnosticEndpoints(phase) {
    const endpoints = [
        { label: 'gameflow-session', path: '/lol-gameflow/v1/session' },
    ]

    if (phase === 'ChampSelect') {
        endpoints.unshift({ label: 'champ-select-session', path: '/lol-champ-select/v1/session' })
    }

    if (phase === 'WaitingForStats' || phase === 'PreEndOfGame' || phase === 'EndOfGame') {
        endpoints.push(
            { label: 'eog-stats-block', path: '/lol-end-of-game/v1/eog-stats-block' },
            { label: 'gameclient-eog-stats-block', path: '/lol-end-of-game/v1/gameclient-eog-stats-block' }
        )
    }

    return endpoints
}

async function logReadOnlyGameApiDiagnostics(lcuService, phase, reason, force = false) {
    if (!phase || gameApiDiagnosticInFlight) {
        return
    }

    const now = Date.now()
    if (!force && now - lastGameApiDiagnosticAt < GAME_API_DIAGNOSTIC_INTERVAL_MS) {
        return
    }

    lastGameApiDiagnosticAt = now
    gameApiDiagnosticInFlight = true

    try {
        for (const endpoint of getLcuDiagnosticEndpoints(phase)) {
            const result = await lcuService.getReadOnlyJsonEndpoint(endpoint.path)
            logger.lcuApiDiagnostics('[LCU diagnostics] read-only endpoint snapshot', {
                phase,
                reason,
                endpoint: endpoint.label,
                path: endpoint.path,
                status: result?.status || null,
                summary: result ? summarizeDiagnosticPayload(result.data) : null,
            })
        }

        if (phase === 'InProgress') {
            const liveClientData = await lcuService.getLiveClientAllGameData()
            logger.lcuApiDiagnostics('[LCU diagnostics] live client data snapshot', {
                phase,
                reason,
                endpoint: 'liveclientdata-allgamedata',
                status: liveClientData?.status || null,
                summary: liveClientData ? summarizeDiagnosticPayload(liveClientData.data) : null,
            })
        }
    } catch (error) {
        logger.debug('LCU diagnostics snapshot failed:', error.message)
    } finally {
        gameApiDiagnosticInFlight = false
    }
}

async function showChampionInsightForChampSelect(lcuService) {
    const popupWindow = getPopupWindow()
    if (!popupWindow || popupWindow.isDestroyed()) {
        logger.warn('Champion insight window is unavailable for champ-select')
        return
    }

    let snapshot = null
    try {
        snapshot = await lcuService.getChampSelectSnapshot()
        if (snapshot.selfChampionId) {
            store.set('lastSelectedChampionId', snapshot.selfChampionId)
        }
    } catch (error) {
        logger.debug('Failed to load champ-select snapshot for champion insight:', error.message)
    }

    applyPopupWindowLayout()
    if (!popupWindow.isVisible()) {
        popupWindow.show()
    }

    popupWindow.webContents.send('for-popup', {
        championId: snapshot?.selfChampionId || null,
        augments: [],
        champSelect: true,
        dataSource: 'champ-select',
        timestamp: Date.now(),
    })

    logger.info('显示英雄详情选人视图', {
        championId: snapshot?.selfChampionId || null,
        benchCount: snapshot?.benchChampions?.length || 0,
        snapshotStatus: snapshot?.status || 'unavailable',
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
            logger.info('   1. 运行: node src/main/lcu-debug.ts "你的游戏目录"')
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
                void logReadOnlyGameApiDiagnostics(lcuService, phase, `phase-change:${source}`, true)

                // 特定阶段处理
                switch (phase) {
                    case 'Lobby':
                    case 'Matchmaking':
                    case 'ReadyCheck':
                        stopAutoScreenshotForGame(`LCU phase ${phase}`)
                        break
                    case 'ChampSelect':
                        logger.info('进入选人阶段 - 暂停游戏内海克斯 OCR')
                        notifyAllWindows('champ-select-start', {})
                        await showChampionInsightForChampSelect(lcuService)
                        stopAutoScreenshotForGame('LCU phase ChampSelect')
                        break
                    case 'GameStart':
                        logger.info('游戏开始加载')
                        notifyAllWindows('game-started', {})
                        stopAutoScreenshotForGame('LCU phase GameStart')
                        break
                    case 'InProgress':
                        logger.info('游戏进行中 - 启动自动截图来检测海克斯选择')
                        notifyAllWindows('game-in-progress', {})
                        await startAutoScreenshotForGame('LCU phase InProgress')
                        break
                    case 'WaitingForStats':
                        logger.info('游戏已结束')
                        notifyAllWindows('game-ended', {})
                        stopAutoScreenshotForGame('LCU phase WaitingForStats')
                        break
                    case 'PreEndOfGame':
                        logger.info('游戏结束统计阶段')
                        stopAutoScreenshotForGame('LCU phase PreEndOfGame')
                        break
                    case 'EndOfGame':
                        logger.info('游戏完全结束')
                        notifyAllWindows('end-of-game', {})
                        stopAutoScreenshotForGame('LCU phase EndOfGame')
                        break
                }
            }

            if (phase === GAMEFLOW_AUGMENT_ANALYSIS_PHASE) {
                void logReadOnlyGameApiDiagnostics(lcuService, phase, `heartbeat:${source}`)
                await startAutoScreenshotForGame('LCU phase InProgress')
            } else if (phase === 'None') {
                await reconcileAutoScreenshotWithLolWindow(phase)
            } else if (phase) {
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
async function runQuitCleanup() {
    logger.info('App is quitting, cleaning up...')

    lcuGameflowMonitorStopping = true
    stopGameflowWebSocket('app will quit')

    if (lcuPollingTimer) {
        clearInterval(lcuPollingTimer)
        lcuPollingTimer = null
        logger.info('游戏流程轮询已停止')
    }

    if (autoScreenshotService && autoScreenshotService.isRunning) {
        autoScreenshotService.stop()
        logger.info('自动截图服务已停止')
    }

    await logger.cleanupOldLogs(7)
}

function registerAppEvents() {
    app.on('before-quit', (event) => {
        if (quitCleanupCompleted) {
            return
        }

        event.preventDefault()

        if (!quitCleanupPromise) {
            quitCleanupPromise = runQuitCleanup()
                .catch((error) => {
                    logger.warn('App quit cleanup failed:', error.message)
                })
                .finally(() => {
                    quitCleanupCompleted = true
                    app.quit()
                })
        }
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
