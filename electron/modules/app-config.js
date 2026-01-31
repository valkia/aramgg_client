import { app, globalShortcut, BrowserWindow } from 'electron'
import https from 'https'
import { captureScreenshot, cleanupOldScreenshots } from '../screenshot.js'
import { analyzeScreenshot } from '../image-analyzer.js'
import { registerIpcHandlers } from './ipc-handlers.js'
import { createMainWindow, createPopupWindow, toggleMainWindow } from './window-manager.js'
import autoScreenshotService from '../auto-screenshot-service.js'
import GameFlowMonitor from '../../src/service/game-flow-monitor.js'
import { getLcuToken } from '../lcu-utils.js'
import axios from 'axios'

const __dirname = import.meta.dirname

// 全局游戏流程监控实例
let gameFlowMonitor = null
let lcuPollingTimer = null

/**
 * 简化的 LCU 服务 - 用于主进程
 * 只提供游戏流程监控所需的最小功能
 */
class MainProcessLCU {
    constructor(lolPath) {
        this.lolPath = lolPath
        this.active = false
        this.url = null
        this.auth = null
        this.pollingTimer = null
    }

    async getAuthToken() {
        try {
            // getLcuToken 返回 [token, port, urlWithAuth] 或 [null, null, null]
            const [token, port, urlWithAuth] = await getLcuToken(this.lolPath)

            if (!token || !port) {
                console.warn('⚠️ 无法获取 LCU Token，游戏客户端可能未运行')
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
            console.log('✅ LCU 连接成功 (端口: ' + port + ')')
            return { token, port, url: this.url }
        } catch (error) {
            console.error('❌ LCU 连接失败:', error.message)
            this.active = false
            return null
        }
    }

    async getGameflowPhase() {
        if (!this.active || !this.url) {
            return null
        }

        try {
            // 禁用 SSL 证书验证（LCU 使用自签名证书）
            const httpsAgent = new https.Agent({
                rejectUnauthorized: false,
            })

            const res = await axios.get(`${this.url}/lol-gameflow/v1/gameflow-phase`, {
                ...this.auth,
                httpsAgent,
                validateStatus: (status) => status < 500,
            })
            return res.data
        } catch (error) {
            console.warn('⚠️ 获取游戏阶段失败:', error.message)
            return null
        }
    }

    async pollGameflowPhase(callback, interval = 1000) {
        let lastPhase = null

        this.pollingTimer = setInterval(async () => {
            try {
                const phase = await this.getGameflowPhase()
                if (phase && phase !== lastPhase) {
                    lastPhase = phase
                    if (callback) {
                        callback(phase)
                    }
                }
            } catch (error) {
                console.warn('⚠️ 轮询游戏阶段出错:', error.message)
            }
        }, interval)

        return this.pollingTimer
    }

    stopPollGameflowPhase(timerId) {
        if (timerId) {
            clearInterval(timerId)
            this.pollingTimer = null
            console.log('⏹️ 停止游戏阶段轮询')
        }
    }
}

/**
 * 初始化应用
 */
export async function init() {
    console.log(`ChampR starting...`)

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
    console.log('Windows created:', {
        main: !!mainWindow,
        popup: !!popupWindow
    })

    // 初始化游戏流程监控
    initGameFlowMonitor()

    // 注册 F1 全局快捷键
    registerF1Shortcut(isDev)

    // 注册其他应用事件
    registerAppEvents()

    return { mainWindow, popupWindow, toggleMainWindow }
}

/**
 * 初始化游戏流程监控
 */
async function initGameFlowMonitor() {
    try {
        // 获取游戏目录（从 store 中读取）
        const Store = (await import('electron-store')).default
        const store = new Store()
        const lolPath = store.get('lolPath')

        console.log('\n============ 初始化游戏流程监控 ============')
        console.log('📁 读取配置的游戏目录:', lolPath)

        if (!lolPath) {
            console.warn('⚠️ 未设置游戏目录，游戏流程监控不可用')
            console.log('💡 请在应用设置中配置游戏目录')
            return
        }

        // 初始化 LCU 服务（主进程版本）
        console.log('\n🔧 初始化 LCU 服务...')
        const lcuService = new MainProcessLCU(lolPath)
        console.log('⏳ 获取 LCU Token...')
        const authResult = await lcuService.getAuthToken()

        if (!lcuService.active) {
            console.error('\n❌ LCU 连接失败！')
            console.warn('⚠️ 可能的原因:')
            console.warn('   1. 游戏客户端未运行 - 请启动 League of Legends 客户端')
            console.warn('   2. LeagueClientUx.log 文件不存在 - 请重启游戏客户端')
            console.warn('   3. 游戏目录配置错误 - 请在应用设置中检查')
            console.warn('\n💡 调试步骤:')
            console.warn('   1. 运行: node electron/lcu-debug.js "你的游戏目录"')
            console.warn('   2. 检查输出中是否找到了 LeagueClientUx.log')
            console.warn('   3. 检查日志中是否包含 LCU URL')
            return
        }

        // 初始化游戏流程监控
        gameFlowMonitor = new GameFlowMonitor(lcuService, {
            pollInterval: 1000, // 每1秒检查一次游戏阶段
        })

        // 监听游戏阶段变化事件
        gameFlowMonitor.on('phase-change', (phase, prevPhase) => {
            console.log(`📍 游戏阶段变化: ${prevPhase} → ${phase}`)
            notifyAllWindows('game-phase-changed', { phase, prevPhase })
        })

        // 监听游戏开始事件
        gameFlowMonitor.on('game-started', () => {
            console.log('🎮 游戏开始加载')
            notifyAllWindows('game-started', {})
        })

        // 监听游戏进行中事件（海克斯选择可能即将开始）
        gameFlowMonitor.on('game-in-progress', () => {
            console.log('⚔️ 游戏进行中 - 启动自动截图来检测海克斯选择')
            notifyAllWindows('game-in-progress', {})

            // 启动高频率自动截图（每200ms一次，用于检测海克斯选择）
            if (!autoScreenshotService.isRunning) {
                autoScreenshotService.setConfig({
                    interval: 200, // 200ms 截图一次
                    maxScreenshots: 100, // 最多保留100张截图
                })
                autoScreenshotService.start(200).then(() => {
                    console.log('📸 自动截图服务启动成功')
                })
            }
        })

        // 监听海克斯就绪事件
        gameFlowMonitor.on('augment-ready', () => {
            console.log('✨ 海克斯选择界面准备就绪，开始分析截图')
            notifyAllWindows('augment-detection-started', {})
        })

        // 监听游戏结束事件
        gameFlowMonitor.on('game-ended', () => {
            console.log('📊 游戏已结束')
            notifyAllWindows('game-ended', {})

            // 停止自动截图
            if (autoScreenshotService.isRunning) {
                autoScreenshotService.stop()
                console.log('📸 自动截图服务已停止')
            }
        })

        // 监听游戏结束确认事件
        gameFlowMonitor.on('end-of-game', () => {
            console.log('🏁 游戏完全结束')
            notifyAllWindows('end-of-game', {})
        })

        // 启动游戏流程监控
        await gameFlowMonitor.start()
        console.log('✅ 游戏流程监控已启动')
    } catch (error) {
        console.error('❌ 初始化游戏流程监控失败:', error)
    }
}

/**
 * 注册 F1 快捷键
 */
function registerF1Shortcut(isDev) {
    const f1Ret = globalShortcut.register('F1', async () => {
        console.log('F1 pressed, capturing screenshot...')
        try {
            const result = await captureScreenshot()
            console.log('Screenshot result:', result)

            if (result.success) {
                console.log(`Screenshot saved: ${result.filepath}`)

                // 异步执行分析和查询（不阻塞主线程）
                setImmediate(async () => {
                    try {
                        // 分析截图（海克斯检测 + OCR）
                        const analysisResult = await analyzeScreenshot(result.filepath)
                        console.log('Analysis result:', analysisResult)

                        if (analysisResult.success && analysisResult.analysis.augments.length > 0) {
                            // 构建胜率查询数据（从识别的海克斯）
                            const augments = analysisResult.analysis.augments.slice(0, 3)

                            const winrateData = {
                                success: true,
                                gamePhase: 'augment-select',
                                augments: augments.map(aug => ({
                                    id: aug.id,
                                    name: aug.name,
                                    rarity: aug.rarity,
                                    confidence: aug.confidence,
                                })),
                                analysisConfidence: analysisResult.analysis.confidence,
                                timestamp: Date.now(),
                                dataSource: 'local-analysis',
                            }

                            console.log('✨ 海克斯识别成功:', winrateData)

                            // 通知所有渲染进程
                            notifyAllWindows('augment-detected', winrateData)
                        } else {
                            console.log('ℹ️ 未识别到海克斯，使用兼容数据')
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
                        console.error('Error analyzing screenshot:', error)
                    }
                })

                // 通知所有渲染进程新增截图
                notifyAllWindows('screenshot-taken', result)
            } else {
                console.error('Screenshot failed:', result.error)
            }
        } catch (error) {
            console.error('F1 shortcut handler error:', error)
        }
    })

    if (!f1Ret) {
        console.log('Failed to register F1 shortcut')
    } else {
        console.log('F1 shortcut registered successfully')
    }
}

/**
 * 注册应用事件
 */
function registerAppEvents() {
    // 应用即将退出时的清理
    app.on('will-quit', async (e) => {
        console.log('App will quit, cleaning up...')

        // 停止游戏流程监控
        if (gameFlowMonitor && gameFlowMonitor.isRunning) {
            gameFlowMonitor.stop()
            console.log('游戏流程监控已停止')
        }

        // 停止自动截图
        if (autoScreenshotService && autoScreenshotService.isRunning) {
            autoScreenshotService.stop()
            console.log('自动截图服务已停止')
        }
    })

    // 应用退出时的清理
    app.on('quit', () => {
        console.log('App quit')
        // 注销所有全局快捷键
        globalShortcut.unregisterAll()
    })

    // 窗口全部关闭时退出应用
    app.on('window-all-closed', function () {
        console.log('All windows closed, quitting app...')
        app.quit()
    })

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) {
            (async () => {
                const { createMainWindow } = await import('./window-manager.js')
                createMainWindow(process.env.NODE_ENV === 'development', 'http://localhost:5173')
            })()
        }
    })
}

/**
 * 通知所有窗口
 */
async function notifyAllWindows(channel, data) {
    const { BrowserWindow } = await import('electron')

    // 通知所有打开的窗口
    BrowserWindow.getAllWindows().forEach(window => {
        if (!window.isDestroyed()) {
            window.webContents.send(channel, data)
        }
    })
}