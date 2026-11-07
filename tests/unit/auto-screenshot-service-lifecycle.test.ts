import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveCaptureStage } from '../../src/main/auto-screenshot-policy.ts'

const mocks = vi.hoisted(() => ({
  tencentSource: { start: vi.fn(), stop: vi.fn(), getCandidates: vi.fn(() => null) },
  onTencentSelection: null as null | ((details: { at: number; index: number; key: string | null; id: number | null }) => void),
  onTencentCandidates: null as null | ((timing: { observedAt: number; receivedAt: number }) => void),
  captureScreenshot: vi.fn(),
  analyzeScreenshot: vi.fn(),
  analyzeScreenshotGate: vi.fn(),
  warmupImageAnalyzer: vi.fn(),
  prepareWindows: vi.fn(),
  windows: [] as any[],
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    toBeijingISOString: vi.fn(() => '2026-08-30T12:00:00.000+08:00'),
  },
}))

vi.mock('../../src/main/services/augments/tencent-augment-runtime.ts', () => ({
  createTencentAugmentSource: (selected, candidatesReady) => {
    mocks.onTencentSelection = selected
    mocks.onTencentCandidates = candidatesReady
    return mocks.tencentSource
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
    getAllWindows: vi.fn(() => mocks.windows),
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
  refreshVisibleMacAugmentOverlayOrder: vi.fn(),
  ensureAugmentOverlayWindows: mocks.prepareWindows,
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
    vi.stubEnv('ARAMGG_GAME_DIAGNOSTICS', undefined)
    mocks.tencentSource.getCandidates.mockReturnValue(null)
    mocks.windows.length = 0
    mocks.prepareWindows.mockResolvedValue([])
  })

  afterEach(() => {
    autoScreenshotService.reset()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('redisplays the same cards after repeated in-game collapse and expand cycles', async () => {
    const service = createRunningIdleService()
    let now = 100000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const detected = vi.spyOn(service, '_notifyAugmentDetected').mockImplementation(() => {})
    const cleared = vi.spyOn(service, '_notifyAugmentCleared').mockImplementation(() => {})
    const cards = {
      success: true,
      analysis: {
        cardCount: 3, confidence: 0.95, isAugmentPhase: true,
        augments: [{ id: 1 }, { id: 2 }, { id: 3 }],
        augmentGate: { titleActivity: { likely: true }, rerollButtons: { visible: true } },
      },
    }
    const collapsed = {
      success: true,
      analysis: {
        cardCount: 0, confidence: 0, isAugmentPhase: false, augments: [],
        augmentGate: { cardFramesVisible: false, ocrSkippedReason: 'no-likely-title-activity' },
      },
    }
    for (let cycle = 0; cycle < 3; cycle++) {
      mocks.analyzeScreenshot.mockResolvedValue(cards)
      await service._analyzeScreenshot(Buffer.from('expanded-game-cards'))
      expect(detected).toHaveBeenCalledTimes(cycle + 1)
      expect(service.captureMode).toBe('active-selection')
      now += 3000
      mocks.analyzeScreenshot.mockResolvedValue(collapsed)
      await service._analyzeScreenshot(Buffer.from('collapsed-game-cards'))
      await service._analyzeScreenshot(Buffer.from('collapsed-game-cards'))
      expect(cleared).toHaveBeenCalledTimes(cycle + 1)
      expect(service.lastDetectedAugmentIds).toEqual([])
      expect(service.captureMode).toBe('idle')
      now += 1000
    }
  })

  it('keeps recommendations through long tooltip occlusion and clears after cards disappear', async () => {
    const service = createRunningIdleService()
    service.captureMode = 'active-selection'
    service.lastDetectedAugmentIds = ['1', '2', '3']
    service.lastDetectedAugmentAt = Date.now() - 10000
    const clear = vi.spyOn(service, '_notifyAugmentCleared').mockImplementation(() => {})
    const result = {
      success: true,
      analysis: {
        cardCount: 0, confidence: 0, isAugmentPhase: false, augments: [],
        augmentGate: { cardFramesVisible: true, ocrSkippedReason: 'no-visible-reroll-buttons' },
      },
    }
    mocks.analyzeScreenshot.mockResolvedValue(result)
    for (let index = 0; index < 20; index++) {
      await service._analyzeScreenshot(Buffer.from('tooltip-frame'))
    }
    expect(clear).not.toHaveBeenCalled()
    expect(service.lastDetectedAugmentIds).toEqual(['1', '2', '3'])
    expect(service.captureMode).toBe('active-selection')
    expect(service.visibleAugmentMissCount).toBe(0)
    result.analysis.augmentGate.cardFramesVisible = false
    await service._analyzeScreenshot(Buffer.from('gameplay-frame'))
    expect(clear).not.toHaveBeenCalled()
    await service._analyzeScreenshot(Buffer.from('gameplay-frame'))
    expect(clear).toHaveBeenCalledTimes(1)
    expect(service.lastDetectedAugmentIds).toEqual([])
    expect(service.captureMode).toBe('idle')
  })

  it('wakes the idle timer and uses one small visibility frame despite the OCR cooldown', async () => {
    vi.useFakeTimers()
    const service = createRunningIdleService()
    service.interval = 500
    service.idleInterval = 1500
    service.candidateStreak = 0
    service.pendingFullCapture = false
    service.fullOcrCooldownUntil = Date.now() + 4000
    const frame = Buffer.from('small-gate')
    mocks.tencentSource.getCandidates.mockReturnValue([1, 2, 3].map(id => ({ id, name: `Augment ${id}` })))
    mocks.captureScreenshot.mockResolvedValue({ success: true, buffer: frame })
    mocks.analyzeScreenshotGate.mockResolvedValue({ success: true, likely: true, rerollVisible: true })
    const notify = vi.spyOn(service, '_notifyAugmentDetected').mockResolvedValue(undefined)
    service._scheduleNextCapture(1500, service.runId)
    mocks.onTencentCandidates!({ observedAt: Date.now() - 100, receivedAt: Date.now() })
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.captureScreenshot).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ thumbnailSize: { width: 640, height: 360 } }))
    expect(mocks.analyzeScreenshotGate).toHaveBeenCalledExactlyOnceWith(frame)
    expect(mocks.analyzeScreenshot).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(service.lastDetectedAugmentIds).toEqual(['1', '2', '3'])
    expect(service.captureMode).toBe('active-selection')
  })

  it('does not publish native candidates on a hidden panel, and bounds the faster retries', async () => {
    vi.useFakeTimers()
    const service = createRunningIdleService()
    service.interval = 500
    service.idleInterval = 1500
    mocks.tencentSource.getCandidates.mockReturnValue([{ id: 1 }, { id: 2 }, { id: 3 }])
    mocks.captureScreenshot.mockResolvedValue({ success: true, buffer: Buffer.from('hidden') })
    mocks.analyzeScreenshotGate.mockResolvedValue({ success: true, likely: false, rerollVisible: false })
    const notify = vi.spyOn(service, '_notifyAugmentDetected').mockResolvedValue(undefined)
    mocks.onTencentCandidates!({ observedAt: Date.now(), receivedAt: Date.now() })
    await vi.advanceTimersByTimeAsync(2000)
    expect(notify).not.toHaveBeenCalled()
    expect(mocks.analyzeScreenshot).not.toHaveBeenCalled()
    expect(service._getCurrentCaptureInterval()).toBe(1500)
  })

  it('does not reopen a selection that completes while the small gate is in flight', async () => {
    const service = createRunningIdleService()
    mocks.tencentSource.getCandidates.mockReturnValue([{ id: 1 }, { id: 2 }, { id: 3 }])
    let finish!: (value: unknown) => void
    mocks.analyzeScreenshotGate.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const notify = vi.spyOn(service, '_notifyAugmentDetected').mockResolvedValue(undefined)
    const pending = service._analyzeGateScreenshot(Buffer.from('old-gate'))
    mocks.onTencentSelection!({ at: Date.now(), index: 2, key: 'test_3', id: 3 })
    expect(mocks.logger.info).toHaveBeenCalledWith('[tencent augments]', expect.objectContaining({ event: 'selection-completed', selectedAugmentId: 3 }))
    finish({ success: true, likely: true, rerollVisible: true })
    await pending
    expect(notify).not.toHaveBeenCalled()
    expect(service.lastDetectedAugmentIds).toEqual([])
  })

  it('waits for in-flight OCR before waking capture and discards its superseded result', async () => {
    vi.useFakeTimers()
    const service = createRunningIdleService()
    let finish!: (value: unknown) => void
    mocks.analyzeScreenshot.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const schedule = vi.spyOn(service, '_scheduleNextCapture')
    const notify = vi.spyOn(service, '_notifyAugmentDetected').mockResolvedValue(undefined)
    const pending = service._drainAnalysisQueue(Buffer.from('old-frame'), service.runId)
    mocks.onTencentCandidates!({ observedAt: Date.now(), receivedAt: Date.now() })
    expect(schedule).not.toHaveBeenCalled()
    finish({ success: true, analysis: { cardCount: 3, confidence: 1, isAugmentPhase: true, augments: [{ id: 1 }, { id: 2 }, { id: 3 }] } })
    await pending
    expect(notify).not.toHaveBeenCalled()
    expect(schedule).toHaveBeenCalledExactlyOnceWith(0, service.runId)
  })

  it('does not run title OCR on a small frame when native candidates expire', async () => {
    const service = createRunningIdleService()
    mocks.tencentSource.getCandidates.mockReturnValue(null)
    await service._analyzeScreenshot(Buffer.from('small-gate'), service.runId, { gateResult: { success: true, likely: true, rerollVisible: true }, tencentOnly: true })
    expect(mocks.analyzeScreenshot).not.toHaveBeenCalled()
  })

  it('uses mapped Tencent candidates only after a visible selection gate, without title OCR', async () => {
    const service = createRunningIdleService()
    const candidates = [1, 2, 3].map(id => ({ id, key: `test_${id}`, name: `Augment ${id}`, detectedSlot: id - 1 }))
    mocks.tencentSource.getCandidates.mockReturnValue(candidates)
    mocks.analyzeScreenshotGate.mockResolvedValue({ success: true, likely: true, rerollVisible: true })
    const notify = vi.spyOn(service, '_notifyAugmentDetected').mockResolvedValue(undefined)
    await service._analyzeScreenshot(Buffer.from('visible-selection'))
    expect(mocks.analyzeScreenshot).not.toHaveBeenCalled()
    expect(service.lastDetectedAugmentIds).toEqual(['1', '2', '3'])
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ recognitionSource: 'tencent-log' }), service.runId)
  })

  it('preserves OCR fallback when Tencent mapping is unavailable or the gate is absent', async () => {
    const service = createRunningIdleService()
    mocks.analyzeScreenshot.mockResolvedValue({ success: false, error: 'fixture-miss' })
    await service._analyzeScreenshot(Buffer.from('frame'))
    expect(mocks.analyzeScreenshot).toHaveBeenCalledTimes(1)
    mocks.tencentSource.getCandidates.mockReturnValue([{ id: 1 }, { id: 2 }, { id: 3 }])
    mocks.analyzeScreenshotGate.mockResolvedValue({ success: true, likely: false, rerollVisible: false })
    await service._analyzeScreenshot(Buffer.from('closed-panel'))
    expect(mocks.analyzeScreenshot).toHaveBeenCalledTimes(2)
  })

  it('does not reopen the overlay when a native pick arrives during title OCR', async () => {
    const service = createRunningIdleService()
    service.lastDetectedAugmentIds = ['1', '2', '3']
    let finish!: (result: unknown) => void
    mocks.analyzeScreenshot.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const notify = vi.spyOn(service, '_notifyAugmentDetected').mockResolvedValue(undefined)
    const pending = service._analyzeScreenshot(Buffer.from('old-frame'))
    mocks.onTencentSelection!({ at: Date.now(), index: 2, key: 'test_3', id: 3 })
    finish({ success: true, analysis: { cardCount: 3, confidence: 1, isAugmentPhase: true, augments: [{ id: 1 }, { id: 2 }, { id: 3 }] } })
    await pending
    expect(service.lastDetectedAugmentIds).toEqual([])
    expect(notify).not.toHaveBeenCalled()
  })

  it('continues with OCR if the optional Tencent visibility gate throws', async () => {
    const service = createRunningIdleService()
    mocks.tencentSource.getCandidates.mockReturnValue([{ id: 1 }, { id: 2 }, { id: 3 }])
    mocks.analyzeScreenshotGate.mockRejectedValue(new Error('gate unavailable'))
    mocks.analyzeScreenshot.mockResolvedValue({ success: false, error: 'fixture-miss' })
    const frame = Buffer.from('frame')
    await service._analyzeScreenshot(frame)
    expect(mocks.analyzeScreenshot).toHaveBeenCalledWith(frame)
  })

  it('stops the optional source on phase exit and restarts it only in game', () => {
    const service = createRunningIdleService()
    service.setGameflowPhase('InProgress')
    expect(mocks.tencentSource.start).toHaveBeenCalledTimes(1)
    service.setGameflowPhase('ChampSelect')
    expect(mocks.tencentSource.stop).toHaveBeenCalled()
    expect(service.isAnalysisAllowedByGameflow()).toBe(false)
  })

  it('does not keep reading logs when analysis is disabled during a match', () => {
    const service = createRunningIdleService()
    service.setGameflowPhase('InProgress')
    expect(mocks.tencentSource.start).toHaveBeenCalledTimes(1)
    service.setConfig({ enableAnalysis: false })
    expect(mocks.tencentSource.stop).toHaveBeenCalled()
    service.setGameflowPhase('InProgress')
    expect(mocks.tencentSource.start).toHaveBeenCalledTimes(1)
    service.setConfig({ enableAnalysis: true })
    expect(mocks.tencentSource.start).toHaveBeenCalledTimes(2)
  })

  it('delivers the first detection only after the on-demand renderer is ready', async () => {
    const service = createRunningIdleService()
    service.lastDetectedAugmentIds = ['1', '2', '3']
    let ready!: () => void
    mocks.prepareWindows.mockReturnValue(new Promise<void>(resolve => { ready = resolve }))
    const send = vi.fn()
    mocks.windows.push({
      isDestroyed: () => false,
      webContents: { getURL: () => 'http://localhost/#/floating-overlay', send },
    })
    const payload = { augments: [{ id: 1 }, { id: 2 }, { id: 3 }] }
    const pending = service._sendAugmentDetectedPayload(payload)
    expect(send).not.toHaveBeenCalled()
    ready()
    await pending
    expect(send).toHaveBeenCalledWith('augment-detected', payload)
  })

  it('does not deliver a detection if stopped while its window is loading', async () => {
    const service = createRunningIdleService()
    service.lastDetectedAugmentIds = ['1', '2', '3']
    let ready!: () => void
    mocks.prepareWindows.mockReturnValue(new Promise<void>(resolve => { ready = resolve }))
    const send = vi.fn()
    mocks.windows.push({
      isDestroyed: () => false,
      webContents: { getURL: () => 'http://localhost/#/floating-overlay', send },
    })
    const pending = service._sendAugmentDetectedPayload({ augments: [{ id: 1 }, { id: 2 }, { id: 3 }] })
    service.stop('gameflow')
    ready()
    await pending
    expect(send).not.toHaveBeenCalled()
  })

  it('does not deliver a stale detection into a restarted run with matching ids', async () => {
    const service = createRunningIdleService()
    const payload = { augments: [{ id: 1 }, { id: 2 }, { id: 3 }] }
    service.lastDetectedAugmentIds = ['1', '2', '3']
    const staleRunId = service.runId

    service.runId++
    await service._sendAugmentDetectedPayload(payload, 'detected', staleRunId)

    expect(mocks.prepareWindows).not.toHaveBeenCalled()
  })

  it('does not let a stale run occupy the restarted capture timer', () => {
    const service = createRunningIdleService()
    const staleRunId = service.runId

    service.runId++
    service._scheduleNextCapture(0, staleRunId)

    expect(service.intervalId).toBeNull()
  })

  it('ignores a gate result that finishes after the run has restarted', async () => {
    const service = createRunningIdleService()
    let resolveGate!: (value: any) => void
    mocks.analyzeScreenshotGate.mockReturnValue(new Promise(resolve => { resolveGate = resolve }))
    const staleRunId = service.runId
    const pending = service._analyzeGateScreenshot(Buffer.from('gate-frame'), staleRunId)

    service.runId++
    service.candidateStreak = 1
    service.pendingFullCapture = false
    resolveGate({ success: true, likely: true, rerollVisible: true, durationMs: 10 })
    await pending

    expect(service.candidateStreak).toBe(1)
    expect(service.pendingFullCapture).toBe(false)
  })

  it('ignores an OCR result that finishes after the run has restarted', async () => {
    const service = createRunningIdleService()
    let resolveAnalysis!: (value: any) => void
    mocks.analyzeScreenshot.mockReturnValue(new Promise(resolve => { resolveAnalysis = resolve }))
    const notify = vi.spyOn(service, '_notifyAugmentDetected').mockImplementation(() => {})
    const staleRunId = service.runId
    const pending = service._analyzeScreenshot(Buffer.from('full-frame'), staleRunId)

    service.runId++
    service.captureMode = 'idle'
    service.lastDetectedAugmentIds = []
    service.lastDetectedAugments = []
    service.detectionCount = 0
    resolveAnalysis({
      success: true,
      timestamp: Date.now(),
      analysis: {
        cardCount: 3,
        confidence: 0.95,
        isAugmentPhase: true,
        augments: [{ id: 1 }, { id: 2 }, { id: 3 }],
        slotDiagnostics: [],
        augmentGate: {
          ocrSkippedReason: null,
          titleActivity: { likely: true },
          rerollButtons: { visible: true },
        },
      },
    })
    await pending

    expect(service.captureMode).toBe('idle')
    expect(service.lastDetectedAugmentIds).toEqual([])
    expect(service.lastDetectedAugments).toEqual([])
    expect(service.detectionCount).toBe(0)
    expect(notify).not.toHaveBeenCalled()
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

  it.each([undefined, '1'])('keeps partial slot diagnostics opt-in without changing recognition: %s', async (flag) => {
    vi.stubEnv('ARAMGG_GAME_DIAGNOSTICS', flag)
    const service = createRunningIdleService()
    vi.spyOn(service, '_savePartialOcrScreenshot').mockImplementation(() => {})
    mocks.analyzeScreenshot.mockResolvedValue({
      success: true, analysis: {
        cardCount: 2, confidence: 0.2, isAugmentPhase: true,
        augments: [{ id: 1413, detectedSlot: 0 }, { id: 1048, detectedSlot: 2 }],
        slotDiagnostics: [], augmentGate: { titleActivity: { likely: true }, rerollButtons: { visible: true } },
      },
    })
    await service._analyzeScreenshot(Buffer.from('partial-frame'))
    if (flag === '1') {
      expect(mocks.logger.debug).toHaveBeenCalledWith('Augment selection UI observed', {
        candidateSlots: [1413, null, 1048], cardCount: 2, confidence: 0.2, recognitionSource: 'ocr',
      })
    } else {
      expect(mocks.logger.debug.mock.calls.some(([message]) => message === 'Augment selection UI observed')).toBe(false)
    }
    expect(service.captureMode).toBe('active-selection')
  })
})
