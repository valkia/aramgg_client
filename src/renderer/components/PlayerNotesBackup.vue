<template>
  <div v-if="store" class="space-y-2 border-t border-border pt-3 text-xs">
    <div class="flex flex-wrap gap-2">
      <button type="button" class="min-h-8 rounded border border-border px-3 disabled:opacity-50" :disabled="busy || !!preview" @click="exportNotes">{{ t('playerNotes.export') }}</button>
      <button type="button" class="min-h-8 rounded border border-border px-3 disabled:opacity-50" :disabled="busy || !!preview" @click="selectImport">{{ t('playerNotes.import') }}</button>
    </div>
    <p v-if="status" :role="failed ? 'alert' : 'status'" :class="failed ? 'text-destructive' : 'text-muted-foreground'">{{ t(status) }}</p>
    <div v-if="preview" class="space-y-2 rounded border border-primary/30 bg-primary/5 p-3">
      <p class="font-semibold">{{ t('playerNotes.importPreview') }}</p>
      <p>{{ t('playerNotes.importCounts', { total: preview.total, added: preview.added, kept: preview.kept }) }}</p>
      <p class="text-muted-foreground">{{ t('playerNotes.importRule') }}</p>
      <ul class="max-h-40 space-y-1 overflow-y-auto">
        <li v-for="note in preview.samples" :key="note.playerKey" class="break-words">{{ note.playerName || t('playerNotes.unknownPlayer') }} · {{ t(`playerNotes.${note.label}`) }}<span v-if="note.text"> · {{ note.text }}</span></li>
      </ul>
      <p v-if="preview.total > preview.samples.length" class="text-muted-foreground">{{ t('playerNotes.previewLimit', { count: preview.samples.length }) }}</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="min-h-8 rounded bg-primary px-3 text-primary-foreground disabled:opacity-50" :disabled="busy" @click="applyImport">{{ t('playerNotes.confirmImport') }}</button>
        <button type="button" class="min-h-8 rounded border border-border px-3 disabled:opacity-50" :disabled="busy" @click="cancelImport">{{ t('playerNotes.cancel') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PlayerNotesImportPreview } from '../../shared/ipc-contract.ts'
import { PLAYER_NOTES_KEY } from '../services/player-notes-store.ts'

const store = inject(PLAYER_NOTES_KEY, undefined)
const { t } = useI18n()
const preview = ref<PlayerNotesImportPreview>()
const status = ref('')
const failed = ref(false)
const busy = computed(() => store?.busy.value || store?.loading.value)
let disposed = false

async function exportNotes() {
  status.value = ''; failed.value = false
  try {
    const result = await store!.exportBackup()
    if (!result.success) throw new Error('Export failed')
    if (!result.canceled) status.value = 'playerNotes.exported'
  } catch { failed.value = true; status.value = 'playerNotes.exportFailed' }
}
async function selectImport() {
  status.value = ''; failed.value = false
  try {
    const result = await store!.previewImport()
    if (!result.success) throw new Error('Import failed')
    if (result.canceled) return
    if (!result.preview) throw new Error('Preview missing')
    if (disposed) { void store!.cancelImport(result.preview.token).catch(() => {}); return }
    preview.value = result.preview
  } catch { failed.value = true; status.value = 'playerNotes.importFailed' }
}
async function applyImport() {
  if (!preview.value) return
  failed.value = false; status.value = ''
  if (await store!.applyImport(preview.value.token)) {
    preview.value = undefined; status.value = 'playerNotes.imported'
  } else { failed.value = true; status.value = 'playerNotes.importFailed' }
}
function cancelImport() {
  if (preview.value) void store!.cancelImport(preview.value.token).catch(() => {})
  preview.value = undefined; status.value = ''; failed.value = false
}
onBeforeUnmount(() => { disposed = true; cancelImport() })
</script>
