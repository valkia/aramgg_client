import { app } from 'electron'
import { configureAppPaths } from './modules/app-paths.js'

configureAppPaths()

const [{ init }, windowManager, { default: logger }] = await Promise.all([
    import('./modules/app-config.js'),
    import('./modules/window-manager.js'),
    import('./modules/logger.js'),
])

const { getMainWindow } = windowManager

app.commandLine.appendSwitch('ignore-connections-limit', 'op.gg')

/**
 * 主进程全局错误处理
 */
function setupMainProcessErrorHandling() {
    // 捕获未处理的 Promise 拒绝
    process.on('unhandledRejection', (reason, promise) => {
        logger.error('主进程未处理的 Promise 拒绝:', reason)
        console.error('Unhandled Rejection at:', promise, 'reason:', reason)
    })

    // 捕获未捕获的异常
    process.on('uncaughtException', (error) => {
        logger.error('主进程未捕获的异常:', error.message, error.stack)
        console.error('Uncaught Exception:', error)
    })

    // 捕获警告
    process.on('warning', (warning) => {
        logger.warn('主进程警告:', warning.message, warning.stack)
        console.warn('Process Warning:', warning)
    })

    app.on('before-quit', () => {
        logger.info('[app] before-quit')
    })

    app.on('render-process-gone', (_event, webContents, details) => {
        logger.error('[app] renderer process gone:', {
            reason: details.reason,
            exitCode: details.exitCode,
            url: webContents.getURL(),
        })
    })

    app.on('child-process-gone', (_event, details) => {
        logger.error('[app] child process gone:', details)
    })

    app.on('gpu-process-crashed', (_event, killed) => {
        logger.error('[app] gpu process crashed:', { killed })
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
    app.whenReady().then(init)
}
