import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSources: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('electron', () => ({
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
      types: ['window', 'screen'],
      thumbnailSize: { width: 1280, height: 720 },
    })
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
