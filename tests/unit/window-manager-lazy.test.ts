import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ windows: [] as any[], top: true, side: true }))
vi.mock('../../src/main/modules/mac-game-capture.ts', () => ({ getMacCaptureDiagnostics: () => ({}) }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    destroyed = false
    url = ''
    options: any
    webContents = Object.assign(new EventEmitter(), {
      getURL: () => this.url,
      setWindowOpenHandler: vi.fn(),
      openDevTools: vi.fn(),
      send: vi.fn(),
    })
    constructor(options: any) {
      super()
      this.options = options
      mocks.windows.push(this)
    }
    isDestroyed() { return this.destroyed }
    isVisible() { return false }
    isMinimized() { return false }
    setAlwaysOnTop = vi.fn()
    moveTop = vi.fn()
    showInactive = vi.fn()
    isVisibleOnAllWorkspaces() { return false }
    setVisibleOnAllWorkspaces = vi.fn()
    setIgnoreMouseEvents = vi.fn()
    loadURL(url: string) { this.url = url; return Promise.resolve() }
    destroy() { this.destroyed = true; this.webContents.emit('destroyed'); this.emit('closed') }
  }
  return {
    BrowserWindow: Window,
    app: { isPackaged: false, getAppPath: () => '/tmp/isolated-window-test' },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  }
})
vi.mock('../../src/main/modules/logger.ts', () => ({ default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() } }))
vi.mock('../../src/main/modules/app-store.ts', () => ({ default: { get: () => undefined } }))
vi.mock('../../src/main/modules/user-preferences.ts', () => ({
  shouldShowChampionDetails: () => true,
  shouldHideChampionInsightOnGameStart: () => true,
  shouldKeepChampionInsightOnTop: () => false,
  shouldShowAugmentTopOverlay: () => mocks.top,
  shouldShowAugmentSidePanel: () => mocks.side,
}))

beforeEach(() => {
  vi.resetModules()
  mocks.windows.length = 0
  mocks.top = true
  mocks.side = true
})
afterEach(() => {
  for (const window of mocks.windows) if (!window.isDestroyed()) window.destroy()
})

describe('auxiliary window loading', () => {
  it('restores requested Mac panels despite occlusion and respects explicit hiding', async () => {
    const manager = await import('../../src/main/modules/window-manager.ts')
    const { markRendererReady } = await import('../../src/main/modules/renderer-ready.ts')
    const loading = Promise.all([manager.ensureFloatingWindow(), manager.ensureAugmentSidePanelWindow()])
    await Promise.resolve()
    for (const window of mocks.windows) markRendererReady(window.webContents)
    const [floating, side] = await loading
    manager.raiseOverlayWindow(floating)
    floating.moveTop.mockClear()
    floating.showInactive.mockClear()
    // Electron can report false while the game covers an explicitly shown panel.
    floating.isVisible = () => false
    manager.refreshVisibleMacAugmentOverlayOrder(1000)
    manager.refreshVisibleMacAugmentOverlayOrder(2000)
    manager.refreshVisibleMacAugmentOverlayOrder(2500)
    expect(floating.moveTop).toHaveBeenCalledTimes(process.platform === 'darwin' ? 2 : 0)
    expect(floating.showInactive).toHaveBeenCalledTimes(process.platform === 'darwin' ? 2 : 0)
    expect(side.moveTop).not.toHaveBeenCalled()
    floating.emit('hide')
    manager.refreshVisibleMacAugmentOverlayOrder(5000)
    manager.raiseOverlayWindow(floating)
    floating.moveTop.mockClear()
    mocks.top = false
    manager.refreshVisibleMacAugmentOverlayOrder(7000)
    expect(floating.moveTop).not.toHaveBeenCalled()
  })
  it('loads the popup once and waits beyond page load until Vue has mounted', async () => {
    const manager = await import('../../src/main/modules/window-manager.ts')
    const { markRendererReady } = await import('../../src/main/modules/renderer-ready.ts')
    const first = manager.ensurePopupWindow()
    const second = manager.ensurePopupWindow()
    const ready = vi.fn()
    void second.then(ready)
    await Promise.resolve()
    expect(mocks.windows).toHaveLength(1)
    expect(mocks.windows[0].url).toContain('#/augment-overlay')
    expect(mocks.windows[0].options.show).toBe(false)
    expect(ready).not.toHaveBeenCalled()
    markRendererReady(mocks.windows[0].webContents)
    expect(await first).toBe(await second)
    expect(await manager.ensurePopupWindow()).toBe(mocks.windows[0])
    expect(mocks.windows).toHaveLength(1)
  })

  it('prepares all auxiliary windows while hidden and reuses them when enabled', async () => {
    mocks.top = false
    mocks.side = false
    const manager = await import('../../src/main/modules/window-manager.ts')
    const { markRendererReady } = await import('../../src/main/modules/renderer-ready.ts')
    const loading = Promise.all([
      manager.ensurePopupWindow(),
      manager.ensureFloatingWindow(),
      manager.ensureAugmentSidePanelWindow(),
    ])
    await Promise.resolve()
    expect(mocks.windows).toHaveLength(3)
    for (const window of mocks.windows) {
      expect(window.options.show).toBe(false)
      markRendererReady(window.webContents)
    }
    const [popup, floating, sidePanel] = await loading
    if (process.platform === 'darwin') {
      expect(floating.options.type).toBe('panel')
      expect(sidePanel.options.type).toBe('panel')
      expect(floating.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 1)
      expect(sidePanel.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 1)
      expect(floating.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true })
      expect(floating.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
    }
    expect(floating.webContents.getURL()).toContain('#/floating-overlay')
    expect(sidePanel.webContents.getURL()).toContain('#/augment-side-panel')
    expect(await manager.ensureAugmentOverlayWindows()).toEqual([null, null])
    mocks.top = true
    mocks.side = true
    expect(await manager.ensurePopupWindow()).toBe(popup)
    expect(await manager.ensureAugmentOverlayWindows()).toEqual([floating, sidePanel])
    expect(mocks.windows).toHaveLength(3)
  })
})
