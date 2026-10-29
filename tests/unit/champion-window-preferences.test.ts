import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  handlers: new Map<string, (...args: any[]) => any>(),
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    static getAllWindows() { return [] }
    visible = false
    destroyed = false
    url = ''
    options: any
    setAlwaysOnTop = vi.fn()
    setIgnoreMouseEvents = vi.fn()
    showInactive() { this.show() }
    moveTop = vi.fn()
    setBounds = vi.fn()
    isVisibleOnAllWorkspaces() { return false }
    setVisibleOnAllWorkspaces = vi.fn()
    hide = vi.fn(() => { this.visible = false })
    webContents = Object.assign(new EventEmitter(), {
      getURL: () => this.url,
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      openDevTools: vi.fn(),
    })
    constructor(options: any) { super(); this.options = options }
    isDestroyed() { return this.destroyed }
    setClosable(value: boolean) { this.options.closable = value }
    close() {
      if (process.platform === 'darwin' && this.options.closable === false) return
      this.destroyed = true
      this.emit('closed')
    }
    isVisible() { return this.visible }
    show() { this.visible = true; this.emit('show') }
    loadURL(url: string) { this.url = url; return Promise.resolve() }
  }
  return {
    BrowserWindow: Window,
    app: { isPackaged: false, getAppPath: () => '/tmp/isolated-champion-window-test' },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  }
})
vi.mock('../../src/main/modules/logger.ts', () => ({ default: {
  info: vi.fn(), debug: vi.fn(), warn: vi.fn(),
} }))
vi.mock('../../src/main/modules/app-store.ts', () => ({ default: {
  get: (key: string) => mocks.store.get(key),
  set: (key: string, value: unknown) => mocks.store.set(key, value),
  delete: (key: string) => mocks.store.delete(key),
} }))
vi.mock('../../src/main/modules/renderer-ready.ts', () => ({ waitForRendererReady: async () => {} }))
vi.mock('../../src/main/security/trusted-ipc.ts', () => ({ trustedIpcMain: {
  handle: (channel: string, handler: (...args: any[]) => any) => mocks.handlers.set(channel, handler),
} }))
vi.mock('../../src/main/data-loader.ts', () => ({
  DEFAULT_DATA_LOCALE: 'zh-CN', SUPPORTED_DATA_LOCALES: ['zh-CN', 'en-US', 'zh-TW'],
  getDataLocale: () => 'zh-CN', normalizeDataLocale: (locale: string) => locale,
  prepareDataLocale: async (locale: string) => ({ locale }), setDataLocale: vi.fn(),
}))

beforeEach(() => {
  vi.resetModules()
  mocks.store.clear()
  mocks.handlers.clear()
})

async function setup() {
  const manager = await import('../../src/main/modules/window-manager.ts')
  const popup = await manager.createPopupWindow(true, 'http://localhost:5173')
  const { registerPreferencesIpcHandlers } = await import('../../src/main/ipc/preferences-handlers.ts')
  registerPreferencesIpcHandlers()
  return { manager, popup }
}

describe('champion window preferences', () => {
  it('allows the hidden detail window to close when quitting', async () => {
    const { manager, popup } = await setup()
    expect(popup.isVisible()).toBe(false)
    manager.allowMainWindowClose()
    popup.close()
    expect(popup.isDestroyed()).toBe(true)
    expect(manager.getPopupWindow()).toBe(null)
  })
  it('creates an unpinned window by default and applies saved pinning on each show', async () => {
    const { popup } = await setup()
    expect((popup as any).options.alwaysOnTop).toBe(false)
    popup.show()
    expect(popup.setAlwaysOnTop).toHaveBeenLastCalledWith(false, expect.any(String), ...(process.platform === 'darwin' ? [0] : []))
    mocks.store.set('championInsight.alwaysOnTop', true)
    popup.hide()
    popup.show()
    expect(popup.setAlwaysOnTop).toHaveBeenLastCalledWith(true, expect.any(String), ...(process.platform === 'darwin' ? [1] : []))
  })

  it.each(['GameStart', 'InProgress'] as const)('hides on %s by default without destroying the window', async phase => {
    const { manager, popup } = await setup()
    popup.show()
    manager.applyPopupWindowPreferences(phase)
    expect(popup.isVisible()).toBe(false)
    expect(popup.isDestroyed()).toBe(false)
    popup.show()
    expect(popup.isVisible()).toBe(false)
    manager.applyPopupWindowPreferences('EndOfGame')
    popup.show()
    expect(popup.isVisible()).toBe(true)
    manager.applyPopupWindowPreferences('ChampSelect')
    popup.show()
    expect(popup.isVisible()).toBe(true)
  })

  it.each([false, true])('keeps game visibility separate from pinning (%s)', async pinned => {
    mocks.store.set('championInsight.hideOnGameStart', false)
    mocks.store.set('championInsight.alwaysOnTop', pinned)
    const { manager, popup } = await setup()
    expect((popup as any).options.alwaysOnTop).toBe(pinned)
    popup.show()
    for (const phase of ['GameStart', 'InProgress'] as const) {
      manager.applyPopupWindowPreferences(phase)
      expect(popup.isVisible()).toBe(true)
      expect(popup.setAlwaysOnTop).toHaveBeenLastCalledWith(pinned, expect.any(String), ...(process.platform === 'darwin' ? [pinned ? 1 : 0] : []))
    }
  })

  it('restores the current game hero immediately when close-in-game is turned off', async () => {
    const { manager, popup } = await setup()
    const state = await import('../../src/main/modules/champion-monitor-state.ts')
    state.setChampionMonitorPhase('InProgress')
    state.setChampionMonitorChampion(112)
    manager.applyPopupWindowPreferences('InProgress')
    expect(popup.isVisible()).toBe(false)
    await mocks.handlers.get('store-set')!({}, 'championInsight.hideOnGameStart', false)
    expect(popup.isVisible()).toBe(true)
    expect(popup.webContents.send).toHaveBeenCalledWith('for-popup', expect.objectContaining({ championId: 112 }))
  })

  it('applies setting changes immediately through IPC and restores defaults on deletion', async () => {
    mocks.store.set('championInsight.hideOnGameStart', false)
    const { manager, popup } = await setup()
    popup.show()
    manager.applyPopupWindowPreferences('InProgress')
    const set = mocks.handlers.get('store-set')!
    await set({}, 'championInsight.alwaysOnTop', true)
    expect(popup.setAlwaysOnTop).toHaveBeenLastCalledWith(true, expect.any(String), ...(process.platform === 'darwin' ? [1] : []))
    expect(popup.isVisible()).toBe(true)
    await set({}, 'championInsight.alwaysOnTop', false)
    expect(popup.setAlwaysOnTop).toHaveBeenLastCalledWith(false, expect.any(String), ...(process.platform === 'darwin' ? [0] : []))
    await set({}, 'championInsight.alwaysOnTop', true)
    mocks.handlers.get('store-delete')!({}, 'championInsight.alwaysOnTop')
    expect(popup.setAlwaysOnTop).toHaveBeenLastCalledWith(false, expect.any(String), ...(process.platform === 'darwin' ? [0] : []))
    await set({}, 'championInsight.alwaysOnTop', true)
    await set({}, 'championInsight.hideOnGameStart', true)
    expect(popup.isVisible()).toBe(false)
    await set({}, 'championInsight.hideOnGameStart', false)
    expect(popup.isVisible()).toBe(false)
    await expect(set({}, 'championInsight.unrecognized', true)).rejects.toThrow('Unsupported renderer store key')
  })
})
