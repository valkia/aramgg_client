import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ notify: vi.fn(), handlers: new Map<string, (...args: any[]) => unknown>(), getService: vi.fn() }))
vi.mock('../../src/main/modules/window-manager.ts', () => ({ notifyAllWindows: mocks.notify }))
vi.mock('../../src/main/security/trusted-ipc.ts', () => ({ trustedIpcMain: { handle: (channel, listener) => mocks.handlers.set(channel, listener) } }))
vi.mock('../../src/main/services/lcu/lcu-service.ts', () => ({ getLCUServiceInstance: mocks.getService }))
vi.mock('../../src/main/services/aram/bench-recommendation-data.ts', () => ({ loadChampionStatsForRecommendation: vi.fn() }))
vi.mock('../../src/main/modules/champion-monitor-state.ts', () => ({ getChampionMonitorState: vi.fn(), rememberChampionId: vi.fn() }))
vi.mock('../../src/main/modules/logger.ts', () => ({ default: { warn: vi.fn(), info: vi.fn() } }))
beforeEach(() => { vi.resetModules(); mocks.handlers.clear() })

describe('read-only LCU connection snapshot', () => {
  it('starts without inferring a connection, returns copies and only broadcasts changes', async () => {
    const state = await import('../../src/main/modules/lcu-connection-state.ts')
    expect(state.getLcuConnectionState()).toEqual({ connection: 'checking', phase: null, revision: 0 })
    const current = state.setLcuConnectionState('connected', 'None')
    current.phase = 'InProgress'
    expect(state.getLcuConnectionState()).toEqual({ connection: 'connected', phase: 'None', revision: 1 })
    for (let index = 0; index < 30; index++) state.observeLcuGameflow('None', true)
    expect(mocks.notify).toHaveBeenCalledExactlyOnceWith('lcu-connection-changed', { connection: 'connected', phase: 'None', revision: 1 })
    state.setLcuConnectionState('disconnected', 'InProgress')
    expect(state.getLcuConnectionState()).toEqual({ connection: 'disconnected', phase: null, revision: 2 })
  })

  it('serves the cached snapshot through trusted IPC without initiating LCU discovery or a request', async () => {
    const state = await import('../../src/main/modules/lcu-connection-state.ts')
    const { registerLCUIpcHandlers } = await import('../../src/main/services/lcu/ipc-handlers.ts')
    state.observeLcuGameflow('ChampSelect', true)
    registerLCUIpcHandlers()
    expect(await mocks.handlers.get('lcu-get-connection-state')!({})).toEqual({ connection: 'connected', phase: 'ChampSelect', revision: 1 })
    expect(mocks.getService).not.toHaveBeenCalled()
  })
})
