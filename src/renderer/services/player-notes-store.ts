import { computed, ref, type InjectionKey } from 'vue'
import type { ElectronAPI, PlayerNote, PlayerNoteDraft, PlayerNotesResult } from '../../shared/ipc-contract.ts'

export function createPlayerNotesStore(api: ElectronAPI['playerNotes']) {
  const notes = ref<PlayerNote[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const busy = ref(false)
  const error = ref(false)
  let loadPromise: Promise<boolean> | undefined
  const byKey = computed(() => new Map(notes.value.map((note) => [note.playerKey, note])))

  function apply(result: PlayerNotesResult): void {
    if (!result.success || !result.notes) throw new Error('Player notes unavailable')
    notes.value = result.notes
    loaded.value = true
  }

  async function load(force = false): Promise<boolean> {
    if (loadPromise) return loadPromise
    if (busy.value || (loaded.value && !force)) return loaded.value
    loading.value = true
    error.value = false
    loadPromise = (async () => {
      try { apply(await Promise.resolve().then(() => api.list())); return true } catch { error.value = true; return false }
      finally { loading.value = false; loadPromise = undefined }
    })()
    return loadPromise
  }

  async function mutate(operation: () => Promise<PlayerNotesResult>): Promise<boolean> {
    if (busy.value || !await load()) return false
    if (busy.value) return false
    busy.value = true
    error.value = false
    try { apply(await operation()); return true } catch { error.value = true; return false }
    finally { busy.value = false }
  }
  async function fileOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (busy.value || loading.value) throw new Error('Player notes are busy')
    busy.value = true
    try { return await operation() } finally { busy.value = false }
  }
  return { notes, byKey, loaded, loading, busy, error, load,
    save: (note: PlayerNoteDraft) => mutate(() => api.save(note)),
    remove: (key: string) => mutate(() => api.remove(key)),
    exportBackup: () => fileOperation(() => api.exportBackup()),
    previewImport: () => fileOperation(() => api.previewImport()),
    applyImport: (token: string) => mutate(() => api.applyImport(token)),
    cancelImport: (token: string) => api.cancelImport(token),
  }
}

export type PlayerNotesStore = ReturnType<typeof createPlayerNotesStore>
export const PLAYER_NOTES_KEY: InjectionKey<PlayerNotesStore> = Symbol('playerNotes')
