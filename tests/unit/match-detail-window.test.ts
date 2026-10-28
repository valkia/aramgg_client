import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OwnedMatchDetailSnapshot } from '../../src/main/services/match-history/match-detail-snapshots.ts'

const mocks = vi.hoisted(() => ({ windows: [] as any[], area: { x: -1280, y: 24, width: 1280, height: 720 }, failLoad: false }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    destroyed = false
    url = ''
    minimized = false
    options: any
    webContents = Object.assign(new EventEmitter(), { getURL: () => this.url, setWindowOpenHandler: vi.fn(), send: vi.fn() })
    show = vi.fn()
    focus = vi.fn()
    restore = vi.fn(() => { this.minimized = false })
    constructor(options: any) { super(); this.options = options; mocks.windows.push(this) }
    isDestroyed() { return this.destroyed }
    isMinimized() { return this.minimized }
    loadURL(url: string) { this.url = url; return mocks.failLoad ? Promise.reject(new Error('load failed')) : Promise.resolve() }
    destroy() { this.destroyed = true; this.webContents.emit('destroyed'); this.emit('closed') }
  }
  return { BrowserWindow: Window, app: { isPackaged: false, getAppPath: () => '/tmp/match-detail-test' }, screen: { getPrimaryDisplay: () => ({ workArea: mocks.area }) } }
})
vi.mock('../../src/main/modules/logger.ts', () => ({ default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../src/main/modules/app-store.ts', () => ({ default: { get: () => undefined } }))

function snapshot(gameId = 1): OwnedMatchDetailSnapshot {
  return { accountKey: 'account-a', data: { match: { gameId } as any, playerName: 'One', platformId: 'HN1', locale: 'zh-CN', queriedAt: 1000 } }
}
beforeEach(() => { vi.resetModules(); mocks.windows.length = 0; mocks.failLoad = false; mocks.area = { x: -1280, y: 24, width: 1280, height: 720 } })
afterEach(async () => { (await import('../../src/main/modules/window-manager.ts')).closeMatchDetailWindows() })

describe('match detail window lifecycle', () => {
  it('deduplicates concurrent opens, stays hidden until mounted and restores/focuses the same match', async () => {
    const manager = await import('../../src/main/modules/window-manager.ts')
    const { markRendererReady } = await import('../../src/main/modules/renderer-ready.ts')
    const first = manager.openMatchDetailWindow(snapshot())
    const second = manager.openMatchDetailWindow(snapshot())
    expect(first).toBe(second)
    expect(mocks.windows).toHaveLength(1)
    const window = mocks.windows[0]
    expect(window.options.show).toBe(false)
    expect(window.show).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(window.url).toContain('#/match-detail')
    expect(window.options.webPreferences).toMatchObject({ contextIsolation: true, sandbox: true, webSecurity: true, nodeIntegration: false })
    markRendererReady(window.webContents)
    await first
    expect(window.show).toHaveBeenCalledTimes(1)
    window.minimized = true
    await manager.openMatchDetailWindow(snapshot())
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledTimes(2)
    expect(mocks.windows).toHaveLength(1)
  })

  it('clamps initial size and position to small or negative-coordinate work areas', async () => {
    const { getMatchDetailWindowBounds } = await import('../../src/main/modules/window-manager.ts')
    expect(getMatchDetailWindowBounds(mocks.area)).toEqual({ x: -1240, y: 24, width: 1200, height: 720 })
    expect(getMatchDetailWindowBounds({ x: 12, y: -500, width: 320, height: 240 })).toEqual({ x: 12, y: -500, width: 320, height: 240 })
  })

  it('binds snapshots by WebContents identity, blocks external navigation and cleans ownership on close', async () => {
    const manager = await import('../../src/main/modules/window-manager.ts')
    const { markRendererReady } = await import('../../src/main/modules/renderer-ready.ts')
    const first = manager.openMatchDetailWindow(snapshot())
    const window = mocks.windows[0]
    await Promise.resolve()
    expect(manager.getOwnedMatchDetailSnapshot(window.webContents)?.data.match.gameId).toBe(1)
    expect(manager.getOwnedMatchDetailSnapshot({ ...window.webContents } as any)).toBeUndefined()
    for (const kind of ['will-navigate', 'will-redirect']) {
      const event = { preventDefault: vi.fn() }
      window.webContents.emit(kind, event, 'https://evil.test')
      expect(event.preventDefault).toHaveBeenCalledOnce()
    }
    expect(window.webContents.setWindowOpenHandler.mock.calls[0][0]({ url: 'https://evil.test' })).toEqual({ action: 'deny' })
    markRendererReady(window.webContents)
    await first
    window.destroy()
    expect(manager.getOwnedMatchDetailSnapshot(window.webContents)).toBeUndefined()
    const reopened = manager.openMatchDetailWindow(snapshot())
    markRendererReady(mocks.windows[1].webContents)
    await reopened
    expect(mocks.windows).toHaveLength(2)
  })

  it('cleans failed or cancelled loads and permits a clean retry', async () => {
    const manager = await import('../../src/main/modules/window-manager.ts')
    const { markRendererReady } = await import('../../src/main/modules/renderer-ready.ts')
    mocks.failLoad = true
    await expect(manager.openMatchDetailWindow(snapshot())).rejects.toThrow('load failed')
    expect(mocks.windows[0].destroyed).toBe(true)
    mocks.failLoad = false
    const pending = manager.openMatchDetailWindow(snapshot())
    manager.closeMatchDetailWindows()
    await expect(pending).rejects.toThrow('closed')
    const retry = manager.openMatchDetailWindow(snapshot())
    markRendererReady(mocks.windows[2].webContents)
    await retry
  })

  it('bounds pinned windows and destroys every window/ownership on invalidation', async () => {
    const manager = await import('../../src/main/modules/window-manager.ts')
    const { markRendererReady } = await import('../../src/main/modules/renderer-ready.ts')
    for (let id = 1; id <= 4; id++) {
      const open = manager.openMatchDetailWindow(snapshot(id))
      markRendererReady(mocks.windows[id - 1].webContents)
      await open
    }
    await expect(manager.openMatchDetailWindow(snapshot(5))).rejects.toThrow('Close a match detail window')
    manager.closeMatchDetailWindows()
    for (const window of mocks.windows) {
      expect(window.destroyed).toBe(true)
      expect(manager.getOwnedMatchDetailSnapshot(window.webContents)).toBeUndefined()
    }
  })
})
