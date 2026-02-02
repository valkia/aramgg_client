import { ipcMain } from 'electron'
import Store from 'electron-store'
import https from 'https'
import axios from 'axios'
import { captureScreenshot, cleanupOldScreenshots } from '../screenshot.js'
import { analyzeScreenshot } from '../image-analyzer.js'
import autoScreenshotService from '../auto-screenshot-service.js'
import { getLcuToken } from '../lcu-utils.js'
import { getMainWindow, getPopupWindow } from './window-manager.js'
import logger from './logger.js'

const store = new Store()

/**
 * 简化的 LCU 服务 - 用于主进程 IPC 处理
 */
class IpcLCUService {
    constructor(lolPath) {
        this.lolPath = lolPath
        this.active = false
        this.url = null
        this.auth = null
        this.lastTokenFetchTime = 0
        this.lastFailTime = 0
        this.tokenCacheDuration = 60000 // Token 缓存时间 60 秒
        this.failCooldown = 10000 // 连接失败后 10 秒内不重试
    }

    /**
     * 获取认证 token（带缓存机制）
     * @param {boolean} forceRefresh - 是否强制刷新 token
     */
    async getAuthToken(forceRefresh = false) {
        const now = Date.now()

        // 如果在失败冷却期内，直接返回 null
        if (!forceRefresh && this.lastFailTime && (now - this.lastFailTime < this.failCooldown)) {
            return null
        }

        const needRefresh = forceRefresh || !this.active || (now - this.lastTokenFetchTime > this.tokenCacheDuration)

        // 如果已有有效的连接且不需要刷新，直接返回
        if (this.active && !needRefresh) {
            return { token: this.auth.auth.password, url: this.url }
        }

        try {
            const [token, port, urlWithAuth] = await getLcuToken(this.lolPath)

            if (!token || !port) {
                this.active = false
                return null
            }

            this.url = `https://127.0.0.1:${port}`
            this.auth = {
                auth: {
                    username: 'riot',
                    password: token,
                },
            }
            this.active = true
            this.lastTokenFetchTime = now
            this.lastFailTime = 0 // 清除失败时间
            logger.info(`已从日志文件读取 LCU 凭证 (端口: ${port})`)
            return { token, port, url: this.url }
        } catch (error) {
            logger.error('读取 LCU 凭证失败:', error.message)
            this.active = false
            return null
        }
    }

    /**
     * 获取当前选人会话
     */
    async getCurrentSession() {
        if (!this.active || !this.url) {
            return null
        }

        try {
            const httpsAgent = new https.Agent({
                rejectUnauthorized: false,
            })

            const res = await axios.get(`${this.url}/lol-champ-select/v1/session`, {
                ...this.auth,
                httpsAgent,
                validateStatus: (status) => status < 500,
            })
            return res.data
        } catch (error) {
            // 连接被拒绝说明客户端可能未运行或端口已失效
            // 标记为非活跃状态，并设置失败时间以触发冷却期
            if (error.code === 'ECONNREFUSED') {
                this.active = false
                this.lastFailTime = Date.now()
            }
            return null
        }
    }
}

// 全局 LCU 服务实例（单例模式）
let globalLcuService = null

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
        if (result.success) {
            // 自动清理旧截图
            await cleanupOldScreenshots(10)
        }
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
        const { loadChampionStats, loadAugmentBase, loadChampionAugments, loadChampionBuild, loadItems } = await import('../data-loader.js')
        try {
            const [stats, augments, augmentStats, build, items] = await Promise.all([
                Promise.resolve(loadChampionStats(championId)),
                Promise.resolve(loadAugmentBase()),
                Promise.resolve(loadChampionAugments(championId)),
                Promise.resolve(loadChampionBuild(championId)),
                Promise.resolve(loadItems())
            ])
            return {
                success: true,
                data: {
                    stats,
                    augments,
                    augmentStats,
                    build,
                    items
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

    // 获取当前选择的英雄ID IPC 处理程序
    ipcMain.handle('get-champion-id', async (event) => {
        try {
            // 从 store 中获取游戏路径
            let lolPath = store.get('lolPath')

            if (!lolPath) {
                logger.warn('未设置游戏路径')
                return {
                    success: false,
                    championId: null,
                    error: '游戏路径未配置'
                }
            }

            // 获取或创建全局 LCU 服务实例
            if (!globalLcuService || globalLcuService.lolPath !== lolPath) {
                globalLcuService = new IpcLCUService(lolPath)
            }

            // 首次调用或需要刷新时获取 token，否则直接使用缓存的连接
            if (!globalLcuService.active) {
                const authResult = await globalLcuService.getAuthToken()
                if (!globalLcuService.active) {
                    logger.warn('LCU 未激活')
                    return {
                        success: false,
                        championId: null,
                        error: 'LCU 未激活'
                    }
                }
            }

            // 直接轮询选人会话（内部会自动处理连接失败的重试）
            const sessionData = await globalLcuService.getCurrentSession()
            if (!sessionData || sessionData.errorCode) {
                // 这是正常情况（未在选人阶段），不需要记录 info 日志
                return {
                    success: false,
                    championId: null,
                    error: '无有效的选人会话'
                }
            }

            // 获取当前玩家的 cellId
            const localPlayerCellId = sessionData.localPlayerCellId

            // 从 myTeam 中查找当前玩家选择的英雄
            if (sessionData.myTeam && Array.isArray(sessionData.myTeam)) {
                for (const member of sessionData.myTeam) {
                    // 必须匹配当前玩家的 cellId
                    if (member.cellId === localPlayerCellId &&
                        member.championId && member.championId !== 0) {
                        logger.info('从 myTeam 获得英雄ID:', member.championId, '(cellId:', localPlayerCellId, ')')
                        return {
                            success: true,
                            championId: member.championId
                        }
                    }
                }
            }

            // 如果 myTeam 中没找到，尝试从 actions 中查找
            if (sessionData.actions && Array.isArray(sessionData.actions) && sessionData.actions.length > 0) {
                for (const actionGroup of sessionData.actions) {
                    if (Array.isArray(actionGroup)) {
                        for (const action of actionGroup) {
                            if (action.actorCellId === localPlayerCellId &&
                                action.championId && action.championId !== 0) {
                                logger.info('从 actions 获得英雄ID:', action.championId, '(cellId:', localPlayerCellId, ')')
                                return {
                                    success: true,
                                    championId: action.championId
                                }
                            }
                        }
                    }
                }
            }

            // 没有找到任何英雄选择
            return {
                success: false,
                championId: null,
                error: '未检测到英雄选择'
            }
        } catch (error) {
            logger.error('获取英雄ID出错:', error.message)
            return {
                success: false,
                championId: null,
                error: error.message
            }
        }
    })
}