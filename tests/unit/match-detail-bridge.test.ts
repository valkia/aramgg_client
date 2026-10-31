// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (key: string, value: any) => { (window as any)[key] = value } },
  ipcRenderer: { invoke: mocks.invoke, on: vi.fn(), once: vi.fn(), send: vi.fn(), removeListener: vi.fn() },
}))
afterEach(() => { delete window.electronAPI })

describe('match detail bridge', () => {
  it('crosses both the renderer facade and typed preload with selection-only/open and argument-free/read', async () => {
    await import('../../src/preload/preload.ts')
    const { electronAPI } = await import('../../src/renderer/native/electron-api.ts')
    const selection = { snapshotId: 'capability', gameId: 123 }
    const result = { success: true }
    mocks.invoke.mockResolvedValue(result)
    expect(await electronAPI.matchHistory.openDetail(selection)).toBe(result)
    expect(mocks.invoke).toHaveBeenLastCalledWith('match-history-open-detail', selection)
    expect(await electronAPI.matchHistory.getDetailSnapshot()).toBe(result)
    expect(mocks.invoke).toHaveBeenLastCalledWith('match-history-get-detail-snapshot')
  })
})
