import { app, BrowserWindow, ipcMain, Menu, screen, globalShortcut } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import Store from 'electron-store'
import { captureScreenshot, cleanupOldScreenshots } from './screenshot.js'
import { analyzeScreenshot, extractChampions, extractPosition } from './image-analyzer.js'
import autoScreenshotService from './auto-screenshot-service.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const store = new Store()

let isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let devServerUrl = 'http://localhost:5173'
console.log('Environment check:', {
    NODE_ENV: process.env.NODE_ENV,
    isPackaged: app.isPackaged,
    isDev: isDev,
    VITE_DEV_SERVER_URL: process.env.VITE_DEV_SERVER_URL
})
if (process.env.VITE_DEV_SERVER_URL) {
    devServerUrl = process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')
}

// 保证函数只执行一次
let isRuned = false
// 截图时会出现截图界面，如下就是保存截图窗口的数组
const $windows = []
// 判断是否为快捷键退出，其他的退出方式都不被允许
let isClose = false

// 解决提示ERR_CERT_AUTHORITY_INVALID的问题
app.commandLine.appendSwitch('ignore-certificate-errors', 'true')
app.commandLine.appendSwitch('ignore-connections-limit', 'op.gg')

let mainWindow = null
let popupWindow = null

const webPreferences = {
    nodeIntegration: true,
    nodeIntegrationInWorker: true,
    webSecurity: false,
    contextIsolation: false,
    sandbox: false,
    preload: isDev
        ? path.join(__dirname, '..', 'dist-electron', 'preload.js')
        : path.join(__dirname, 'preload.js'),
}

const createMainWindow = async () => {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences,
        title: 'lol符文助手',
    })

    mainWindow.on('close', () => {
        console.log('Main window closing...')
        // 关闭主窗口时，同时关闭 popup 窗口
        if (popupWindow && !popupWindow.isDestroyed()) {
            console.log('Closing popup window...')
            popupWindow.close()
        }
    })

    mainWindow.on('closed', () => {
        console.log('Main window closed')
        mainWindow = null
    })

    // and load the index.html of the app.
    if (isDev) {
        mainWindow.loadURL(`${devServerUrl}/#/display`)
        mainWindow.webContents.openDevTools()
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
    }
}

//符文弹出层
const createPopupWindow = async () => {
    const [mX, mY] = mainWindow.getPosition()
    const curDisplay = screen.getDisplayNearestPoint({
        x: mX,
        y: mY,
    })

    // TODO: remember window size & position
    const popup = new BrowserWindow({
        show: false,
        frame: true,
        skipTaskbar: true,
        resizable: isDev || false,
        fullscreenable: false,
        alwaysOnTop: !isDev,
        width: isDev ? 900 : 400,
        height: 600,
        x: isDev ? curDisplay.bounds.width / 2 : curDisplay.bounds.width - 500 - 140,
        y: curDisplay.bounds.height / 2,
        webPreferences,
    })

    popup.on('closed', () => {
        console.log('Popup window closed')
        popupWindow = undefined
    })

    await popup.loadURL(
        isDev
            ? `${devServerUrl}/#/showDetail`
            : `file://${path.join(__dirname, '../dist/index.html')}#/showDetail`,
    )

    return popup
}

function registerMainListeners() {
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

    ipcMain.on(`show-popup`, async (ev, data) => {
        if (!popupWindow) {
            popupWindow = await createPopupWindow()
        }

        popupWindow.show()
        popupWindow.webContents.send(`for-popup`, {
            championId: data.championId,
            position: data.position,
        })
    })

    ipcMain.on(`hide-popup`, async () => {
        if (popupWindow) {
            const isVisible = popupWindow.isVisible()
            if (isVisible) {
                popupWindow.hide()
            }
        }
    })

    ipcMain.on(`toggle-main-window`, () => {
        toggleMainWindow()
    })

    ipcMain.on(`restart-app`, () => {
        app.relaunch()
        app.exit()
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
        // TODO: 实现胜率查询逻辑
        // data = { champions: [], position: null }
        const result = {
            success: true,
            champion: {
                id: data.champions?.[0],
                name: 'Champion Name',
                position: data.position,
                winrate: 52.5,
            },
            stats: {
                winrate: '52.5%',
                pickRate: '15.2%',
                banRate: '8.3%',
                playCount: '10000+',
            },
            runes: [],
            items: [],
            dataSource: 'OP.GG',
            updateTime: Date.now(),
        }
        return result
    })

    // 数据加载 IPC 处理程序
    ipcMain.handle('load-champion-data', async (event, championId) => {
        const { loadChampionStats, loadAugmentBase, loadChampionAugments, loadChampionBuild, loadItems } = await import('./data-loader.js')
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
            console.log('Auto screenshot service started')
        }
        return {
            success,
            config: autoScreenshotService.getConfig(),
        }
    })

    ipcMain.handle('auto-screenshot-stop', async (event) => {
        const success = autoScreenshotService.stop()
        if (success) {
            console.log('Auto screenshot service stopped')
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

    // 监听定时截图事件，通知所有渲染进程
    const notifyAutoScreenshot = (screenshotData) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('auto-screenshot-taken', screenshotData)
        }
        if (popupWindow && !popupWindow.isDestroyed()) {
            popupWindow.webContents.send('auto-screenshot-taken', screenshotData)
        }
    }

    // 每次截图完成时，通知渲染进程
    // 注意：这需要修改 auto-screenshot-service.js 来支持事件发射
    // 或者定期轮询获取最新的截图信息
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.

app.whenReady().then(init)

// Quit when all windows are closed.
app.on('window-all-closed', function () {
    console.log('All windows closed, quitting app...')
    // 强制退出应用（不管是什么平台）
    app.quit()
})

// 确保应用退出时彻底清理
app.on('will-quit', (e) => {
    console.log('App will quit, cleaning up...')
})

// 当应用即将退出时，强制结束进程（作为最后的保障）
app.on('quit', () => {
    console.log('App quit')
    // 注销所有全局快捷键
    globalShortcut.unregisterAll()
    // 在开发模式下，强制退出整个进程树
    if (isDev) {
        process.exit(0)
    }
})

app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
})

// Toggle main window visibility
const toggleMainWindow = () => {
    if (mainWindow) {
        if (mainWindow.isVisible()) {
            mainWindow.hide()
        } else {
            mainWindow.show()
        }
    }
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

async function init() {
    console.log(`ChampR starting...`)

    Menu.setApplicationMenu(null)
    registerMainListeners()

    await createMainWindow()
    popupWindow = await createPopupWindow()
    console.log('Popup window created:', popupWindow ? 'success' : 'failed')

    // 注册 F1 全局快捷键
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
                        // 分析截图
                        const analysisResult = await analyzeScreenshot(result.filepath)
                        console.log('Analysis result:', analysisResult)

                        if (analysisResult.success) {
                            // 获取胜率信息
                            const winrateData = await (async () => {
                                // TODO: 根据分析结果查询胜率
                                return {
                                    success: true,
                                    champion: {
                                        name: 'Champion',
                                        position: analysisResult.analysis.position,
                                        winrate: 52.5,
                                    },
                                    stats: {
                                        winrate: '52.5%',
                                        pickRate: '15.2%',
                                        banRate: '8.3%',
                                    },
                                    runes: [],
                                    items: [],
                                    dataSource: 'OP.GG',
                                }
                            })()

                            // 通知所有渲染进程
                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.webContents.send('winrate-updated', winrateData)
                            }
                            if (popupWindow && !popupWindow.isDestroyed()) {
                                popupWindow.webContents.send('winrate-updated', winrateData)
                            }
                        }
                    } catch (error) {
                        console.error('Error analyzing screenshot:', error)
                    }
                })

                // 通知所有渲染进程新增截图
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('screenshot-taken', result)
                }
                if (popupWindow && !popupWindow.isDestroyed()) {
                    popupWindow.webContents.send('screenshot-taken', result)
                }
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