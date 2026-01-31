import { BrowserWindow, screen } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow = null
let popupWindow = null

/**
 * 获取正确的 preload 脚本路径
 */
function getPreloadPath(isDev) {
    if (isDev) {
        return path.join(__dirname, '../../dist-electron', 'preload.js')
    } else {
        return path.join(__dirname, 'preload.js')
    }
}

const getWebPreferences = (isDev) => ({
    nodeIntegration: true,
    nodeIntegrationInWorker: true,
    webSecurity: false,
    contextIsolation: false,
    sandbox: false,
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
        alwaysOnTop: !isDev,
        width: isDev ? 900 : 400,
        height: 600,
        x: isDev ? curDisplay.bounds.width / 2 : curDisplay.bounds.width - 500 - 140,
        y: curDisplay.bounds.height / 2,
        webPreferences,
    })

    popupWindow.on('closed', () => {
        console.log('Popup window closed')
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
 * 获取主窗口实例
 */
export const getMainWindow = () => mainWindow

/**
 * 获取弹出窗口实例
 */
export const getPopupWindow = () => popupWindow

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