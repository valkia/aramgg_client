<template>
  <details v-if="store" class="mt-3 rounded border border-border bg-card/50 p-3" @toggle="onToggle">
    <summary class="cursor-pointer text-sm font-semibold text-primary">{{ t('playerNotes.title') }} <span v-if="store.loaded.value" class="text-xs text-muted-foreground">· {{ t('playerNotes.count', { count: store.notes.value.length }) }}</span></summary>
    <div v-if="expanded" class="mt-3 space-y-3">
      <p class="text-xs text-muted-foreground">{{ t('playerNotes.localOnly') }}</p>
      <p v-if="store.loading.value" class="text-xs text-muted-foreground" role="status">{{ t('common.loading') }}</p>
      <div v-if="store.error.value" class="text-xs text-destructive" role="alert">
        {{ t('playerNotes.loadFailed') }} <button type="button" class="min-h-8 underline" :disabled="store.busy.value || store.loading.value" @click="store.load(true)">{{ t('playerNotes.retry') }}</button>
      </div>
      <div v-if="store.loaded.value" class="space-y-2">
        <div class="flex flex-wrap gap-2">
          <label class="min-w-32 flex-1 text-xs text-muted-foreground">{{ t('playerNotes.search') }}<input v-model="search" type="search" :placeholder="t('playerNotes.searchPlaceholder')" class="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-foreground" /></label>
          <label class="min-w-28 flex-1 text-xs text-muted-foreground">{{ t('playerNotes.label') }}<select v-model="label" class="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-foreground"><option value="all">{{ t('playerNotes.allLabels') }}</option><option v-for="value in PLAYER_NOTE_LABELS" :key="value" :value="value">{{ t(`playerNotes.${value}`) }}</option></select></label>
        </div>
        <button type="button" class="min-h-8 text-xs text-primary disabled:opacity-50" :disabled="store.busy.value || store.loading.value" @click="store.load(true)">{{ t('playerNotes.refresh') }}</button>
        <ul class="max-h-96 space-y-2 overflow-y-auto">
          <li v-for="note in filteredNotes" :key="note.playerKey" class="rounded border border-border p-2">
            <p class="break-words text-xs font-semibold text-foreground">{{ note.playerName || t('playerNotes.unknownPlayer') }} <span class="font-normal text-muted-foreground">· {{ note.playerKey.split(':')[0] }}</span></p>
            <PlayerNoteEditor :player-key="note.playerKey" :player-name="note.playerName" />
          </li>
        </ul>
        <p v-if="!filteredNotes.length" class="text-xs text-muted-foreground">{{ t(store.notes.value.length ? 'playerNotes.noResults' : 'playerNotes.empty') }}</p>
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PlayerNoteLabel } from '../../shared/ipc-contract.ts'
import { PLAYER_NOTE_LABELS } from '../../shared/player-notes.ts'
import { PLAYER_NOTES_KEY } from '../services/player-notes-store.ts'
import PlayerNoteEditor from './PlayerNoteEditor.vue'

const store = inject(PLAYER_NOTES_KEY, undefined)
const { t } = useI18n()
const expanded = ref(false)
const search = ref('')
const label = ref<PlayerNoteLabel | 'all'>('all')
const filteredNotes = computed(() => (store?.notes.value || []).filter((note) =>
  (label.value === 'all' || note.label === label.value)
  && `${note.playerName} ${note.text}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()),
))
function onToggle(event: Event) {
  expanded.value = (event.target as HTMLDetailsElement).open
  if (expanded.value) void store?.load()
}
</script>
