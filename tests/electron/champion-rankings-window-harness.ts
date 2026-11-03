import { app, BrowserWindow, ipcMain, session } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'

const root = process.env.ARAMGG_RANKINGS_SMOKE_ROOT!
const output = process.env.ARAMGG_RANKINGS_SMOKE_OUTPUT!
const dataDir = process.env.ARAMGG_RANKINGS_SMOKE_DATA!
assert(path.isAbsolute(root) && path.isAbsolute(output) && path.isAbsolute(dataDir))
app.setAppPath(root)
app.setPath('userData', dataDir)
app.setPath('sessionData', path.join(dataDir, 'session'))
const attemptedUrls: string[] = []
const offline = () => { throw new Error('Ranking window smoke: external network disabled') }
http.request = offline; http.get = offline; https.request = offline; https.get = offline
globalThis.fetch = async (url) => { attemptedUrls.push(String(url)); throw new Error('Ranking window smoke: external network disabled') }
syncBuiltinESMExports()
const ready = new Set<number>()
const failures: string[] = []
const checks: string[] = []
ipcMain.on('renderer-ready', (event) => { if (event.senderFrame === event.sender.mainFrame) ready.add(event.sender.id) })
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('preload-error', (_event, _preload, error) => failures.push(error.message))
  window.webContents.on('render-process-gone', (_event, details) => failures.push(`Renderer gone: ${details.reason}`))
})
async function run() {
  await app.whenReady()
  const server = http.createServer(async (request, response) => {
    if (request.url?.startsWith('/owner/')) {
      response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><title>Isolated owner</title><p>Isolated owner</p>'); return
    }
    const pathname = new URL(request.url || '/', 'http://localhost').pathname
    const file = path.resolve(root, 'dist', pathname.replace(/^\//, '') || 'index.html')
    if (!file.startsWith(path.join(root, 'dist') + path.sep)) { response.writeHead(404); response.end(); return }
    try {
      const contents = await fs.readFile(file)
      response.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' } as Record<string, string>)[path.extname(file)] || 'application/octet-stream' })
      response.end(contents)
    } catch { response.writeHead(404); response.end() }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  process.env.VITE_DEV_SERVER_URL = origin
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) && !details.url.startsWith(`${origin}/`) }))
  try {
    const version = '99.0.0'
    const champion = { id: 103, name: 'Smoke Ahri', alias: 'Ahri', title: 'Smoke Fox', stats: { tier: 1, winRate: 0.55, pickRate: 0.1, games: null, date: '2026-10-28', source: 'fixture', region: 'test' } }
    const write = async (file: string, data: unknown) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(data)) }
    const directory = path.join(dataDir, 'data', 'versions', version)
    await write(path.join(dataDir, 'data', 'current.json'), { locale: 'zh-CN', dataVersion: version })
    await write(path.join(directory, 'manifest.json'), { locale: 'zh-CN', dataVersion: version, files: ['champions.json', 'items.json', 'augments.json', 'champion-shards/index.json', 'champions/103.json'].map((p) => ({ path: p })) })
    await write(path.join(directory, 'champions.json'), { locale: 'zh-CN', dataVersion: version, data: [champion] })
    await write(path.join(directory, 'items.json'), { items: [] })
    await write(path.join(directory, 'augments.json'), { augments: [] })
    await write(path.join(directory, 'champion-shards/index.json'), { shards: [] })
    await write(path.join(directory, 'champions/103.json'), { champion, augments: [], builds: [] })
    const { configureAppPaths } = await import('../../src/main/modules/app-paths.ts')
    assert.equal(configureAppPaths(), dataDir)
    const { default: store } = await import('../../src/main/modules/app-store.ts')
    store.set('championInsight.showDetails', false)
    store.set('championInsight.hideOnGameStart', true)
    store.set('championInsight.alwaysOnTop', false)
    const manager = await import('../../src/main/modules/window-manager.ts')
    const { trustedIpcMain } = await import('../../src/main/security/trusted-ipc.ts')
    const { markRendererReady } = await import('../../src/main/modules/renderer-ready.ts')
    const { registerChampionRankingsIpcHandlers } = await import('../../src/main/ipc/champion-rankings-handlers.ts')
    const { getChampionDetailData } = await import('../../src/main/data-loader.ts')
    trustedIpcMain.on('renderer-ready', (event) => markRendererReady(event.sender))
    trustedIpcMain.handle('locale-get', () => ({ locale: 'zh-CN', supportedLocales: [] }))
    trustedIpcMain.handle('store-get', () => false)
    trustedIpcMain.handle('load-champion-data', async (_event, id) => {
      const detail = await getChampionDetailData(id)
      return { success: true, locale: detail.locale, dataVersion: detail.dataVersion, data: { stats: detail.stats, augments: detail.augmentBase, augmentStats: detail.augments, augmentTrios: detail.augmentTrios, builds: detail.builds, items: detail.items, championName: detail.championName } }
    })
    registerChampionRankingsIpcHandlers()
    const main = await manager.createMainWindow(true, `${origin}/owner`)
    main.webContents.closeDevTools()
    const rankings = await main.webContents.executeJavaScript('window.electronAPI.champions.getRankings()')
    assert.equal(rankings.success, true); assert.equal(rankings.data.champions[0].numGames, null)
    for (const id of [0, -1, 1.5, '103', 999]) {
      assert.equal((await main.webContents.executeJavaScript(`window.electronAPI.champions.openDetail(${JSON.stringify(id)})`)).success, false)
    }
    assert.equal(manager.getPopupWindow(), null)
    const open = () => main.webContents.executeJavaScript('window.electronAPI.champions.openDetail(103)')
    assert.equal((await open()).success, true)
    const popup = manager.getPopupWindow()!
    assert(popup && popup.isVisible(), 'Manual opening remains visible with automatic champion display disabled')
    assert(ready.has(popup.webContents.id), 'Real Vue readiness must precede payload delivery')
    await popup.webContents.executeJavaScript(`new Promise((resolve, reject) => { const started = Date.now(); const check = () => { if (document.querySelector('.champion-name')?.textContent?.includes('Smoke Ahri') && document.querySelector('.stat-strip strong')?.textContent?.includes('55')) return resolve(true); if (Date.now() - started > 5000) return reject(new Error('Hero content did not render')); setTimeout(check, 20) }; check() })`)
    const text = await popup.webContents.executeJavaScript('document.body.textContent')
    assert(text.includes('Smoke Ahri'))
    assert.equal(popup.isAlwaysOnTop(), false)
    const prefs = popup.webContents.getLastWebPreferences()
    assert(prefs.contextIsolation && prefs.sandbox && prefs.webSecurity && !prefs.nodeIntegration)
    await fs.writeFile(path.join(output, 'champion-detail.png'), (await popup.webContents.capturePage()).toPNG())
    const minimized = new Promise<void>((resolve) => popup.once('minimize', () => resolve()))
    popup.minimize()
    await minimized
    const restored = new Promise<void>((resolve) => popup.once('restore', () => resolve()))
    assert.equal((await open()).success, true)
    await restored
    assert.equal(popup.isMinimized(), false)
    assert.equal(manager.getPopupWindow(), popup)
    assert.equal(BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().endsWith('#/augment-overlay')).length, 1)
    checks.push('Real preload + trusted index/manual-open IPC + local hero detail + Vue readiness; automatic display disabled; same popup reused')
    const waitForHide = () => new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Native hide event did not arrive')), 5000)
      popup.once('hide', () => { clearTimeout(timeout); resolve() })
    })
    let hidden = waitForHide()
    manager.applyPopupWindowPreferences('GameStart')
    await hidden
    assert.equal(popup.isVisible(), false, 'A later game start still obeys the independent hide-on-game-start preference')
    assert.equal((await open()).success, true)
    assert(popup.isVisible(), 'An explicit click during the current game phase may reopen the popup')
    hidden = waitForHide()
    popup.hide()
    await hidden
    hidden = waitForHide()
    popup.show()
    await hidden
    assert.equal(popup.isVisible(), false, 'Hide clears the manual override; automatic show remains disabled')
    checks.push('Manual override cleared on hide; later game phase retains hide preference; explicit in-game reopen allowed; always-on-top preserved')
    const foreign = new BrowserWindow({ show: false, webPreferences: { ...prefs, preload: path.join(root, 'dist-electron/preload.cjs') } })
    await foreign.loadURL(`${origin}/owner/#/display`)
    assert.equal((await foreign.webContents.executeJavaScript('window.electronAPI.champions.openDetail(103)')).success, false)
    await foreign.loadURL('data:text/html,<p>Untrusted origin</p>')
    assert.equal(await foreign.webContents.executeJavaScript('window.electronAPI.champions.getRankings().then(() => false, () => true)'), true)
    foreign.destroy()
    assert.equal(await popup.webContents.executeJavaScript(`window.open('https://invalid.example') === null`), true)
    checks.push('Invalid/unknown IDs and non-main-window opening denied; untrusted-origin index denied; secure popup preferences and window.open denial')
    assert.ok(attemptedUrls.every((url) => /\/config(?:\?|$)/.test(url)), 'Only background config checks may attempt network')
    manager.allowMainWindowClose(); main.close()
  } catch (error) { failures.push(error instanceof Error ? error.stack || error.message : String(error)) }
  finally {
    server.close()
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: !failures.length, electronVersion: process.versions.electron, packaged: app.isPackaged, platform: process.platform, arch: process.arch, checks, failures }, null, 2))
    app.exit(failures.length ? 1 : 0)
  }
}
void run().catch(async (error) => { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: false, failures: [String(error)] }, null, 2)); app.exit(1) })
