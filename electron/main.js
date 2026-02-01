import { app } from 'electron'
import { init } from './modules/app-config.js'

// 解决提示ERR_CERT_AUTHORITY_INVALID的问题
app.commandLine.appendSwitch('ignore-certificate-errors', 'true')
app.commandLine.appendSwitch('ignore-connections-limit', 'op.gg')

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.

app.whenReady().then(init)

// Quit when all windows are closed.
app.on('window-all-closed', function () {
    console.log('All windows closed, quitting app...')
    app.quit()
})

// When the app is activated (macOS)
app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
        const { createMainWindow } = require('./modules/window-manager.js')
        createMainWindow(process.env.NODE_ENV === 'development', 'http://localhost:5173')
    }
})