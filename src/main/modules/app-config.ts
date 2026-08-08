// @ts-nocheck
import { app, globalShortcut, BrowserWindow } from 'electron'
import { getLolGameStatus } from '../screenshot.ts'
import { registerIpcHandlers } from './ipc-handlers.ts'
import {
    applyAugmentSidePanelWindowLayout,
    applyFloatingWindowLayout,
    applyPopupWindowLayout,
    createAugmentSidePanelWindow,
    createMainWindow,
    createPopupWindow,
    createFloatingWindow,
    toggleMainWindow,
    getAugmentSidePanelWindow,
    getFloatingWindow,
    getPopupWindow,
    raiseOverlayWindow,
    setPopupWindowAlwaysOnTop,
} from './window-manager.ts'
import autoScreenshotService from '../auto-screenshot-service.ts'
import { getLCUServiceInstance } from '../services/lcu/lcu-service.ts'
import {
    requestLocalMatchHistoryBackgroundSync,
    startLocalMatchHistoryBackgroundSync,
    stopLocalMatchHistoryBackgroundSync,
} from '../services/match-history/background-sync.ts'
import { checkForClientUpdate } from '../version-checker.ts'
import {
    checkForAppUpdate,
    initializeAppUpdateService,
    installDownloadedAppUpdate,
    isAppUpdateInstallInProgress,
    refreshAppUpdateConfig,
    setAppUpdateGamePhase,
    setAppUpdateInstallCleanup,
    shouldInstallDownloadedAppUpdateOnQuit,
} from '../app-update-service.ts'
import { initAnalyticsService, markAnalyticsAppCleanExit } from '../services/analytics-service.ts'
import {
    collectAramCandidateChampionIds,
    getAramBenchRecommendation,
} from '../services/aram/bench-recommendation.ts'
import {
    capturePostGameShareSnapshot,
    preparePostGameSharePosterData,
    resetPostGameShareSnapshot,
} from '../services/post-game-share.ts'
import logger from './logger.ts'
import store from './app-store.ts'
import { getAppDataDir } from './app-paths.ts'
import { logDiagnosticSnapshot } from './diagnostic-logger.ts'
import {
    startPerformanceMonitor,
    stopPerformanceMonitor,
} from './performance-monitor.ts'
import { createAppTray } from './tray.ts'
import {
    shouldShowChampionDetails,
    shouldShowAugmentSidePanel,
    shouldShowAugmentTopOverlay,
} from './user-preferences.ts'
import { GameSessionCoordinator } from '../services/game-session/game-session-machine.ts'
import { shouldRaiseOverlayWindow } from './overlay-window-state.ts'
import {
    GAMEFLOW_ACTIVE_CAPTURE_INTERVAL_MS,
    GAMEFLOW_CAPTURE_THUMBNAIL_SIZE,
    GAMEFLOW_IDLE_CAPTURE_INTERVAL_MS,
} from '../auto-screenshot-policy.ts'

const __dirname = import.meta.dirname

// 全局游戏流程监控状态
let lcuPollingTimer = null
let lcuGameflowSubscription = null
let lcuGameflowReconnectTimer = null
let lcuGameflowMonitorStopping = false
let lcuGameflowInitPromise = null
let quitCleanupCompleted = false
let quitCleanupPromise = null
const AUTO_SCREENSHOT_MAX_CAPTURES = 100
const GAME_WINDOW_STATUS_LOG_INTERVAL_MS = 30000
const GAMEFLOW_AUGMENT_ANALYSIS_PHASE = 'InProgress'
const GAMEFLOW_POLL_FALLBACK_INTERVAL_MS = 1000
const GAMEFLOW_TOKEN_REFRESH_INTERVAL_MS = 60000
const GAMEFLOW_WS_STALE_MS = 15000
const GAMEFLOW_WS_RECONNECT_BASE_MS = 2000
const GAMEFLOW_WS_RECONNECT_MAX_MS = 30000
const GAME_API_DIAGNOSTIC_INTERVAL_MS = 15000
const IN_PROGRESS_CHAMPION_RECOVERY_RETRY_MS = 10000
const GAME_API_DIAGNOSTIC_HEARTBEAT_ENABLED_KEY = 'diagnostics.lcuHeartbeat'
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
const ITEM_SET_AUTO_APPLY_KEY = 'itemSets.autoApplyAram'
const ITEM_SET_PRELOAD_CONCURRENCY = 3
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
let itemSetAutoApplyInFlight = false
let pendingAutoApplyChampionId = null
let pendingAutoApplyReason = null
let lastAutoAppliedItemSetChampionId = null
let lastChampSelectInsightChampionId = null
let lastInProgressInsightChampionId = null
let lastInProgressChampionRecoveryAttemptAt = 0
let inProgressChampionRecoveryInFlight = false
let champSelectSnapshotPollInFlight = false
let itemSetPreloadGeneration = 0
let itemSetPreloadActiveCount = 0
let itemSetPreloadQueue = []
const itemSetPreloadInFlight = new Set()
const itemSetPreloadDataByChampionId = new Map()

/**
 * 初始化应用
 */
export async function init() {
    logger.info(`${'='.repeat(50)}`)
    logger.info(`ARAMGG助手启动中...`)
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
    logDiagnosticSnapshot('startup').catch((error) => {
        logger.warn('[diagnostics] startup snapshot failed:', error.message)
    })

    const mainWindow = await createMainWindow(isDev, devServerUrl)
    const popupWindow = await createPopupWindow(isDev, devServerUrl)
    const floatingWindow = await createFloatingWindow(isDev, devServerUrl)
    const augmentSidePanelWindow = await createAugmentSidePanelWindow(isDev, devServerUrl)
    createAppTray()
    logger.info('窗口已创建:', {
        main: !!mainWindow,
        popup: !!popupWindow,
        floating: !!floatingWindow,
        augmentSidePanel: !!augmentSidePanelWindow,
        tray: true,
    })
    startPerformanceMonitor()

    initializeAppUpdateService({ isDev })
    setAppUpdateInstallCleanup(() => ensureQuitCleanup('app update install'))
    refreshAppUpdateConfig({ reason: 'startup' }).catch((error) => {
        logger.warn('[update] startup config refresh failed:', error.message)
    })

    setTimeout(() => {
        checkForClientUpdate(mainWindow).catch((error) => {
            logger.warn('Client update check failed:', error.message)
        })
    }, 1000)

    setTimeout(() => {
        checkForAppUpdate('startup').catch((error) => {
            logger.warn('[update] startup app update check failed:', error.message)
        })
    }, 2500)

    initAnalyticsService().catch((error) => {
        logger.debug('[analytics] initialization skipped:', error.message)
    })
    startLocalMatchHistoryBackgroundSync((updatedAt) => {
        notifyAllWindows('match-history-updated', { updatedAt })
    }, app.getVersion())

    // 初始化游戏流程监控（延迟初始化，避免阻塞应用启动）
    logger.info('将在后台初始化游戏流程监控...')
    setTimeout(() => {
        void ensureGameFlowMonitor('startup-delay')
    }, 2000)

    // 注册其他应用事件
    registerAppEvents()

    return { mainWindow, popupWindow, toggleMainWindow }
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
        interval: GAMEFLOW_ACTIVE_CAPTURE_INTERVAL_MS,
        idleInterval: GAMEFLOW_IDLE_CAPTURE_INTERVAL_MS,
        automaticThumbnailSize: GAMEFLOW_CAPTURE_THUMBNAIL_SIZE,
        maxScreenshots: AUTO_SCREENSHOT_MAX_CAPTURES,
    })

    const startedAt = Date.now()
    const success = await autoScreenshotService.start(GAMEFLOW_ACTIVE_CAPTURE_INTERVAL_MS, 'gameflow')
    if (success) {
        autoScreenshotManagedByGameFlow = true
        logger.info('Auto screenshot service started by game monitor', {
            reason,
            durationMs: Date.now() - startedAt,
            intervalMs: GAMEFLOW_ACTIVE_CAPTURE_INTERVAL_MS,
            idleIntervalMs: GAMEFLOW_IDLE_CAPTURE_INTERVAL_MS,
            activeIntervalMs: GAMEFLOW_ACTIVE_CAPTURE_INTERVAL_MS,
            thumbnailSize: GAMEFLOW_CAPTURE_THUMBNAIL_SIZE,
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

function keepChampionInsightOnTop(reason) {
    const popupWindow = getPopupWindow()
    if (!shouldShowChampionDetails()) {
        if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) {
            popupWindow.hide()
        }
        logger.debug('Champion insight visibility disabled by preference', { reason })
        return
    }

    setPopupWindowAlwaysOnTop(true)
    logger.info('Champion insight remains visible and always on top', { reason })
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

    const isHeartbeat = String(reason || '').startsWith('heartbeat:')
    if (!force && isHeartbeat && store.get(GAME_API_DIAGNOSTIC_HEARTBEAT_ENABLED_KEY) !== true) {
        return
    }

    const now = Date.now()
    if (!force && now - lastGameApiDiagnosticAt < GAME_API_DIAGNOSTIC_INTERVAL_MS) {
        return
    }

    lastGameApiDiagnosticAt = now
    gameApiDiagnosticInFlight = true

    try {
        const logSnapshot = force ? logger.info : logger.debug
        for (const endpoint of getLcuDiagnosticEndpoints(phase)) {
            const result = await lcuService.getReadOnlyJsonEndpoint(endpoint.path)
            logSnapshot('[LCU diagnostics] read-only endpoint snapshot', {
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
            logSnapshot('[LCU diagnostics] live client data snapshot', {
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

function normalizeChampionId(value) {
    const championId = Number(value)
    return Number.isFinite(championId) && championId > 0 ? championId : null
}

function normalizeIdentityText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .trim()
}

function normalizeChampionLookupText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/^game_character_displayname_/i, '')
        .replace(/['’.\s_-]+/g, '')
        .trim()
}

function getNestedValue(source, path) {
    return path.reduce((current, key) => current?.[key], source)
}

function collectChampionIdsFromValue(value, results = []) {
    const championId = normalizeChampionId(value)
    if (championId) {
        results.push(championId)
        return results
    }

    if (!value || typeof value !== 'object') {
        return results
    }

    if (Array.isArray(value)) {
        value.forEach(item => collectChampionIdsFromValue(item, results))
        return results
    }

    for (const [key, child] of Object.entries(value)) {
        if (/champion/i.test(key)) {
            collectChampionIdsFromValue(child, results)
        }
    }

    return results
}

function getLikelyChampionIdFromGameflowSession(session) {
    const directPaths = [
        ['gameData', 'playerChampionSelection', 'championId'],
        ['gameData', 'playerChampionSelection', 'selectedChampionId'],
        ['gameData', 'selectedChampionId'],
        ['gameData', 'championId'],
        ['playerChampionSelection', 'championId'],
        ['playerChampionSelection', 'selectedChampionId'],
    ]

    for (const path of directPaths) {
        const championId = normalizeChampionId(getNestedValue(session, path))
        if (championId) {
            return championId
        }
    }

    const selections = session?.gameData?.playerChampionSelections
    if (Array.isArray(selections) && selections.length === 1) {
        return collectChampionIdsFromValue(selections[0])[0] || null
    }

    return null
}

async function resolveChampionIdFromLiveClientData(liveClientData, currentSummoner) {
    const data = liveClientData && typeof liveClientData === 'object' ? liveClientData : {}
    const activePlayer = data.activePlayer || {}
    const allPlayers = Array.isArray(data.allPlayers) ? data.allPlayers : []

    const directChampionId = normalizeChampionId(activePlayer.championId ?? activePlayer.championID)
    if (directChampionId) {
        return {
            championId: directChampionId,
            source: 'liveclient-active-player-id',
            matchedPlayer: activePlayer.summonerName || activePlayer.riotId || null,
        }
    }

    const currentIdentityCandidates = [
        currentSummoner?.displayName,
        currentSummoner?.gameName,
        currentSummoner?.internalName,
        currentSummoner?.name,
        currentSummoner?.puuid,
        activePlayer?.summonerName,
        activePlayer?.riotId,
        activePlayer?.riotIdGameName,
        activePlayer?.riotIdTagLine ? `${activePlayer?.riotIdGameName || activePlayer?.summonerName || ''}#${activePlayer.riotIdTagLine}` : '',
    ]
        .map(normalizeIdentityText)
        .filter(Boolean)

    const matchedPlayer = allPlayers.find(player => {
        const playerIdentityCandidates = [
            player?.summonerName,
            player?.riotId,
            player?.riotIdGameName,
            player?.riotIdTagLine ? `${player?.riotIdGameName || player?.summonerName || ''}#${player.riotIdTagLine}` : '',
            player?.puuid,
        ]
            .map(normalizeIdentityText)
            .filter(Boolean)

        return playerIdentityCandidates.some(candidate => currentIdentityCandidates.includes(candidate))
    }) || (allPlayers.length === 1 ? allPlayers[0] : null)

    const matchedChampionId = normalizeChampionId(matchedPlayer?.championId ?? matchedPlayer?.championID)
    if (matchedChampionId) {
        return {
            championId: matchedChampionId,
            source: 'liveclient-matched-player-id',
            matchedPlayer: matchedPlayer?.summonerName || matchedPlayer?.riotId || null,
        }
    }

    const championName = matchedPlayer?.rawChampionName ||
        matchedPlayer?.championName ||
        activePlayer?.rawChampionName ||
        activePlayer?.championName ||
        ''
    if (!championName) {
        return null
    }

    const { loadChampionRoster } = await import('../data-loader.ts')
    const roster = await loadChampionRoster()
    const championByName = new Map()

    for (const champion of roster) {
        const championId = normalizeChampionId(champion?.championId ?? champion?.id)
        if (!championId) {
            continue
        }

        const keys = [
            champion?.alias,
            champion?.nameEN,
            champion?.nameCN,
        ]
            .map(normalizeChampionLookupText)
            .filter(Boolean)

        keys.forEach(key => championByName.set(key, championId))
    }

    const championId = championByName.get(normalizeChampionLookupText(championName)) || null
    return championId
        ? {
            championId,
            source: 'liveclient-champion-name',
            matchedPlayer: matchedPlayer?.summonerName || matchedPlayer?.riotId || null,
            championName,
        }
        : null
}

function isAramItemSetAutoApplyEnabled() {
    return store.get(ITEM_SET_AUTO_APPLY_KEY) !== false
}

function resetChampSelectItemSetState(reason) {
    lastChampSelectInsightChampionId = null
    lastInProgressInsightChampionId = null
    lastInProgressChampionRecoveryAttemptAt = 0
    pendingAutoApplyChampionId = null
    pendingAutoApplyReason = null
    champSelectSnapshotPollInFlight = false
    itemSetPreloadGeneration += 1
    itemSetPreloadQueue = []
    itemSetPreloadDataByChampionId.clear()
    logger.debug('[item-set] champ-select item set state reset', { reason })
}

function queueChampSelectItemSetPreload(championId, reason) {
    if (
        !championId ||
        itemSetPreloadDataByChampionId.has(championId) ||
        itemSetPreloadInFlight.has(championId) ||
        itemSetPreloadQueue.some((queued) => queued.championId === championId)
    ) {
        return
    }

    itemSetPreloadQueue.push({
        championId,
        reason,
        generation: itemSetPreloadGeneration,
    })

    logger.debug('[item-set] champ-select item set data preload queued', {
        championId,
        reason,
        queueSize: itemSetPreloadQueue.length,
    })
    drainChampSelectItemSetPreloadQueue()
}

function drainChampSelectItemSetPreloadQueue() {
    while (itemSetPreloadActiveCount < ITEM_SET_PRELOAD_CONCURRENCY && itemSetPreloadQueue.length > 0) {
        const preloadTask = itemSetPreloadQueue.shift()
        if (!preloadTask || preloadTask.generation !== itemSetPreloadGeneration) {
            continue
        }

        const { championId, reason, generation } = preloadTask
        if (itemSetPreloadDataByChampionId.has(championId) || itemSetPreloadInFlight.has(championId)) {
            continue
        }

        itemSetPreloadActiveCount += 1
        itemSetPreloadInFlight.add(championId)
        void preloadChampSelectItemSetData(championId, reason, generation)
            .finally(() => {
                itemSetPreloadInFlight.delete(championId)
                itemSetPreloadActiveCount = Math.max(0, itemSetPreloadActiveCount - 1)
                drainChampSelectItemSetPreloadQueue()
            })
    }
}

async function preloadChampSelectItemSetData(championId, reason, generation) {
    const startedAt = Date.now()

    try {
        const { loadChampionBuild, loadChampionName } = await import('../data-loader.ts')
        const [build, championName] = await Promise.all([
            loadChampionBuild(championId),
            loadChampionName(championId),
        ])

        if (generation !== itemSetPreloadGeneration) {
            return
        }

        const builds = Array.isArray(build?.builds) ? build.builds : []
        const hasBuilds = builds.length > 0
        const hasChampionName = championName && typeof championName === 'object'
        if (hasBuilds || hasChampionName) {
            itemSetPreloadDataByChampionId.set(championId, {
                builds: hasBuilds ? builds : null,
                championName: hasChampionName ? championName : null,
            })
        }

        logger.debug('[item-set] champ-select item set data preloaded', {
            championId,
            reason,
            hasBuilds,
            buildCount: builds.length,
            hasChampionName,
            durationMs: Date.now() - startedAt,
        })
    } catch (error) {
        if (generation !== itemSetPreloadGeneration) {
            return
        }

        logger.warn('[item-set] champ-select item set data preload failed:', {
            championId,
            reason,
            error: error.message,
            durationMs: Date.now() - startedAt,
        })
    }
}

function preloadAramItemSetDataForChampSelect(snapshot, reason) {
    if (!isAramItemSetAutoApplyEnabled() || snapshot?.gameflowPhase !== 'ChampSelect') {
        return
    }

    const championIds = collectAramCandidateChampionIds(snapshot)
        .map((championId) => normalizeChampionId(championId))
        .filter(Boolean)

    championIds.forEach((championId) => queueChampSelectItemSetPreload(championId, reason))
}

function buildRefreshableBenchRecommendation(snapshot) {
    if (!snapshot || snapshot.gameflowPhase !== 'ChampSelect') {
        return null
    }

    return {
        ...getAramBenchRecommendation(snapshot, {}),
        refreshable: true,
    }
}

async function showChampionInsightSnapshot(snapshot, reason) {
    const championId = normalizeChampionId(snapshot?.selfChampionId)
    if (championId) {
        store.set('lastSelectedChampionId', championId)
    }

    if (!shouldShowChampionDetails()) {
        logger.debug('Champion insight show skipped by preference', { championId, reason })
        return
    }

    const popupWindow = getPopupWindow()
    if (!popupWindow || popupWindow.isDestroyed()) {
        logger.warn('Champion insight window is unavailable for champ-select')
        return
    }

    applyPopupWindowLayout()
    if (!popupWindow.isVisible()) {
        popupWindow.show()
    }

    popupWindow.webContents.send('for-popup', {
        championId,
        augments: [],
        benchRecommendation: buildRefreshableBenchRecommendation(snapshot),
        champSelect: true,
        dataSource: 'champ-select',
        timestamp: Date.now(),
    })

    logger.info('显示英雄详情选人视图', {
        championId,
        benchCount: snapshot?.benchChampions?.length || 0,
        benchCandidateCount: collectAramCandidateChampionIds(snapshot).length,
        snapshotStatus: snapshot?.status || 'unavailable',
        reason,
    })
}

async function pollChampSelectSnapshot(lcuService, reason, forceShow = false) {
    if (champSelectSnapshotPollInFlight) {
        return
    }

    champSelectSnapshotPollInFlight = true
    try {
        const snapshot = await lcuService.getChampSelectSnapshot()
        if (snapshot?.gameflowPhase && snapshot.gameflowPhase !== 'ChampSelect') {
            return
        }

        const championId = normalizeChampionId(snapshot?.selfChampionId)
        const championChanged = !!championId && championId !== lastChampSelectInsightChampionId
        const shouldShowEmpty = forceShow && !championId && lastChampSelectInsightChampionId == null

        preloadAramItemSetDataForChampSelect(snapshot, reason)

        if (championChanged || shouldShowEmpty) {
            lastChampSelectInsightChampionId = championId
            await showChampionInsightSnapshot(snapshot, reason)
        }

        if (championChanged) {
            logger.info('[item-set] champ-select current champion changed', {
                championId,
                reason,
                snapshotStatus: snapshot?.status || 'unavailable',
            })
            void autoApplyAramItemSetForChampion(championId, reason)
        }
    } catch (error) {
        logger.debug('Failed to poll champ-select snapshot:', {
            reason,
            error: error.message,
        })
    } finally {
        champSelectSnapshotPollInFlight = false
    }
}

async function showChampionInsightForChampSelect(lcuService) {
    await pollChampSelectSnapshot(lcuService, 'champ-select-insight', true)
}

async function prepareAndNotifyPostGameShare(lcuService, reason) {
    const result = await preparePostGameSharePosterData(lcuService, reason)
    if (!result?.data || result.data.status === 'unavailable') {
        logger.debug('[post-game-share] poster notification skipped', {
            reason,
            success: result?.success,
            status: result?.data?.status || null,
            error: result?.error || null,
        })
        return
    }

    await notifyAllWindows('post-game-share-ready', result.data)
}

async function resolveInProgressChampion(lcuService) {
    const gameflowSession = await lcuService.getReadOnlyJsonEndpoint('/lol-gameflow/v1/session')
    const sessionChampionId = getLikelyChampionIdFromGameflowSession(gameflowSession?.data)
    if (sessionChampionId) {
        return {
            championId: sessionChampionId,
            source: 'gameflow-session',
            status: gameflowSession?.status || null,
        }
    }

    const liveClientData = await lcuService.getLiveClientAllGameData()
    let liveClientChampion = await resolveChampionIdFromLiveClientData(liveClientData?.data, null)
    if (!liveClientChampion && liveClientData?.data) {
        const currentSummoner = await lcuService.getCurrentSummoner()
        liveClientChampion = await resolveChampionIdFromLiveClientData(liveClientData.data, currentSummoner)
    }

    return liveClientChampion
        ? {
            ...liveClientChampion,
            status: liveClientData?.status || null,
        }
        : null
}

async function recoverChampionInsightForInProgress(lcuService, reason) {
    if (inProgressChampionRecoveryInFlight) {
        return
    }

    const popupWindow = getPopupWindow()
    const canRefreshVisiblePopup = shouldShowChampionDetails() &&
        popupWindow &&
        !popupWindow.isDestroyed() &&
        popupWindow.isVisible()

    const now = Date.now()
    if (
        lastInProgressInsightChampionId == null &&
        lastInProgressChampionRecoveryAttemptAt &&
        now - lastInProgressChampionRecoveryAttemptAt < IN_PROGRESS_CHAMPION_RECOVERY_RETRY_MS
    ) {
        return
    }

    lastInProgressChampionRecoveryAttemptAt = now
    inProgressChampionRecoveryInFlight = true
    const startedAt = now

    try {
        const resolved = await resolveInProgressChampion(lcuService)
        const championId = normalizeChampionId(resolved?.championId)
        if (!championId) {
            logger.warn('Unable to recover current champion while game is in progress', {
                reason,
                durationMs: Date.now() - startedAt,
            })
            return
        }

        store.set('lastSelectedChampionId', championId)
        logger.info('Recovered current champion while game is in progress', {
            championId,
            reason,
            source: resolved?.source || null,
            matchedPlayer: resolved?.matchedPlayer || null,
            championName: resolved?.championName || null,
            status: resolved?.status || null,
            durationMs: Date.now() - startedAt,
        })

        if (lastInProgressInsightChampionId === championId) {
            return
        }

        lastInProgressInsightChampionId = championId
        if (!canRefreshVisiblePopup) {
            return
        }

        setPopupWindowAlwaysOnTop(true)

        popupWindow.webContents.send('for-popup', {
            championId,
            augments: [],
            benchRecommendation: null,
            champSelect: false,
            dataSource: 'in-progress',
            timestamp: Date.now(),
        })
        logger.info('显示英雄详情游戏中视图', {
            championId,
            reason,
            source: resolved?.source || null,
        })
    } catch (error) {
        logger.warn('Failed to recover current champion while game is in progress:', {
            reason,
            error: error.message,
            durationMs: Date.now() - startedAt,
        })
    } finally {
        inProgressChampionRecoveryInFlight = false
    }
}

async function autoApplyAramItemSetForChampion(championId, reason) {
    const normalizedChampionId = Number(championId)
    if (!Number.isFinite(normalizedChampionId) || normalizedChampionId <= 0) {
        return
    }

    if (!isAramItemSetAutoApplyEnabled()) {
        logger.debug('[item-set] auto apply skipped: disabled', {
            championId: normalizedChampionId,
            reason,
        })
        return
    }

    if (itemSetAutoApplyInFlight) {
        pendingAutoApplyChampionId = normalizedChampionId
        pendingAutoApplyReason = reason
        logger.debug('[item-set] auto apply queued while another apply is running', {
            championId: normalizedChampionId,
            reason,
            lastChampionId: lastAutoAppliedItemSetChampionId,
        })
        return
    }

    if (lastAutoAppliedItemSetChampionId === normalizedChampionId) {
        logger.debug('[item-set] auto apply skipped: duplicate champion', {
            championId: normalizedChampionId,
            reason,
            lastChampionId: lastAutoAppliedItemSetChampionId,
        })
        return
    }

    itemSetAutoApplyInFlight = true
    logger.info('[item-set] auto apply requested for current champion', {
        championId: normalizedChampionId,
        reason,
    })

    try {
        const { installAramItemSetForChampion } = await import('../services/item-sets/item-set-installer.ts')
        const preloadedItemSetData = itemSetPreloadDataByChampionId.get(normalizedChampionId)
        const result = await installAramItemSetForChampion({
            championId: normalizedChampionId,
            builds: preloadedItemSetData?.builds || null,
            championName: preloadedItemSetData?.championName || null,
        })

        if (result?.success) {
            lastAutoAppliedItemSetChampionId = normalizedChampionId
        }

        logger.info('[item-set] auto apply completed for current champion', {
            championId: normalizedChampionId,
            reason,
            success: result?.success || false,
            error: result?.error || null,
            localRemovedCount: result?.localRemovedCount ?? null,
            localWrittenCount: result?.localWrittenCount ?? null,
            lcuRemovedCount: result?.lcuRemovedCount ?? null,
            lcuItemSetCount: result?.lcuItemSetCount ?? null,
            writtenItemSetCount: result?.writtenItemSetCount ?? null,
            usedPreloadedData: !!preloadedItemSetData,
            durationMs: result?.durationMs ?? null,
        })
        void notifyAllWindows('item-set-auto-apply-completed', {
            championId: normalizedChampionId,
            reason,
            success: result?.success || false,
            skipped: result?.skipped || false,
            error: result?.error || null,
            writtenItemSetCount: result?.writtenItemSetCount ?? null,
            durationMs: result?.durationMs ?? null,
        })
    } catch (error) {
        logger.warn('[item-set] auto apply failed for current champion:', {
            championId: normalizedChampionId,
            reason,
            error: error.message,
        })
        void notifyAllWindows('item-set-auto-apply-completed', {
            championId: normalizedChampionId,
            reason,
            success: false,
            skipped: false,
            error: error.message || '装备推荐写入失败',
            writtenItemSetCount: 0,
            durationMs: null,
        })
    } finally {
        itemSetAutoApplyInFlight = false
        if (pendingAutoApplyChampionId && pendingAutoApplyChampionId !== lastAutoAppliedItemSetChampionId) {
            const nextChampionId = pendingAutoApplyChampionId
            const nextReason = pendingAutoApplyReason || 'champ-select-pending'
            pendingAutoApplyChampionId = null
            pendingAutoApplyReason = null
            void autoApplyAramItemSetForChampion(nextChampionId, nextReason)
        } else {
            pendingAutoApplyChampionId = null
            pendingAutoApplyReason = null
        }
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

function stopGameflowMonitorRuntime(reason) {
    lcuGameflowMonitorStopping = true
    stopGameflowWebSocket(reason)

    if (lcuPollingTimer) {
        clearInterval(lcuPollingTimer)
        lcuPollingTimer = null
        logger.info(`游戏流程轮询已停止: ${reason}`)
    }
}

async function ensureGameFlowMonitor(reason = 'manual') {
    if (lcuPollingTimer) {
        logger.debug(`Game flow monitor already running (${reason})`)
        return true
    }

    if (lcuGameflowInitPromise) {
        logger.debug(`Game flow monitor initialization already in progress (${reason})`)
        await lcuGameflowInitPromise
        return Boolean(lcuPollingTimer)
    }

    logger.info(`Ensuring game flow monitor: ${reason}`)
    lcuGameflowInitPromise = initGameFlowMonitor()
        .catch((error) => {
            logger.warn(`Game flow monitor ensure failed (${reason}):`, error.message)
        })
        .finally(() => {
            lcuGameflowInitPromise = null
        })

    await lcuGameflowInitPromise
    return Boolean(lcuPollingTimer)
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

        logger.info('============ 初始化游戏流程监控 ============')
        logger.debug('LCU 认证将仅使用运行中 League Client 进程参数')

        // 初始化 LCU 服务（使用统一的 LCU 服务）
        logger.debug('初始化 LCU 服务...')
        const lcuService = getLCUServiceInstance()
        logger.debug('获取 LCU Token...')
        let currentAuth = await lcuService.getAuthToken()
        let lastAuthUrl = currentAuth?.url || lcuService.getUrl()

        if (!lcuService.isActive()) {
            logger.error('LCU 连接失败！')
            logger.warn('可能的原因:')
            logger.warn('   1. 游戏客户端未运行 - 请启动 League of Legends 客户端')
            logger.warn('   2. 未能从 LeagueClientUx.exe 启动参数发现 LCU')
            logger.warn('   3. 当前系统权限无法读取 League Client 进程命令行')
            logger.info('调试步骤:')
            logger.info('   1. 确认 League Client 已启动')
            logger.info('   2. 检查日志中是否出现 LCU process discovery 相关错误')
            logger.info('将继续低频重试 LCU 连接')
        } else {
            logger.debug('LCU Token 获取成功')
        }

        const gameSessionCoordinator = new GameSessionCoordinator()
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
            setAppUpdateGamePhase(phase)

            const transition = gameSessionCoordinator.transition(phase, source)
            if (transition.changed) {
                const prevPhase = transition.previous.phase
                const currentPhase = transition.current.phase
                logger.info(`游戏阶段变化(${source}): ${prevPhase || 'unknown'} → ${phase}`)
                notifyAllWindows('game-phase-changed', { phase: currentPhase, prevPhase })
                clearAugmentOverlayForPhase(currentPhase)
                void logReadOnlyGameApiDiagnostics(lcuService, currentPhase, `phase-change:${source}`, true)
                if (currentPhase === 'Lobby' || currentPhase === 'None') {
                    requestLocalMatchHistoryBackgroundSync(`phase-change:${currentPhase}`)
                }

                // 状态机只决定阶段入口效果，Electron/LCU 副作用仍由主进程执行。
                switch (transition.entryEffect) {
                    case 'RESET_IDLE_SERVICES':
                        lastAutoAppliedItemSetChampionId = null
                        resetChampSelectItemSetState(`LCU phase ${currentPhase}`)
                        stopAutoScreenshotForGame(`LCU phase ${currentPhase}`)
                        break
                    case 'ENTER_CHAMP_SELECT':
                        logger.info('进入选人阶段 - 暂停游戏内海克斯 OCR')
                        resetPostGameShareSnapshot('LCU phase ChampSelect')
                        keepChampionInsightOnTop('LCU phase ChampSelect')
                        lastAutoAppliedItemSetChampionId = null
                        resetChampSelectItemSetState(`LCU phase ${phase}`)
                        notifyAllWindows('champ-select-start', {})
                        await showChampionInsightForChampSelect(lcuService)
                        stopAutoScreenshotForGame('LCU phase ChampSelect')
                        break
                    case 'ENTER_GAME_START':
                        logger.info('游戏开始加载')
                        resetPostGameShareSnapshot('LCU phase GameStart')
                        keepChampionInsightOnTop('LCU phase GameStart')
                        notifyAllWindows('game-started', {})
                        resetChampSelectItemSetState('LCU phase GameStart')
                        stopAutoScreenshotForGame('LCU phase GameStart')
                        break
                    case 'ENTER_IN_PROGRESS':
                        logger.info('游戏进行中 - 启动自动截图来检测海克斯选择')
                        keepChampionInsightOnTop('LCU phase InProgress')
                        notifyAllWindows('game-in-progress', {})
                        resetChampSelectItemSetState('LCU phase InProgress')
                        void recoverChampionInsightForInProgress(lcuService, 'LCU phase InProgress')
                        void capturePostGameShareSnapshot(lcuService, 'LCU phase InProgress')
                        await startAutoScreenshotForGame('LCU phase InProgress')
                        break
                    case 'ENTER_WAITING_FOR_STATS':
                        logger.info('游戏已结束')
                        notifyAllWindows('game-ended', {})
                        void prepareAndNotifyPostGameShare(lcuService, 'LCU phase WaitingForStats')
                        resetChampSelectItemSetState('LCU phase WaitingForStats')
                        stopAutoScreenshotForGame('LCU phase WaitingForStats')
                        break
                    case 'ENTER_PRE_END_OF_GAME':
                        logger.info('游戏结束统计阶段')
                        void prepareAndNotifyPostGameShare(lcuService, 'LCU phase PreEndOfGame')
                        resetChampSelectItemSetState('LCU phase PreEndOfGame')
                        stopAutoScreenshotForGame('LCU phase PreEndOfGame')
                        break
                    case 'ENTER_END_OF_GAME':
                        logger.info('游戏完全结束')
                        notifyAllWindows('end-of-game', {})
                        void prepareAndNotifyPostGameShare(lcuService, 'LCU phase EndOfGame')
                        resetChampSelectItemSetState('LCU phase EndOfGame')
                        stopAutoScreenshotForGame('LCU phase EndOfGame')
                        break
                }
            }

            if (phase === GAMEFLOW_AUGMENT_ANALYSIS_PHASE) {
                void logReadOnlyGameApiDiagnostics(lcuService, phase, `heartbeat:${source}`)
                void capturePostGameShareSnapshot(lcuService, `heartbeat:${source}`)
                if (lastInProgressInsightChampionId == null) {
                    void recoverChampionInsightForInProgress(lcuService, 'LCU phase InProgress heartbeat')
                }
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

                if (gameSessionCoordinator.getState().phase === 'ChampSelect') {
                    await pollChampSelectSnapshot(lcuService, 'champ-select-poll')
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
 * 注册应用事件
 */
async function runQuitCleanup(reason = 'app quit') {
    logger.info('App is quitting, cleaning up...', { reason })
    markAnalyticsAppCleanExit()
    stopPerformanceMonitor(reason)

    stopGameflowMonitorRuntime('app will quit')
    stopLocalMatchHistoryBackgroundSync()

    if (autoScreenshotService && autoScreenshotService.isRunning) {
        autoScreenshotService.stop()
        logger.info('自动截图服务已停止')
    }

    await logger.cleanupOldLogs(7)
}

function ensureQuitCleanup(reason = 'app quit') {
    if (quitCleanupCompleted) {
        return Promise.resolve()
    }

    if (!quitCleanupPromise) {
        quitCleanupPromise = runQuitCleanup(reason)
            .catch((error) => {
                logger.warn('App quit cleanup failed:', error.message)
            })
            .finally(() => {
                quitCleanupCompleted = true
            })
    }

    return quitCleanupPromise
}

function registerAppEvents() {
    let appUpdateInstallOnQuitPromise = null

    app.on('before-quit', (event) => {
        if (isAppUpdateInstallInProgress()) {
            logger.info('[app] before-quit allowed for app update install')
            return
        }

        if (shouldInstallDownloadedAppUpdateOnQuit()) {
            event.preventDefault()

            if (!appUpdateInstallOnQuitPromise) {
                appUpdateInstallOnQuitPromise = installDownloadedAppUpdate('before-quit')
                    .then((result) => {
                        if (!result.success) {
                            logger.warn('[app] failed to install downloaded update on quit:', result.error)
                            return ensureQuitCleanup('before-quit-update-install-failed').finally(() => {
                                app.quit()
                            })
                        }
                        return null
                    })
                    .catch((error) => {
                        logger.warn('[app] failed to install downloaded update on quit:', error.message)
                        return ensureQuitCleanup('before-quit-update-install-error').finally(() => {
                            app.quit()
                        })
                    })
                    .finally(() => {
                        appUpdateInstallOnQuitPromise = null
                    })
            }

            return
        }

        if (quitCleanupCompleted) {
            return
        }

        event.preventDefault()
        ensureQuitCleanup('before-quit').finally(() => {
            app.quit()
        })
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
        const sidePanelWin = getAugmentSidePanelWindow()
        let sentToOverlay = false

        if (floatingWin && !floatingWin.isDestroyed() && shouldShowAugmentTopOverlay()) {
            if (shouldRaiseOverlayWindow(floatingWin)) {
                applyFloatingWindowLayout()
                logger.info('✨ 显示海克斯浮动窗口')
                raiseOverlayWindow(floatingWin, 'floating')
            }
            // 发送数据到浮动窗口
            floatingWin.webContents.send(channel, data)
            sentToOverlay = true
        } else if (floatingWin && !floatingWin.isDestroyed() && floatingWin.isVisible() && !shouldShowAugmentTopOverlay()) {
            floatingWin.hide()
        }

        if (sidePanelWin && !sidePanelWin.isDestroyed() && shouldShowAugmentSidePanel()) {
            if (shouldRaiseOverlayWindow(sidePanelWin)) {
                applyAugmentSidePanelWindowLayout()
                logger.info('✨ 显示海克斯右侧推荐列表')
                raiseOverlayWindow(sidePanelWin, 'augment-side-panel')
            }
            sidePanelWin.webContents.send(channel, data)
            sentToOverlay = true
        } else if (sidePanelWin && !sidePanelWin.isDestroyed() && sidePanelWin.isVisible() && !shouldShowAugmentSidePanel()) {
            sidePanelWin.hide()
        }

        if (sentToOverlay) {
            return
        } else {
            logger.warn('⚠️ 海克斯浮窗均未显示或不可用')
        }
    }

    // 通知所有打开的窗口（兜底）
    BrowserWindow.getAllWindows().forEach(window => {
        if (!window.isDestroyed()) {
            window.webContents.send(channel, data)
        }
    })
}
