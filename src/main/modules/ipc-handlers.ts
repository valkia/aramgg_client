// @ts-nocheck
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { captureScreenshot } from '../screenshot.ts'
import { analyzeScreenshot } from '../image-analyzer.ts'
import autoScreenshotService from '../auto-screenshot-service.ts'
import { registerLCUIpcHandlers } from '../services/lcu/ipc-handlers.ts'
import {
    applyFloatingWindowLayout,
    applyPopupWindowLayout,
    allowMainWindowClose,
    createPopupWindow,
    getFloatingWindow,
    getMainWindow,
    getPopupWindow,
    toggleMainWindow,
} from './window-manager.ts'
import logger from './logger.ts'
import store from './app-store.ts'
import { getAppDataDir } from './app-paths.ts'
import {
    getAnalyticsStatus,
    setAnalyticsEnabled,
    trackAnalyticsEvent,
} from '../services/analytics-service.ts'

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
    'item-set-auto-apply-completed',
    'game-started',
    'game-in-progress',
    'bench-recommendation-preview',
    'augment-detection-started',
    'augment-detected',
    'augment-cleared',
    'game-ended',
    'end-of-game',
])
const championDataLoadRequests = new Map()
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

    allowMainWindowClose()

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

function assertSafeExternalUrl(url) {
    const parsedUrl = new URL(url)
    if (!['http:', 'https:', 'mailto:'].includes(parsedUrl.protocol)) {
        throw new Error(`Unsupported external URL protocol: ${parsedUrl.protocol}`)
    }

    return parsedUrl.toString()
}

async function directoryExists(directoryPath) {
    try {
        const stats = await fs.stat(directoryPath)
        return stats.isDirectory()
    } catch {
        return false
    }
}

async function findLolInstallChildPath(directoryPath) {
    const candidates = [
        'League of Legends',
        'LeagueOfLegends',
        '英雄联盟',
    ]

    for (const directoryName of candidates) {
        const candidatePath = path.join(directoryPath, directoryName)
        if (await directoryExists(path.join(candidatePath, 'LeagueClient'))) {
            return candidatePath
        }
    }

    return null
}

async function validateLolDirectory(lolPath) {
    const normalizedPath = typeof lolPath === 'string' ? lolPath.trim() : ''

    if (!normalizedPath) {
        return {
            success: true,
            valid: false,
            reason: 'empty',
            message: '请输入英雄联盟安装目录，或点击“浏览”选择目录。',
        }
    }

    let stats
    try {
        stats = await fs.stat(normalizedPath)
    } catch {
        return {
            success: true,
            valid: false,
            reason: 'not-found',
            message: '这个路径不存在。请检查拼写，或点击“浏览”重新选择英雄联盟安装目录。',
        }
    }

    if (!stats.isDirectory()) {
        return {
            success: true,
            valid: false,
            reason: 'not-directory',
            message: '请选择文件夹路径，不要选择 exe 文件或快捷方式。',
        }
    }

    const normalizedDirectory = path.normalize(normalizedPath)
    const directoryName = path.basename(normalizedDirectory).toLowerCase()
    if (directoryName === 'leagueclient' || directoryName === 'game') {
        const parentPath = path.dirname(normalizedPath)
        if (await directoryExists(path.join(parentPath, 'LeagueClient'))) {
            return {
                success: true,
                valid: false,
                reason: `${directoryName}-subdirectory`,
                message: `当前选中的是 ${path.basename(normalizedDirectory)} 子目录，请改选上一层英雄联盟安装目录：${parentPath}`,
                suggestedPath: parentPath,
            }
        }
    }

    if (directoryName === 'riot client') {
        const siblingLolPath = path.join(path.dirname(normalizedPath), 'League of Legends')
        if (await directoryExists(path.join(siblingLolPath, 'LeagueClient'))) {
            return {
                success: true,
                valid: false,
                reason: 'riot-client-directory',
                message: `当前选中的是 Riot Client 目录，请选择同级的 League of Legends 游戏目录：${siblingLolPath}`,
                suggestedPath: siblingLolPath,
            }
        }
    }

    if (directoryName === 'riot games' || directoryName === 'wegameapps') {
        const childLolPath = await findLolInstallChildPath(normalizedPath)
        if (childLolPath) {
            return {
                success: true,
                valid: false,
                reason: 'publisher-root-directory',
                message: `当前选中的是上级安装目录，请选择英雄联盟游戏目录：${childLolPath}`,
                suggestedPath: childLolPath,
            }
        }
    }

    const leagueClientPath = path.join(normalizedPath, 'LeagueClient')
    if (!(await directoryExists(leagueClientPath))) {
        return {
            success: true,
            valid: false,
            reason: 'missing-league-client',
            message: '未找到 LeagueClient 文件夹。国际服请选择 C:\\Riot Games\\League of Legends 这类游戏目录；国服请选择 WeGameApps\\英雄联盟。不要选择 Riot Client、LeagueClient、Game 或 exe 文件。',
        }
    }

    return {
        success: true,
        valid: true,
        reason: 'ok',
        message: '路径格式正确。若后续连接失败，请确认英雄联盟客户端已启动。',
    }
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
    const { getAramBenchRecommendation } = await import('../services/aram/bench-recommendation.ts')
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
        requestAppQuit('user confirmed quit')
        return { success: true, quit: true }
    })

    ipcMain.on('restart-app', () => {
        app.relaunch()
        app.exit()
    })

    ipcMain.handle('get-version-info', async () => {
        try {
            const { getVersionInfo } = await import('../version-checker.ts')
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

    ipcMain.handle('analytics-get-status', async () => {
        try {
            return { success: true, data: await getAnalyticsStatus() }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle('analytics-set-enabled', async (_event, enabled) => {
        try {
            return { success: true, data: await setAnalyticsEnabled(enabled) }
        } catch (error) {
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle('analytics-track', async (_event, name, properties = {}) => {
        return trackAnalyticsEvent(name, properties)
    })

    ipcMain.handle('shell-open-external', async (_event, url) => {
        const safeUrl = assertSafeExternalUrl(url)
        await shell.openExternal(safeUrl)
        return { success: true }
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

                augmentStats = augmentStats.filter((augment) => {
                    const augmentId = Number(augment.augmentId ?? augment.id)
                    return augmentIdSet.has(augmentId)
                })
                augmentStats.sort((a, b) => {
                    const leftId = Number(a.augmentId ?? a.id)
                    const rightId = Number(b.augmentId ?? b.id)
                    return augmentOrder.get(leftId) - augmentOrder.get(rightId)
                })
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
        const requestKey = String(championId || '')
        const pendingRequest = championDataLoadRequests.get(requestKey)
        if (pendingRequest) {
            logger.info('[champion-data] load joined pending request', { championId })
            return pendingRequest
        }

        const startedAt = Date.now()

        const request = (async () => {
            const { getChampionDetailData } = await import('../data-loader.ts')
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
        })().finally(() => {
            championDataLoadRequests.delete(requestKey)
        })

        championDataLoadRequests.set(requestKey, request)
        return request
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

    ipcMain.handle('validate-lol-directory', async (_event, lolPath) => {
        try {
            return await validateLolDirectory(lolPath)
        } catch (error) {
            logger.error('Directory validation failed:', error)
            return {
                success: false,
                valid: false,
                reason: 'validation-error',
                message: error.message || '路径校验失败，请重试。',
            }
        }
    })

    ipcMain.handle('item-sets-get-aram-status', async () => {
        try {
            const { getAramItemSetInstallStatus } = await import('../services/item-sets/item-set-installer.ts')
            const lolPath = store.get('lolPath')

            if (!lolPath) {
                return {
                    success: true,
                    installed: false,
                    installedCount: 0,
                    error: '游戏路径未配置',
                }
            }

            return await getAramItemSetInstallStatus({ lolPath })
        } catch (error) {
            logger.warn('[item-set] failed to read ARAM item set status:', error.message)
            return {
                success: false,
                installed: false,
                installedCount: 0,
                error: error.message,
            }
        }
    })

    ipcMain.handle('item-sets-install-aram-champion', async (_event, payload) => {
        try {
            const { installAramItemSetForChampion } = await import('../services/item-sets/item-set-installer.ts')
            const lolPath = store.get('lolPath')
            const request = payload && typeof payload === 'object'
                ? payload
                : { championId: payload }

            if (!lolPath) {
                return {
                    success: false,
                    error: '游戏路径未配置',
                }
            }

            return await installAramItemSetForChampion({
                lolPath,
                championId: request.championId,
                build: request.build,
                championName: request.championName,
            })
        } catch (error) {
            logger.error('[item-set] failed to install ARAM item set:', error)
            return {
                success: false,
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
