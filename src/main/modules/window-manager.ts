// @ts-nocheck
import logger from './logger.ts';
import { BrowserWindow, screen, app } from 'electron'
import { createServer } from 'http'
import { createReadStream, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow = null
let popupWindow = null
let floatingWindow = null
let augmentSidePanelWindow = null
let mainWindowCloseAllowed = false
let rendererServerPromise = null

const MAIN_WINDOW_SIZE = { width: 380, height: 620 }
const POPUP_WINDOW_SIZE = { width: 360, height: 640 }
const FLOATING_WINDOW_SIZE = { width: 760, height: 170 }
const AUGMENT_SIDE_PANEL_WINDOW_SIZE = { width: 360, height: 640 }
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
}

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

function getAugmentSidePanelBounds() {
    const display = screen.getPrimaryDisplay()
    const area = display.workArea || display.bounds
    const width = Math.min(AUGMENT_SIDE_PANEL_WINDOW_SIZE.width, area.width)
    const height = Math.min(AUGMENT_SIDE_PANEL_WINDOW_SIZE.height, area.height)

    return {
        width,
        height,
        x: area.x + area.width - width - 16,
        y: area.y + Math.max(16, Math.round((area.height - height) / 2)),
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

export function applyAugmentSidePanelWindowLayout() {
    if (augmentSidePanelWindow && !augmentSidePanelWindow.isDestroyed()) {
        augmentSidePanelWindow.setBounds(getAugmentSidePanelBounds())
    }
}

export function setPopupWindowAlwaysOnTop(alwaysOnTop) {
    if (popupWindow && !popupWindow.isDestroyed()) {
        popupWindow.setAlwaysOnTop(Boolean(alwaysOnTop))
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

function getRendererDistPath() {
    return path.dirname(getRendererIndexPath())
}

function resolveRendererAssetPath(requestUrl) {
    const url = new URL(requestUrl, 'http://127.0.0.1')
    const requestedPath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const rendererDistPath = path.resolve(getRendererDistPath())
    const filePath = path.resolve(rendererDistPath, requestedPath)
    const isInsideRendererDist =
        filePath === rendererDistPath || filePath.startsWith(`${rendererDistPath}${path.sep}`)

    return isInsideRendererDist ? filePath : null
}

function getMimeType(filePath) {
    return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function startRendererServer() {
    if (rendererServerPromise) {
        return rendererServerPromise
    }

    rendererServerPromise = new Promise((resolve, reject) => {
        const server = createServer((request, response) => {
            const filePath = resolveRendererAssetPath(request.url || '/index.html')
            if (!filePath || !existsSync(filePath)) {
                response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
                response.end('Not found')
                return
            }

            const stream = createReadStream(filePath)
            stream.once('open', () => {
                response.writeHead(200, {
                    'content-type': getMimeType(filePath),
                    'cache-control': 'no-store',
                })
                stream.pipe(response)
            })
            stream.once('error', () => {
                if (!response.headersSent) {
                    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
                    response.end('Not found')
                    return
                }

                response.destroy()
            })
        })

        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            if (!address || typeof address === 'string') {
                server.close()
                reject(new Error('Renderer server did not return a TCP address'))
                return
            }

            app.once('will-quit', () => {
                server.close()
            })
            resolve(`http://127.0.0.1:${address.port}`)
        })
    }).catch((error) => {
        rendererServerPromise = null
        throw error
    })

    return rendererServerPromise
}

async function getRendererBaseUrl(isDev, devServerUrl) {
    if (isDev) {
        return devServerUrl
    }

    return startRendererServer()
}

async function loadRendererUrl(window, route, isDev, devServerUrl) {
    const baseUrl = await getRendererBaseUrl(isDev, devServerUrl)
    await window.loadURL(`${baseUrl}/#${route}`)
}

function getRendererLogUrl(isDev, devServerUrl) {
    if (isDev) {
        return devServerUrl
    }

    return 'http://127.0.0.1:<dynamic>'
}

function getRendererLogPath(isDev) {
    if (isDev) {
        return undefined
    }

    return getRendererIndexPath()
}

function getRendererLogPathExists(isDev) {
    if (isDev) {
        return undefined
    }

    return existsSync(getRendererIndexPath())
}

function getRendererLogInfo(isDev, devServerUrl) {
    return {
        rendererBaseUrl: getRendererLogUrl(isDev, devServerUrl),
        rendererIndexPath: getRendererLogPath(isDev),
        rendererIndexExists: getRendererLogPathExists(isDev),
    }
}

function attachWindowDiagnostics(name, window) {
    const { webContents } = window

    webContents.on('did-finish-load', () => {
        logger.info(`[window:${name}] renderer loaded`, {
            url: webContents.getURL(),
        })
    })

    webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        logger.error(`[window:${name}] renderer load failed`, {
            errorCode,
            errorDescription,
            validatedURL,
            isMainFrame,
            currentUrl: webContents.getURL(),
        })
    })

    webContents.on('preload-error', (_event, preloadPath, error) => {
        logger.error(`[window:${name}] preload failed`, {
            preloadPath,
            message: error?.message,
            stack: error?.stack,
        })
    })

    webContents.on('render-process-gone', (_event, details) => {
        logger.error(`[window:${name}] renderer process gone`, {
            reason: details.reason,
            exitCode: details.exitCode,
            url: webContents.getURL(),
        })
    })

    webContents.on('console-message', (_event, level, message, line, sourceId) => {
        if (level < 2) {
            return
        }

        logger.warn(`[window:${name}] renderer console`, {
            level,
            message,
            line,
            sourceId,
            url: webContents.getURL(),
        })
    })
}

async function loadRendererRoute(window, name, isDev, devServerUrl, route, preloadPath) {
    logger.info(`[window:${name}] loading renderer route`, {
        route,
        isDev,
        preloadPath,
        preloadExists: preloadPath ? existsSync(preloadPath) : false,
        ...getRendererLogInfo(isDev, devServerUrl),
    })

    await loadRendererUrl(window, route, isDev, devServerUrl)
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
        title: 'ARAMGG助手',
    })
    attachWindowDiagnostics('main', mainWindow)

    mainWindow.on('close', (event) => {
        if (!mainWindowCloseAllowed) {
            event.preventDefault()
            logger.info('Main window close requested; asking renderer for confirmation')
            if (!mainWindow.isVisible()) {
                mainWindow.show()
            }
            if (mainWindow.isMinimized()) {
                mainWindow.restore()
            }
            mainWindow.focus()
            mainWindow.webContents.send('quit-confirm-requested')
            return
        }

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
        if (augmentSidePanelWindow && !augmentSidePanelWindow.isDestroyed()) {
            logger.info('Closing augment side panel window...')
            augmentSidePanelWindow.close()
        }
    })

    mainWindow.on('closed', () => {
        logger.info('Main window closed')
        mainWindow = null
    })

    // 加载应用
    await loadRendererRoute(mainWindow, 'main', isDev, devServerUrl, '/display', webPreferences.preload)

    if (isDev) {
        mainWindow.webContents.openDevTools()
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
    attachWindowDiagnostics('popup', popupWindow)

    popupWindow.on('closed', () => {
        logger.info('Popup window closed')
        popupWindow = undefined
    })

    await loadRendererRoute(popupWindow, 'popup', isDev, devServerUrl, '/augment-overlay', webPreferences.preload)

    if (isDev) {
        popupWindow.webContents.openDevTools({ mode: 'detach' })
    }

    logger.info('Popup window loaded', popupWindow.webContents.getURL())

    return popupWindow
}

/**
 * 创建游戏右侧海克斯推荐列表窗口
 */
export const createAugmentSidePanelWindow = async (isDev, devServerUrl) => {
    const webPreferences = getOverlayWebPreferences(isDev)
    const bounds = getAugmentSidePanelBounds()

    augmentSidePanelWindow = new BrowserWindow({
        show: false,
        frame: false,
        transparent: true,
        skipTaskbar: true,
        resizable: isDev || false,
        fullscreenable: false,
        alwaysOnTop: true,
        focusable: false,
        ...bounds,
        webPreferences,
    })
    attachWindowDiagnostics('augment-side-panel', augmentSidePanelWindow)

    augmentSidePanelWindow.on('closed', () => {
        logger.info('Augment side panel window closed')
        augmentSidePanelWindow = undefined
    })

    await loadRendererRoute(
        augmentSidePanelWindow,
        'augment-side-panel',
        isDev,
        devServerUrl,
        '/augment-side-panel',
        webPreferences.preload
    )

    if (isDev) {
        augmentSidePanelWindow.webContents.openDevTools({ mode: 'detach' })
    }

    logger.info('海克斯右侧推荐列表窗口已创建', {
        ...bounds,
        url: augmentSidePanelWindow.webContents.getURL(),
    })

    return augmentSidePanelWindow
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
    attachWindowDiagnostics('floating', floatingWindow)

    // 设置窗口忽略鼠标事件（透传点击）
    // floatingWindow.setIgnoreMouseEvents(true, { forward: true })

    floatingWindow.on('closed', () => {
        logger.info('Floating window closed')
        floatingWindow = undefined
    })

    await loadRendererRoute(floatingWindow, 'floating', isDev, devServerUrl, '/floating-overlay', webPreferences.preload)

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

export const getAugmentSidePanelWindow = () => augmentSidePanelWindow

export const allowMainWindowClose = () => {
    mainWindowCloseAllowed = true
}

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
