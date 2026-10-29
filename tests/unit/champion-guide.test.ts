import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  state: { phase: 'InProgress', selectedChampionId: 112 as number | null, lastChampionId: 145, revision: 1 },
  hideInGame: true, showDetails: true,
  send: vi.fn(), show: vi.fn(), hide: vi.fn(), presentation: vi.fn(),
  ready: null as Promise<void> | null,
}))
vi.mock('../../src/main/modules/champion-monitor-state.ts', () => ({ getChampionMonitorState: () => ({ ...m.state }) }))
vi.mock('../../src/main/modules/user-preferences.ts', () => ({
  shouldHideChampionInsightOnGameStart: () => m.hideInGame, shouldShowChampionDetails: () => m.showDetails,
}))
vi.mock('../../src/main/modules/window-manager.ts', () => {
  const win = { isDestroyed: () => false, showInactive: m.show, moveTop: vi.fn(), hide: m.hide, webContents: { send: m.send } }
  return { ensurePopupWindow: async () => { if (m.ready) await m.ready; return win }, getPopupWindow: () => win,
    applyPopupWindowLayout: vi.fn(), setPopupPresentation: m.presentation }
})
import { showCurrentChampionGuide, hideCurrentChampionGuide } from '../../src/main/modules/champion-guide.ts'
beforeEach(() => { vi.clearAllMocks(); m.state = { phase: 'InProgress', selectedChampionId: 112, lastChampionId: 145, revision: 1 }; m.hideInGame = true; m.showDetails = true; m.ready = null })
describe('current champion guide', () => {
  it('explicitly opens the current hero even when automatic display is disabled', async () => {
    m.showDetails = false
    expect((await showCurrentChampionGuide()).success).toBe(true)
    expect(m.send).toHaveBeenCalledWith('for-popup', expect.objectContaining({ championId: 112, benchRecommendation: null }))
    expect(m.presentation).toHaveBeenCalledWith(true, false)
    expect(m.show).toHaveBeenCalledOnce()
  })
  it('does not fall back to the last match hero', async () => {
    m.state.selectedChampionId = null
    expect((await showCurrentChampionGuide()).success).toBe(false)
    expect(m.show).not.toHaveBeenCalled()
  })
  it('reopens on preference change only when automatic in-game display is allowed', async () => {
    expect((await showCurrentChampionGuide('preference')).success).toBe(false)
    m.hideInGame = false
    expect((await showCurrentChampionGuide('preference')).success).toBe(true)
    expect(m.presentation).toHaveBeenCalledWith(false, false)
  })
  it('does not flash a pending guide after hiding or leaving the match', async () => {
    let resolve!: () => void
    m.ready = new Promise<void>(done => { resolve = done })
    const opening = showCurrentChampionGuide('tab')
    hideCurrentChampionGuide()
    resolve()
    expect((await opening).success).toBe(false)
    expect(m.show).not.toHaveBeenCalled()
    m.ready = null
    m.state.phase = 'EndOfGame'
    expect((await showCurrentChampionGuide()).success).toBe(false)
  })
})
