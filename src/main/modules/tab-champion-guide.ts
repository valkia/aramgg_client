import { app } from 'electron'
import store from './app-store.ts'
import { getChampionMonitorState } from './champion-monitor-state.ts'
import { showCurrentChampionGuide, hideCurrentChampionGuide } from './champion-guide.ts'
import { getPopupPresentation } from './window-manager.ts'
import { getMacTabState, requestMacTabAccess } from './mac-game-capture.ts'
import logger from './logger.ts'

const ENABLED_KEY = 'championInsight.tabGuide'
let timer: ReturnType<typeof setTimeout> | null = null
let held = false
let generation = 0
let ownedByTab = false
let stopped = false

export function getTabGuideStatus() {
    const native = getMacTabState(store.get(ENABLED_KEY) === true && getChampionMonitorState().phase === 'InProgress')
    return { supported: process.platform === 'darwin' && !!native,
        enabled: store.get(ENABLED_KEY) === true, authorized: native?.authorized === true }
}

export function setTabGuideEnabled(enabled: boolean) {
    store.set(ENABLED_KEY, enabled)
    if (enabled) requestMacTabAccess()
    else { held = false; resetTabGuide() }
    return getTabGuideStatus()
}

function resetTabGuide() {
    generation++
    if (ownedByTab && getPopupPresentation().clickThrough) hideCurrentChampionGuide()
    ownedByTab = false
}

export async function tickTabGuide(): Promise<void> {
    const state = getChampionMonitorState()
    const enabled = store.get(ENABLED_KEY) === true && state.phase === 'InProgress'
    const native = getMacTabState(enabled)
    const pressed = enabled && native?.listening && native.gameFrontmost && native.held
    if (!pressed) {
        held = false
        resetTabGuide()
        return
    }
    if (held) return
    held = true
    const current = ++generation
    const result = await showCurrentChampionGuide('tab', () => current === generation)
    if (current !== generation) return
    ownedByTab = result.success
}

export function startTabGuideMonitor(): void {
    if (process.platform !== 'darwin' || timer) return
    stopped = false
    const tick = () => {
        void tickTabGuide().catch(error => { logger.debug('[champion-guide] Tab monitor unavailable:', String(error)); resetTabGuide() })
        if (!stopped) {
            timer = setTimeout(tick, getChampionMonitorState().phase === 'InProgress' ? 50 : 1000)
            timer.unref()
        }
    }
    timer = setTimeout(tick, 0)
    timer.unref()
    app.once('will-quit', () => {
        stopped = true
        if (timer) clearTimeout(timer)
        timer = null
        getMacTabState(false)
    })
}
