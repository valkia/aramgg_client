<template>
  <details ref="disclosure" class="mt-3 border-t border-border pt-2" @toggle="onToggle">
    <summary ref="summary" class="cursor-pointer rounded py-2 text-xs font-semibold text-primary focus-visible:outline focus-visible:outline-primary">
      {{ t('matchAnalysis.details') }} · {{ t('matchHistory.players', { count: match.participants?.length || 0 }) }}
    </summary>
    <MatchScoreboardContent v-if="expanded" :match="match" :loading="loading" />
  </details>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HextechAramMatchHistoryMatch } from '../../shared/ipc-contract.ts'
import MatchScoreboardContent from './MatchScoreboardContent.vue'

defineProps<{ match: HextechAramMatchHistoryMatch; loading?: boolean }>()
const { t } = useI18n()
const expanded = ref(false)
const disclosure = ref<HTMLDetailsElement>()
const summary = ref<HTMLElement>()
async function open() {
  if (!disclosure.value) return
  disclosure.value.open = true
  expanded.value = true
  await nextTick()
  summary.value?.focus({ preventScroll: true })
  summary.value?.scrollIntoView({ block: 'start' })
}
function onToggle(event: Event) { expanded.value = (event.target as HTMLDetailsElement).open }
defineExpose({ open })
</script>
