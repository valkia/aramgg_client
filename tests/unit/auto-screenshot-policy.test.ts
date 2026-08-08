import { describe, expect, it } from 'vitest'
import {
  FULL_OCR_BACKOFF_MS,
  GATE_CAPTURE_THUMBNAIL_SIZE,
  GAMEFLOW_ACTIVE_CAPTURE_INTERVAL_MS,
  GAMEFLOW_CAPTURE_THUMBNAIL_SIZE,
  GAMEFLOW_IDLE_CAPTURE_INTERVAL_MS,
  resolveCandidateStreak,
  resolveCaptureStage,
  resolveCaptureModeAfterAnalysis,
  resolveFullOcrBackoffUntil,
  resolveGameflowCaptureInterval,
  SELECTION_CANDIDATE_STREAK_THRESHOLD,
  shouldQueueFullCapture,
  shouldActivateSelectionCapture,
} from '../../src/main/auto-screenshot-policy.ts'

describe('automatic screenshot policy', () => {
  it('uses the reduced automatic thumbnail and adaptive intervals', () => {
    expect(GAMEFLOW_CAPTURE_THUMBNAIL_SIZE).toEqual({ width: 1024, height: 576 })
    expect(resolveGameflowCaptureInterval('idle')).toBe(GAMEFLOW_IDLE_CAPTURE_INTERVAL_MS)
    expect(resolveGameflowCaptureInterval('active-selection')).toBe(
      GAMEFLOW_ACTIVE_CAPTURE_INTERVAL_MS,
    )
  })

  it('enters active mode for a confirmed selection and retains it through transient misses', () => {
    const active = resolveCaptureModeAfterAnalysis({
      currentMode: 'idle',
      confirmedSelectionUi: true,
      hasVisibleAugments: false,
    })
    const retained = resolveCaptureModeAfterAnalysis({
      currentMode: active,
      confirmedSelectionUi: false,
      hasVisibleAugments: true,
    })

    expect(active).toBe('active-selection')
    expect(retained).toBe('active-selection')
  })

  it('returns to idle after the visible augment state has cleared', () => {
    expect(resolveCaptureModeAfterAnalysis({
      currentMode: 'active-selection',
      confirmedSelectionUi: false,
      hasVisibleAugments: false,
    })).toBe('idle')
  })

  it('stays idle when a gate-like frame has no recognized or visible augments', () => {
    expect(shouldActivateSelectionCapture({
      confirmedSelectionUi: true,
      recognizedAugmentCount: 0,
      hasVisibleAugments: false,
    })).toBe(false)
    expect(resolveCaptureModeAfterAnalysis({
      currentMode: 'idle',
      confirmedSelectionUi: false,
      hasVisibleAugments: false,
    })).toBe('idle')
  })

  it('activates after the gate and at least one augment are both confirmed', () => {
    expect(shouldActivateSelectionCapture({
      confirmedSelectionUi: true,
      recognizedAugmentCount: 1,
      hasVisibleAugments: false,
    })).toBe(true)
  })

  it('keeps the gate thumbnail independent from the OCR thumbnail', () => {
    expect(GATE_CAPTURE_THUMBNAIL_SIZE).toEqual({ width: 640, height: 360 })
    expect(GAMEFLOW_CAPTURE_THUMBNAIL_SIZE).toEqual({ width: 1024, height: 576 })
  })

  it('stays on gate frames until a full capture is queued', () => {
    expect(resolveCaptureStage({
      mode: 'idle',
      pendingFullCapture: false,
    })).toBe('gate')
    expect(resolveCaptureStage({
      mode: 'idle',
      pendingFullCapture: true,
    })).toBe('full')
    expect(resolveCaptureStage({
      mode: 'active-selection',
      pendingFullCapture: false,
    })).toBe('full')
  })

  it('does not upgrade while the full OCR cooldown is active', () => {
    const now = 1000
    expect(resolveCaptureStage({
      mode: 'idle',
      pendingFullCapture: true,
      fullOcrCooldownUntil: now + FULL_OCR_BACKOFF_MS,
      now,
    })).toBe('gate')
    expect(resolveCaptureStage({
      mode: 'idle',
      pendingFullCapture: true,
      fullOcrCooldownUntil: now,
      now,
    })).toBe('full')
  })

  it('tracks consecutive gate candidates and queues full capture at the threshold', () => {
    const first = resolveCandidateStreak({
      gateLikely: true,
      rerollVisible: true,
      currentStreak: 0,
    })
    const second = resolveCandidateStreak({
      gateLikely: true,
      rerollVisible: true,
      currentStreak: first,
    })

    expect(first).toBe(1)
    expect(second).toBe(SELECTION_CANDIDATE_STREAK_THRESHOLD)
    expect(shouldQueueFullCapture({
      candidateStreak: second,
      fullOcrCooldownUntil: 0,
    })).toBe(true)
    expect(shouldQueueFullCapture({
      candidateStreak: second,
      fullOcrCooldownUntil: Date.now() + FULL_OCR_BACKOFF_MS,
    })).toBe(false)
  })

  it('resets the candidate streak when the gate stops looking like a selection', () => {
    expect(resolveCandidateStreak({
      gateLikely: true,
      rerollVisible: false,
      currentStreak: 2,
    })).toBe(0)
    expect(resolveCandidateStreak({
      gateLikely: false,
      rerollVisible: true,
      currentStreak: 2,
    })).toBe(0)
  })

  it('computes a future full OCR backoff timestamp', () => {
    const now = 1000
    expect(resolveFullOcrBackoffUntil(now)).toBe(now + FULL_OCR_BACKOFF_MS)
  })
})
