import { BrowserWindow, clipboard, dialog, nativeImage, type OpenDialogOptions } from 'electron'
import { writeFile } from 'fs/promises'
import path from 'path'
import { captureScreenshot } from '../screenshot.ts'
import { analyzeScreenshot } from '../image-analyzer.ts'
import autoScreenshotService from '../auto-screenshot-service.ts'
import { registerLCUIpcHandlers } from '../services/lcu/ipc-handlers.ts'
import { getLCUServiceInstance } from '../services/lcu/lcu-service.ts'
import { registerMatchHistoryIpcHandlers } from '../services/match-history/ipc-handlers.ts'
import {
    createMockPostGameSharePosterData,
    getLatestPostGameSharePosterData,
    preparePostGameSharePosterData,
} from '../services/post-game-share.ts'
import {
    applyAugmentSidePanelWindowLayout,
    applyFloatingWindowLayout,
    applyPopupWindowLayout,
    getAugmentSidePanelWindow,
    createPopupWindow,
    getFloatingWindow,
    getMainWindow,
    getPopupWindow,
    raiseOverlayWindow,
    setPopupWindowAlwaysOnTop,
} from './window-manager.ts'
import logger from './logger.ts'
import store from './app-store.ts'
import { getAppDataDir } from './app-paths.ts'
import {
    shouldShowChampionDetails,
    shouldShowAugmentSidePanel,
    shouldShowAugmentTopOverlay,
} from './user-preferences.ts'
import {
    findLeagueInstallChildPath,
    inspectLeagueInstallDirectory,
    isLeagueInstallDirectory,
} from './lol-path.ts'
import {
    getDataLocale,
    loadChampionRoster,
} from '../data-loader.ts'
import { getAramBenchRecommendation } from '../services/aram/bench-recommendation.ts'
import { registerPreferencesIpcHandlers } from '../ipc/preferences-handlers.ts'
import { registerSystemIpcHandlers } from '../ipc/system-handlers.ts'
import { trustedIpcMain as ipcMain } from '../security/trusted-ipc.ts'
import { shouldRaiseOverlayWindow } from './overlay-window-state.ts'

const TEST_AUGMENT_COUNT = 3
const TEST_BENCH_CHAMPION_COUNT = 8
const LCU_MANUAL_LEAGUE_PATH_KEY = 'lolPath'
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
    'post-game-share-ready',
    'locale-changed',
])
const championDataLoadRequests = new Map<string, Promise<unknown>>()
const MAX_POSTER_DATA_URL_LENGTH = 24 * 1024 * 1024

function getElapsedMs(startedAt: number): number {
    return Date.now() - startedAt
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function suppressManualAugmentOverlayReshow(reason: unknown, source: string): void {
    if (reason !== 'manual') {
        return
    }

    try {
        autoScreenshotService.suppressCurrentAugmentOverlay(source)
    } catch (error) {
        logger.warn('[overlay] failed to suppress manual augment reshow:', getErrorMessage(error))
    }
}

function getPosterPngBuffer(dataUrl: unknown): Buffer {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
        throw new Error('Invalid poster image format')
    }

    if (dataUrl.length > MAX_POSTER_DATA_URL_LENGTH) {
        throw new Error('Poster image is too large')
    }

    const base64 = dataUrl.slice('data:image/png;base64,'.length)
    const buffer = Buffer.from(base64, 'base64')
    if (!buffer.length) {
        throw new Error('Poster image is empty')
    }

    return buffer
}

function getPosterSavePath(filePath: unknown): string {
    if (typeof filePath !== 'string' || !filePath) {
        return ''
    }

    return path.extname(filePath).toLowerCase() === '.png'
        ? filePath
        : `${filePath}.png`
}

async function validateLolDirectory(lolPath: unknown) {
    const normalizedInput = typeof lolPath === 'string' ? lolPath.trim() : ''

    if (!normalizedInput) {
        return {
            success: true,
            valid: false,
            reason: 'empty',
            message: '请输入英雄联盟安装目录，或点击浏览选择目录。',
            path: '',
            normalizedPath: '',
        }
    }

    const installInfo = await inspectLeagueInstallDirectory(normalizedInput)

    if (!installInfo.exists) {
        return {
            success: true,
            valid: false,
            reason: 'not-found',
            message: '这个路径不存在。请检查拼写，或点击浏览重新选择。',
            path: normalizedInput,
            normalizedPath: installInfo.normalizedPath,
        }
    }

    if (!installInfo.isDirectory) {
        return {
            success: true,
            valid: false,
            reason: 'not-directory',
            message: '请选择文件夹路径，不要选择 exe 文件或快捷方式。',
            path: normalizedInput,
            normalizedPath: installInfo.normalizedPath,
        }
    }

    const normalizedDirectory = path.normalize(installInfo.normalizedPath)
    const directoryName = path.basename(normalizedDirectory).toLowerCase()
    if (directoryName === 'leagueclient' || directoryName === 'game') {
        const parentPath = path.dirname(installInfo.normalizedPath)
        if (await isLeagueInstallDirectory(parentPath)) {
            return {
                success: true,
                valid: false,
                reason: `${directoryName}-subdirectory`,
                message: `当前选中的是 ${path.basename(normalizedDirectory)} 子目录，请改选上一层英雄联盟安装目录。`,
                path: normalizedInput,
                normalizedPath: installInfo.normalizedPath,
                suggestedPath: parentPath,
            }
        }
    }

    if (directoryName === 'riot client') {
        const siblingLolPath = path.join(path.dirname(installInfo.normalizedPath), 'League of Legends')
        if (await isLeagueInstallDirectory(siblingLolPath)) {
            return {
                success: true,
                valid: false,
                reason: 'riot-client-directory',
                message: '当前选中的是 Riot Client 目录，请选择同级的 League of Legends 游戏目录。',
                path: normalizedInput,
                normalizedPath: installInfo.normalizedPath,
                suggestedPath: siblingLolPath,
            }
        }
    }

    if (directoryName === 'riot games' || directoryName === 'wegameapps') {
        const childLolPath = await findLeagueInstallChildPath(installInfo.normalizedPath)
        if (childLolPath) {
            return {
                success: true,
                valid: false,
                reason: 'publisher-root-directory',
                message: '当前选中的是上级安装目录，请选择英雄联盟游戏目录。',
                path: normalizedInput,
                normalizedPath: installInfo.normalizedPath,
                suggestedPath: childLolPath,
            }
        }
    }

    if (!installInfo.valid) {
        return {
            success: true,
            valid: false,
            reason: 'missing-league-client',
            message: '未找到 LeagueClient.exe 或 LeagueClient 文件夹，请选择英雄联盟安装目录。',
            path: normalizedInput,
            normalizedPath: installInfo.normalizedPath,
        }
    }

    return {
        success: true,
        valid: true,
        reason: 'ok',
        message: '目录可用。自动发现失败时会用它读取 lockfile 或客户端日志。',
        path: installInfo.normalizedPath,
        normalizedPath: installInfo.normalizedPath,
        layout: installInfo.layout,
    }
}

function sampleItems<T>(items: T[], count: number): T[] {
    const pool = [...items]
    const selected: T[] = []

    while (pool.length > 0 && selected.length < count) {
        const index = Math.floor(Math.random() * pool.length)
        selected.push(pool.splice(index, 1)[0])
    }

    return selected
}

function getChampionDisplayName(champion: Record<string, unknown> | null | undefined): string {
    const name = champion?.nameCN || champion?.nameEN || champion?.alias
    return typeof name === 'string' && name ? name : `英雄 ${String(champion?.championId || '')}`
}

function sendPopupError(message: string): void {
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

async function buildRandomBenchRecommendation(currentChampionId: number | null = null) {
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

export function registerIpcHandlers(isDev: boolean): void {
    registerPreferencesIpcHandlers()
    registerSystemIpcHandlers()

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
        logger.debug('[popup] show-popup requested', {
            championId: data?.championId || null,
            augmentCount: Array.isArray(data?.augments) ? data.augments.length : 0,
            dataSource: data?.dataSource || null,
        })

        if (!shouldShowChampionDetails()) {
            logger.debug('[popup] show-popup skipped by preference')
            return
        }

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
        if (!shouldShowChampionDetails()) {
            logger.debug('[popup] show-popup aborted after window preparation: disabled by preference')
            return
        }

        applyPopupWindowLayout()
        setPopupWindowAlwaysOnTop(true)
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
        logger.debug('[popup] for-popup event sent', {
            championId: data?.championId || null,
            durationMs: getElapsedMs(startedAt),
        })
    })

    ipcMain.on('hide-popup', async (_event, reason = 'renderer') => {
        suppressManualAugmentOverlayReshow(reason, 'hide-popup')
        const popupWindow = getPopupWindow()
        if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) {
            popupWindow.hide()
        }
        logger.debug('[popup] hide-popup processed', {
            reason,
            windowExists: !!popupWindow && !popupWindow.isDestroyed(),
            visibleAfter: !!popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible(),
        })
    })

    ipcMain.on('hide-floating', async (_event, reason = 'renderer') => {
        suppressManualAugmentOverlayReshow(reason, 'hide-floating')
        const floatingWindow = getFloatingWindow()
        if (floatingWindow && !floatingWindow.isDestroyed() && floatingWindow.isVisible()) {
            floatingWindow.hide()
        }
        logger.debug('Floating window hide processed', {
            reason,
            windowExists: !!floatingWindow && !floatingWindow.isDestroyed(),
            visibleAfter: !!floatingWindow && !floatingWindow.isDestroyed() && floatingWindow.isVisible(),
        })
    })

    ipcMain.on('hide-augment-side-panel', async (_event, reason = 'renderer') => {
        suppressManualAugmentOverlayReshow(reason, 'hide-augment-side-panel')
        const sidePanelWindow = getAugmentSidePanelWindow()
        if (sidePanelWindow && !sidePanelWindow.isDestroyed() && sidePanelWindow.isVisible()) {
            sidePanelWindow.hide()
        }
        logger.debug('Augment side panel hide processed', {
            reason,
            windowExists: !!sidePanelWindow && !sidePanelWindow.isDestroyed(),
            visibleAfter: !!sidePanelWindow && !sidePanelWindow.isDestroyed() && sidePanelWindow.isVisible(),
        })
    })

    ipcMain.handle('test-show-floating', async (_event, data) => {
        try {
            const floatingWindow = getFloatingWindow()
            const sidePanelWindow = getAugmentSidePanelWindow()

            if ((!floatingWindow || floatingWindow.isDestroyed()) && (!sidePanelWindow || sidePanelWindow.isDestroyed())) {
                logger.error('Augment overlay windows do not exist')
                return { success: false, error: 'Augment overlay windows do not exist' }
            }

            if (floatingWindow && !floatingWindow.isDestroyed() && shouldShowAugmentTopOverlay()) {
                if (shouldRaiseOverlayWindow(floatingWindow)) {
                    applyFloatingWindowLayout()
                    logger.info('Floating window shown for test')
                    raiseOverlayWindow(floatingWindow, 'floating')
                }
                floatingWindow.webContents.send('augment-detected', data)
            }

            if (sidePanelWindow && !sidePanelWindow.isDestroyed() && shouldShowAugmentSidePanel()) {
                if (shouldRaiseOverlayWindow(sidePanelWindow)) {
                    applyAugmentSidePanelWindowLayout()
                    logger.info('Augment side panel window shown for test')
                    raiseOverlayWindow(sidePanelWindow, 'augment-side-panel')
                }
                sidePanelWindow.webContents.send('augment-detected', data)
            }

            logger.info('Test data sent to floating window')

            return { success: true }
        } catch (error) {
            logger.error('Failed to test floating window:', error)
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('test-show-random-floating', async () => {
        const startedAt = Date.now()
        try {
            logger.info('[diagnostics] random floating test requested')
            const data = await buildRandomAugmentPreviewData('random-floating-test')
            const floatingWindow = getFloatingWindow()
            const sidePanelWindow = getAugmentSidePanelWindow()

            if ((!floatingWindow || floatingWindow.isDestroyed()) && (!sidePanelWindow || sidePanelWindow.isDestroyed())) {
                logger.error('Augment overlay windows do not exist')
                return { success: false, error: 'Augment overlay windows do not exist' }
            }

            if (floatingWindow && !floatingWindow.isDestroyed() && shouldShowAugmentTopOverlay()) {
                if (shouldRaiseOverlayWindow(floatingWindow)) {
                    applyFloatingWindowLayout()
                    logger.info('Floating window shown for random test')
                    raiseOverlayWindow(floatingWindow, 'floating')
                }
                floatingWindow.webContents.send('augment-detected', data)
            }

            if (sidePanelWindow && !sidePanelWindow.isDestroyed() && shouldShowAugmentSidePanel()) {
                if (shouldRaiseOverlayWindow(sidePanelWindow)) {
                    applyAugmentSidePanelWindowLayout()
                    logger.info('Augment side panel window shown for random test')
                    raiseOverlayWindow(sidePanelWindow, 'augment-side-panel')
                }
                sidePanelWindow.webContents.send('augment-detected', data)
            }

            logger.info('Random test data sent to floating window', {
                championId: data.championId,
                augmentIds: data.augments.map((augment) => augment.id),
                durationMs: getElapsedMs(startedAt),
            })

            return { success: true, data }
        } catch (error) {
            logger.error('Failed to show random floating test:', error)
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('test-show-random-popup', async () => {
        const startedAt = Date.now()
        try {
            logger.info('[diagnostics] random popup test requested')

            if (!shouldShowChampionDetails()) {
                return { success: true, skipped: true, reason: 'champion-details-disabled' }
            }

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
            if (!shouldShowChampionDetails()) {
                return { success: true, skipped: true, reason: 'champion-details-disabled' }
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
            sendPopupError(getErrorMessage(error))
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('test-show-bench-recommendation', async () => {
        const startedAt = Date.now()
        try {
            logger.info('[diagnostics] random bench recommendation requested for champion insight')

            if (!shouldShowChampionDetails()) {
                return { success: true, skipped: true, reason: 'champion-details-disabled' }
            }

            const recommendation = await buildRandomBenchRecommendation()

            if (!getPopupWindow()) {
                const devServerUrl = isDev ? 'http://localhost:5173' : ''
                await createPopupWindow(isDev, devServerUrl)
            }

            const popupWindow = getPopupWindow()
            if (!popupWindow || popupWindow.isDestroyed()) {
                return { success: false, error: 'Popup window does not exist' }
            }
            if (!shouldShowChampionDetails()) {
                return { success: true, skipped: true, reason: 'champion-details-disabled' }
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
            return { success: false, error: getErrorMessage(error) }
        }
    })

    ipcMain.handle('lcu-get-manual-league-path', async () => {
        try {
            const configuredPath = store.get(LCU_MANUAL_LEAGUE_PATH_KEY) || ''
            if (!configuredPath) {
                return {
                    success: true,
                    path: '',
                    valid: false,
                    reason: 'empty',
                }
            }

            const validation = await validateLolDirectory(configuredPath)
            return {
                ...validation,
                path: configuredPath,
                configuredPath,
            }
        } catch (error) {
            logger.warn('[lcu] failed to read manual League path:', getErrorMessage(error))
            return {
                success: false,
                path: '',
                valid: false,
                error: getErrorMessage(error),
            }
        }
    })

    ipcMain.handle('lcu-select-manual-league-path', async () => {
        try {
            const mainWindow = getMainWindow()
            const dialogOptions: OpenDialogOptions = {
                properties: ['openDirectory'],
                title: '选择英雄联盟游戏目录',
                message: '请选择英雄联盟安装目录',
            }
            const result = mainWindow && !mainWindow.isDestroyed()
                ? await dialog.showOpenDialog(mainWindow, dialogOptions)
                : await dialog.showOpenDialog(dialogOptions)

            if (result.canceled || result.filePaths.length === 0) {
                return {
                    success: false,
                    path: '',
                    valid: false,
                    reason: 'cancelled',
                }
            }

            return validateLolDirectory(result.filePaths[0])
        } catch (error) {
            logger.warn('[lcu] manual League path selection failed:', getErrorMessage(error))
            return {
                success: false,
                path: '',
                valid: false,
                error: getErrorMessage(error),
            }
        }
    })

    ipcMain.handle('lcu-validate-manual-league-path', async (_event, lolPath) => {
        try {
            return await validateLolDirectory(lolPath)
        } catch (error) {
            logger.warn('[lcu] manual League path validation failed:', getErrorMessage(error))
            return {
                success: false,
                valid: false,
                reason: 'validation-error',
                message: getErrorMessage(error) || '目录校验失败，请重试。',
                error: getErrorMessage(error),
            }
        }
    })

    ipcMain.handle('lcu-set-manual-league-path', async (_event, lolPath) => {
        try {
            const validation = await validateLolDirectory(lolPath)
            if (!validation.valid) {
                return validation
            }

            store.set(LCU_MANUAL_LEAGUE_PATH_KEY, validation.normalizedPath)

            let connected = false
            let connectionReason = 'auth-not-found-or-endpoint-unreachable'
            try {
                const lcuService = getLCUServiceInstance()
                const auth = await lcuService.getAuthToken(true)
                if (auth) {
                    connected = await lcuService.getLcuStatus()
                    connectionReason = connected ? 'endpoint-verified' : 'endpoint-unreachable'
                }
            } catch (error) {
                connectionReason = 'connection-check-failed'
                logger.debug('[lcu] manual League path saved but auth refresh failed:', getErrorMessage(error))
            }

            logger.info('[lcu] manual League path fallback saved', {
                layout: validation.layout || null,
                connected,
                connectionReason,
                configuredPath: validation.normalizedPath,
            })

            return {
                ...validation,
                path: validation.normalizedPath,
                configuredPath: validation.normalizedPath,
                connected,
                connectionReason,
            }
        } catch (error) {
            logger.warn('[lcu] failed to save manual League path:', getErrorMessage(error))
            return {
                success: false,
                valid: false,
                error: getErrorMessage(error),
                message: getErrorMessage(error) || '保存目录失败',
            }
        }
    })

    ipcMain.handle('lcu-clear-manual-league-path', async () => {
        try {
            store.delete(LCU_MANUAL_LEAGUE_PATH_KEY)
            logger.info('[lcu] manual League path fallback cleared')
            return {
                success: true,
                path: '',
                valid: false,
                reason: 'cleared',
            }
        } catch (error) {
            logger.warn('[lcu] failed to clear manual League path:', getErrorMessage(error))
            return {
                success: false,
                error: getErrorMessage(error),
            }
        }
    })

    ipcMain.handle('post-game-share-get-latest', async () => {
        try {
            const lcuService = getLCUServiceInstance()
            return await getLatestPostGameSharePosterData(lcuService, 'renderer-request')
        } catch (error) {
            logger.warn('[post-game-share] failed to get latest poster data:', getErrorMessage(error))
            return {
                success: false,
                data: null,
                error: getErrorMessage(error),
            }
        }
    })

    ipcMain.handle('post-game-share-refresh', async () => {
        try {
            const lcuService = getLCUServiceInstance()
            return await preparePostGameSharePosterData(lcuService, 'renderer-refresh')
        } catch (error) {
            logger.warn('[post-game-share] failed to refresh poster data:', getErrorMessage(error))
            return {
                success: false,
                data: null,
                error: getErrorMessage(error),
            }
        }
    })

    ipcMain.handle('post-game-share-create-mock', async () => {
        try {
            return await createMockPostGameSharePosterData()
        } catch (error) {
            logger.warn('[post-game-share] failed to create mock poster data:', getErrorMessage(error))
            return {
                success: false,
                data: null,
                error: getErrorMessage(error),
            }
        }
    })

    ipcMain.handle('post-game-share-copy-image', async (_event, dataUrl) => {
        try {
            getPosterPngBuffer(dataUrl)
            const image = nativeImage.createFromDataURL(dataUrl)
            if (image.isEmpty()) {
                throw new Error('Poster image is empty')
            }

            clipboard.writeImage(image)
            return { success: true }
        } catch (error) {
            logger.warn('[post-game-share] failed to copy poster image:', getErrorMessage(error))
            return {
                success: false,
                error: getErrorMessage(error),
            }
        }
    })

    ipcMain.handle('post-game-share-save-image', async (event, dataUrl, suggestedFilename = 'aramgg-post-game-share.png') => {
        try {
            const buffer = getPosterPngBuffer(dataUrl)
            const ownerWindow = BrowserWindow.fromWebContents(event.sender) || getMainWindow()
            const dialogOptions = {
                title: '保存赛后海报',
                defaultPath: suggestedFilename,
                filters: [
                    { name: 'PNG 图片', extensions: ['png'] },
                ],
            }
            const result = ownerWindow
                ? await dialog.showSaveDialog(ownerWindow, dialogOptions)
                : await dialog.showSaveDialog(dialogOptions)

            if (result.canceled || !result.filePath) {
                return {
                    success: false,
                    cancelled: true,
                    reason: 'cancelled',
                }
            }

            const filePath = getPosterSavePath(result.filePath)
            await writeFile(filePath, buffer)
            return {
                success: true,
                filePath,
            }
        } catch (error) {
            logger.warn('[post-game-share] failed to save poster image:', getErrorMessage(error))
            return {
                success: false,
                error: getErrorMessage(error),
            }
        }
    })

    ipcMain.handle('screenshot-capture', async () => {
        return captureScreenshot()
    })

    ipcMain.handle('analyze-screenshot', async (_event, imagePath) => {
        return analyzeScreenshot(imagePath)
    })

    ipcMain.handle('get-winrate', async (_event, data: unknown = {}) => {
        const request = data && typeof data === 'object'
            ? data as Record<string, unknown>
            : {}
        const { requestStartedAt, requestSource } = request
        const championId = typeof request.championId === 'number' || typeof request.championId === 'string'
            ? request.championId
            : ''
        const augmentIds = Array.isArray(request.augmentIds) ? request.augmentIds : []
        const requestLocale = getDataLocale()
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

        logger.debug('[winrate] query requested', {
            championId,
            augmentIds: Array.isArray(augmentIds) ? augmentIds : [],
            source: requestSource || null,
            rendererToMainDelayMs: hasRendererRequestStartedAt ? startedAt - rendererRequestStartedAt : null,
        })

        try {
            const { getChampionAugmentStats } = await import('../data-loader.ts')
            let augmentStats = await getChampionAugmentStats(championId, requestLocale)

            if (augmentIds.length > 0) {
                const orderedAugmentIds = augmentIds
                    .map((id: unknown) => Number.parseInt(String(id), 10))
                    .filter((id: number) => Number.isFinite(id))
                const augmentIdSet = new Set<number>(orderedAugmentIds)
                const augmentOrder = new Map<number, number>(
                    orderedAugmentIds.map((id: number, index: number) => [id, index])
                )

                augmentStats = augmentStats.filter((augment) => {
                    const augmentId = Number(augment.augmentId ?? augment.id)
                    return augmentIdSet.has(augmentId)
                })
                augmentStats.sort((a, b) => {
                    const leftId = Number(a.augmentId ?? a.id)
                    const rightId = Number(b.augmentId ?? b.id)
                    return (augmentOrder.get(leftId) ?? Number.MAX_SAFE_INTEGER) -
                        (augmentOrder.get(rightId) ?? Number.MAX_SAFE_INTEGER)
                })
            }

            const completedAt = Date.now()
            return {
                success: true,
                championId,
                locale: requestLocale,
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
                error: getErrorMessage(error),
                timing: buildTiming(completedAt),
            }
        } finally {
            const timing = buildTiming()
            logger.debug('[winrate] query completed', {
                championId,
                source: requestSource || null,
                durationMs: timing.mainDurationMs,
                rendererToMainDelayMs: timing.rendererToMainDelayMs,
            })
        }
    })

    ipcMain.handle('load-champion-data', async (_event, championId) => {
        const requestLocale = getDataLocale()
        const requestKey = `${requestLocale}:${String(championId || '')}`
        const pendingRequest = championDataLoadRequests.get(requestKey)
        if (pendingRequest) {
            logger.debug('[champion-data] load joined pending request', { championId })
            return pendingRequest
        }

        const startedAt = Date.now()

        const request = (async () => {
            const { getChampionDetailData } = await import('../data-loader.ts')
            logger.debug('[champion-data] load requested', { championId })

            try {
                const detail = await getChampionDetailData(championId, requestLocale)
                logger.debug('[champion-data] load completed', {
                    championId,
                    buildCount: Array.isArray(detail.builds) ? detail.builds.length : 0,
                    augmentCount: detail.augments ? Object.keys(detail.augments).length : 0,
                    durationMs: getElapsedMs(startedAt),
                })

                return {
                    success: true,
                    locale: detail.locale,
                    dataVersion: detail.dataVersion,
                    data: {
                        stats: detail.stats,
                        augments: detail.augmentBase,
                        augmentStats: detail.augments,
                        augmentTrios: detail.augmentTrios,
                        builds: detail.builds,
                        items: detail.items,
                        championName: detail.championName,
                    },
                }
            } catch (error) {
                logger.error('Champion data load error:', error)
                return {
                    success: false,
                    error: getErrorMessage(error),
                }
            } finally {
                logger.debug('[champion-data] load finished', {
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

    ipcMain.handle('item-sets-get-aram-status', async () => {
        try {
            const { getAramItemSetInstallStatus } = await import('../services/item-sets/item-set-installer.ts')
            return await getAramItemSetInstallStatus()
        } catch (error) {
            logger.warn('[item-set] failed to read ARAM item set status:', getErrorMessage(error))
            return {
                success: false,
                installed: false,
                installedCount: 0,
                error: getErrorMessage(error),
            }
        }
    })

    ipcMain.handle('item-sets-install-aram-champion', async (_event, payload) => {
        try {
            const { installAramItemSetForChampion } = await import('../services/item-sets/item-set-installer.ts')
            const request = payload && typeof payload === 'object'
                ? payload
                : { championId: payload }

            return await installAramItemSetForChampion({
                championId: request.championId,
                builds: request.builds,
                championName: request.championName,
            })
        } catch (error) {
            logger.error('[item-set] failed to install ARAM item set:', error)
            return {
                success: false,
                error: getErrorMessage(error),
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
        logger.debug('Renderer info reported:', {
            type: data.type || 'renderer-info',
            message: data.message || '',
            source: data.source || 'renderer',
            url: data.url || 'unknown',
            timestamp: data.timestamp || Date.now(),
            details: data.details || {},
        })
    })

    registerLCUIpcHandlers()
    registerMatchHistoryIpcHandlers()

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
                error: getErrorMessage(error),
                stack: error instanceof Error ? error.stack : undefined,
            }
        }
    })
}
