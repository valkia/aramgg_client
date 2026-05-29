import logger from './logger.js';
import { BrowserWindow, screen, app } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow = null
let popupWindow = null
let floatingWindow = null

const MAIN_WINDOW_SIZE = { width: 380, height: 620 }
const POPUP_WINDOW_SIZE = { width: 360, height: 640 }
const FLOATING_WINDOW_SIZE = { width: 760, height: 170 }

function getMainWindowBounds() {
    const display = screen.getPrimaryDisplay()
    const area = display.workArea || display.bounds
    const width = Math.min(MAIN_WINDOW_SIZE.width, area.width)
    const height = Math.min(MAIN_WINDOW_SIZE.height, area.height)
    const rightAlignedX = area.x + area.width - width - 20

    return {
        width,
        height,
        x: Math.max(area.x + 20, rightAlignedX),
        y: area.y + Math.max(20, Math.round((area.height - height) / 2)),
    }
}

function getDisplayForMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        const [x, y] = mainWindow.getPosition()
        return screen.getDisplayNearestPoint({ x, y })
    }

    return screen.getPrimaryDisplay()
}

function getPopupBounds() {
    const display = getDisplayForMainWindow()
    const area = display.workArea || display.bounds
    const width = Math.min(POPUP_WINDOW_SIZE.width, area.width)
    const height = Math.min(POPUP_WINDOW_SIZE.height, area.height)
    const rightAlignedX = area.x + area.width - width - 140

    return {
        width,
        height,
        x: Math.max(area.x + 20, rightAlignedX),
        y: area.y + Math.max(20, Math.round((area.height - height) / 2)),
    }
}

function getFloatingBounds() {
    const display = screen.getPrimaryDisplay()
    const area = display.workArea || display.bounds
    const width = Math.min(FLOATING_WINDOW_SIZE.width, area.width)
    const height = Math.min(FLOATING_WINDOW_SIZE.height, area.height)

    return {
        width,
        height,
        x: area.x + Math.round((area.width - width) / 2),
        y: area.y + Math.round(area.height * 0.02),
    }
}

export function applyPopupWindowLayout() {
    if (popupWindow && !popupWindow.isDestroyed()) {
        popupWindow.setBounds(getPopupBounds())
    }
}

export function applyFloatingWindowLayout() {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
        floatingWindow.setBounds(getFloatingBounds())
    }
}

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

function getRendererIndexPath() {
    return path.join(__dirname, '../dist/index.html')
}

const getWebPreferences = (isDev, overrides = {}) => ({
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    contextIsolation: true,
    sandbox: true,
    preload: getPreloadPath(isDev),
    ...overrides,
})

const getOverlayWebPreferences = (isDev) => getWebPreferences(isDev, {
    backgroundThrottling: false,
})

/**
 * 创建主窗口
 */
export const createMainWindow = async (isDev, devServerUrl) => {
    const webPreferences = getWebPreferences(isDev)
    const bounds = getMainWindowBounds()

    mainWindow = new BrowserWindow({
        ...bounds,
        frame: false,
        webPreferences,
        title: '海克斯核心',
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
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
            hash: '/display',
        })
    }

    return mainWindow
}

/**
 * 创建弹出窗口
 */
export const createPopupWindow = async (isDev, devServerUrl) => {
    const webPreferences = getOverlayWebPreferences(isDev)
    const bounds = getPopupBounds()

    popupWindow = new BrowserWindow({
        show: false,
        frame: false,
        skipTaskbar: true,
        resizable: isDev || false,
        fullscreenable: false,
        alwaysOnTop: true, // 始终置顶，包括开发模式
        ...bounds,
        webPreferences,
    })

    popupWindow.on('closed', () => {
        logger.info('Popup window closed')
        popupWindow = undefined
    })

    if (isDev) {
        await popupWindow.loadURL(`${devServerUrl}/#/augment-overlay`)
    } else {
        await popupWindow.loadFile(getRendererIndexPath(), {
            hash: '/augment-overlay',
        })
    }

    if (isDev) {
        popupWindow.webContents.openDevTools({ mode: 'detach' })
    }

    logger.info('Popup window loaded', popupWindow.webContents.getURL())

    return popupWindow
}

/**
 * 创建透明浮动窗口（用于游戏内显示海克斯推荐）
 * 【重要】窗口位置在屏幕顶部(2%)，确保不与OCR识别区域(从25%开始)重叠
 */
export const createFloatingWindow = async (isDev, devServerUrl) => {
    const webPreferences = getOverlayWebPreferences(isDev)
    const bounds = getFloatingBounds()

    floatingWindow = new BrowserWindow({
        show: false,
        frame: false,           // 无边框
        transparent: true,      // 透明背景
        skipTaskbar: true,      // 不在任务栏显示
        resizable: false,
        fullscreenable: false,
        alwaysOnTop: true,      // 始终置顶
        focusable: false,       // 不获取焦点，避免干扰游戏
        ...bounds,
        webPreferences,
    })

    // 设置窗口忽略鼠标事件（透传点击）
    // floatingWindow.setIgnoreMouseEvents(true, { forward: true })

    floatingWindow.on('closed', () => {
        logger.info('Floating window closed')
        floatingWindow = undefined
    })

    if (isDev) {
        await floatingWindow.loadURL(`${devServerUrl}/#/floating-overlay`)
    } else {
        await floatingWindow.loadFile(getRendererIndexPath(), {
            hash: '/floating-overlay',
        })
    }

    // 开发模式下打开开发者工具
    if (isDev) {
        floatingWindow.webContents.openDevTools({ mode: 'detach' })
    }

    logger.info('透明浮动窗口已创建', {
        ...bounds,
        url: floatingWindow.webContents.getURL(),
    })

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
