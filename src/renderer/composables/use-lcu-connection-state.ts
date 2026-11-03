import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { LcuConnectionState, Unsubscribe } from '../../shared/ipc-contract.ts'
import { electronAPI, hasElectronAPI } from '../native/electron-api.ts'

export function useLcuConnectionState() {
  const state = ref<LcuConnectionState>({ connection: 'checking', phase: null, revision: -1 })
  let disposed = false
  let unsubscribe: Unsubscribe | undefined

  const apply = (next: LcuConnectionState) => {
    if (!disposed && next.revision > state.value.revision) state.value = { ...next }
  }

  onMounted(async () => {
    if (!hasElectronAPI()) {
      state.value = { connection: 'unavailable', phase: null, revision: -1 }
      return
    }
    unsubscribe = electronAPI.events.on('lcu-connection-changed', apply)
    try {
      apply(await electronAPI.lcu.getConnectionState())
    } catch {
      if (!disposed && state.value.revision === -1) {
        state.value = { connection: 'unavailable', phase: null, revision: -1 }
      }
    }
  })
  onBeforeUnmount(() => { disposed = true; unsubscribe?.() })
  return state
}
