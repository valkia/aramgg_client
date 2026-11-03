import { app, Menu, nativeImage, Tray } from 'electron'
import { existsSync } from 'fs'
import path from 'path'
import logger from './logger.ts'
import {
    getMainWindow,
    hideMainWindow,
    showMainWindow,
    toggleMainWindow,
} from './window-manager.ts'

let tray: Tray | null = null

const TRAY_TOOLTIP = 'ARAMGG助手'

function uniqueExistingPaths(paths: string[]) {
    const seen = new Set<string>()
    return paths.filter((candidatePath) => {
        const normalizedPath = path.normalize(candidatePath)
        if (seen.has(normalizedPath)) {
            return false
        }
        seen.add(normalizedPath)
        return existsSync(normalizedPath)
    })
}

function getTrayIconPath() {
    const appPath = app.getAppPath()
    const candidates = uniqueExistingPaths([
        ...(process.platform === 'darwin' ? [
            path.join(appPath, 'dist', 'logo.jpg'),
            path.join(appPath, 'public', 'logo.jpg'),
        ] : []),
        path.join(appPath, 'dist', 'icon.ico'),
        path.join(appPath, 'public', 'icon.ico'),
        path.join(process.cwd(), 'dist', 'icon.ico'),
        path.join(process.cwd(), 'public', 'icon.ico'),
        path.join(process.resourcesPath || '', 'icon.ico'),
    ])

    return candidates[0] || null
}

function createTrayIcon() {
    const iconPath = getTrayIconPath()

    if (!iconPath) {
        logger.warn('[tray] icon file not found; creating tray with empty icon')
        return nativeImage.createEmpty()
    }

    const image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) {
        logger.warn('[tray] icon file could not be loaded', { iconPath })
        return nativeImage.createEmpty()
    }

    logger.info('[tray] icon loaded', { iconPath })
    return process.platform === 'darwin' ? image.resize({ width: 18, height: 18 }) : image
}

function requestQuitConfirmation() {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
        logger.info('[tray] quit requested without main window; quitting app')
        app.quit()
        return
    }

    showMainWindow()
    mainWindow.webContents.send('quit-confirm-requested')
}

function buildTrayMenu() {
    return Menu.buildFromTemplate([
        {
            label: '打开主窗口',
            click: () => {
                showMainWindow()
            },
        },
        {
            label: '隐藏主窗口',
            click: () => {
                hideMainWindow()
            },
        },
        { type: 'separator' },
        {
            label: '退出',
            click: () => {
                requestQuitConfirmation()
            },
        },
    ])
}

export function createAppTray() {
    if (tray && !tray.isDestroyed()) {
        return tray
    }

    tray = new Tray(createTrayIcon())
    tray.setToolTip(TRAY_TOOLTIP)
    tray.setContextMenu(buildTrayMenu())

    tray.on('click', () => {
        toggleMainWindow()
    })

    tray.on('double-click', () => {
        showMainWindow()
    })

    app.once('quit', () => {
        destroyAppTray()
    })

    logger.info('[tray] system tray created')
    return tray
}

export function destroyAppTray() {
    if (!tray || tray.isDestroyed()) {
        tray = null
        return
    }

    tray.destroy()
    tray = null
    logger.info('[tray] system tray destroyed')
}
