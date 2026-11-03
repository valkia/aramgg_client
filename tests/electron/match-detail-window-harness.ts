import { app, BrowserWindow, ipcMain, session } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'

const root = process.env.ARAMGG_MATCH_DETAIL_SMOKE_ROOT!
const output = process.env.ARAMGG_MATCH_DETAIL_SMOKE_OUTPUT!
const dataDir = process.env.ARAMGG_MATCH_DETAIL_SMOKE_DATA!
assert(path.isAbsolute(root) && path.isAbsolute(output) && path.isAbsolute(dataDir))
app.setAppPath(root)
app.setPath('userData', dataDir)
app.setPath('sessionData', path.join(dataDir, 'session'))
// No application startup/background services, real LCU discovery, user data, or remote traffic.
const offline = () => { throw new Error('Match detail smoke: external network disabled') }
http.request = offline
http.get = offline
https.request = offline
https.get = offline
globalThis.fetch = async () => { throw new Error('Match detail smoke: external network disabled') }
syncBuiltinESMExports()
const failures: string[] = []
const ready = new Set<number>()
const checks: string[] = []
ipcMain.on('renderer-ready', (event) => { if (event.senderFrame === event.sender.mainFrame) ready.add(event.sender.id) })
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('preload-error', (_event, _preload, error) => failures.push(error.message))
  window.webContents.on('render-process-gone', (_event, details) => failures.push(`Renderer gone: ${details.reason}`))
})

// Do not top-level await app.whenReady(): Electron emits ready after its ESM entry finishes evaluating.
async function run() {
await app.whenReady()
const server = http.createServer(async (request, response) => {
  if (request.url?.startsWith('/owner/')) {
    response.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'; script-src 'self'; object-src 'none'" })
    response.end('<!doctype html><title>Isolated IPC owner</title><p>Isolated IPC owner</p>')
    return
  }
  const pathname = new URL(request.url || '/', 'http://localhost').pathname
  const file = path.resolve(root, 'dist', pathname.replace(/^\//, '') || 'index.html')
  if (!file.startsWith(path.join(root, 'dist') + path.sep)) { response.writeHead(404); response.end(); return }
  try {
    const contents = await fs.readFile(file)
    const extension = path.extname(file)
    response.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' } as Record<string, string>)[extension] || 'application/octet-stream' })
    response.end(contents)
  } catch { response.writeHead(404); response.end() }
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address() as { port: number }
const origin = `http://127.0.0.1:${address.port}`
process.env.VITE_DEV_SERVER_URL = origin
session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) && !details.url.startsWith(`${origin}/`) }))

try {
  const { configureAppPaths } = await import('../../src/main/modules/app-paths.ts')
  assert.equal(configureAppPaths(), dataDir)
  const manager = await import('../../src/main/modules/window-manager.ts')
  const { markRendererReady } = await import('../../src/main/modules/renderer-ready.ts')
  const { trustedIpcMain } = await import('../../src/main/security/trusted-ipc.ts')
  const { getLCUServiceInstance } = await import('../../src/main/services/lcu/lcu-service.ts')
  const { SgpMatchHistoryService } = await import('../../src/main/services/match-history/sgp-match-history-service.ts')
  const { getHextechAramQueryService } = await import('../../src/main/services/match-history/hextech-aram-query-service.ts')
  const { registerMatchHistoryIpcHandlers } = await import('../../src/main/services/match-history/ipc-handlers.ts')
  const { matchDetailSnapshots } = await import('../../src/main/services/match-history/match-detail-snapshots.ts')
  const puuid = '11111111-1111-1111-1111-111111111111'
  let accountPuuid = puuid
  let requests = 0
  const lcu = getLCUServiceInstance()
  lcu.getAuthToken = async () => { throw new Error('Real LCU discovery must not run') }
  lcu.getCurrentSummoner = async () => ({ puuid: accountPuuid, platformId: 'HN1', gameName: 'Smoke One' })
  SgpMatchHistoryService.prototype.getHextechAramSummaries = async () => {
    requests += 1
    return [{
      gameId: 123, gameCreation: 1000, gameDuration: 900, gameVersion: '16.21', gameMode: 'KIWI', queueId: 2400,
      participants: Array.from({ length: 10 }, (_, index) => ({
        participantId: index + 1, teamId: index < 5 ? 100 : 200, puuid: index === 0 ? puuid : `smoke-player-${index}`,
        riotIdGameName: `Smoke Player ${index + 1}`, championId: 103, win: index < 5,
        kills: 2, deaths: 1, assists: 4, totalDamageDealtToChampions: 1000, totalDamageTaken: 500,
        totalHeal: 200, damageDealtToTurrets: 250, goldEarned: 5000, totalMinionsKilled: 30, neutralMinionsKilled: 5, summoner1Id: 4, summoner2Id: 32,
      })),
    }]
  }
  // Local synthetic asset dictionary; no real user/cache or seasonal data is needed by this window test.
  Object.assign(getHextechAramQueryService(lcu), { loadLabels: async () => ({ champions: new Map([[103, { name: 'Smoke Ahri' }]]) }) })
  trustedIpcMain.on('renderer-ready', (event) => markRendererReady(event.sender))
  trustedIpcMain.handle('locale-get', () => ({ locale: 'zh-CN', supportedLocales: [] }))
  registerMatchHistoryIpcHandlers()
  const main = await manager.createMainWindow(true, `${origin}/owner`)
  main.webContents.closeDevTools()
  const query = await main.webContents.executeJavaScript('window.electronAPI.matchHistory.queryCurrent()')
  assert.equal(query.success, true)
  assert.equal(query.data.matches[0].participants.length, 10)
  const selection = { snapshotId: query.data.snapshotId, gameId: 123 }
  const open = () => main.webContents.executeJavaScript(`window.electronAPI.matchHistory.openDetail(${JSON.stringify(selection)})`)
  const results = await Promise.all([open(), open()])
  assert(results.every((result) => result.success))
  let details = BrowserWindow.getAllWindows().filter((window) => window.webContents.getURL().endsWith('#/match-detail'))
  assert.equal(details.length, 1)
  const detail = details[0]
  const contents = detail.webContents
  assert(ready.has(contents.id), 'Real Vue renderer-ready must be observed')
  assert(detail.isVisible())
  const rendered = await contents.executeJavaScript(`({ players: document.querySelectorAll('.scoreboard-player').length, loading: !!document.querySelector('[role="status"]'), text: document.body.textContent, overflow: document.documentElement.scrollWidth > innerWidth })`)
  assert.equal(rendered.players, 10)
  assert.equal(rendered.loading, false)
  assert.equal(rendered.overflow, false)
  assert(rendered.text.includes('Smoke Ahri'))
  await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await fs.writeFile(path.join(output, 'match-detail.png'), (await contents.capturePage()).toPNG())
  checks.push('Real preload + trusted IPC + query DTO + Vue mount/readiness + concurrent open deduplication')
  detail.minimize()
  assert.equal((await open()).success, true)
  assert.equal(detail.isMinimized(), false)
  assert.equal(BrowserWindow.getAllWindows().filter((window) => window.webContents.getURL().endsWith('#/match-detail')).length, 1)
  const bounds = detail.getBounds()
  const area = (await import('electron')).screen.getDisplayMatching(bounds).workArea
  assert(bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height)
  const preferences = contents.getLastWebPreferences()
  assert(preferences.contextIsolation && preferences.sandbox && preferences.webSecurity && !preferences.nodeIntegration)
  assert.equal(await contents.executeJavaScript(`window.open('https://invalid.example') === null`), true)
  checks.push('Work-area bounds, sandbox/context isolation/web security, blocked window.open and repeat focus')
  assert.equal(await main.webContents.executeJavaScript(`window.electronAPI.matchHistory.getDetailSnapshot().then(() => false, () => true)`), true)
  const foreign = new BrowserWindow({ show: false, webPreferences: { ...preferences, preload: path.join(root, 'dist-electron/preload.cjs') } })
  await foreign.loadURL(`${origin}/owner/#/match-detail`)
  assert.equal(await foreign.webContents.executeJavaScript(`window.electronAPI.matchHistory.getDetailSnapshot().then(() => false, () => true)`), true)
  await foreign.loadURL('data:text/html,<p>Untrusted origin</p>')
  assert.equal(await foreign.webContents.executeJavaScript(`window.electronAPI.matchHistory.openDetail(${JSON.stringify(selection)}).then(() => false, () => true)`), true)
  foreign.destroy()
  checks.push('Main/foreign-window snapshot denial and remote/unregistered-origin IPC denial')
  // A newly queried page replaces selection capability but leaves an open snapshot readable.
  await main.webContents.executeJavaScript('window.electronAPI.matchHistory.queryCurrent()')
  assert.equal((await contents.executeJavaScript('window.electronAPI.matchHistory.getDetailSnapshot()')).success, true)
  assert.equal((await open()).success, false)
  accountPuuid = '22222222-2222-2222-2222-222222222222'
  assert.equal((await open()).success, false)
  assert(detail.isDestroyed())
  assert.equal(manager.getOwnedMatchDetailSnapshot(contents), undefined)
  checks.push('Latest-page replacement, pinned read, account-switch invalidation and ownership cleanup')
  accountPuuid = puuid
  const fresh = await main.webContents.executeJavaScript('window.electronAPI.matchHistory.queryCurrent()')
  const freshOpen = `window.electronAPI.matchHistory.openDetail(${JSON.stringify({ snapshotId: fresh.data.snapshotId, gameId: 123 })})`
  assert.equal((await main.webContents.executeJavaScript(freshOpen)).success, true)
  details = BrowserWindow.getAllWindows().filter((window) => window.webContents.getURL().endsWith('#/match-detail'))
  manager.allowMainWindowClose()
  main.close()
  assert(details.every((window) => window.isDestroyed()))
  matchDetailSnapshots.clear()
  checks.push('Reopen after invalidation and main-window/app shutdown cleanup')
  assert.equal(requests, 3, 'Opening details must not fetch additional SGP matches')
} catch (error) {
  failures.push(error instanceof Error ? error.stack || error.message : String(error))
} finally {
  server.close()
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: !failures.length, electronVersion: process.versions.electron, packaged: app.isPackaged, platform: process.platform, arch: process.arch, checks, failures }, null, 2))
  app.exit(failures.length ? 1 : 0)
}
}
void run().catch(async (error) => {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: false, failures: [String(error)] }, null, 2))
  app.exit(1)
})
