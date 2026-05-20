import { contextBridge, ipcRenderer, shell } from 'electron'

const validEvents = new Set([
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
    'augment-cleared',
    'game-ended',
    'end-of-game',
])

const on = (channel, callback) => {
    if (!validEvents.has(channel)) {
        throw new Error(`Invalid event channel: ${channel}`)
    }

    const handler = (_event, ...args) => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
}

const once = (channel, callback) => {
    if (!validEvents.has(channel)) {
        throw new Error(`Invalid event channel: ${channel}`)
    }

    const handler = (_event, ...args) => callback(...args)
    ipcRenderer.once(channel, handler)
}

const electronAPI = {
    store: {
        get: (key) => ipcRenderer.invoke('store-get', key),
        set: (key, value) => ipcRenderer.invoke('store-set', key, value),
        delete: (key) => ipcRenderer.invoke('store-delete', key),
        clear: () => ipcRenderer.invoke('store-clear'),
    },
    windows: {
        showPopup: (data) => ipcRenderer.send('show-popup', data),
        hidePopup: () => ipcRenderer.send('hide-popup'),
        hideFloating: () => ipcRenderer.send('hide-floating'),
        toggleMain: () => ipcRenderer.send('toggle-main-window'),
        confirmQuit: () => ipcRenderer.invoke('confirm-quit-app'),
        restart: () => ipcRenderer.send('restart-app'),
    },
    appInfo: {
        getVersionInfo: () => ipcRenderer.invoke('get-version-info'),
    },
    screenshot: {
        capture: () => ipcRenderer.invoke('screenshot-capture'),
        analyze: (imagePathOrBuffer) => ipcRenderer.invoke('analyze-screenshot', imagePathOrBuffer),
    },
    winrate: {
        get: (data) => ipcRenderer.invoke('get-winrate', data),
        loadChampionData: (championId) => ipcRenderer.invoke('load-champion-data', championId),
    },
    autoScreenshot: {
        start: (config) => ipcRenderer.invoke('auto-screenshot-start', config),
        stop: () => ipcRenderer.invoke('auto-screenshot-stop'),
        setConfig: (config) => ipcRenderer.invoke('auto-screenshot-set-config', config),
        getStats: () => ipcRenderer.invoke('auto-screenshot-get-stats'),
        getConfig: () => ipcRenderer.invoke('auto-screenshot-get-config'),
    },
    dialogs: {
        selectLolDirectory: () => ipcRenderer.invoke('select-lol-directory'),
    },
    lcu: {
        getChampionId: () => ipcRenderer.invoke('get-champion-id'),
        getStatus: () => ipcRenderer.invoke('lcu-get-status'),
        getCurrentSession: () => ipcRenderer.invoke('lcu-get-current-session'),
        getPerkList: () => ipcRenderer.invoke('lcu-get-perk-list'),
        applyPerk: (data) => ipcRenderer.invoke('lcu-apply-perk', data),
        getGameflowPhase: () => ipcRenderer.invoke('lcu-get-gameflow-phase'),
    },
    diagnostics: {
        testShowFloating: (data) => ipcRenderer.invoke('test-show-floating', data),
        logRendererError: (errorData) => ipcRenderer.invoke('log-renderer-error', errorData),
        testDatabaseLoad: () => ipcRenderer.invoke('test-database-load'),
    },
    shell: {
        openExternal: (url) => {
            const parsedUrl = new URL(url)
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                throw new Error(`Unsupported external URL protocol: ${parsedUrl.protocol}`)
            }
            return shell.openExternal(parsedUrl.toString())
        },
    },
    events: {
        on,
        once,
    },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
