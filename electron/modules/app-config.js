import { app, globalShortcut, BrowserWindow } from 'electron'
import https from 'https'
import { captureScreenshot } from '../screenshot.js'
import { analyzeScreenshot } from '../image-analyzer.js'
import { registerIpcHandlers } from './ipc-handlers.js'
import { createMainWindow, createPopupWindow, toggleMainWindow } from './window-manager.js'
import autoScreenshotService from '../auto-screenshot-service.js'
import { getLcuToken } from '../lcu-utils.js'
import axios from 'axios'

const __dirname = import.meta.dirname

// 全局游戏流程轮询定时器
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
        // 如果连接不活跃，尝试重新连接
        if (!this.active || !this.url) {
            await this.getAuthToken()
        }

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
                timeout: 5000,  // 添加超时
            })

            if (res.status === 404 || res.status === 401) {
                // 重新获取 token
                console.log('⚠️ LCU 认证失效，尝试重新连接...')
                this.active = false
                await this.getAuthToken()
                return null
            }

            return res.data
        } catch (error) {
            // 连接失败时尝试重新认证
            if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                console.log('⚠️ LCU 连接丢失，尝试重新连接...')
                this.active = false
                await this.getAuthToken()
            } else {
                console.warn('⚠️ 获取游戏阶段失败:', error.message)
            }
            return null
        }
    }

}

/**
 * 初始化应用
 */
export async function init() {
    console.log(`\n${'='.repeat(50)}`)
    console.log(`ChampR 应用启动中...`)
    console.log(`${'='.repeat(50)}\n`)

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
    console.log('✅ 窗口已创建:', {
        main: !!mainWindow,
        popup: !!popupWindow
    })

    // 初始化游戏流程监控（延迟初始化，避免阻塞应用启动）
    console.log('\n⏳ 将在后台初始化游戏流程监控...')
    setTimeout(() => {
        initGameFlowMonitor()
    }, 2000)

    // 注册 F1 全局快捷键
    registerF1Shortcut(isDev)

    // 注册其他应用事件
    registerAppEvents()

    return { mainWindow, popupWindow, toggleMainWindow }
}

/**
 * 自动检测游戏目录
 */
async function autoDetectLolPath() {
    const fs = await import('fs')
    const path = await import('path')

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
            console.log(`✅ 自动检测到游戏目录: ${checkPath}`)
            return checkPath
        }
    }

    return null
}

/**
 * 简化的游戏流程监控 - 直接在主进程中实现
 * 避免与其他服务的兼容性问题
 */
async function initGameFlowMonitor() {
    try {
        // 获取游戏目录（从 store 中读取）
        const Store = (await import('electron-store')).default
        const store = new Store()
        let lolPath = store.get('lolPath')

        console.log('\n============ 初始化游戏流程监控 ============')
        console.log('📁 读取配置的游戏目录:', lolPath)

        // 如果没有配置，尝试自动检测
        if (!lolPath) {
            console.log('⏳ 未设置游戏目录，正在尝试自动检测...')
            lolPath = await autoDetectLolPath()

            if (lolPath) {
                console.log('✅ 自动检测成功，已保存配置')
                store.set('lolPath', lolPath)
            } else {
                console.warn('⚠️ 无法自动检测游戏目录')
                console.log('💡 请在应用设置中配置游戏目录')
                return
            }
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

        console.log('✅ LCU Token 获取成功')

        // 启动游戏流程轮询
        console.log('\n🔄 启动游戏阶段轮询...')
        let lastPhase = null
        let tokenRefreshCounter = 0

        lcuPollingTimer = setInterval(async () => {
            try {
                // 每60次轮询（即60秒）刷新一次 LCU token（确保连接保持活跃）
                tokenRefreshCounter++
                if (tokenRefreshCounter >= 60) {
                    console.log('🔄 定期刷新 LCU token...')
                    await lcuService.getAuthToken()
                    tokenRefreshCounter = 0
                }

                const phase = await lcuService.getGameflowPhase()
                if (phase && phase !== lastPhase) {
                    lastPhase = phase
                    console.log(`📍 游戏阶段变化: → ${phase}`)
                    notifyAllWindows('game-phase-changed', { phase, prevPhase: null })

                    // 特定阶段处理
                    switch (phase) {
                        case 'GameStart':
                            console.log('🎮 游戏开始加载')
                            notifyAllWindows('game-started', {})
                            break
                        case 'InProgress':
                            console.log('⚔️ 游戏进行中 - 启动自动截图来检测海克斯选择')
                            notifyAllWindows('game-in-progress', {})
                            // 启动高频率自动截图
                            if (!autoScreenshotService.isRunning) {
                                autoScreenshotService.setConfig({
                                    interval: 200,
                                    maxScreenshots: 100,
                                })
                                autoScreenshotService.start(200).then(() => {
                                    console.log('📸 自动截图服务启动成功')
                                })
                            }
                            break
                        case 'WaitingForStats':
                            console.log('📊 游戏已结束')
                            notifyAllWindows('game-ended', {})
                            if (autoScreenshotService.isRunning) {
                                autoScreenshotService.stop()
                                console.log('📸 自动截图服务已停止')
                            }
                            break
                        case 'EndOfGame':
                            console.log('🏁 游戏完全结束')
                            notifyAllWindows('end-of-game', {})
                            break
                    }
                }
            } catch (error) {
                console.warn('⚠️ 游戏流程轮询出错:', error.message)
            }
        }, 1000)

        console.log('✅ 游戏流程监控已启动 (每1秒检查一次，每60秒刷新一次token)')
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

        // 停止游戏流程轮询
        if (lcuPollingTimer) {
            clearInterval(lcuPollingTimer)
            console.log('游戏流程轮询已停止')
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