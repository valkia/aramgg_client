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
const WRITE_TEST_FILE = '.aramgg-write-test'

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

function canUseDataDir(directoryPath) {
    if (!directoryPath) {
        return false
    }

    const testFile = path.join(directoryPath, WRITE_TEST_FILE)
    try {
        fs.ensureDirSync(directoryPath)
        fs.writeFileSync(testFile, String(Date.now()), { encoding: 'utf8' })
        fs.removeSync(testFile)
        return true
    } catch {
        try {
            fs.removeSync(testFile)
        } catch {
            // Ignore cleanup failures for the probe file.
        }
        return false
    }
}

export function getAppDataDir() {
    if (cachedAppDataDir) {
        return cachedAppDataDir
    }

    const userDataDir = getDefaultUserDataDir()
    const installSideDataDir = getInstallSideDataDir()

    if (installSideDataDir && canUseDataDir(installSideDataDir)) {
        cachedAppDataDir = installSideDataDir
        return cachedAppDataDir
    }

    cachedAppDataDir = userDataDir
    fs.ensureDirSync(cachedAppDataDir)

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
