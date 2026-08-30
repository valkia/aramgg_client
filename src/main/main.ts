import { app } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { configureAppPaths } from './modules/app-paths.ts'

function getBootstrapLogFile(): string {
    const appDataRoot = process.env.APPDATA
        ? path.join(process.env.APPDATA, 'aramgg_client')
        : path.join(os.homedir(), '.aramgg_client')
    const logDir = path.join(appDataRoot, 'logs')
    fs.mkdirSync(logDir, { recursive: true })
    const date = new Date().toISOString().slice(0, 10)
    return path.join(logDir, `bootstrap-${date}.log`)
}

function writeBootstrapError(stage: string, error: unknown): void {
    try {
        const message = error instanceof Error
            ? `${error.message}\n${error.stack || ''}`
            : String(error)
        fs.appendFileSync(
            getBootstrapLogFile(),
            `[${new Date().toISOString()}] ${stage}\n${message}\n\n`,
            'utf8'
        )
    } catch {
        // Last-resort diagnostics must never mask the original startup error.
    }
}

try {
    configureAppPaths()
} catch (error) {
    writeBootstrapError('configureAppPaths failed', error)
    throw error
}

let init: typeof import('./modules/app-config.ts').init
let windowManager: typeof import('./modules/window-manager.ts')
let logger: typeof import('./modules/logger.ts').default
try {
    ;[{ init }, windowManager, { default: logger }] = await Promise.all([
        import('./modules/app-config.ts'),
        import('./modules/window-manager.ts'),
        import('./modules/logger.ts'),
    ])
} catch (error) {
    writeBootstrapError('main module imports failed', error)
    throw error
}

const { getMainWindow } = windowManager

app.commandLine.appendSwitch('ignore-connections-limit', 'op.gg')

/**
 * 主进程全局错误处理
 */
function setupMainProcessErrorHandling(): void {
    const globalErrorStates = new Map<string, {
        lastLoggedAt: number
        suppressedCount: number
    }>()
    const globalErrorLogIntervalMs = 30 * 1000

    const logGlobalError = (event: string, error: unknown): boolean => {
        const normalizedError = error instanceof Error ? error : new Error(String(error))
        const errorWithCode = normalizedError as Error & { code?: unknown }
        const signature = `${event}:${normalizedError.name}:${errorWithCode.code || ''}:${normalizedError.message}`
        const now = Date.now()
        const state = globalErrorStates.get(signature)

        if (state && now - state.lastLoggedAt < globalErrorLogIntervalMs) {
            state.suppressedCount += 1
            return false
        }

        globalErrorStates.set(signature, {
            lastLoggedAt: now,
            suppressedCount: 0,
        })
        if (state?.suppressedCount) {
            logger.error(event, {
                suppressedSinceLastLog: state.suppressedCount,
            }, normalizedError)
        } else {
            logger.error(event, normalizedError)
        }
        return true
    }

    // 捕获未处理的 Promise 拒绝
    process.on('unhandledRejection', (reason) => {
        if (!logGlobalError('主进程未处理的 Promise 拒绝:', reason)) {
            return
        }
        import('./services/analytics-service.ts').then(({ recordPendingAnalyticsEvent }) => {
            recordPendingAnalyticsEvent('main_unhandled_rejection', {
                message: reason instanceof Error ? reason.message : String(reason || 'unknown'),
            })
        }).catch(() => {})
    })

    // 捕获未捕获的异常
    process.on('uncaughtException', (error) => {
        if (!logGlobalError('主进程未捕获的异常:', error)) {
            return
        }
        import('./services/analytics-service.ts').then(({ recordPendingAnalyticsEvent }) => {
            recordPendingAnalyticsEvent('main_uncaught_exception', {
                message: error?.message || 'unknown',
                name: error?.name || 'Error',
            })
        }).catch(() => {})
    })

    // 捕获警告
    process.on('warning', (warning) => {
        logger.warn('主进程警告:', warning)
    })

    app.on('before-quit', () => {
        logger.info('[app] before-quit')
        import('./services/analytics-service.ts').then(({ markAnalyticsAppCleanExit }) => {
            markAnalyticsAppCleanExit()
        }).catch(() => {})
    })

    app.on('render-process-gone', (_event, webContents, details) => {
        logger.error('[app] renderer process gone:', {
            reason: details.reason,
            exitCode: details.exitCode,
            url: webContents.getURL(),
        })
        import('./services/analytics-service.ts').then(({ recordPendingAnalyticsEvent }) => {
            recordPendingAnalyticsEvent('renderer_process_gone', {
                reason: details.reason,
                exit_code: details.exitCode,
                url: webContents.getURL(),
            })
        }).catch(() => {})
    })

    app.on('child-process-gone', (_event, details) => {
        logger.error('[app] child process gone:', details)
        import('./services/analytics-service.ts').then(({ recordPendingAnalyticsEvent }) => {
            recordPendingAnalyticsEvent('child_process_gone', {
                type: details.type,
                reason: details.reason,
                exit_code: details.exitCode,
                name: details.name,
            })
        }).catch(() => {})
    })

    // 记录应用启动
    logger.info('应用启动 - 主进程错误监听已设置')
}

// 设置主进程错误处理
setupMainProcessErrorHandling()

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
    logger.info('[app] another instance is already running; exiting second instance')
    app.quit()
} else {
    app.on('second-instance', (_event, commandLine, workingDirectory) => {
        logger.info('[app] second instance detected', {
            commandLine,
            workingDirectory,
        })

        const mainWindow = getMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore()
            }
            if (!mainWindow.isVisible()) {
                mainWindow.show()
            }
            mainWindow.focus()
        }
    })

    // Some APIs can only be used after Electron is ready.
    app.whenReady().then(init).catch((error) => {
        writeBootstrapError('app initialization failed', error)
        logger.error('[app] initialization failed:', error)
    })
}
