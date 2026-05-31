// @ts-nocheck
import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'

const APP_DATA_DIR_NAME = 'aramgg_client-data'
let cachedAppDataDir = null
const require = createRequire(import.meta.url)
let electron = null

if (process.versions?.electron) {
    try {
        electron = require('electron')
    } catch {
        electron = null
    }
}

const electronApp = electron?.app || electron?.default?.app || null

function hasElectronApp() {
    return electronApp && typeof electronApp.getPath === 'function'
}

function getDefaultUserDataDir() {
    if (!hasElectronApp()) {
        return path.join(os.homedir(), '.aramgg_client')
    }

    try {
        return electronApp.getPath('userData')
    } catch {
        return path.join(os.homedir(), '.aramgg_client')
    }
}

function getInstallSideDataDir() {
    if (!hasElectronApp() || !electronApp.isPackaged || process.platform !== 'win32') {
        return null
    }

    try {
        return path.join(path.dirname(electronApp.getPath('exe')), APP_DATA_DIR_NAME)
    } catch {
        return null
    }
}

function migrateInstallSideDataDir(targetDir) {
    const installSideDataDir = getInstallSideDataDir()

    if (!installSideDataDir || path.resolve(installSideDataDir) === path.resolve(targetDir)) {
        return
    }

    try {
        if (fs.pathExistsSync(installSideDataDir)) {
            fs.copySync(installSideDataDir, targetDir, {
                overwrite: false,
                errorOnExist: false,
            })
        }
    } catch {
        // Startup should continue even if an old install-side cache cannot be migrated.
    }
}

export function getAppDataDir() {
    if (cachedAppDataDir) {
        return cachedAppDataDir
    }

    cachedAppDataDir = getDefaultUserDataDir()
    fs.ensureDirSync(cachedAppDataDir)
    migrateInstallSideDataDir(cachedAppDataDir)

    return cachedAppDataDir
}

export function configureAppPaths() {
    const appDataDir = getAppDataDir()

    if (!hasElectronApp() || typeof electronApp.setPath !== 'function') {
        return appDataDir
    }

    try {
        if (electronApp.getPath('userData') !== appDataDir) {
            electronApp.setPath('userData', appDataDir)
        }
    } catch {
        // Keep Electron defaults if the path cannot be changed in this runtime.
    }

    return appDataDir
}

export function getConfigDir() {
    const configDir = path.join(getAppDataDir(), 'config')
    fs.ensureDirSync(configDir)
    return configDir
}

export function getLogDir() {
    const logDir = path.join(getAppDataDir(), 'logs')
    fs.ensureDirSync(logDir)
    return logDir
}

export function getPartialOcrScreenshotDir() {
    const screenshotDir = path.join(getAppDataDir(), 'ocr-partial-screenshots')
    fs.ensureDirSync(screenshotDir)
    return screenshotDir
}
