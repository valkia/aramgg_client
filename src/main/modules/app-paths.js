import electron from 'electron'
import fs from 'fs-extra'
import os from 'os'
import path from 'path'

const APP_DATA_DIR_NAME = 'aramgg_client-data'
let cachedAppDataDir = null
const electronApp = electron?.app || electron?.default?.app || null

function hasElectronApp() {
    return electronApp && typeof electronApp.getPath === 'function'
}

function canWriteDirectory(dir) {
    const testFile = path.join(dir, `.write-test-${process.pid}-${Date.now()}`)

    try {
        fs.ensureDirSync(dir)
        fs.writeFileSync(testFile, 'ok', 'utf8')
        fs.removeSync(testFile)
        return true
    } catch {
        try {
            fs.removeSync(testFile)
        } catch {
            // Ignore cleanup failures for a file that may not have been created.
        }

        return false
    }
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

export function getAppDataDir() {
    if (cachedAppDataDir) {
        return cachedAppDataDir
    }

    const installSideDataDir = getInstallSideDataDir()

    if (installSideDataDir && canWriteDirectory(installSideDataDir)) {
        cachedAppDataDir = installSideDataDir
    } else {
        cachedAppDataDir = getDefaultUserDataDir()
        fs.ensureDirSync(cachedAppDataDir)
    }

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
