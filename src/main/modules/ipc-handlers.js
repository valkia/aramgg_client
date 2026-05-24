import { app, dialog, ipcMain } from 'electron'
import Store from 'electron-store'
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
import { getAppDataDir, getConfigDir } from './app-paths.js'

const store = new Store({ cwd: getConfigDir() })

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

    ipcMain.handle('store-clear', () => {
        store.clear()
    })

    ipcMain.on('broadcast', (ev, data) => {
        ev.sender.send(data.channel, data)
    })

    ipcMain.on('show-popup', async (_ev, data) => {
        if (!getPopupWindow()) {
            const devServerUrl = isDev ? 'http://localhost:5173' : ''
            await createPopupWindow(isDev, devServerUrl)
        }

        const popupWindow = getPopupWindow()
        if (!popupWindow) {
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
            app.quit()
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

    ipcMain.handle('get-winrate', async (_event, data) => {
        const { championId, augmentIds } = data

        try {
            const { getChampionAugmentStats } = await import('../data-loader.js')
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

            return {
                success: true,
                championId,
                augments: augmentStats,
                timestamp: Date.now(),
                dataSource: 'remote',
            }
        } catch (error) {
            logger.error('Winrate query error:', error)
            return {
                success: false,
                championId,
                augments: [],
                error: error.message,
            }
        }
    })

    ipcMain.handle('load-champion-data', async (_event, championId) => {
        const {
            loadChampionStats,
            loadAugmentBase,
            loadChampionAugments,
            loadChampionBuild,
            loadItems,
            loadChampionName,
        } = await import('../data-loader.js')

        try {
            const [stats, augments, augmentStats, build, items, championName] = await Promise.all([
                loadChampionStats(championId),
                loadAugmentBase(),
                loadChampionAugments(championId),
                loadChampionBuild(championId),
                loadItems(),
                loadChampionName(championId),
            ])

            return {
                success: true,
                data: {
                    stats,
                    augments,
                    augmentStats,
                    build,
                    items,
                    championName,
                },
            }
        } catch (error) {
            logger.error('Champion data load error:', error)
            return {
                success: false,
                error: error.message,
            }
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
        const { message, stack, source, line, column, url, type, timestamp, userAgent } = errorData

        logger.error('Renderer error reported:', {
            type: type || 'error',
            message: message || 'Unknown error',
            stack: stack || 'No stack trace',
            source: source || 'unknown',
            location: `${line}:${column}`,
            url: url || 'unknown',
            timestamp: timestamp || Date.now(),
            userAgent: userAgent || 'unknown',
        })

        return { success: true }
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
            } = await import('../data-loader.js')
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
