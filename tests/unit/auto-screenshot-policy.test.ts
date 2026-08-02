import { describe, expect, it } from 'vitest'
import {
  GAMEFLOW_ACTIVE_CAPTURE_INTERVAL_MS,
  GAMEFLOW_CAPTURE_THUMBNAIL_SIZE,
  GAMEFLOW_IDLE_CAPTURE_INTERVAL_MS,
  resolveCaptureModeAfterAnalysis,
  resolveGameflowCaptureInterval,
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
})
