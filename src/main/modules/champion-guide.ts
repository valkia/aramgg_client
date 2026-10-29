import type { OperationResult } from '../../shared/ipc-contract.ts'
import { getChampionMonitorState } from './champion-monitor-state.ts'
import { applyPopupWindowLayout, ensurePopupWindow, getPopupWindow, setPopupPresentation } from './window-manager.ts'
import { shouldHideChampionInsightOnGameStart, shouldShowChampionDetails } from './user-preferences.ts'

let requestGeneration = 0

export async function showCurrentChampionGuide(
    source: 'manual' | 'tab' | 'preference' = 'manual',
    stillWanted: () => boolean = () => true,
): Promise<OperationResult> {
    const request = ++requestGeneration
    const state = getChampionMonitorState()
    const inGame = state.phase === 'GameStart' || state.phase === 'InProgress'
    if ((!inGame && state.phase !== 'ChampSelect') || !state.selectedChampionId) {
        return { success: false, error: 'no-current-champion' }
    }
    const allowed = () => source !== 'preference' || (shouldShowChampionDetails() &&
        !(inGame && shouldHideChampionInsightOnGameStart()))
    if (!allowed()) return { success: false, error: 'hidden-by-preference' }
    const window = await ensurePopupWindow()
    const latest = getChampionMonitorState()
    if (request !== requestGeneration || !stillWanted() || !allowed() || window.isDestroyed() || latest.revision !== state.revision) {
        return { success: false, error: 'state-changed' }
    }
    applyPopupWindowLayout()
    setPopupPresentation(source !== 'preference', source === 'tab')
    window.webContents.send('for-popup', {
        championId: state.selectedChampionId,
        augments: [], benchRecommendation: null, champSelect: false,
        presentation: inGame ? 'in-game' : 'full',
        dataSource: 'current-champion', timestamp: Date.now(),
    })
    window.showInactive()
    window.moveTop()
    return { success: true }
}

export function hideCurrentChampionGuide(): void {
    requestGeneration++
    const window = getPopupWindow()
    if (window && !window.isDestroyed()) window.hide()
    setPopupPresentation(false)
}
