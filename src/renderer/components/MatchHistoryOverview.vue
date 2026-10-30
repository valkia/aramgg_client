<template>
  <section class="analysis-panel mt-3 p-3" :aria-label="t('matchAnalysis.overview')">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="analysis-heading text-sm"><ChartNoAxesCombined aria-hidden="true" />{{ t('matchAnalysis.overview') }}</h3>
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
    <template v-if="summary.completed">
      <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 tabular-nums">
        <div v-for="metric in performanceMetrics" :key="metric.key" class="min-w-0">
          <dt class="break-words text-xs text-muted-foreground">{{ t(metric.label) }}</dt>
          <dd class="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span class="text-sm font-semibold text-foreground">{{ formatMetric(metric.value, metric.percent) }}</span>
            <span class="text-xs text-muted-foreground">{{ t('matchAnalysis.metricSamples', { count: metric.samples }) }}</span>
          </dd>
        </div>
      </dl>
      <details class="mt-2 text-xs leading-relaxed text-muted-foreground">
        <summary class="analysis-disclosure cursor-pointer py-1">{{ t('matchAnalysis.performanceMethod') }}</summary>
        <p class="mt-1">{{ t('matchAnalysis.performanceMethodHint') }}</p>
      </details>
    </template>
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
import { ChartNoAxesCombined } from 'lucide-vue-next'
import type { HextechAramMatchHistoryMatch } from '../../shared/ipc-contract.ts'
import { summarizeMatches } from '../services/match-history-insights.ts'

const props = defineProps<{ matches: HextechAramMatchHistoryMatch[] }>()
const { t, locale } = useI18n()
const summary = computed(() => summarizeMatches(props.matches))
const performanceMetrics = computed(() => ([
  { key: 'damage', label: 'matchAnalysis.averageDamage', percent: false },
  { key: 'participation', label: 'matchAnalysis.averageParticipation', percent: true },
  { key: 'gold', label: 'matchAnalysis.averageGold', percent: false },
  { key: 'goldShare', label: 'matchAnalysis.averageGoldShare', percent: true },
] as const).map((metric) => ({ ...metric, ...summary.value.performance[metric.key] })))
function formatMetric(value: number | null, percent: boolean): string {
  if (value === null) return '—'
  const formatted = new Intl.NumberFormat(locale.value, { maximumFractionDigits: percent ? 1 : 0 }).format(value)
  return percent ? `${formatted}%` : formatted
}
const resultKeys = { win: 'matchHistory.victory', loss: 'matchHistory.defeat', remake: 'matchHistory.remake' }
const resultClasses = {
  win: 'bg-[var(--lol-success)]/15 text-[var(--lol-success)]',
  loss: 'bg-[var(--lol-crimson)]/15 text-[var(--lol-crimson)]',
  remake: 'bg-muted text-muted-foreground',
}
</script>
