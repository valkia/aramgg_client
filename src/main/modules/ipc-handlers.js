import { app, BrowserWindow, dialog, globalShortcut, ipcMain } from 'electron'
import { captureScreenshot } from '../screenshot.js'
import { analyzeScreenshot } from '../image-analyzer.js'
import autoScreenshotService from '../auto-screenshot-service.js'
import { registerLCUIpcHandlers } from '../services/lcu/ipc-handlers.ts'
import {
    applyFloatingWindowLayout,
    applyPopupWindowLayout,
    createPopupWindow,
    getFloatingWindow,
    getMainWindow,
    getPopupWindow,
    toggleMainWindow,
} from './window-manager.js'
import logger from './logger.js'
import store from './app-store.js'
import { getAppDataDir } from './app-paths.js'

const TEST_AUGMENT_COUNT = 3
const TEST_BENCH_CHAMPION_COUNT = 8
const BROADCAST_CHANNELS = new Set([
    'fromMain',
    'for-popup',
    'screenshot-taken',
    'winrate-updated',
    'auto-screenshot-taken',
    'game-phase-changed',
    'champ-select-start',
    'game-started',
    'game-in-progress',
    'bench-recommendation-preview',
    'augment-detection-started',
    'augment-detected',
    'augment-cleared',
    'game-ended',
    'end-of-game',
])
let quitRequested = false

function getElapsedMs(startedAt) {
    return Date.now() - startedAt
}

function requestAppQuit(reason) {
    if (quitRequested) {
        return
    }

    quitRequested = true
    logger.info('[app] quit requested', { reason })

    try {
        globalShortcut.unregisterAll()
    } catch (error) {
        logger.warn('[app] failed to unregister shortcuts before quit:', error.message)
    }

    try {
        autoScreenshotService.stop(`app quit: ${reason}`)
    } catch (error) {
        logger.warn('[app] failed to stop auto screenshot before quit:', error.message)
    }

    const forceExitTimer = setTimeout(() => {
        logger.warn('[app] force exiting after quit timeout')
        for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) {
                window.destroy()
            }
        }
        app.exit(0)
    }, 1500)

    forceExitTimer.unref?.()
    app.quit()
}

function sampleItems(items, count) {
    const pool = [...items]
    const selected = []

    while (pool.length > 0 && selected.length < count) {
        const index = Math.floor(Math.random() * pool.length)
        selected.push(pool.splice(index, 1)[0])
    }

    return selected
}

function getChampionDisplayName(champion) {
    return champion?.nameCN || champion?.nameEN || champion?.alias || `英雄 ${champion?.championId || ''}`
}

function sendPopupError(message) {
    const popupWindow = getPopupWindow()
    if (!popupWindow || popupWindow.isDestroyed()) {
        return
    }

    popupWindow.webContents.send('for-popup', {
        success: false,
        error: message || '数据加载失败',
        dataSource: 'error',
        timestamp: Date.now(),
    })
}

async function buildRandomAugmentPreviewData(context = 'random-augment-preview') {
    const startedAt = Date.now()
    const { loadChampionRoster, getChampionAugmentStats } = await import('../data-loader.ts')
    logger.info(`[diagnostics] ${context}: loading champion roster`)
    const champions = await loadChampionRoster()
    logger.info(`[diagnostics] ${context}: champion roster loaded`, {
        count: champions.length,
        durationMs: getElapsedMs(startedAt),
    })

    if (!champions.length) {
        throw new Error('没有可用英雄数据')
    }

    const shuffledChampions = sampleItems(champions, Math.min(champions.length, 12))
    for (const champion of shuffledChampions) {
        const championStartedAt = Date.now()
        const augmentStats = await getChampionAugmentStats(champion.championId)
        logger.info(`[diagnostics] ${context}: champion augments loaded`, {
            championId: champion.championId,
            augmentCount: augmentStats.length,
            durationMs: getElapsedMs(championStartedAt),
        })
        if (!augmentStats.length) {
            continue
        }

        const augments = sampleItems(augmentStats, TEST_AUGMENT_COUNT).map((augment) => ({
            ...augment,
            id: augment.id || augment.augmentId,
            augmentId: augment.augmentId || augment.id,
            confidence: 0.88 + Math.random() * 0.1,
        }))

        const payload = {
            success: true,
            gamePhase: 'augment-select',
            championId: Number(champion.championId),
            championName: getChampionDisplayName(champion),
            augments,
            analysisConfidence: 0.9 + Math.random() * 0.08,
            timestamp: Date.now(),
            dataSource: 'test',
        }
        logger.info(`[diagnostics] ${context}: random preview data ready`, {
            championId: payload.championId,
            augmentIds: payload.augments.map((augment) => augment.id),
            durationMs: getElapsedMs(startedAt),
        })
        return payload
    }

    throw new Error('没有可用英雄海克斯数据')
}

async function buildRandomBenchRecommendation(currentChampionId = null) {
    const { loadChampionRoster } = await import('../data-loader.ts')
    const { getAramBenchRecommendation } = await import('../services/aram/bench-recommendation.js')
    const champions = await loadChampionRoster()

    if (champions.length < 2) {
        throw new Error('没有足够的英雄数据用于席位推荐')
    }

    const requestedChampionId = Number(currentChampionId)
    const preferredChampion = Number.isFinite(requestedChampionId)
        ? champions.find((champion) => Number(champion.championId) === requestedChampionId)
        : null
    const benchPool = preferredChampion
        ? champions.filter((champion) => Number(champion.championId) !== Number(preferredChampion.championId))
        : champions
    const selectedChampions = preferredChampion
        ? [
            preferredChampion,
            ...sampleItems(benchPool, Math.min(TEST_BENCH_CHAMPION_COUNT - 1, benchPool.length)),
        ]
        : sampleItems(champions, Math.min(TEST_BENCH_CHAMPION_COUNT, champions.length))
    const [currentChampion, ...benchChampions] = selectedChampions
    const championStatsById = selectedChampions.reduce((result, champion) => {
        result[champion.championId] = champion
        return result
    }, {})

    return getAramBenchRecommendation(
        {
            status: 'ready',
            gameflowPhase: 'ChampSelect',
            selfChampionId: Number(currentChampion.championId),
            benchEnabled: benchChampions.length > 0,
            benchChampions: benchChampions.map((champion) => ({
                championId: Number(champion.championId),
            })),
        },
        championStatsById
    )
}

export function registerIpcHandlers(isDev) {
    ipcMain.handle('store-get', (_event, key) => {
        return store.get(key)
    })

    ipcMain.handle('store-set', (_event, key, value) => {
        store.set(key, value)
    })

    ipcMain.handle('store-delete', (_event, key) => {
        store.delete(key)
    })

    ipcMain.on('broadcast', (ev, data) => {
        if (!data || !BROADCAST_CHANNELS.has(data.channel)) {
            logger.warn('[ipc] blocked broadcast to invalid channel', {
                channel: data?.channel || null,
            })
            return
        }

        ev.sender.send(data.channel, data)
    })

    ipcMain.on('show-popup', async (_ev, data) => {
        const startedAt = Date.now()
        logger.info('[popup] show-popup requested', {
            championId: data?.championId || null,
            augmentCount: Array.isArray(data?.augments) ? data.augments.length : 0,
            dataSource: data?.dataSource || null,
        })

        if (!getPopupWindow()) {
            const devServerUrl = isDev ? 'http://localhost:5173' : ''
            await createPopupWindow(isDev, devServerUrl)
            logger.info('[popup] window created for show-popup', {
                durationMs: getElapsedMs(startedAt),
            })
        }

        const popupWindow = getPopupWindow()
        if (!popupWindow) {
            logger.warn('[popup] show-popup aborted: window unavailable')
            return
        }

        applyPopupWindowLayout()
        popupWindow.show()
        popupWindow.webContents.send('for-popup', {
            championId: data.championId,
            championName: data.championName,
            position: data.position,
            augments: data.augments,
            dataSource: data.dataSource,
            error: data.error,
            timestamp: data.timestamp,
        })
        logger.info('[popup] for-popup event sent', {
            championId: data?.championId || null,
            durationMs: getElapsedMs(startedAt),
        })
    })

    ipcMain.on('hide-popup', async () => {
        const popupWindow = getPopupWindow()
        if (popupWindow?.isVisible()) {
            popupWindow.hide()
        }
    })

    ipcMain.on('hide-floating', async () => {
        const floatingWindow = getFloatingWindow()
        if (floatingWindow && !floatingWindow.isDestroyed() && floatingWindow.isVisible()) {
            floatingWindow.hide()
            logger.info('Floating window hidden')
        }
    })

    ipcMain.handle('test-show-floating', async (_event, data) => {
        try {
            const floatingWindow = getFloatingWindow()

            if (!floatingWindow || floatingWindow.isDestroyed()) {
                logger.error('Floating window does not exist')
                return { success: false, error: 'Floating window does not exist' }
            }

            applyFloatingWindowLayout()
            if (!floatingWindow.isVisible()) {
                floatingWindow.show()
                logger.info('Floating window shown for test')
            }

            floatingWindow.webContents.send('augment-detected', data)
            logger.info('Test data sent to floating window')

            return { success: true }
        } catch (error) {
            logger.error('Failed to test floating window:', error)
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle('test-show-random-floating', async () => {
        const startedAt = Date.now()
        try {
            logger.info('[diagnostics] random floating test requested')
            const data = await buildRandomAugmentPreviewData('random-floating-test')
            const floatingWindow = getFloatingWindow()

            if (!floatingWindow || floatingWindow.isDestroyed()) {
                logger.error('Floating window does not exist')
                return { success: false, error: 'Floating window does not exist' }
            }

            applyFloatingWindowLayout()
            if (!floatingWindow.isVisible()) {
                floatingWindow.show()
                logger.info('Floating window shown for random test')
            }

            floatingWindow.webContents.send('augment-detected', data)
            logger.info('Random test data sent to floating window', {
                championId: data.championId,
                augmentIds: data.augments.map((augment) => augment.id),
                durationMs: getElapsedMs(startedAt),
            })

            return { success: true, data }
        } catch (error) {
            logger.error('Failed to show random floating test:', error)
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle('test-show-random-popup', async () => {
        const startedAt = Date.now()
        try {
            logger.info('[diagnostics] random popup test requested')

            if (!getPopupWindow()) {
                const devServerUrl = isDev ? 'http://localhost:5173' : ''
                await createPopupWindow(isDev, devServerUrl)
                logger.info('[diagnostics] random popup window created', {
                    durationMs: getElapsedMs(startedAt),
                })
            }

            const popupWindow = getPopupWindow()
            if (!popupWindow || popupWindow.isDestroyed()) {
                return { success: false, error: 'Popup window does not exist' }
            }

            applyPopupWindowLayout()
            popupWindow.show()
            popupWindow.webContents.send('for-popup', {
                pending: true,
                dataSource: 'pending',
                timestamp: Date.now(),
                message: '正在抽取真实英雄数据...',
            })
            logger.info('[diagnostics] random popup loading state shown', {
                durationMs: getElapsedMs(startedAt),
            })

            const data = await buildRandomAugmentPreviewData('random-popup-test')
            const benchRecommendation = await buildRandomBenchRecommendation(data.championId)
            popupWindow.webContents.send('for-popup', {
                championId: data.championId,
                championName: data.championName,
                augments: data.augments,
                benchRecommendation,
                dataSource: data.dataSource,
                timestamp: data.timestamp,
            })

            logger.info('Random test data sent to popup window', {
                championId: data.championId,
                augmentIds: data.augments.map((augment) => augment.id),
                benchCandidateCount: benchRecommendation?.candidates?.length || 0,
                durationMs: getElapsedMs(startedAt),
            })

            return { success: true, data, benchRecommendation }
        } catch (error) {
            logger.error('Failed to show random popup test:', error)
            sendPopupError(error.message)
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle('test-show-bench-recommendation', async () => {
        const startedAt = Date.now()
        try {
            logger.info('[diagnostics] random bench recommendation requested for champion insight')
            const recommendation = await buildRandomBenchRecommendation()

            if (!getPopupWindow()) {
                const devServerUrl = isDev ? 'http://localhost:5173' : ''
                await createPopupWindow(isDev, devServerUrl)
            }

            const popupWindow = getPopupWindow()
            if (!popupWindow || popupWindow.isDestroyed()) {
                return { success: false, error: 'Popup window does not exist' }
            }

            applyPopupWindowLayout()
            if (!popupWindow.isVisible()) {
                popupWindow.show()
            }

            popupWindow.webContents.send('for-popup', {
                championId: recommendation?.currentChampion?.championId || null,
                championName: recommendation?.currentChampion?.name || '',
                augments: [],
                benchRecommendation: recommendation,
                champSelect: true,
                dataSource: 'champ-select',
                timestamp: Date.now(),
            })
            popupWindow.webContents.send('bench-recommendation-preview', recommendation)
            logger.info('Random bench recommendation sent to champion insight window', {
                recommendedChampionId: recommendation?.recommendedChampion?.championId,
                candidateCount: recommendation?.candidates?.length || 0,
                durationMs: getElapsedMs(startedAt),
            })

            return { success: true, recommendation }
        } catch (error) {
            logger.error('Failed to show random bench recommendation:', error)
            return { success: false, error: error.message }
        }
    })

    ipcMain.on('toggle-main-window', () => {
        toggleMainWindow()
    })

    ipcMain.handle('confirm-quit-app', async () => {
        const mainWindow = getMainWindow()
        const options = {
            type: 'question',
            buttons: ['退出', '取消'],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
            title: '退出海克斯核心',
            message: '确定退出海克斯核心？',
            detail: '退出后，英雄监控、自动截图和浮窗更新都会停止。',
        }
        const result = mainWindow && !mainWindow.isDestroyed()
            ? await dialog.showMessageBox(mainWindow, options)
            : await dialog.showMessageBox(options)

        if (result.response === 0) {
            requestAppQuit('user confirmed quit')
            return { success: true, quit: true }
        }

        return { success: true, quit: false }
    })

    ipcMain.on('restart-app', () => {
        app.relaunch()
        app.exit()
    })

    ipcMain.handle('get-version-info', async () => {
        try {
            const { getVersionInfo } = await import('../version-checker.js')
            return {
                success: true,
                data: await getVersionInfo(),
            }
        } catch (error) {
            logger.warn('Failed to load version info:', error.message)
            return {
                success: false,
                error: error.message,
            }
        }
    })

    ipcMain.handle('screenshot-capture', async () => {
        return captureScreenshot()
    })

    ipcMain.handle('analyze-screenshot', async (_event, imagePath) => {
        return analyzeScreenshot(imagePath)
    })

    ipcMain.handle('get-winrate', async (_event, data = {}) => {
        const { championId, augmentIds, requestStartedAt, requestSource } = data
        const startedAt = Date.now()
        const rendererRequestStartedAt = Number(requestStartedAt)
        const hasRendererRequestStartedAt = Number.isFinite(rendererRequestStartedAt)
        const buildTiming = (completedAt = Date.now()) => ({
            rendererRequestStartedAt: hasRendererRequestStartedAt ? rendererRequestStartedAt : null,
            mainStartedAt: startedAt,
            mainCompletedAt: completedAt,
            mainDurationMs: completedAt - startedAt,
            rendererToMainDelayMs: hasRendererRequestStartedAt ? startedAt - rendererRequestStartedAt : null,
        })

        logger.info('[winrate] query requested', {
            championId,
            augmentIds: Array.isArray(augmentIds) ? augmentIds : [],
            source: requestSource || null,
            rendererToMainDelayMs: hasRendererRequestStartedAt ? startedAt - rendererRequestStartedAt : null,
        })

        try {
            const { getChampionAugmentStats } = await import('../data-loader.ts')
            let augmentStats = await getChampionAugmentStats(championId)

            if (augmentIds && augmentIds.length > 0) {
                const orderedAugmentIds = augmentIds
                    .map((id) => parseInt(id))
                    .filter((id) => Number.isFinite(id))
                const augmentIdSet = new Set(orderedAugmentIds)
                const augmentOrder = new Map(orderedAugmentIds.map((id, index) => [id, index]))

                augmentStats = augmentStats.filter((augment) => augmentIdSet.has(augment.augmentId))
                augmentStats.sort((a, b) => augmentOrder.get(a.augmentId) - augmentOrder.get(b.augmentId))
            }

            const completedAt = Date.now()
            return {
                success: true,
                championId,
                augments: augmentStats,
                timestamp: completedAt,
                dataSource: 'remote',
                timing: buildTiming(completedAt),
            }
        } catch (error) {
            logger.error('Winrate query error:', error)
            const completedAt = Date.now()
            return {
                success: false,
                championId,
                augments: [],
                error: error.message,
                timing: buildTiming(completedAt),
            }
        } finally {
            const timing = buildTiming()
            logger.info('[winrate] query completed', {
                championId,
                source: requestSource || null,
                durationMs: timing.mainDurationMs,
                rendererToMainDelayMs: timing.rendererToMainDelayMs,
            })
        }
    })

    ipcMain.handle('load-champion-data', async (_event, championId) => {
        const { getChampionDetailData } = await import('../data-loader.ts')
        const startedAt = Date.now()
        logger.info('[champion-data] load requested', { championId })

        try {
            const detail = await getChampionDetailData(championId)
            logger.info('[champion-data] load completed', {
                championId,
                hasBuild: !!detail.build,
                augmentCount: detail.augments ? Object.keys(detail.augments).length : 0,
                durationMs: getElapsedMs(startedAt),
            })

            return {
                success: true,
                data: {
                    stats: detail.stats,
                    augments: detail.augmentBase,
                    augmentStats: detail.augments,
                    augmentTrios: detail.augmentTrios,
                    build: detail.build,
                    items: detail.items,
                    championName: detail.championName,
                },
            }
        } catch (error) {
            logger.error('Champion data load error:', error)
            return {
                success: false,
                error: error.message,
            }
        } finally {
            logger.info('[champion-data] load finished', {
                championId,
                durationMs: getElapsedMs(startedAt),
            })
        }
    })

    ipcMain.handle('auto-screenshot-start', async (_event, config = {}) => {
        const interval = config.interval || 5000
        const success = await autoScreenshotService.start(interval, 'manual')
        if (success) {
            logger.info('Auto screenshot service started')
        }
        return {
            success,
            config: autoScreenshotService.getConfig(),
        }
    })

    ipcMain.handle('auto-screenshot-stop', async () => {
        const success = autoScreenshotService.stop('manual')
        if (success) {
            logger.info('Auto screenshot service stopped')
        }
        return {
            success,
            config: autoScreenshotService.getConfig(),
        }
    })

    ipcMain.handle('auto-screenshot-set-config', async (_event, config) => {
        autoScreenshotService.setConfig(config)
        return autoScreenshotService.getConfig()
    })

    ipcMain.handle('auto-screenshot-get-stats', async () => {
        return autoScreenshotService.getPerformanceStats()
    })

    ipcMain.handle('auto-screenshot-get-config', async () => {
        return autoScreenshotService.getConfig()
    })

    ipcMain.handle('select-lol-directory', async () => {
        const { dialog } = await import('electron')
        const mainWindow = getMainWindow()

        try {
            const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory'],
                title: '选择英雄联盟游戏目录',
                message: '请选择英雄联盟的安装目录',
            })

            if (!result.canceled && result.filePaths.length > 0) {
                return {
                    success: true,
                    path: result.filePaths[0],
                }
            }

            return {
                success: false,
                path: null,
                reason: '用户取消了选择',
            }
        } catch (error) {
            logger.error('Directory selection failed:', error)
            return {
                success: false,
                path: null,
                error: error.message,
            }
        }
    })

    ipcMain.handle('log-renderer-error', async (_event, errorData) => {
        const {
            message,
            stack,
            source,
            line,
            column,
            url,
            type,
            timestamp,
            userAgent,
            errorName,
            componentName,
            info,
            route,
        } = errorData || {}

        logger.error('Renderer error reported:', {
            type: type || 'error',
            errorName: errorName || 'Error',
            message: message || 'Unknown error',
            stack: stack || 'No stack trace',
            source: source || 'unknown',
            componentName: componentName || null,
            info: info || null,
            location: `${line}:${column}`,
            url: url || 'unknown',
            route: route || null,
            timestamp: timestamp || Date.now(),
            userAgent: userAgent || 'unknown',
        })

        return { success: true }
    })

    ipcMain.on('log-renderer-info', (_event, data = {}) => {
        logger.info('Renderer info reported:', {
            type: data.type || 'renderer-info',
            message: data.message || '',
            source: data.source || 'renderer',
            url: data.url || 'unknown',
            timestamp: data.timestamp || Date.now(),
            details: data.details || {},
        })
    })

    registerLCUIpcHandlers()

    ipcMain.handle('test-database-load', async () => {
        try {
            const {
                DATA_API_ORIGIN,
                DATA_API_PREFIX,
                loadDataApiConfig,
                loadAugmentBase,
                loadChampionStats,
            } = await import('../data-loader.ts')
            const [config, augments, championStats] = await Promise.all([
                loadDataApiConfig(),
                loadAugmentBase(),
                loadChampionStats(63),
            ])

            return {
                success: true,
                successPath: `${DATA_API_ORIGIN}${DATA_API_PREFIX}`,
                dataCount: augments.length,
                dataVersion: config.dataVersion,
                championStats,
                resourcesPath: process.resourcesPath,
                appDataDir: getAppDataDir(),
                cwd: process.cwd(),
                isDev,
                nodeEnv: process.env.NODE_ENV,
            }
        } catch (error) {
            logger.error('Remote data load test failed:', error)
            return {
                success: false,
                error: error.message,
                stack: error.stack,
            }
        }
    })
}
