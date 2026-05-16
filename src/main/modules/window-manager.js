import logger from './logger.js';
import { BrowserWindow, screen, app } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow = null
let popupWindow = null
let floatingWindow = null

/**
 * 获取正确的 preload 脚本路径
 */
function getPreloadPath(isDev) {
    // 使用 app.getAppPath() 获取应用根目录
    const appPath = app.getAppPath()

    if (isDev) {
        // 开发模式：从应用根目录查找 dist-electron/preload.cjs
        return path.join(appPath, 'dist-electron', 'preload.cjs')
    } else {
        // 生产模式：preload.cjs 在 dist-electron 目录中
        return path.join(appPath, 'dist-electron', 'preload.cjs')
    }
}

const getWebPreferences = (isDev) => ({
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    contextIsolation: true,
    sandbox: true,
    preload: getPreloadPath(isDev),
})

/**
 * 创建主窗口
 */
export const createMainWindow = async (isDev, devServerUrl) => {
    const webPreferences = getWebPreferences(isDev)

    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences,
        title: 'lol符文助手',
    })

    mainWindow.on('close', () => {
        logger.info('Main window closing...')
        // 关闭主窗口时，同时关闭 popup 窗口和浮动窗口
        if (popupWindow && !popupWindow.isDestroyed()) {
            logger.info('Closing popup window...')
            popupWindow.close()
        }
        if (floatingWindow && !floatingWindow.isDestroyed()) {
            logger.info('Closing floating window...')
            floatingWindow.close()
        }
    })

    mainWindow.on('closed', () => {
        logger.info('Main window closed')
        mainWindow = null
    })

    // 加载应用
    if (isDev) {
        mainWindow.loadURL(`${devServerUrl}/#/display`)
        mainWindow.webContents.openDevTools()
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
    }

    return mainWindow
}

/**
 * 创建弹出窗口
 */
export const createPopupWindow = async (isDev, devServerUrl) => {
    const [mX, mY] = mainWindow.getPosition()
    const curDisplay = screen.getDisplayNearestPoint({
        x: mX,
        y: mY,
    })

    const webPreferences = getWebPreferences(isDev)

    popupWindow = new BrowserWindow({
        show: false,
        frame: true,
        skipTaskbar: true,
        resizable: isDev || false,
        fullscreenable: false,
        alwaysOnTop: true, // 始终置顶，包括开发模式
        width: 400,
        height: 600,
        x: curDisplay.bounds.width - 400 - 140,
        y: curDisplay.bounds.height / 2,
        webPreferences,
    })

    popupWindow.on('closed', () => {
        logger.info('Popup window closed')
        popupWindow = undefined
    })

    await popupWindow.loadURL(
        isDev
            ? `${devServerUrl}/#/augment-overlay`
            : `file://${path.join(__dirname, '../dist/index.html')}#/augment-overlay`,
    )

    return popupWindow
}

/**
 * 创建透明浮动窗口（用于游戏内显示海克斯推荐）
 * 【重要】窗口位置在屏幕顶部(2%)，确保不与OCR识别区域(从25%开始)重叠
 */
export const createFloatingWindow = async (isDev, devServerUrl) => {
    // 获取主显示器信息
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

    const webPreferences = getWebPreferences(isDev)

    // 窗口宽度和位置
    const windowWidth = 850
    const windowHeight = 200
    const windowX = Math.round((screenWidth - windowWidth) / 2)
    const windowY = Math.round(screenHeight * 0.02) // 屏幕顶部 2% 位置，避免与OCR区域重叠

    floatingWindow = new BrowserWindow({
        show: false,
        frame: false,           // 无边框
        transparent: true,      // 透明背景
        skipTaskbar: true,      // 不在任务栏显示
        resizable: false,
        fullscreenable: false,
        alwaysOnTop: true,      // 始终置顶
        focusable: false,       // 不获取焦点，避免干扰游戏
        width: windowWidth,
        height: windowHeight,
        x: windowX,
        y: windowY,
        webPreferences,
    })

    // 设置窗口忽略鼠标事件（透传点击）
    // floatingWindow.setIgnoreMouseEvents(true, { forward: true })

    floatingWindow.on('closed', () => {
        logger.info('Floating window closed')
        floatingWindow = undefined
    })

    await floatingWindow.loadURL(
        isDev
            ? `${devServerUrl}/#/floating-overlay`
            : `file://${path.join(__dirname, '../dist/index.html')}#/floating-overlay`,
    )

    // 开发模式下打开开发者工具
    if (isDev) {
        floatingWindow.webContents.openDevTools({ mode: 'detach' })
    }

    logger.info('透明浮动窗口已创建', { x: windowX, y: windowY, width: windowWidth, height: windowHeight })

    return floatingWindow
}

/**
 * 获取主窗口实例
 */
export const getMainWindow = () => mainWindow

/**
 * 获取弹出窗口实例
 */
export const getPopupWindow = () => popupWindow

/**
 * 获取浮动窗口实例
 */
export const getFloatingWindow = () => floatingWindow

/**
 * 切换主窗口可见性
 */
export const toggleMainWindow = () => {
    if (mainWindow) {
        if (mainWindow.isVisible()) {
            mainWindow.hide()
        } else {
            mainWindow.show()
        }
    }
}
