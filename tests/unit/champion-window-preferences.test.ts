import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  handlers: new Map<string, (...args: any[]) => any>(),
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    visible = false
    url = ''
    options: any
    setAlwaysOnTop = vi.fn()
    hide = vi.fn(() => { this.visible = false })
    webContents = Object.assign(new EventEmitter(), {
      getURL: () => this.url,
      setWindowOpenHandler: vi.fn(),
      openDevTools: vi.fn(),
    })
    constructor(options: any) { super(); this.options = options }
    isDestroyed() { return false }
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
  it('creates an unpinned window by default and applies saved pinning on each show', async () => {
    const { popup } = await setup()
    expect((popup as any).options.alwaysOnTop).toBe(false)
    popup.show()
    expect(popup.setAlwaysOnTop).toHaveBeenLastCalledWith(false, expect.any(String))
    mocks.store.set('championInsight.alwaysOnTop', true)
    popup.hide()
    popup.show()
    expect(popup.setAlwaysOnTop).toHaveBeenLastCalledWith(true, expect.any(String))
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
      expect(popup.setAlwaysOnTop).toHaveBeenLastCalledWith(pinned, expect.any(String))
    }
  })

  it('applies setting changes immediately through IPC and restores defaults on deletion', async () => {
    mocks.store.set('championInsight.hideOnGameStart', false)
    const { manager, popup } = await setup()
    popup.show()
    manager.applyPopupWindowPreferences('InProgress')
    const set = mocks.handlers.get('store-set')!
    set({}, 'championInsight.alwaysOnTop', true)
    expect(popup.setAlwaysOnTop).toHaveBeenLastCalledWith(true, expect.any(String))
    expect(popup.isVisible()).toBe(true)
    set({}, 'championInsight.alwaysOnTop', false)
    expect(popup.setAlwaysOnTop).toHaveBeenLastCalledWith(false, expect.any(String))
    set({}, 'championInsight.alwaysOnTop', true)
    mocks.handlers.get('store-delete')!({}, 'championInsight.alwaysOnTop')
    expect(popup.setAlwaysOnTop).toHaveBeenLastCalledWith(false, expect.any(String))
    set({}, 'championInsight.alwaysOnTop', true)
    set({}, 'championInsight.hideOnGameStart', true)
    expect(popup.isVisible()).toBe(false)
    set({}, 'championInsight.hideOnGameStart', false)
    expect(popup.isVisible()).toBe(false)
    expect(() => set({}, 'championInsight.unrecognized', true)).toThrow('Unsupported renderer store key')
  })
})
