<template>
  <div v-if="store" class="mt-2 text-xs">
    <button ref="trigger" type="button" class="min-h-8 rounded border border-border px-2 py-1 font-semibold disabled:opacity-50" :class="note ? labelClasses[note.label] : 'text-muted-foreground'" :aria-label="t('playerNotes.editFor', { name: playerName || t('playerNotes.unknownPlayer') })" :aria-expanded="editing" :disabled="store.loading.value || store.busy.value" @click="openEditor">
      {{ note ? t(`playerNotes.${note.label}`) : t('playerNotes.add') }}
    </button>
    <p v-if="note?.text && !editing" class="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{{ note.text }}</p>
    <form v-if="editing" class="mt-2 space-y-2 rounded border border-border bg-card p-2" :aria-label="t('playerNotes.editFor', { name: playerName })" @submit.prevent="save">
      <fieldset :disabled="store.busy.value" class="space-y-2">
        <legend class="mb-1 text-muted-foreground">{{ t('playerNotes.label') }}</legend>
        <div class="flex flex-wrap gap-1">
          <button v-for="label in PLAYER_NOTE_LABELS" :key="label" type="button" class="min-h-8 rounded border px-2 py-1" :class="[labelClasses[label], draftLabel === label ? 'border-primary bg-primary/10' : 'border-border']" :aria-pressed="draftLabel === label" @click="draftLabel = label">{{ t(`playerNotes.${label}`) }}</button>
        </div>
        <label class="block text-muted-foreground">
          {{ t('playerNotes.text') }}
          <textarea v-model="draftText" rows="3" :maxlength="MAX_NOTE_TEXT_LENGTH" :placeholder="t('playerNotes.placeholder')" class="mt-1 block w-full resize-y rounded border border-border bg-background p-2 text-foreground focus-visible:outline-primary" />
        </label>
        <p class="text-right text-muted-foreground">{{ draftText.length }} / {{ MAX_NOTE_TEXT_LENGTH }}</p>
        <div class="flex flex-wrap justify-end gap-2">
          <button v-if="note" type="button" class="mr-auto min-h-8 text-destructive" @click="remove">{{ t('playerNotes.remove') }}</button>
          <button type="button" class="min-h-8 px-2 text-muted-foreground" @click="closeEditor">{{ t('playerNotes.cancel') }}</button>
          <button type="submit" class="min-h-8 rounded border border-primary/40 px-3 text-primary">{{ t(store.busy.value ? 'playerNotes.saving' : 'playerNotes.save') }}</button>
        </div>
      </fieldset>
    </form>
    <p v-if="feedback" class="mt-1 text-muted-foreground" :role="failed ? 'alert' : 'status'">{{ t(feedback) }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PlayerNoteLabel } from '../../shared/ipc-contract.ts'
import { MAX_NOTE_TEXT_LENGTH, PLAYER_NOTE_LABELS } from '../../shared/player-notes.ts'
import { PLAYER_NOTES_KEY } from '../services/player-notes-store.ts'

const props = defineProps<{ playerKey: string; playerName: string }>()
const store = inject(PLAYER_NOTES_KEY, undefined)
const { t } = useI18n()
const note = computed(() => store?.byKey.value.get(props.playerKey))
const editing = ref(false)
const draftText = ref('')
const draftLabel = ref<PlayerNoteLabel>('neutral')
const feedback = ref('')
const failed = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const labelClasses = { friendly: 'text-[var(--lol-success)]', neutral: 'text-muted-foreground', caution: 'text-primary', avoid: 'text-destructive' }
onMounted(() => { void store?.load() })
watch(() => props.playerKey, () => { editing.value = false; feedback.value = '' })
async function openEditor() {
  if (!store || !await store.load()) { failed.value = true; feedback.value = 'playerNotes.loadFailed'; return }
  draftText.value = note.value?.text || ''
  draftLabel.value = note.value?.label || 'neutral'
  feedback.value = ''
  editing.value = true
}
async function closeEditor() { editing.value = false; await nextTick(); trigger.value?.focus() }
async function save() {
  const success = await store?.save({ playerKey: props.playerKey, playerName: props.playerName, text: draftText.value, label: draftLabel.value })
  failed.value = !success
  feedback.value = success ? 'playerNotes.saved' : 'playerNotes.failed'
  if (success) await closeEditor()
}
async function remove() {
  const success = await store?.remove(props.playerKey)
  failed.value = !success
  feedback.value = success ? 'playerNotes.removed' : 'playerNotes.failed'
  if (success) await closeEditor()
}
</script>
