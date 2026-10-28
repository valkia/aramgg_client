<template>
  <section class="mt-3 rounded-md border border-border bg-card/60 p-3" :aria-label="t('matchAnalysis.overview')">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="text-sm font-semibold text-foreground">{{ t('matchAnalysis.overview') }}</h3>
      <span v-if="summary.streak >= 3" class="rounded border border-border px-2 py-1 text-xs" :class="summary.streakResult === 'win' ? 'text-[var(--lol-success)]' : 'text-[var(--lol-crimson)]'">
        {{ t(summary.streakResult === 'win' ? 'matchAnalysis.winStreak' : 'matchAnalysis.lossStreak', { count: summary.streak }) }}
      </span>
    </div>
    <div v-if="summary.completed" class="mt-3 grid grid-cols-2 gap-3 tabular-nums">
      <div>
        <p class="text-xs text-muted-foreground">{{ t('matchAnalysis.winRate') }}</p>
        <p class="mt-1 text-xl font-bold" :class="summary.winRate! >= 50 ? 'text-[var(--lol-success)]' : 'text-[var(--lol-crimson)]'">{{ summary.winRate!.toFixed(0) }}%</p>
        <div class="my-2 h-1 overflow-hidden rounded bg-muted" aria-hidden="true"><div class="h-full bg-[var(--lol-success)]" :style="{ width: `${summary.winRate}%` }" /></div>
        <p class="text-xs text-muted-foreground">{{ t('matchAnalysis.record', summary) }}</p>
      </div>
      <div>
        <p class="text-xs text-muted-foreground">{{ t('matchAnalysis.averageKda') }}</p>
        <p class="mt-1 text-xl font-bold text-primary">{{ summary.kda!.toFixed(2) }}</p>
        <p class="mt-3 text-xs text-muted-foreground">{{ t('matchAnalysis.averageScore', { kills: summary.averageKills.toFixed(1), deaths: summary.averageDeaths.toFixed(1), assists: summary.averageAssists.toFixed(1) }) }}</p>
      </div>
    </div>
    <p v-else class="mt-2 text-xs text-muted-foreground">{{ t('matchAnalysis.noCompleted') }}</p>
    <div v-if="summary.ordered.length" class="mt-3">
      <p class="mb-2 text-xs text-muted-foreground">{{ t('matchAnalysis.trend') }}</p>
      <ol class="flex flex-wrap gap-1.5">
        <li v-for="match in summary.ordered" :key="match.gameId" class="flex h-7 min-w-7 items-center justify-center rounded px-1 text-xs font-bold" :class="resultClasses[match.result]" :title="`${match.championName || t('matchHistory.championFallback', { id: match.championId })} · ${match.kills}/${match.deaths}/${match.assists}`">
          {{ t(resultKeys[match.result]) }}
        </li>
      </ol>
    </div>
    <p class="mt-3 text-xs leading-relaxed text-muted-foreground">{{ t('matchAnalysis.scope', { count: summary.completed }) }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HextechAramMatchHistoryMatch } from '../../shared/ipc-contract.ts'
import { summarizeMatches } from '../services/match-history-insights.ts'

const props = defineProps<{ matches: HextechAramMatchHistoryMatch[] }>()
const { t } = useI18n()
const summary = computed(() => summarizeMatches(props.matches))
const resultKeys = { win: 'matchHistory.victory', loss: 'matchHistory.defeat', remake: 'matchHistory.remake' }
const resultClasses = {
  win: 'bg-[var(--lol-success)]/15 text-[var(--lol-success)]',
  loss: 'bg-[var(--lol-crimson)]/15 text-[var(--lol-crimson)]',
  remake: 'bg-muted text-muted-foreground',
}
</script>
