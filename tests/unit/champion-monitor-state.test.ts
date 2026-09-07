import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  stored: new Map<string, unknown>(),
  set: vi.fn(),
  notify: vi.fn(),
}))
vi.mock('../../src/main/modules/app-store.ts', () => ({
  default: { get: (key: string) => mocks.stored.get(key), set: mocks.set },
}))
vi.mock('../../src/main/modules/window-manager.ts', () => ({ notifyAllWindows: mocks.notify }))

beforeEach(() => {
  vi.resetModules()
  mocks.stored.clear()
  mocks.set.mockImplementation((key, value) => mocks.stored.set(key, value))
})

describe('shared champion monitoring state', () => {
  it('restores only the last champion before a current game has been observed', async () => {
    mocks.stored.set('lastSelectedChampionId', 22)
    const monitor = await import('../../src/main/modules/champion-monitor-state.ts')
    expect(monitor.getChampionMonitorState()).toEqual({
      phase: null, selectedChampionId: null, lastChampionId: 22, revision: 0,
    })
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('does not write or broadcast again for an unchanged champion', async () => {
    const monitor = await import('../../src/main/modules/champion-monitor-state.ts')
    monitor.setChampionMonitorPhase('ChampSelect')
    for (let i = 0; i < 30; i++) {
      monitor.setChampionMonitorChampion(22)
      monitor.rememberChampionId(22)
    }
    expect(mocks.set).toHaveBeenCalledTimes(1)
    expect(mocks.notify).toHaveBeenCalledTimes(2)
    monitor.setChampionMonitorChampion(99)
    expect(mocks.set).toHaveBeenCalledTimes(2)
    expect(monitor.getChampionMonitorState()).toMatchObject({ selectedChampionId: 99, lastChampionId: 99 })
  })

  it('keeps the game champion during loading and clears current selection after the game', async () => {
    const monitor = await import('../../src/main/modules/champion-monitor-state.ts')
    monitor.setChampionMonitorPhase('ChampSelect')
    monitor.setChampionMonitorChampion(22)
    monitor.setChampionMonitorPhase('GameStart')
    monitor.setChampionMonitorPhase('InProgress')
    expect(monitor.getChampionMonitorState().selectedChampionId).toBe(22)
    monitor.setChampionMonitorPhase('EndOfGame')
    expect(monitor.getChampionMonitorState()).toMatchObject({ selectedChampionId: null, lastChampionId: 22 })
    monitor.setChampionMonitorPhase('ChampSelect')
    monitor.setChampionMonitorChampion(22)
    expect(mocks.set).toHaveBeenCalledTimes(1)
  })
})
