import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  write: vi.fn(),
  phase: vi.fn(),
  snapshot: vi.fn(),
  subscribe: vi.fn(),
  createMain: vi.fn(),
  ensurePopup: vi.fn(),
  ensureFloating: vi.fn(),
  ensureSidePanel: vi.fn(),
  notify: vi.fn(),
  applyPopupPreferences: vi.fn(),
  logError: vi.fn(),
  popup: { show: vi.fn(), isVisible: () => false, isDestroyed: () => false, webContents: { send: vi.fn() } },
}))
vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => 'test', on: vi.fn(), quit: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  globalShortcut: { unregisterAll: vi.fn() },
  Menu: { setApplicationMenu: vi.fn() },
}))
vi.mock('../../src/main/modules/logger.ts', () => ({ default: {
  info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: mocks.logError,
  getCurrentLogFile: () => '/tmp/isolated-monitor-test.log', cleanupOldLogs: vi.fn(),
} }))
vi.mock('../../src/main/modules/app-store.ts', () => ({ default: {
  get: (key: string) => mocks.store.get(key), set: mocks.write,
} }))
vi.mock('../../src/main/modules/window-manager.ts', () => ({
  createMainWindow: mocks.createMain,
  ensurePopupWindow: mocks.ensurePopup,
  ensureFloatingWindow: mocks.ensureFloating,
  ensureAugmentSidePanelWindow: mocks.ensureSidePanel,
  getPopupWindow: () => null, getFloatingWindow: () => null, getAugmentSidePanelWindow: () => null,
  toggleMainWindow: vi.fn(), applyPopupWindowLayout: vi.fn(), applyPopupWindowPreferences: mocks.applyPopupPreferences,
  notifyAllWindows: mocks.notify,
}))
vi.mock('../../src/main/screenshot.ts', () => ({ getLolGameStatus: async () => ({ isGameOpen: false }) }))
vi.mock('../../src/main/modules/ipc-handlers.ts', () => ({ registerIpcHandlers: vi.fn() }))
vi.mock('../../src/main/auto-screenshot-service.ts', () => ({ default: {
  isRunning: false, setGameflowPhase: vi.fn(), clearAugmentState: vi.fn(),
  setConfig: vi.fn(), start: vi.fn(async () => true),
} }))
vi.mock('../../src/main/services/lcu/lcu-service.ts', () => ({ getLCUServiceInstance: () => ({
  getAuthToken: async () => ({ url: 'https://127.0.0.1:2999' }),
  getUrl: () => 'https://127.0.0.1:2999', isActive: () => true,
  getGameflowPhase: mocks.phase, getChampSelectSnapshot: mocks.snapshot,
  subscribeGameflowPhase: mocks.subscribe,
}) }))
vi.mock('../../src/main/services/match-history/background-sync.ts', () => ({
  requestLocalMatchHistoryBackgroundSync: vi.fn(), startLocalMatchHistoryBackgroundSync: vi.fn(), stopLocalMatchHistoryBackgroundSync: vi.fn(),
}))
vi.mock('../../src/main/version-checker.ts', () => ({ checkForClientUpdate: vi.fn(async () => {}) }))
vi.mock('../../src/main/app-update-service.ts', () => ({
  initializeAppUpdateService: vi.fn(), setAppUpdateInstallCleanup: vi.fn(),
  refreshAppUpdateConfig: vi.fn(async () => {}), checkForAppUpdate: vi.fn(async () => {}),
  setAppUpdateGamePhase: vi.fn(),
}))
vi.mock('../../src/main/services/analytics-service.ts', () => ({ initAnalyticsService: vi.fn(async () => {}) }))
vi.mock('../../src/main/services/aram/bench-recommendation.ts', () => ({
  collectAramCandidateChampionIds: () => [], getAramBenchRecommendation: () => ({}),
}))
vi.mock('../../src/main/services/post-game-share.ts', () => ({
  resetPostGameShareSnapshot: vi.fn(), capturePostGameShareSnapshot: vi.fn(async () => {}),
  preparePostGameSharePosterData: vi.fn(async () => ({ data: { status: 'unavailable' } })),
}))
vi.mock('../../src/main/modules/app-paths.ts', () => ({ getAppDataDir: () => '/tmp/isolated-monitor-test' }))
vi.mock('../../src/main/modules/diagnostic-logger.ts', () => ({ logDiagnosticSnapshot: vi.fn(async () => {}) }))
vi.mock('../../src/main/modules/performance-monitor.ts', () => ({ startPerformanceMonitor: vi.fn() }))
vi.mock('../../src/main/modules/tray.ts', () => ({ createAppTray: vi.fn() }))
vi.mock('../../src/main/modules/user-preferences.ts', () => ({
  shouldShowChampionDetails: () => true,
  shouldShowAugmentTopOverlay: () => true,
  shouldShowAugmentSidePanel: () => true,
}))

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  mocks.store.clear()
  mocks.store.set('diagnostics.lcuHeartbeat', false)
  mocks.store.set('itemSets.autoApplyAram', false)
  mocks.write.mockImplementation((key, value) => mocks.store.set(key, value))
  mocks.phase.mockResolvedValue('None')
  mocks.snapshot.mockResolvedValue({ gameflowPhase: 'ChampSelect', selfChampionId: 22, benchChampions: [], status: 'ready' })
  mocks.subscribe.mockResolvedValue({ isConnected: () => false, close: vi.fn() })
  mocks.createMain.mockResolvedValue({})
  mocks.ensurePopup.mockResolvedValue(mocks.popup)
  mocks.ensureFloating.mockResolvedValue({})
  mocks.ensureSidePanel.mockResolvedValue({})
})
afterEach(async () => {
  await vi.dynamicImportSettled()
  vi.clearAllTimers()
  vi.useRealTimers()
})

async function start() {
  const { init } = await import('../../src/main/modules/app-config.ts')
  await init()
  await vi.advanceTimersByTimeAsync(2000)
  expect(mocks.logError).not.toHaveBeenCalled()
}

describe('main-process monitoring ownership', () => {
  it('applies champion window preferences on game loading and in-progress transitions', async () => {
    await start()
    const phaseChanged = mocks.subscribe.mock.calls[0][0]
    await phaseChanged('GameStart')
    expect(mocks.applyPopupPreferences).toHaveBeenLastCalledWith('GameStart')
    await phaseChanged('InProgress')
    expect(mocks.applyPopupPreferences).toHaveBeenLastCalledWith('InProgress')
    expect(mocks.popup.show).not.toHaveBeenCalled()
  })

  it('prepares all four windows at startup without showing champion details', async () => {
    await start()
    expect(mocks.createMain).toHaveBeenCalledOnce()
    for (const prepare of [mocks.ensurePopup, mocks.ensureFloating, mocks.ensureSidePanel]) {
      expect(prepare).toHaveBeenCalledOnce()
    }
    expect(mocks.popup.show).not.toHaveBeenCalled()
    expect(mocks.popup.webContents.send).not.toHaveBeenCalled()
  })

  it('waits for every auxiliary renderer before starting game monitoring', async () => {
    let ready!: (value: unknown) => void
    mocks.ensureFloating.mockReturnValueOnce(new Promise(done => { ready = done }))
    const { init } = await import('../../src/main/modules/app-config.ts')
    const starting = init()
    await vi.dynamicImportSettled()
    await vi.advanceTimersByTimeAsync(6000)
    expect(mocks.ensurePopup).toHaveBeenCalledOnce()
    expect(mocks.ensureFloating).toHaveBeenCalledOnce()
    expect(mocks.ensureSidePanel).toHaveBeenCalledOnce()
    expect(mocks.phase).not.toHaveBeenCalled()
    ready({})
    await starting
    await vi.advanceTimersByTimeAsync(2000)
    expect(mocks.phase).toHaveBeenCalledOnce()
    expect(mocks.logError).not.toHaveBeenCalled()
  })

  it('writes a stable champion once across a minute of main-process monitoring', async () => {
    mocks.phase.mockResolvedValue('ChampSelect')
    await start()
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.snapshot.mock.calls.length).toBeGreaterThan(1)
    expect(mocks.write.mock.calls.filter(([key]) => key === 'lastSelectedChampionId')).toEqual([['lastSelectedChampionId', 22]])
    expect(mocks.ensurePopup).toHaveBeenCalledTimes(2)
    expect(mocks.popup.webContents.send).toHaveBeenCalledOnce()
    expect(mocks.logError).not.toHaveBeenCalled()
  })

  it('does not overlap slow gameflow polling requests', async () => {
    await start()
    let resolve!: (value: string) => void
    mocks.phase.mockReturnValueOnce(new Promise<string>(done => { resolve = done }))
    await vi.advanceTimersByTimeAsync(6000)
    expect(mocks.phase).toHaveBeenCalledTimes(2)
    resolve('None')
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.phase).toHaveBeenCalledTimes(3)
  })

  it('does not show an obsolete champion after the game changes while the popup loads', async () => {
    await start()
    let ready!: (value: unknown) => void
    mocks.ensurePopup.mockReturnValueOnce(new Promise(done => { ready = done }))
    const phaseChanged = mocks.subscribe.mock.calls[0][0]
    const selecting = phaseChanged('ChampSelect')
    await vi.advanceTimersByTimeAsync(0)
    await phaseChanged('EndOfGame')
    ready(mocks.popup)
    await selecting
    expect(mocks.popup.show).not.toHaveBeenCalled()
    expect(mocks.popup.webContents.send).not.toHaveBeenCalled()
    const { getChampionMonitorState } = await import('../../src/main/modules/champion-monitor-state.ts')
    expect(getChampionMonitorState()).toMatchObject({ phase: 'EndOfGame', selectedChampionId: null, lastChampionId: 22 })
  })
})
