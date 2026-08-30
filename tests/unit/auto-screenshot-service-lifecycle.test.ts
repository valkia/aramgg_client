import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveCaptureStage } from '../../src/main/auto-screenshot-policy.ts'

const mocks = vi.hoisted(() => ({
  captureScreenshot: vi.fn(),
  analyzeScreenshot: vi.fn(),
  analyzeScreenshotGate: vi.fn(),
  warmupImageAnalyzer: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    toBeijingISOString: vi.fn(() => '2026-08-30T12:00:00.000+08:00'),
  },
}))

vi.mock('../../src/main/screenshot.ts', () => ({
  CAPTURE_THUMBNAIL_SIZE: { width: 1280, height: 720 },
  captureScreenshot: mocks.captureScreenshot,
}))

vi.mock('../../src/main/image-analyzer.ts', () => ({
  analyzeScreenshot: mocks.analyzeScreenshot,
  analyzeScreenshotGate: mocks.analyzeScreenshotGate,
  warmupImageAnalyzer: mocks.warmupImageAnalyzer,
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}))

vi.mock('fs-extra', () => ({
  default: {
    ensureDir: vi.fn(),
    writeFile: vi.fn(),
    readdir: vi.fn(async () => []),
    stat: vi.fn(),
    remove: vi.fn(),
  },
}))

vi.mock('../../src/main/modules/logger.ts', () => ({ default: mocks.logger }))
vi.mock('../../src/main/modules/window-manager.ts', () => ({
  applyAugmentSidePanelWindowLayout: vi.fn(),
  applyFloatingWindowLayout: vi.fn(),
  raiseOverlayWindow: vi.fn(),
}))
vi.mock('../../src/main/modules/overlay-window-state.ts', () => ({
  shouldRaiseOverlayWindow: vi.fn(() => false),
}))
vi.mock('../../src/main/modules/app-store.ts', () => ({
  default: { get: vi.fn(() => null) },
}))
vi.mock('../../src/main/modules/app-paths.ts', () => ({
  getPartialOcrScreenshotDir: vi.fn(() => '/tmp/aramgg-client-ocr-test'),
}))
vi.mock('../../src/main/augment-partial-merge.ts', () => ({
  createInitialPartialAugmentSelection: vi.fn(() => null),
  getAugmentIds: vi.fn((augments = []) => augments.map(augment => String(augment.id))),
  mergePartialAugments: vi.fn(() => null),
}))
vi.mock('../../src/main/modules/user-preferences.ts', () => ({
  shouldShowAugmentSidePanel: vi.fn(() => true),
  shouldShowAugmentTopOverlay: vi.fn(() => true),
}))

import autoScreenshotService from '../../src/main/auto-screenshot-service.ts'

const createRunningIdleService = () => {
  autoScreenshotService.reset()
  autoScreenshotService.isRunning = true
  autoScreenshotService.controlOwner = 'gameflow'
  autoScreenshotService.captureMode = 'idle'
  autoScreenshotService.gameflowPhase = 'InProgress'
  autoScreenshotService.enableAnalysis = true
  autoScreenshotService.automaticThumbnailSize = { width: 1024, height: 576 }
  autoScreenshotService.pendingFullCapture = true
  autoScreenshotService.candidateStreak = 2
  return autoScreenshotService
}

const expectNextCaptureToUseGate = (service) => {
  expect(resolveCaptureStage({
    mode: service.captureMode,
    pendingFullCapture: service.pendingFullCapture,
    fullOcrCooldownUntil: service.fullOcrCooldownUntil,
    now: Date.now(),
  })).toBe('gate')
}

describe.sequential('automatic screenshot service lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    autoScreenshotService.reset()
    vi.restoreAllMocks()
  })

  it('consumes a queued full capture before starting OCR', async () => {
    const service = createRunningIdleService()
    const imageBuffer = Buffer.from('full-frame')
    mocks.captureScreenshot.mockResolvedValue({
      success: true,
      buffer: imageBuffer,
      width: 1024,
      height: 576,
    })
    const queueAnalysis = vi.spyOn(service, '_queueAnalysis').mockImplementation(() => {})

    const result = await service._captureScreenshot(service.runId)

    expect(result.stage).toBe('full')
    expect(service.pendingFullCapture).toBe(false)
    expect(service.candidateStreak).toBe(0)
    expect(queueAnalysis).toHaveBeenCalledWith(imageBuffer)
    expectNextCaptureToUseGate(service)
  })

  it('returns to gate backoff when full OCR reports failure', async () => {
    const service = createRunningIdleService()
    const startedAt = Date.now()
    mocks.analyzeScreenshot.mockResolvedValue({ success: false, error: 'ocr-failed' })

    await service._analyzeScreenshot(Buffer.from('full-frame'))

    expect(service.pendingFullCapture).toBe(false)
    expect(service.candidateStreak).toBe(0)
    expect(service.fullOcrCooldownUntil).toBeGreaterThan(startedAt)
    expectNextCaptureToUseGate(service)
  })

  it('returns a gate false positive with no confirmed cards to backoff', async () => {
    const service = createRunningIdleService()
    const startedAt = Date.now()
    mocks.analyzeScreenshot.mockResolvedValue({
      success: true,
      timestamp: Date.now(),
      analysis: {
        cardCount: 0,
        confidence: 0,
        isAugmentPhase: false,
        augments: [],
        slotDiagnostics: [],
        augmentGate: {
          ocrSkippedReason: 'selection-ui-not-confirmed',
          titleActivity: { likely: false },
          rerollButtons: { visible: false },
        },
      },
    })

    await service._analyzeScreenshot(Buffer.from('false-positive-frame'))

    expect(service.captureMode).toBe('idle')
    expect(service.pendingFullCapture).toBe(false)
    expect(service.candidateStreak).toBe(0)
    expect(service.fullOcrCooldownUntil).toBeGreaterThan(startedAt)
    expectNextCaptureToUseGate(service)
  })

  it('returns an unconfirmed partial recognition to gate backoff', async () => {
    const service = createRunningIdleService()
    const startedAt = Date.now()
    vi.spyOn(service, '_savePartialOcrScreenshot').mockImplementation(() => {})
    mocks.analyzeScreenshot.mockResolvedValue({
      success: true,
      timestamp: Date.now(),
      analysis: {
        cardCount: 1,
        confidence: 0.75,
        isAugmentPhase: false,
        augments: [{ id: 1, name: '测试海克斯', detectedSlot: 0 }],
        slotDiagnostics: [],
        augmentGate: {
          ocrSkippedReason: 'selection-ui-not-confirmed',
          titleActivity: { likely: false },
          rerollButtons: { visible: false },
        },
      },
    })

    await service._analyzeScreenshot(Buffer.from('partial-frame'))

    expect(service.captureMode).toBe('idle')
    expect(service.pendingFullCapture).toBe(false)
    expect(service.candidateStreak).toBe(0)
    expect(service.fullOcrCooldownUntil).toBeGreaterThan(startedAt)
    expectNextCaptureToUseGate(service)
  })
})
