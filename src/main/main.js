import { app, BrowserWindow } from 'electron'
import { configureAppPaths } from './modules/app-paths.js'

configureAppPaths()

const [{ init }, { createMainWindow }, { default: logger }] = await Promise.all([
    import('./modules/app-config.js'),
    import('./modules/window-manager.js'),
    import('./modules/logger.js'),
])

// 解决提示ERR_CERT_AUTHORITY_INVALID的问题
app.commandLine.appendSwitch('ignore-certificate-errors', 'true')
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

    // 记录应用启动
    logger.info('应用启动 - 主进程错误监听已设置')
}

// 设置主进程错误处理
setupMainProcessErrorHandling()

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.

app.whenReady().then(init)

// Quit when all windows are closed.
app.on('window-all-closed', function () {
    logger.info('所有窗口已关闭，正在退出应用...')
    app.quit()
})

// When the app is activated (macOS)
app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow(process.env.NODE_ENV === 'development', 'http://localhost:5173')
    }
})
