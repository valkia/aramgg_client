// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (key: string, value: any) => { (window as any)[key] = value } },
  ipcRenderer: { invoke: mocks.invoke, on: vi.fn(), once: vi.fn(), send: vi.fn(), removeListener: vi.fn() },
}))
afterEach(() => { delete window.electronAPI })
it('crosses the renderer facade and typed preload without accepting paths, locales or detail payloads', async () => {
  await import('../../src/preload/preload.ts')
  const { electronAPI } = await import('../../src/renderer/native/electron-api.ts')
  mocks.invoke.mockResolvedValue({ success: true })
  await electronAPI.champions.getRankings()
  expect(mocks.invoke).toHaveBeenLastCalledWith('champions-get-rankings')
  await electronAPI.champions.openDetail(103)
  expect(mocks.invoke).toHaveBeenLastCalledWith('champions-open-detail', 103)
})
