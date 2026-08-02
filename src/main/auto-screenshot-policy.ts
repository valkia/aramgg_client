export type AutomaticCaptureMode = 'idle' | 'active-selection'

export const GAMEFLOW_ACTIVE_CAPTURE_INTERVAL_MS = 500
export const GAMEFLOW_IDLE_CAPTURE_INTERVAL_MS = 1500
export const GAMEFLOW_CAPTURE_THUMBNAIL_SIZE = { width: 1024, height: 576 } as const

export function resolveGameflowCaptureInterval(
    mode: AutomaticCaptureMode,
    activeIntervalMs = GAMEFLOW_ACTIVE_CAPTURE_INTERVAL_MS,
    idleIntervalMs = GAMEFLOW_IDLE_CAPTURE_INTERVAL_MS
): number {
    return mode === 'active-selection' ? activeIntervalMs : idleIntervalMs
}

export function resolveCaptureModeAfterAnalysis({
    currentMode,
    confirmedSelectionUi,
    hasVisibleAugments,
}: {
    currentMode: AutomaticCaptureMode
    confirmedSelectionUi: boolean
    hasVisibleAugments: boolean
}): AutomaticCaptureMode {
    if (confirmedSelectionUi) {
        return 'active-selection'
    }

    return hasVisibleAugments ? currentMode : 'idle'
}

export function shouldActivateSelectionCapture({
    confirmedSelectionUi,
    recognizedAugmentCount,
    hasVisibleAugments,
}: {
    confirmedSelectionUi: boolean
    recognizedAugmentCount: number
    hasVisibleAugments: boolean
}): boolean {
    return confirmedSelectionUi && (recognizedAugmentCount > 0 || hasVisibleAugments)
}
