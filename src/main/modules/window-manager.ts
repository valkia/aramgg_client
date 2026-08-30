import logger from './logger.ts'
import {
    BrowserWindow,
    screen,
    app,
    type Event,
    type Rectangle,
    type WebPreferences,
} from 'electron'
import { createServer } from 'http'
import { createReadStream, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
    isTrustedRendererUrl,
    registerTrustedRendererOrigin,
} from '../security/renderer-origin.ts'
import store from './app-store.ts'
import {
    fitWindowPositionToWorkArea,
    parseWindowPosition,
} from './window-position.ts'
import { shouldRaiseOverlayWindow } from './overlay-window-state.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const OPEN_OVERLAY_DEVTOOLS = process.env.ARAMGG_OPEN_OVERLAY_DEVTOOLS === '1'
const RENDERER_CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self' https://www.googletagmanager.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' ws://localhost:* ws://127.0.0.1:* https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com https://*.googleapis.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
].join('; ')

let mainWindow: BrowserWindow | null = null
let popupWindow: BrowserWindow | null = null
let floatingWindow: BrowserWindow | null = null
let augmentSidePanelWindow: BrowserWindow | null = null
let mainWindowCloseAllowed = false
let rendererServerPromise: Promise<string> | null = null

const MAIN_WINDOW_SIZE = { width: 472, height: 752 }
const POPUP_WINDOW_SIZE = { width: 360, height: 640 }
const POPUP_WINDOW_POSITION_KEY = 'windows.championInsightPosition'
const FLOATING_WINDOW_SIZE = { width: 760, height: 170 }
const AUGMENT_SIDE_PANEL_WINDOW_SIZE = { width: 360, height: 640 }
const OVERLAY_ALWAYS_ON_TOP_LEVEL = process.platform === 'win32' ? 'screen-saver' : 'floating'
const MIME_TYPES: Record<string, string> = {
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

function getMainWindowBounds(): Rectangle {
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

function getPopupBounds(): Rectangle {
    const savedPosition = parseWindowPosition(store.get(POPUP_WINDOW_POSITION_KEY))
    const display = savedPosition
        ? screen.getDisplayNearestPoint(savedPosition)
        : getDisplayForMainWindow()
    const area = display.workArea || display.bounds
    const width = Math.min(POPUP_WINDOW_SIZE.width, area.width)
    const height = Math.min(POPUP_WINDOW_SIZE.height, area.height)
    const rightAlignedX = area.x + area.width - width - 140
    const defaultPosition = {
        x: Math.max(area.x + 20, rightAlignedX),
        y: area.y + Math.max(20, Math.round((area.height - height) / 2)),
    }
    const position = fitWindowPositionToWorkArea(
        savedPosition || defaultPosition,
        { width, height },
        area,
    )

    return {
        width,
        height,
        ...position,
    }
}

function savePopupWindowPosition(): void {
    if (!popupWindow || popupWindow.isDestroyed()) {
        return
    }

    const [x, y] = popupWindow.getPosition()
    store.set(POPUP_WINDOW_POSITION_KEY, { x, y })
}

function getFloatingBounds(): Rectangle {
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

function getAugmentSidePanelBounds(): Rectangle {
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
        if (popupWindow.isVisible()) {
            return
        }
        popupWindow.setBounds(getPopupBounds())
    }
}

export function applyFloatingWindowLayout() {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
        if (floatingWindow.isVisible()) {
            return
        }
        floatingWindow.setBounds(getFloatingBounds())
    }
}

export function applyAugmentSidePanelWindowLayout() {
    if (augmentSidePanelWindow && !augmentSidePanelWindow.isDestroyed()) {
        if (augmentSidePanelWindow.isVisible()) {
            return
        }
        augmentSidePanelWindow.setBounds(getAugmentSidePanelBounds())
    }
}

export function setPopupWindowAlwaysOnTop(alwaysOnTop: boolean): void {
    if (popupWindow && !popupWindow.isDestroyed()) {
        setOverlayAlwaysOnTop(popupWindow, Boolean(alwaysOnTop), 'popup')
    }
}

function setOverlayAlwaysOnTop(
    window: BrowserWindow | null,
    alwaysOnTop: boolean = true,
    name: string = 'overlay'
): void {
    if (!window || window.isDestroyed()) {
        return
    }

    try {
        window.setAlwaysOnTop(Boolean(alwaysOnTop), OVERLAY_ALWAYS_ON_TOP_LEVEL)
    } catch (error) {
        logger.debug(
            `[window:${name}] failed to apply high always-on-top level:`,
            error instanceof Error ? error.message : String(error)
        )
        window.setAlwaysOnTop(Boolean(alwaysOnTop))
    }
}

export function raiseOverlayWindow(
    window: BrowserWindow | null,
    name: string = 'overlay'
): void {
    if (!window || window.isDestroyed() || !shouldRaiseOverlayWindow(window)) {
        return
    }

    setOverlayAlwaysOnTop(window, true, name)

    if (window.isMinimized()) {
        window.restore()
    }

    if (typeof window.showInactive === 'function') {
        window.showInactive()
    } else {
        window.show()
    }

    if (typeof window.moveTop === 'function') {
        window.moveTop()
    }
}

/**
 * 获取正确的 preload 脚本路径
 */
function getPreloadPath(isDev: boolean): string {
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

function getRendererIndexPath(): string {
    return path.join(__dirname, '../dist/index.html')
}

function getRendererDistPath(): string {
    return path.dirname(getRendererIndexPath())
}

function resolveRendererAssetPath(requestUrl: string): string | null {
    const url = new URL(requestUrl, 'http://127.0.0.1')
    const requestedPath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const rendererDistPath = path.resolve(getRendererDistPath())
    const filePath = path.resolve(rendererDistPath, requestedPath)
    const isInsideRendererDist =
        filePath === rendererDistPath || filePath.startsWith(`${rendererDistPath}${path.sep}`)

    return isInsideRendererDist ? filePath : null
}

function getMimeType(filePath: string): string {
    return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function startRendererServer(): Promise<string> {
    if (rendererServerPromise) {
        return rendererServerPromise
    }

    rendererServerPromise = new Promise<string>((resolve, reject) => {
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
                    'content-security-policy': RENDERER_CONTENT_SECURITY_POLICY,
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

async function getRendererBaseUrl(isDev: boolean, devServerUrl: string): Promise<string> {
    if (isDev) {
        return devServerUrl
    }

    return startRendererServer()
}

async function loadRendererUrl(
    window: BrowserWindow,
    route: string,
    isDev: boolean,
    devServerUrl: string
): Promise<void> {
    const baseUrl = await getRendererBaseUrl(isDev, devServerUrl)
    registerTrustedRendererOrigin(baseUrl)
    attachRendererNavigationGuards(window)
    await window.loadURL(`${baseUrl}/#${route}`)
}

function attachRendererNavigationGuards(window: BrowserWindow): void {
    const rejectUntrustedNavigation = (event: Event, targetUrl: string) => {
        if (isTrustedRendererUrl(targetUrl)) {
            return
        }

        event.preventDefault()
        logger.warn('[window] blocked untrusted renderer navigation', {
            currentUrl: window.webContents.getURL(),
            targetUrl,
        })
    }

    window.webContents.on('will-navigate', rejectUntrustedNavigation)
    window.webContents.on('will-redirect', rejectUntrustedNavigation)
    window.webContents.setWindowOpenHandler(({ url }) => {
        logger.warn('[window] blocked renderer window.open', {
            currentUrl: window.webContents.getURL(),
            targetUrl: url,
        })
        return { action: 'deny' }
    })
}

function getRendererLogUrl(isDev: boolean, devServerUrl: string): string {
    if (isDev) {
        return devServerUrl
    }

    return 'http://127.0.0.1:<dynamic>'
}

function getRendererLogPath(isDev: boolean): string | undefined {
    if (isDev) {
        return undefined
    }

    return getRendererIndexPath()
}

function getRendererLogPathExists(isDev: boolean): boolean | undefined {
    if (isDev) {
        return undefined
    }

    return existsSync(getRendererIndexPath())
}

function getRendererLogInfo(isDev: boolean, devServerUrl: string) {
    return {
        rendererBaseUrl: getRendererLogUrl(isDev, devServerUrl),
        rendererIndexPath: getRendererLogPath(isDev),
        rendererIndexExists: getRendererLogPathExists(isDev),
    }
}

function attachWindowDiagnostics(name: string, window: BrowserWindow): void {
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

async function loadRendererRoute(
    window: BrowserWindow,
    name: string,
    isDev: boolean,
    devServerUrl: string,
    route: string,
    preloadPath: string | undefined
): Promise<void> {
    logger.info(`[window:${name}] loading renderer route`, {
        route,
        isDev,
        preloadPath,
        preloadExists: preloadPath ? existsSync(preloadPath) : false,
        ...getRendererLogInfo(isDev, devServerUrl),
    })

    await loadRendererUrl(window, route, isDev, devServerUrl)
}

const getWebPreferences = (
    isDev: boolean,
    overrides: Partial<WebPreferences> = {}
): WebPreferences => ({
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    contextIsolation: true,
    sandbox: true,
    preload: getPreloadPath(isDev),
    ...overrides,
})

/**
 * 创建主窗口
 */
export const createMainWindow = async (
    isDev: boolean,
    devServerUrl: string
): Promise<BrowserWindow> => {
    const webPreferences = getWebPreferences(isDev)
    const bounds = getMainWindowBounds()

    mainWindow = new BrowserWindow({
        ...bounds,
        frame: false,
        webPreferences,
        title: 'ARAMGG助手',
    })
    const window = mainWindow
    attachWindowDiagnostics('main', window)

    window.on('close', (event) => {
        if (!mainWindowCloseAllowed) {
            event.preventDefault()
            logger.info('Main window close requested; asking renderer for confirmation')
            if (!window.isVisible()) {
                window.show()
            }
            if (window.isMinimized()) {
                window.restore()
            }
            window.focus()
            window.webContents.send('quit-confirm-requested')
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

    window.on('closed', () => {
        logger.info('Main window closed')
        if (mainWindow === window) {
            mainWindow = null
        }
    })

    // 加载应用
    await loadRendererRoute(window, 'main', isDev, devServerUrl, '/display', webPreferences.preload)

    if (isDev) {
        window.webContents.openDevTools()
    }

    return window
}

/**
 * 创建弹出窗口
 */
export const createPopupWindow = async (
    isDev: boolean,
    devServerUrl: string
): Promise<BrowserWindow> => {
    const webPreferences = getWebPreferences(isDev)
    const bounds = getPopupBounds()

    popupWindow = new BrowserWindow({
        show: false,
        frame: false,
        skipTaskbar: true,
        closable: false,
        resizable: isDev || false,
        fullscreenable: false,
        alwaysOnTop: true, // 始终置顶，包括开发模式
        ...bounds,
        webPreferences,
    })
    setOverlayAlwaysOnTop(popupWindow, true, 'popup')
    attachWindowDiagnostics('popup', popupWindow)

    if (process.platform === 'linux') {
        popupWindow.on('move', savePopupWindowPosition)
    } else {
        popupWindow.on('moved', savePopupWindowPosition)
    }

    popupWindow.on('closed', () => {
        logger.info('Popup window closed')
        popupWindow = null
    })

    await loadRendererRoute(popupWindow, 'popup', isDev, devServerUrl, '/augment-overlay', webPreferences.preload)

    if (isDev && OPEN_OVERLAY_DEVTOOLS) {
        popupWindow.webContents.openDevTools({ mode: 'detach' })
    }

    logger.info('Popup window loaded', popupWindow.webContents.getURL())

    return popupWindow
}

/**
 * 创建游戏右侧海克斯推荐列表窗口
 */
export const createAugmentSidePanelWindow = async (
    isDev: boolean,
    devServerUrl: string
): Promise<BrowserWindow> => {
    const webPreferences = getWebPreferences(isDev)
    const bounds = getAugmentSidePanelBounds()

    augmentSidePanelWindow = new BrowserWindow({
        show: false,
        frame: false,
        transparent: true,
        skipTaskbar: true,
        resizable: isDev || false,
        fullscreenable: false,
        alwaysOnTop: true,
        focusable: true,
        ...bounds,
        webPreferences,
    })
    setOverlayAlwaysOnTop(augmentSidePanelWindow, true, 'augment-side-panel')
    attachWindowDiagnostics('augment-side-panel', augmentSidePanelWindow)

    augmentSidePanelWindow.on('closed', () => {
        logger.info('Augment side panel window closed')
        augmentSidePanelWindow = null
    })

    await loadRendererRoute(
        augmentSidePanelWindow,
        'augment-side-panel',
        isDev,
        devServerUrl,
        '/augment-side-panel',
        webPreferences.preload
    )

    if (isDev && OPEN_OVERLAY_DEVTOOLS) {
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
export const createFloatingWindow = async (
    isDev: boolean,
    devServerUrl: string
): Promise<BrowserWindow> => {
    const webPreferences = getWebPreferences(isDev)
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
    setOverlayAlwaysOnTop(floatingWindow, true, 'floating')
    attachWindowDiagnostics('floating', floatingWindow)

    // 设置窗口忽略鼠标事件（透传点击）
    // floatingWindow.setIgnoreMouseEvents(true, { forward: true })

    floatingWindow.on('closed', () => {
        logger.info('Floating window closed')
        floatingWindow = null
    })

    await loadRendererRoute(floatingWindow, 'floating', isDev, devServerUrl, '/floating-overlay', webPreferences.preload)

    // 开发模式下打开开发者工具
    if (isDev && OPEN_OVERLAY_DEVTOOLS) {
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

export function notifyAllWindows(channel: string, data: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) {
            continue
        }

        try {
            window.webContents.send(channel, data)
        } catch (error) {
            logger.warn('[window-manager] failed to notify renderer window:', {
                channel,
                error: error instanceof Error ? error.message : String(error),
            })
        }
    }
}

export const allowMainWindowClose = () => {
    mainWindowCloseAllowed = true
}

/**
 * 切换主窗口可见性
 */
export const showMainWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return
    }

    if (mainWindow.isMinimized()) {
        mainWindow.restore()
    }

    mainWindow.show()
    mainWindow.focus()
}

export const hideMainWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return
    }

    mainWindow.hide()
}

export const toggleMainWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return
    }

    if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
        hideMainWindow()
        return
    }

    showMainWindow()
}
