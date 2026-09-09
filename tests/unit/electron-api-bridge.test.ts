import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChampionMonitorState, ElectronAPI } from '../../src/shared/ipc-contract.ts'
import { markRendererReady, waitForRendererReady } from '../../src/main/modules/renderer-ready.ts'
import { electronAPI, hasElectronAPI } from '../../src/renderer/native/electron-api.ts'

const ipc = vi.hoisted(() => ({
  expose: vi.fn(),
  send: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: ipc.expose },
  ipcRenderer: ipc,
}))
await import('../../src/preload/preload.ts')
const preloadAPI = ipc.expose.mock.calls.find(([name]) => name === 'electronAPI')![1] as ElectronAPI

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { electronAPI: preloadAPI })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('real renderer facade and preload bridge', () => {
  it('exposes every preload method through the renderer facade', () => {
    for (const group of Object.keys(preloadAPI) as (keyof ElectronAPI)[]) {
      expect(Object.keys(electronAPI[group]).sort()).toEqual(Object.keys(preloadAPI[group]).sort())
      for (const method of Object.values(electronAPI[group])) expect(typeof method).toBe('function')
    }
  })

  it.each(['popup', 'floating', 'augment-side-panel'])('releases the %s readiness gate through the real bridge', async () => {
    const contents = new EventEmitter() as unknown as WebContents
    ipc.send.mockImplementation((channel) => {
      if (channel === 'renderer-ready') markRendererReady(contents)
    })
    const ready = waitForRendererReady(contents)

    electronAPI.windows.ready()

    await expect(ready).resolves.toBeUndefined()
    expect(ipc.send).toHaveBeenCalledExactlyOnceWith('renderer-ready')
    expect(vi.getTimerCount()).toBe(0)
    expect(contents.listenerCount('destroyed')).toBe(0)
  })

  it('reads the initial champion state through the real preload IPC method', async () => {
    const state: ChampionMonitorState = {
      phase: 'ChampSelect', selectedChampionId: 22, lastChampionId: 22, revision: 1,
    }
    ipc.invoke.mockResolvedValueOnce(state)

    await expect(electronAPI.lcu.getChampionMonitorState()).resolves.toEqual(state)
    expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith('lcu-get-champion-monitor-state')
  })

  it('resolves the bridge at call time and reports an unavailable preload clearly', () => {
    vi.stubGlobal('window', {})
    expect(hasElectronAPI()).toBe(false)
    expect(() => electronAPI.windows.ready()).toThrow('Electron API is not available')

    vi.stubGlobal('window', { electronAPI: preloadAPI })
    expect(hasElectronAPI()).toBe(true)
    electronAPI.windows.ready()
    expect(ipc.send).toHaveBeenCalledExactlyOnceWith('renderer-ready')
  })
})
