import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ enabled: true, phase: 'InProgress', visible: false, clickThrough: true,
  native: { authorized: true, listening: true, gameFrontmost: true, held: false },
  show: vi.fn(), hide: vi.fn(),
}))
vi.mock('electron', () => ({ app: { once: vi.fn() } }))
vi.mock('../../src/main/modules/app-store.ts', () => ({ default: { get: () => m.enabled, set: (_key, value) => { m.enabled = value } } }))
vi.mock('../../src/main/modules/champion-monitor-state.ts', () => ({ getChampionMonitorState: () => ({ phase: m.phase }) }))
vi.mock('../../src/main/modules/champion-guide.ts', () => ({ showCurrentChampionGuide: m.show, hideCurrentChampionGuide: m.hide }))
vi.mock('../../src/main/modules/window-manager.ts', () => ({ getPopupPresentation: () => ({ visible: m.visible, clickThrough: m.clickThrough }) }))
vi.mock('../../src/main/modules/mac-game-capture.ts', () => ({ getMacTabState: () => ({ ...m.native }), requestMacTabAccess: vi.fn() }))
vi.mock('../../src/main/modules/logger.ts', () => ({ default: { debug: vi.fn() } }))
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); m.enabled = true; m.phase = 'InProgress'; m.visible = false; m.clickThrough = true
  m.native = { authorized: true, listening: true, gameFrontmost: true, held: false }
  m.show.mockImplementation(async () => { m.visible = true; return { success: true } })
  m.hide.mockImplementation(() => { m.visible = false })
})
describe('Tab hold without consuming game input', () => {
  it('stays open while held and hides on release', async () => {
    const { tickTabGuide } = await import('../../src/main/modules/tab-champion-guide.ts')
    await tickTabGuide(); m.native.held = true; await tickTabGuide(); await tickTabGuide()
    expect(m.show).toHaveBeenCalledOnce(); expect(m.visible).toBe(true)
    m.native.held = false; await tickTabGuide()
    expect(m.hide).toHaveBeenCalledOnce(); expect(m.visible).toBe(false)
  })
  it('hides its guide on focus loss and ignores presses outside the game', async () => {
    const { tickTabGuide } = await import('../../src/main/modules/tab-champion-guide.ts')
    await tickTabGuide(); m.native.held = true; await tickTabGuide()
    m.native.gameFrontmost = false; m.native.held = true; await tickTabGuide()
    expect(m.visible).toBe(false); expect(m.show).toHaveBeenCalledOnce()
  })
  it('cancels a pending open on release', async () => {
    const { tickTabGuide } = await import('../../src/main/modules/tab-champion-guide.ts')
    let resolve!: () => void
    let allowed!: () => boolean
    m.show.mockImplementation((_source, predicate) => { allowed = predicate; return new Promise(done => { resolve = () => done({ success: allowed() }) }) })
    await tickTabGuide(); m.native.held = true; const opening = tickTabGuide()
    m.native.held = false; await tickTabGuide()
    expect(allowed()).toBe(false); resolve(); await opening
  })
  it('does not listen or open without enabled permission and an active game', async () => {
    const { tickTabGuide } = await import('../../src/main/modules/tab-champion-guide.ts')
    await tickTabGuide(); m.native.listening = false; m.native.held = true; await tickTabGuide()
    m.native.listening = true; m.phase = 'EndOfGame'; m.native.held = true; await tickTabGuide()
    expect(m.show).not.toHaveBeenCalled()
  })
})
