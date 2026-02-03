import { ipcMain } from 'electron'
import Store from 'electron-store'
import { captureScreenshot } from '../screenshot.js'
import { analyzeScreenshot } from '../image-analyzer.js'
import autoScreenshotService from '../auto-screenshot-service.js'
import { registerLCUIpcHandlers } from '../services/lcu/ipc-handlers.ts'
import { getMainWindow, getPopupWindow } from './window-manager.js'
import logger from './logger.js'

const store = new Store()

/**
 * 注册主进程 IPC 处理器
 */
export function registerIpcHandlers(isDev) {
    // electron-store IPC handlers
    ipcMain.handle('store-get', (event, key) => {
        return store.get(key)
    })

    ipcMain.handle('store-set', (event, key, value) => {
        store.set(key, value)
    })

    ipcMain.handle('store-delete', (event, key) => {
        store.delete(key)
    })

    ipcMain.handle('store-clear', () => {
        store.clear()
    })

    ipcMain.on(`broadcast`, (ev, data) => {
        ev.sender.send(data.channel, data)
    })

    // 弹出窗口相关处理
    ipcMain.on(`show-popup`, async (ev, data) => {
        const popupWindow = getPopupWindow()
        if (!popupWindow) {
            const { createPopupWindow } = await import('./window-manager.js')
            const devServerUrl = isDev ? 'http://localhost:5173' : ''
            await createPopupWindow(isDev, devServerUrl)
        }

        const newPopupWindow = getPopupWindow()
        newPopupWindow.show()
        newPopupWindow.webContents.send(`for-popup`, {
            championId: data.championId,
            position: data.position,
            augments: data.augments,
            dataSource: data.dataSource,
            timestamp: data.timestamp,
        })
    })

    ipcMain.on(`hide-popup`, async () => {
        const popupWindow = getPopupWindow()
        if (popupWindow) {
            const isVisible = popupWindow.isVisible()
            if (isVisible) {
                popupWindow.hide()
            }
        }
    })

    ipcMain.on(`hide-floating`, async () => {
        const { getFloatingWindow } = await import('./window-manager.js')
        const floatingWindow = getFloatingWindow()
        if (floatingWindow && !floatingWindow.isDestroyed()) {
            const isVisible = floatingWindow.isVisible()
            if (isVisible) {
                floatingWindow.hide()
                logger.info('隐藏浮动窗口')
            }
        }
    })

    // 测试浮动窗口 IPC 处理程序
    ipcMain.handle('test-show-floating', async (event, data) => {
        try {
            const { getFloatingWindow } = await import('./window-manager.js')
            const floatingWindow = getFloatingWindow()

            if (!floatingWindow || floatingWindow.isDestroyed()) {
                logger.error('浮动窗口不存在')
                return { success: false, error: '浮动窗口不存在' }
            }

            // 显示窗口
            if (!floatingWindow.isVisible()) {
                floatingWindow.show()
                logger.info('✨ 显示浮动窗口（测试）')
            }

            // 发送测试数据
            floatingWindow.webContents.send('augment-detected', data)
            logger.info('📢 已发送测试数据到浮动窗口')

            return { success: true }
        } catch (error) {
            logger.error('测试浮动窗口失败:', error)
            return { success: false, error: error.message }
        }
    })

    ipcMain.on(`toggle-main-window`, () => {
        (async () => {
            const { toggleMainWindow } = await import('./window-manager.js')
            toggleMainWindow()
        })()
    })

    ipcMain.on(`restart-app`, () => {
        (async () => {
            const { app } = await import('electron')
            app.relaunch()
            app.exit()
        })()
    })

    // 截图 IPC 处理程序
    ipcMain.handle('screenshot-capture', async () => {
        const result = await captureScreenshot()
        return result
    })

    // 图像分析 IPC 处理程序
    ipcMain.handle('analyze-screenshot', async (event, imagePath) => {
        const result = await analyzeScreenshot(imagePath)
        return result
    })

    // 胜率查询 IPC 处理程序
    ipcMain.handle('get-winrate', async (event, data) => {
        const { championId, augmentIds } = data

        try {
            const { getChampionAugmentStats, filterAugmentsByRarity, loadAugmentBase } = await import('../data-loader.js')

            // 获取英雄的所有海克斯胜率数据
            let augmentStats = getChampionAugmentStats(championId)

            // 如果指定了海克斯ID，则过滤
            if (augmentIds && augmentIds.length > 0) {
                const augmentIdSet = new Set(augmentIds.map(id => parseInt(id)))
                augmentStats = augmentStats.filter(a => augmentIdSet.has(a.augmentId))
            }

            return {
                success: true,
                championId,
                augments: augmentStats,
                timestamp: Date.now(),
                dataSource: 'local'
            }
        } catch (error) {
            logger.error('Winrate query error:', error)
            return {
                success: false,
                championId,
                augments: [],
                error: error.message
            }
        }
    })

    // 数据加载 IPC 处理程序
    ipcMain.handle('load-champion-data', async (event, championId) => {
        const { loadChampionStats, loadAugmentBase, loadChampionAugments, loadChampionBuild, loadItems, loadChampionName } = await import('../data-loader.js')
        try {
            const [stats, augments, augmentStats, build, items, championName] = await Promise.all([
                Promise.resolve(loadChampionStats(championId)),
                Promise.resolve(loadAugmentBase()),
                Promise.resolve(loadChampionAugments(championId)),
                Promise.resolve(loadChampionBuild(championId)),
                Promise.resolve(loadItems()),
                Promise.resolve(loadChampionName(championId))
            ])
            return {
                success: true,
                data: {
                    stats,
                    augments,
                    augmentStats,
                    build,
                    items,
                    championName
                }
            }
        } catch (error) {
            return {
                success: false,
                error: error.message
            }
        }
    })

    // 定时截图服务 IPC 处理程序
    ipcMain.handle('auto-screenshot-start', async (event, config = {}) => {
        const interval = config.interval || 5000
        const success = await autoScreenshotService.start(interval)
        if (success) {
            logger.info('Auto screenshot service started')
        }
        return {
            success,
            config: autoScreenshotService.getConfig(),
        }
    })

    ipcMain.handle('auto-screenshot-stop', async (event) => {
        const success = autoScreenshotService.stop()
        if (success) {
            logger.info('Auto screenshot service stopped')
        }
        return {
            success,
            config: autoScreenshotService.getConfig(),
        }
    })

    ipcMain.handle('auto-screenshot-set-config', async (event, config) => {
        autoScreenshotService.setConfig(config)
        return autoScreenshotService.getConfig()
    })

    ipcMain.handle('auto-screenshot-get-stats', async (event) => {
        return autoScreenshotService.getPerformanceStats()
    })

    ipcMain.handle('auto-screenshot-get-config', async (event) => {
        return autoScreenshotService.getConfig()
    })

    // 选择游戏目录 IPC 处理程序
    ipcMain.handle('select-lol-directory', async (event) => {
        const { dialog, BrowserWindow } = await import('electron')
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
            } else {
                return {
                    success: false,
                    path: null,
                    reason: '用户取消了选择',
                }
            }
        } catch (error) {
            logger.error('选择目录出错:', error)
            return {
                success: false,
                path: null,
                error: error.message,
            }
        }
    })

    // 前端错误上报 IPC 处理程序
    ipcMain.handle('log-renderer-error', async (event, errorData) => {
        const { message, stack, source, line, column, url, type, timestamp, userAgent } = errorData

        logger.error('渲染进程错误上报:', {
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

    // 注册 LCU 相关的 IPC 处理器（使用新的统一服务）
    registerLCUIpcHandlers()
}