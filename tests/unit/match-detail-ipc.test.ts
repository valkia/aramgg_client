import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MatchDetailContext } from '../../src/main/services/match-history/match-detail-snapshots.ts'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(), owners: new Map<any, any>(), snapshots: new Map<any, any>(),
  main: { webContents: { getURL: () => 'http://localhost:5173/#/display' } },
  locale: 'zh-CN', context: { accountKey: 'account-a', platformId: 'HN1', locale: 'zh-CN' } as MatchDetailContext,
  query: vi.fn(), open: vi.fn(), close: vi.fn(), notify: vi.fn(), prepare: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: any) => mocks.handlers.set(channel, handler) },
  BrowserWindow: { fromWebContents: (sender: any) => mocks.owners.get(sender) },
}))
vi.mock('../../src/main/modules/logger.ts', () => ({ default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() } }))
vi.mock('../../src/main/data-loader.ts', () => ({
  getDataLocale: () => mocks.locale,
  DEFAULT_DATA_LOCALE: 'zh-CN', SUPPORTED_DATA_LOCALES: [],
  normalizeDataLocale: (locale: unknown) => locale,
  prepareDataLocale: mocks.prepare,
  setDataLocale: (locale: string) => { mocks.locale = locale },
}))
vi.mock('../../src/main/modules/app-store.ts', () => ({ default: { get: () => undefined, set: vi.fn() } }))
vi.mock('../../src/main/services/lcu/lcu-service.ts', () => ({ getLCUServiceInstance: () => ({}) }))
vi.mock('../../src/main/services/match-history/local-match-history-service.ts', () => ({ getLocalMatchHistoryService: vi.fn() }))
vi.mock('../../src/main/services/match-history/hextech-aram-query-service.ts', () => ({ getHextechAramQueryService: () => ({ getCurrentContext: async () => ({ ...mocks.context }), queryCurrentWithContext: mocks.query }) }))
vi.mock('../../src/main/modules/window-manager.ts', () => ({
  getMainWindow: () => mocks.main,
  openMatchDetailWindow: mocks.open,
  getOwnedMatchDetailSnapshot: (sender: any) => mocks.snapshots.get(sender),
  closeMatchDetailWindows: () => { mocks.close(); mocks.snapshots.clear() },
  applyPopupWindowPreferences: vi.fn(), notifyAllWindows: mocks.notify,
}))

const page = { platformId: 'HN1', playerName: 'One', queriedAt: 1000, matches: [{ gameId: 1 }] }
function event(sender: any = mocks.main.webContents, url = sender.getURL()) {
  const frame = { url } as any
  frame.top = frame
  return { sender, senderFrame: frame }
}
function invoke(channel: string, sender = event(), payload?: unknown) { return mocks.handlers.get(channel)!(sender, payload) }
beforeEach(async () => {
  vi.resetModules()
  mocks.handlers.clear(); mocks.owners.clear(); mocks.snapshots.clear()
  mocks.locale = 'zh-CN'; mocks.context = { accountKey: 'account-a', platformId: 'HN1', locale: 'zh-CN' }
  mocks.query.mockReset(); mocks.open.mockReset(); mocks.close.mockReset()
  mocks.notify.mockReset(); mocks.prepare.mockReset()
  mocks.prepare.mockImplementation(async (locale: string) => ({ locale, dataVersion: 'smoke-local' }))
  mocks.query.mockImplementation(async () => ({ page, context: { ...mocks.context } }))
  mocks.owners.set(mocks.main.webContents, { isDestroyed: () => false })
  const { registerTrustedRendererOrigin } = await import('../../src/main/security/renderer-origin.ts')
  registerTrustedRendererOrigin('http://localhost:5173')
  const { registerMatchHistoryIpcHandlers } = await import('../../src/main/services/match-history/ipc-handlers.ts')
  registerMatchHistoryIpcHandlers()
})

describe('match detail trusted IPC and ownership', () => {
  it('accepts main-window selections from the last query, leaves its snapshot intact on query failure', async () => {
    const result = await invoke('match-history-query-current')
    const selection = { snapshotId: result.data.snapshotId, gameId: 1 }
    mocks.query.mockRejectedValueOnce(new Error('offline'))
    expect((await invoke('match-history-query-current')).success).toBe(false)
    expect(await invoke('match-history-open-detail', event(), selection)).toEqual({ success: true })
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ accountKey: 'account-a', data: expect.objectContaining({ match: { gameId: 1 } }) }))
    expect((await invoke('match-history-open-detail', event(), { ...selection, url: 'https://evil.test' })).success).toBe(false)
  })

  it('rejects child frames, remote origins, destroyed/unowned senders and non-main application windows', async () => {
    const remote = event(mocks.main.webContents, 'https://evil.test')
    const child = event(); child.senderFrame.top = {}
    const detached = event({ getURL: () => 'http://localhost:5173/#/display' })
    for (const invalid of [remote, child, detached]) {
      for (const channel of ['match-history-query-current', 'match-history-open-detail', 'match-history-get-detail-snapshot']) {
        await expect(async () => invoke(channel, invalid)).rejects.toThrow()
      }
    }
    mocks.owners.set(mocks.main.webContents, { isDestroyed: () => true })
    await expect(async () => invoke('match-history-query-current')).rejects.toThrow('owned')
    const other = { getURL: () => 'http://localhost:5173/#/match-detail' }
    mocks.owners.set(other, { isDestroyed: () => false })
    for (const channel of ['match-history-query-current', 'match-history-open-detail']) {
      await expect(async () => invoke(channel, event(other))).rejects.toThrow('Only the main window')
    }
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('returns only the invoking detail window snapshot and denies guessed IDs/foreign windows', async () => {
    const detail = { getURL: () => 'http://localhost:5173/#/match-detail' }
    const foreign = { getURL: () => 'http://localhost:5173/#/match-detail' }
    for (const sender of [detail, foreign]) mocks.owners.set(sender, { isDestroyed: () => false })
    mocks.snapshots.set(detail, { accountKey: 'account-a', data: { match: { gameId: 7 }, platformId: 'HN1', locale: 'zh-CN' } })
    const own = await invoke('match-history-get-detail-snapshot', event(detail), { gameId: 99, windowId: 1 })
    expect(own.data.match.gameId).toBe(7)
    own.data.match.gameId = 999
    expect(mocks.snapshots.get(detail).data.match.gameId).toBe(7)
    await expect(async () => invoke('match-history-get-detail-snapshot', event(foreign), { gameId: 7 })).rejects.toThrow('does not own')
    await expect(async () => invoke('match-history-get-detail-snapshot', event(), { gameId: 7 })).rejects.toThrow('does not own')
  })

  it('invalidates account changes before a new window can be opened', async () => {
    const result = await invoke('match-history-query-current')
    mocks.context = { ...mocks.context, accountKey: 'account-b' }
    expect((await invoke('match-history-open-detail', event(), { snapshotId: result.data.snapshotId, gameId: 1 })).success).toBe(false)
    expect(mocks.close).toHaveBeenCalledOnce()
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('does not register slow old-language queries after a committed language reset', async () => {
    let finish!: (value: any) => void
    mocks.query.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const pending = invoke('match-history-query-current')
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalled())
    const { matchDetailSnapshots } = await import('../../src/main/services/match-history/match-detail-snapshots.ts')
    matchDetailSnapshots.clear()
    mocks.locale = 'en-US'; mocks.context = { ...mocks.context, locale: 'en-US' }
    finish({ page, context: { ...mocks.context, locale: 'zh-CN' } })
    expect((await pending).success).toBe(false)
    const fresh = await invoke('match-history-query-current')
    expect(fresh.data.locale).toBe('en-US')
  })

  it('invalidates snapshots and closes detail windows only after a language preparation commits', async () => {
    const { registerPreferencesIpcHandlers } = await import('../../src/main/ipc/preferences-handlers.ts')
    registerPreferencesIpcHandlers()
    await invoke('locale-get')
    const result = await invoke('match-history-query-current')
    mocks.snapshots.set({}, {})
    mocks.prepare.mockRejectedValueOnce(new Error('unavailable'))
    await expect(invoke('locale-set', event(), 'en-US')).rejects.toThrow('unavailable')
    expect(mocks.close).not.toHaveBeenCalled()
    expect((await invoke('match-history-open-detail', event(), { snapshotId: result.data.snapshotId, gameId: 1 })).success).toBe(true)
    await invoke('locale-set', event(), 'en-US')
    expect(mocks.close).toHaveBeenCalledOnce()
    expect(mocks.snapshots.size).toBe(0)
    expect(mocks.notify).toHaveBeenCalledWith('locale-changed', { locale: 'en-US', dataVersion: 'smoke-local' })
    mocks.context = { ...mocks.context, locale: 'en-US' }
    expect((await invoke('match-history-open-detail', event(), { snapshotId: result.data.snapshotId, gameId: 1 })).success).toBe(false)
  })

  it.each([true, false])('does not reactivate an old-account query after a newer account has queried (existing page: %s)', async (seed) => {
    let finish!: (value: any) => void
    const oldContext = { ...mocks.context }
    if (seed) await invoke('match-history-query-current')
    mocks.query.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const pending = invoke('match-history-query-current')
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(seed ? 2 : 1))
    mocks.context = { ...mocks.context, accountKey: 'account-b' }
    const fresh = await invoke('match-history-query-current')
    finish({ page, context: oldContext })
    expect((await pending).success).toBe(false)
    expect((await invoke('match-history-open-detail', event(), { snapshotId: fresh.data.snapshotId, gameId: 1 })).success).toBe(true)
  })
})
