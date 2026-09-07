import type { ChampionMonitorState, GameflowPhase } from '../../shared/ipc-contract.ts'
import store from './app-store.ts'
import { notifyAllWindows } from './window-manager.ts'

let state: ChampionMonitorState | null = null

function normalizeChampionId(value: unknown): number | null {
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? id : null
}

export function getChampionMonitorState(): ChampionMonitorState {
    state ??= {
        phase: null,
        selectedChampionId: null,
        lastChampionId: normalizeChampionId(store.get('lastSelectedChampionId')),
        revision: 0,
    }
    return { ...state }
}

export function rememberChampionId(value: number): void {
    const championId = normalizeChampionId(value)
    if (championId && store.get('lastSelectedChampionId') !== championId) {
        store.set('lastSelectedChampionId', championId)
    }
}

function publish(next: ChampionMonitorState): void {
    const previous = getChampionMonitorState()
    if (previous.phase === next.phase &&
        previous.selectedChampionId === next.selectedChampionId &&
        previous.lastChampionId === next.lastChampionId) {
        return
    }

    state = { ...next, revision: previous.revision + 1 }
    notifyAllWindows('champion-monitor-changed', { ...state })
}

export function setChampionMonitorPhase(phase: GameflowPhase): void {
    const previous = getChampionMonitorState()
    if (previous.phase === phase) return

    publish({
        ...previous,
        phase,
        selectedChampionId: phase === 'GameStart' || phase === 'InProgress'
            ? previous.selectedChampionId
            : null,
    })
}

export function setChampionMonitorChampion(value: number | null): void {
    const previous = getChampionMonitorState()
    const championId = normalizeChampionId(value)
    if (championId) rememberChampionId(championId)
    publish({
        ...previous,
        selectedChampionId: championId,
        lastChampionId: championId || previous.lastChampionId,
    })
}
