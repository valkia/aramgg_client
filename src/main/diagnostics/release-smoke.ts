import { app, BrowserWindow, ipcMain, session } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'

const ROUTES = ['/display', '/augment-overlay', '/floating-overlay', '/augment-side-panel']
const OFFLINE_ERROR = 'Release smoke: external network disabled'

/** Observe the real packaged startup; never synthesize renderer-ready or replace IPC. */
export function createReleaseSmoke() {
    const outputDir = process.env.ARAMGG_RELEASE_SMOKE_OUTPUT
    const dataDir = process.env.ARAMGG_RELEASE_SMOKE_DATA_DIR
    if (!outputDir || !path.isAbsolute(outputDir)) throw new Error('Smoke output must be an absolute path')
    if (!dataDir || !path.isAbsolute(dataDir)) throw new Error('Smoke data must be an absolute path')
    if (!app.isPackaged) throw new Error('Release smoke requires a packaged application')
    app.setPath('userData', dataDir)
    process.env.ARAMGG_ANALYTICS_ENABLED = 'false'

    // No remote data dependency or accidental production traffic in acceptance tests.
    const denyRequest = () => { throw new Error(OFFLINE_ERROR) }
    http.request = denyRequest
    http.get = denyRequest
    https.request = denyRequest
    https.get = denyRequest
    globalThis.fetch = async () => { throw new Error(OFFLINE_ERROR) }
    syncBuiltinESMExports()

    const startedAt = Date.now()
    const ready = new Set<number>()
    const failures: string[] = []
    const windows: BrowserWindow[] = []
    const fail = (message: string) => { failures.push(message) }
    ipcMain.on('renderer-ready', (event) => {
        if (event.senderFrame === event.sender.mainFrame) ready.add(event.sender.id)
    })
    app.on('browser-window-created', (_event, window) => {
        windows.push(window)
        const contents = window.webContents
        contents.on('preload-error', (_event, preload, error) => fail(`Preload ${preload}: ${error.message}`))
        contents.on('render-process-gone', (_event, details) => fail(`Renderer crashed: ${details.reason}`))
        contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
            if (isMainFrame) fail(`Page load ${url}: ${code} ${description}`)
        })
        contents.on('console-message', (details) => {
            if (details.level === 'error' && !details.message.includes(OFFLINE_ERROR) &&
                !details.message.includes('net::ERR_BLOCKED_BY_CLIENT')) {
                fail(`Renderer ${contents.getURL()}: ${details.message}`)
            }
        })
    })
    process.on('uncaughtException', (error) => fail(`Uncaught exception: ${error.stack || error.message}`))
    process.on('unhandledRejection', (error) => fail(`Unhandled rejection: ${String(error)}`))

    return {
        async run(initialize: () => Promise<unknown>) {
            const snapshots: unknown[] = []
            let timeout: ReturnType<typeof setTimeout> | undefined
            await fs.mkdir(outputDir, { recursive: true })
            session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
                const url = new URL(details.url)
                callback({ cancel: url.protocol.startsWith('http') && url.hostname !== '127.0.0.1' })
            })
            try {
                await Promise.race([
                    (async () => {
                        const { default: store } = await import('../modules/app-store.ts')
                        store.set('itemSets.autoApplyAram', false)
                        await initialize()
                        while (ready.size < ROUTES.length) {
                            if (failures.length) throw new Error(failures.join('\n'))
                            await new Promise((resolve) => setTimeout(resolve, 50))
                        }
                        const main = windows.find((window) => !window.isDestroyed() &&
                            new URL(window.webContents.getURL()).hash === '#/display')
                        if (!main) throw new Error('Main window missing')
                        const preview = {
                            championId: 1, championName: 'Smoke champion', dataSource: 'test',
                            augments: [1, 2, 3].map((id) => ({
                                id, augmentId: id, name: `Smoke augment ${id}`, detectedSlot: id - 1,
                                winRate: 0.55, pickRate: 0.2, recommendScore: 0.6, rarity: 'silver',
                            })),
                        }
                        const shown = await main.webContents.executeJavaScript(`(async () => {
                            const payload = ${JSON.stringify(preview)};
                            window.electronAPI.windows.showPopup(payload);
                            return window.electronAPI.diagnostics.testShowFloating(payload);
                        })()`)
                        if (!shown?.success || shown.skipped) throw new Error('Overlay diagnostic invocation failed')
                        // Auxiliary windows intentionally have no text until given an event payload.
                        await new Promise((resolve) => setTimeout(resolve, 500))
                        for (const route of ROUTES) {
                            const window = windows.find((candidate) => !candidate.isDestroyed() &&
                                new URL(candidate.webContents.getURL()).hash === `#${route}`)
                            if (!window || !ready.has(window.webContents.id)) throw new Error(`Window not ready: ${route}`)
                            // A real invoke must cross the packaged preload and registered main handler.
                            const snapshot = await window.webContents.executeJavaScript(`(async () => ({
                                route: location.hash,
                                mounted: !!document.querySelector('#app[data-v-app]'),
                                elements: document.querySelector('#app')?.childElementCount || 0,
                                text: (document.querySelector('#app')?.textContent || '').trim().slice(0, 160),
                                monitor: await window.electronAPI.lcu.getChampionMonitorState(),
                                locale: await window.electronAPI.locale.get()
                            }))()`)
                            if (!snapshot.mounted || !snapshot.elements || snapshot.text.length < 3 ||
                                typeof snapshot.monitor?.revision !== 'number' || !snapshot.locale?.locale) {
                                throw new Error(`Invalid mounted window: ${route} ${JSON.stringify(snapshot)}`)
                            }
                            if (!window.isVisible()) throw new Error(`Window cannot be shown: ${route}`)
                            if (route === '/floating-overlay' && !snapshot.text.includes('Smoke augment')) {
                                throw new Error('Floating window did not render the diagnostic payload')
                            }
                            const screenshot = await window.webContents.capturePage()
                            if (screenshot.isEmpty()) throw new Error(`Empty screenshot: ${route}`)
                            await fs.writeFile(path.join(outputDir, `${route.slice(1)}.png`), screenshot.toPNG())
                            snapshots.push(snapshot)
                        }
                        // Include delayed mount effects, not just the first IPC notification.
                        await new Promise((resolve) => setTimeout(resolve, 1000))
                        if (failures.length) throw new Error(failures.join('\n'))
                    })(),
                    new Promise((_, reject) => {
                        timeout = setTimeout(() => reject(new Error('Packaged startup exceeded 45 seconds')), 45000)
                    }),
                ])
            } catch (error) {
                fail(error instanceof Error ? error.stack || error.message : String(error))
            } finally {
                clearTimeout(timeout)
                await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify({
                    passed: failures.length === 0, packaged: app.isPackaged,
                    version: app.getVersion(), platform: process.platform,
                    durationMs: Date.now() - startedAt, readyCount: ready.size,
                    windows: snapshots, failures,
                }, null, 2))
                app.exit(failures.length ? 1 : 0)
            }
        },
    }
}
