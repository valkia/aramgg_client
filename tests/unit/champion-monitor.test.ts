// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChampionMonitorState } from '../../src/shared/ipc-contract.ts'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  getChampionId: vi.fn(),
  getSnapshot: vi.fn(),
  writeStore: vi.fn(),
  getWinrate: vi.fn(),
  showPopup: vi.fn(),
  handlers: new Set<(state: ChampionMonitorState) => void>(),
}))
vi.mock('../../src/renderer/native/electron-api.js', () => ({
  hasElectronAPI: () => true,
  electronAPI: {
    lcu: { getChampionMonitorState: mocks.getState, getChampionId: mocks.getChampionId, getChampSelectSnapshot: mocks.getSnapshot },
    store: { set: mocks.writeStore },
    winrate: { get: mocks.getWinrate },
    windows: { showPopup: mocks.showPopup },
    events: { on: (_channel, callback) => {
      mocks.handlers.add(callback)
      return () => mocks.handlers.delete(callback)
    } },
  },
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key, params) => params?.id ? `${key}:${params.id}` : key }) }))
import ChampionMonitor from '../../src/renderer/components/ChampionMonitor.vue'

let app: ReturnType<typeof createApp> | null = null
let root: HTMLDivElement
const state = (id: number, revision: number): ChampionMonitorState => ({
  phase: 'ChampSelect', selectedChampionId: id, lastChampionId: id, revision,
})
const emit = (value: ChampionMonitorState) => mocks.handlers.forEach(callback => callback(value))

beforeEach(() => {
  vi.useFakeTimers()
  mocks.handlers.clear()
  root = document.createElement('div')
  document.body.append(root)
})
afterEach(() => {
  app?.unmount()
  root.remove()
  vi.useRealTimers()
})
function mount() {
  app = createApp(ChampionMonitor)
  app.mount(root)
}

describe('champion status subscription', () => {
  it('reads once and updates from events without polling, store writes or duplicate popup requests', async () => {
    mocks.getState.mockResolvedValue(state(22, 1))
    mount()
    await vi.advanceTimersByTimeAsync(60000)
    emit(state(99, 2))
    await nextTick()
    expect(root.textContent).toContain('monitor.championId:99')
    expect(mocks.getState).toHaveBeenCalledTimes(1)
    for (const request of [mocks.getChampionId, mocks.getSnapshot, mocks.writeStore, mocks.getWinrate, mocks.showPopup]) {
      expect(request).not.toHaveBeenCalled()
    }
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not let an older initial response overwrite a newer pushed champion', async () => {
    let resolve!: (value: ChampionMonitorState) => void
    mocks.getState.mockReturnValue(new Promise<ChampionMonitorState>(done => { resolve = done }))
    mount()
    emit(state(99, 2))
    resolve(state(22, 1))
    await vi.advanceTimersByTimeAsync(0)
    expect(root.textContent).toContain('monitor.championId:99')
    expect(root.textContent).not.toContain('monitor.championId:22')
  })

  it('discards a pending response after stop and does not resurrect a subscription', async () => {
    let resolve!: (value: ChampionMonitorState) => void
    mocks.getState.mockReturnValueOnce(new Promise<ChampionMonitorState>(done => { resolve = done }))
    mount()
    root.querySelector('button')!.click()
    await nextTick()
    resolve(state(22, 10))
    await vi.advanceTimersByTimeAsync(6000)
    expect(mocks.handlers.size).toBe(0)
    expect(root.textContent).toContain('monitor.stopped')
    expect(root.textContent).not.toContain('monitor.championId:22')

    mocks.getState.mockResolvedValue(state(99, 11))
    root.querySelector('button')!.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.handlers.size).toBe(1)
    expect(root.textContent).toContain('monitor.championId:99')
  })

  it('unsubscribes during unmount even when the initial read is pending', async () => {
    let resolve!: (value: ChampionMonitorState) => void
    mocks.getState.mockReturnValue(new Promise<ChampionMonitorState>(done => { resolve = done }))
    mount()
    app!.unmount()
    app = null
    resolve(state(22, 1))
    await vi.advanceTimersByTimeAsync(6000)
    expect(mocks.handlers.size).toBe(0)
    expect(mocks.getState).toHaveBeenCalledTimes(1)
  })
})
