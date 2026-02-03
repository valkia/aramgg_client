import { ipcRenderer, shell } from 'electron'
import fs from 'fs'
import fse from 'fs-extra'
import * as cheerio from 'cheerio'
import PromisePool from 'es6-promise-pool'
import log from './modules/logger.js'

log.info('Preload script loaded successfully')

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

log.info('window.electronStore exposed')

window.ipcRenderer = {
    send: (channel, data) => {
        // whitelist channels
        let validChannels = ['toMain', 'show-popup', 'hide-popup', 'hide-floating', 'toggle-main-window', 'restart-app', 'broadcast']
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data)
        }
    },
    on: (channel, func) => {
        let validChannels = [
            'fromMain',
            'for-popup',
            'screenshot-taken',
            'winrate-updated',
            'auto-screenshot-taken',
            'game-phase-changed',
            'game-started',
            'game-in-progress',
            'augment-detection-started',
            'augment-detected',
            'game-ended',
            'end-of-game'
        ]
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (event, ...args) => func(...args))
        }
    },
    once: (channel, func) => {
        let validChannels = [
            'fromMain',
            'for-popup',
            'screenshot-taken',
            'winrate-updated',
            'auto-screenshot-taken',
            'game-phase-changed',
            'game-started',
            'game-in-progress',
            'augment-detection-started',
            'augment-detected',
            'game-ended',
            'end-of-game'
        ]
        if (validChannels.includes(channel)) {
            ipcRenderer.once(channel, (event, ...args) => func(...args))
        }
    },
    invoke: (channel, ...args) => {
        log.info('ipcRenderer.invoke called:', channel, args)
        const validChannels = [
            'store-get',
            'store-set',
            'store-delete',
            'store-clear',
            'screenshot-capture',
            'analyze-screenshot',
            'get-winrate',
            'load-champion-data',
            'auto-screenshot-start',
            'auto-screenshot-stop',
            'auto-screenshot-set-config',
            'auto-screenshot-get-stats',
            'auto-screenshot-get-config',
            'select-lol-directory',
            'get-champion-id',
            'test-show-floating',
            'log-renderer-error'
        ]
        if (validChannels.includes(channel)) {
            return ipcRenderer.invoke(channel, ...args)
        }
        return Promise.reject(new Error(`Invalid channel: ${channel}`))
    }
}

log.info('window.ipcRenderer exposed')

// 为了方便，暴露 ipc 作为 ipcRenderer 的别名
window.ipc = window.ipcRenderer

log.info('Preload script initialization complete')