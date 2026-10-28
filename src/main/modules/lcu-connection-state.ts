import type { GameflowPhase, LcuConnectionState } from '../../shared/ipc-contract.ts'
import { notifyAllWindows } from './window-manager.ts'

const knownPhases = new Set<GameflowPhase>([
  'None', 'Lobby', 'Matchmaking', 'CheckedIntoGame', 'ReadyCheck', 'ChampSelect',
  'GameStart', 'InProgress', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame',
])

let state: LcuConnectionState = { connection: 'checking', phase: null, revision: 0 }

export function getLcuConnectionState(): LcuConnectionState {
  return { ...state }
}

export function setLcuConnectionState(
  connection: LcuConnectionState['connection'],
  phase: unknown = null,
): LcuConnectionState {
  const nextPhase = connection === 'connected' && knownPhases.has(phase as GameflowPhase)
    ? phase as GameflowPhase
    : null
  if (state.connection !== connection || state.phase !== nextPhase) {
    state = { connection, phase: nextPhase, revision: state.revision + 1 }
    notifyAllWindows('lcu-connection-changed', { ...state })
  }
  return getLcuConnectionState()
}

/** Only a recognized gameflow response proves an observed phase. */
export function observeLcuGameflow(phase: unknown, active: boolean): LcuConnectionState {
  return setLcuConnectionState(
    active && knownPhases.has(phase as GameflowPhase)
      ? 'connected'
      : active ? 'unavailable' : 'disconnected',
    phase,
  )
}
