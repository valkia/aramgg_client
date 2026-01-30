const { ipcRenderer, shell } = require('electron')
const fs = require('fs')
const fse = require('fs-extra')
const cheerio = require('cheerio')
const PromisePool = require('es6-promise-pool').default || require('es6-promise-pool')

// When contextIsolation is false, we can directly attach to window
window.electron = {
    shell: shell
}

// Expose require for Node.js modules (since nodeIntegration is enabled)
// Note: We still expose require but prefer pre-loaded modules to avoid "no access" errors
window.require = require

// Expose fs and fs-extra
window.fs = fs
window.fse = fse

// Expose cheerio directly from preload (already loaded in Node context)
window.cheerio = cheerio

// Expose PromisePool
window.PromisePool = PromisePool

// Expose electron-store API through IPC
window.electronStore = {
    get: (key) => ipcRenderer.invoke('store-get', key),
    set: (key, value) => ipcRenderer.invoke('store-set', key, value),
    delete: (key) => ipcRenderer.invoke('store-delete', key),
    clear: () => ipcRenderer.invoke('store-clear')
}

window.ipcRenderer = {
    send: (channel, data) => {
        // whitelist channels
        let validChannels = ['toMain', 'show-popup', 'hide-popup', 'toggle-main-window', 'restart-app', 'broadcast']
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data)
        }
    },
    on: (channel, func) => {
        let validChannels = ['fromMain', 'for-popup', 'screenshot-taken', 'winrate-updated', 'auto-screenshot-taken']
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (event, ...args) => func(...args))
        }
    },
    once: (channel, func) => {
        let validChannels = ['fromMain', 'for-popup', 'screenshot-taken', 'winrate-updated', 'auto-screenshot-taken']
        if (validChannels.includes(channel)) {
            ipcRenderer.once(channel, (event, ...args) => func(...args))
        }
    },
    invoke: (channel, ...args) => {
        return ipcRenderer.invoke(channel, ...args)
    }
}

// 为了方便，暴露 ipc 作为 ipcRenderer 的别名
window.ipc = window.ipcRenderer