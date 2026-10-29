import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSources: vi.fn(),
  captureMacGameWindow: vi.fn(),
  getMacGameWindowInfo: vi.fn(),
  getMediaAccessStatus: vi.fn(() => 'granted'),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../../src/main/modules/mac-game-capture.ts', () => ({
  captureMacGameWindow: mocks.captureMacGameWindow,
  getMacGameWindowInfo: mocks.getMacGameWindowInfo,
}))

vi.mock('electron', () => ({
  systemPreferences: { getMediaAccessStatus: mocks.getMediaAccessStatus },
  desktopCapturer: {
    getSources: mocks.getSources,
  },
}))

vi.mock('../../src/main/modules/logger.ts', () => ({
  default: mocks.logger,
}))

const createThumbnail = (width = 1280, height = 720) => ({
  isEmpty: () => false,
  toPNG: () => Buffer.from('png'),
  getSize: () => ({ width, height }),
})

describe('captureScreenshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMediaAccessStatus.mockReturnValue('granted')
    mocks.captureMacGameWindow.mockResolvedValue(null)
    mocks.getMacGameWindowInfo.mockResolvedValue(null)
  })

  it('prefers the LoL game window by default', async () => {
    mocks.getSources.mockResolvedValue([
      {
        id: 'window:1:0',
        name: 'League of Legends',
        thumbnail: createThumbnail(1600, 900),
      },
      {
        id: 'screen:0:0',
        name: 'Entire Screen',
        thumbnail: createThumbnail(),
      },
    ])

    const { captureScreenshot } = await import('../../src/main/screenshot.ts')
    const result = await captureScreenshot()

    expect(result.success).toBe(true)
    expect(result.captureMode).toBe('window')
    expect(result.hasLolWindow).toBe(true)
    expect(result.windowName).toBe('League of Legends')
    expect(result.width).toBe(1600)
    expect(result.height).toBe(900)
    expect(mocks.getSources).toHaveBeenCalledWith({
      types: process.platform === 'darwin' ? ['window'] : ['window', 'screen'],
      thumbnailSize: { width: 1280, height: 720 },
    })
  })

  it.skipIf(process.platform !== 'darwin')('does not OCR the desktop when the game window disappears', async () => {
    mocks.getSources.mockResolvedValueOnce([])
    const { captureScreenshot } = await import('../../src/main/screenshot.ts')
    const result = await captureScreenshot()
    expect(result.success).toBe(false)
    expect(result.error).toContain('desktop fallback disabled')
    expect(mocks.getSources).toHaveBeenCalledTimes(1)
  })

  it.skipIf(process.platform !== 'darwin')('uses native game frames independently of Electron window enumeration', async () => {
    mocks.captureMacGameWindow.mockResolvedValue({
      success: true, buffer: Buffer.from('game'), windowId: 123,
      windowName: 'League of Legends (TM) Client', width: 1024, height: 576,
    })
    const { captureScreenshot } = await import('../../src/main/screenshot.ts')
    const result = await captureScreenshot({ thumbnailSize: { width: 1024, height: 576 } })
    expect(result).toMatchObject({ success: true, hasLolWindow: true, captureMode: 'window', buffer: Buffer.from('game') })
    expect(mocks.getSources).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform !== 'darwin')('does not replace a native capture error with unrelated desktop pixels', async () => {
    mocks.captureMacGameWindow.mockResolvedValue({ success: false, error: 'capture-timeout' })
    const { captureScreenshot } = await import('../../src/main/screenshot.ts')
    expect(await captureScreenshot()).toEqual({ success: false, error: 'capture-timeout' })
    expect(mocks.getSources).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform !== 'darwin')('reports denied permission before requesting a capture', async () => {
    mocks.getMediaAccessStatus.mockReturnValue('denied')
    const { captureScreenshot } = await import('../../src/main/screenshot.ts')
    const result = await captureScreenshot()
    expect(result.success).toBe(false)
    expect(result.error).toContain('Screen Recording permission')
    expect(mocks.getSources).not.toHaveBeenCalled()
  })

  it('accepts a smaller thumbnail only when the caller requests it', async () => {
    mocks.getSources.mockResolvedValue([
      {
        id: 'screen:0:0',
        name: 'Entire Screen',
        thumbnail: createThumbnail(1024, 576),
      },
    ])

    const { captureScreenshot } = await import('../../src/main/screenshot.ts')
    const result = await captureScreenshot({
      preferScreen: true,
      thumbnailSize: { width: 1024, height: 576 },
    })

    expect(result.success).toBe(true)
    expect(mocks.getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 1024, height: 576 },
    })
  })
})
