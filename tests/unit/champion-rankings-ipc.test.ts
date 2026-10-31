import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<any>>(),
  getLocale: vi.fn(), load: vi.fn(), getMain: vi.fn(), ensure: vi.fn(), show: vi.fn(), send: vi.fn(),
}))
vi.mock('../../src/main/security/trusted-ipc.ts', () => ({ trustedIpcMain: { handle: (channel: string, listener: any) => mocks.handlers.set(channel, listener) } }))
vi.mock('../../src/main/data-loader.ts', () => ({ getDataLocale: mocks.getLocale, loadChampionRankings: mocks.load }))
vi.mock('../../src/main/modules/window-manager.ts', () => ({ getMainWindow: mocks.getMain, ensurePopupWindow: mocks.ensure, showPopupWindowManually: mocks.show }))
vi.mock('../../src/main/modules/logger.ts', () => ({ default: { warn: vi.fn() } }))
import { registerChampionRankingsIpcHandlers } from '../../src/main/ipc/champion-rankings-handlers.ts'
const sender = {}
const main = { webContents: sender, isDestroyed: () => false }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getLocale.mockReturnValue('zh-CN')
  mocks.getMain.mockReturnValue(main)
  mocks.load.mockResolvedValue({ locale: 'zh-CN', champions: [{ championId: 103, name: '阿狸', alias: 'Ahri' }] })
  mocks.ensure.mockResolvedValue({ isDestroyed: () => false, webContents: { send: mocks.send } })
  registerChampionRankingsIpcHandlers()
})
const open = (id: unknown, contents: unknown = sender) => mocks.handlers.get('champions-open-detail')!({ sender: contents }, id)
describe('champion rankings trusted handlers', () => {
  it('captures the active locale for the argument-free index read and hides internal failures', async () => {
    const get = mocks.handlers.get('champions-get-rankings')!
    expect((await get({})).success).toBe(true)
    expect(mocks.load).toHaveBeenCalledWith('zh-CN')
    mocks.load.mockRejectedValueOnce(new Error('private internal path'))
    expect(await get({})).toEqual({ success: false })
  })
  it('opens only a known hero through the manual popup helper with source-owned display data', async () => {
    expect(await open(103)).toEqual({ success: true })
    expect(mocks.show).toHaveBeenCalledOnce()
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith('for-popup', { championId: 103, championName: '阿狸', dataSource: 'champion-rankings' })
  })
  it.each([0, -1, 1.5, '103', {}, null, Number.MAX_SAFE_INTEGER + 1, Infinity, 999])('rejects invalid or unknown hero %s', async (id) => {
    expect(await open(id)).toEqual({ success: false })
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(mocks.show).not.toHaveBeenCalled()
  })
  it('rejects non-main senders and locale changes during either index or window preparation', async () => {
    expect((await open(103, {})).success).toBe(false)
    expect(mocks.load).not.toHaveBeenCalled()
    mocks.load.mockImplementationOnce(async () => { mocks.getLocale.mockReturnValue('en-US'); return { champions: [{ championId: 103 }] } })
    expect((await open(103)).success).toBe(false)
    expect(mocks.ensure).not.toHaveBeenCalled()
    mocks.getLocale.mockReturnValue('zh-CN')
    mocks.ensure.mockImplementationOnce(async () => { mocks.getLocale.mockReturnValue('en-US'); return { isDestroyed: () => false } })
    expect((await open(103)).success).toBe(false)
    expect(mocks.show).not.toHaveBeenCalled()
  })
})
