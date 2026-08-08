import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'

const APP_DATA_DIR_NAME = 'aramgg_client-data'
let cachedAppDataDir: string | null = null
let cachedDefaultUserDataDir: string | null = null
const require = createRequire(import.meta.url)
let electron: any = null

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

function getDefaultUserDataDir(): string {
    if (cachedDefaultUserDataDir) {
        return cachedDefaultUserDataDir
    }

    if (!hasElectronApp()) {
        cachedDefaultUserDataDir = path.join(os.homedir(), '.aramgg_client')
        return cachedDefaultUserDataDir
    }

    try {
        cachedDefaultUserDataDir = electronApp.getPath('userData')
    } catch {
        cachedDefaultUserDataDir = path.join(os.homedir(), '.aramgg_client')
    }

    return cachedDefaultUserDataDir!
}

function getInstallSideDataDir(): string | null {
    if (!hasElectronApp() || !electronApp.isPackaged || process.platform !== 'win32') {
        return null
    }

    try {
        return path.join(path.dirname(path.dirname(electronApp.getPath('exe'))), APP_DATA_DIR_NAME)
    } catch {
        return null
    }
}

function getLegacyInstallSideDataDir(): string | null {
    if (!hasElectronApp() || !electronApp.isPackaged || process.platform !== 'win32') {
        return null
    }

    try {
        return path.join(path.dirname(electronApp.getPath('exe')), APP_DATA_DIR_NAME)
    } catch {
        return null
    }
}

function canUseDataDir(directoryPath: string | null): boolean {
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

export function getAppDataDir(): string {
    if (cachedAppDataDir) {
        return cachedAppDataDir
    }

    const userDataDir = getDefaultUserDataDir()
    const installSideDataDir = getInstallSideDataDir()

    if (installSideDataDir && canUseDataDir(installSideDataDir)) {
        migrateLegacyInstallSideDataDir(installSideDataDir)
        cachedAppDataDir = installSideDataDir
        return cachedAppDataDir
    }

    cachedAppDataDir = userDataDir
    fs.ensureDirSync(cachedAppDataDir)

    return cachedAppDataDir
}

export function configureAppPaths(): string {
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

export function getConfigDir(): string {
    const configDir = path.join(getDefaultUserDataDir(), 'config')
    fs.ensureDirSync(configDir)
    migrateInstallSideConfigDir(configDir)
    return configDir
}

function migrateLegacyInstallSideDataDir(targetDir: string): void {
    const legacyDir = getLegacyInstallSideDataDir()

    if (!legacyDir || legacyDir === targetDir || !fs.existsSync(legacyDir)) {
        return
    }

    try {
        fs.copySync(legacyDir, targetDir, {
            overwrite: false,
            errorOnExist: false,
        })
    } catch {
        // Keep the new sibling data directory even if old install-side data cannot be copied.
    }
}

function migrateInstallSideConfigDir(configDir: string): void {
    const installSideDataDir = getLegacyInstallSideDataDir()

    if (!installSideDataDir) {
        return
    }

    const legacyConfigDir = path.join(installSideDataDir, 'config')
    if (legacyConfigDir === configDir) {
        return
    }

    const legacyConfigFile = path.join(legacyConfigDir, 'config.json')
    const configFile = path.join(configDir, 'config.json')
    if (!fs.existsSync(legacyConfigFile) || fs.existsSync(configFile)) {
        return
    }

    try {
        fs.copySync(legacyConfigDir, configDir, {
            overwrite: false,
            errorOnExist: false,
        })
    } catch {
        // Keep using the persistent config dir even if legacy migration fails.
    }
}

export function getLogDir(): string {
    const logDir = path.join(getAppDataDir(), 'logs')
    fs.ensureDirSync(logDir)
    return logDir
}

export function getPartialOcrScreenshotDir(): string {
    const screenshotDir = path.join(getAppDataDir(), 'ocr-partial-screenshots')
    fs.ensureDirSync(screenshotDir)
    return screenshotDir
}

/** Persistent, user-local LCU match-history records and derived statistics. */
export function getMatchHistoryDataDir(): string {
    const matchHistoryDir = path.join(getAppDataDir(), 'match-history')
    fs.ensureDirSync(matchHistoryDir)
    return matchHistoryDir
}
