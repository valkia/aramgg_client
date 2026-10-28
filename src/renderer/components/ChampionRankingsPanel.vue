<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RefreshCw } from 'lucide-vue-next'
import type { ChampionRankingEntry, ChampionRankings } from '../../shared/ipc-contract.ts'
import { electronAPI, hasElectronAPI } from '../native/electron-api.ts'
import { filterChampionRankings, sortChampionRankings, type ChampionSortKey, type ChampionSortDirection } from '../services/champion-rankings.ts'

const { t, locale } = useI18n()
const data = ref<ChampionRankings | null>(null)
const loading = ref(false)
const errorKey = ref('')
const keyword = ref('')
const sortKey = ref<ChampionSortKey>('tier')
const direction = ref<ChampionSortDirection>('ascending')
const failedIcons = ref(new Set<number>())
const opening = ref(false)
const openError = ref(false)
const columns: ChampionSortKey[] = ['tier', 'winRate', 'pickRate', 'numGames']
let requestSequence = 0
let openSequence = 0
let active = true

const rows = computed(() => sortChampionRankings(filterChampionRankings(data.value?.champions || [], keyword.value), sortKey.value, direction.value))
const missingGames = computed(() => data.value?.champions.filter((row) => row.numGames === null).length || 0)
const uniqueEvidence = (key: 'source' | 'region' | 'statsDate') => {
  const values = [...new Set(data.value?.champions.map((row) => row[key] || t('championRankings.unknown')) || [])]
  return values.map((value) => key === 'source' && value === 'tencent' ? t('championRankings.tencent') : value).join(', ')
}
const evidence = computed(() => t('championRankings.evidence', {
  sources: uniqueEvidence('source'), regions: uniqueEvidence('region'), dates: uniqueEvidence('statsDate'),
}))

function name(row: ChampionRankingEntry): string {
  return row.name || row.alias || t('championRankings.championFallback', { id: row.championId })
}
function rowEvidence(row: ChampionRankingEntry): string {
  const unknown = t('championRankings.unknown')
  return t('championRankings.rowEvidence', {
    patch: row.gamePatch || unknown, date: row.statsDate || unknown,
    source: row.source === 'tencent' ? t('championRankings.tencent') : row.source || unknown, region: row.region || unknown,
  })
}
function format(row: ChampionRankingEntry, key: ChampionSortKey): string {
  const value = row[key]
  if (value === null) return '—'
  if (key === 'tier') return `T${value}`
  if (key === 'numGames') return new Intl.NumberFormat(locale.value).format(value)
  return new Intl.NumberFormat(locale.value, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)
}
function sort(key: ChampionSortKey): void {
  direction.value = sortKey.value === key
    ? direction.value === 'ascending' ? 'descending' : 'ascending'
    : key === 'tier' ? 'ascending' : 'descending'
  sortKey.value = key
}
async function openDetails(row: ChampionRankingEntry): Promise<void> {
  if (!hasElectronAPI() || opening.value) return
  const sequence = ++openSequence
  opening.value = true
  openError.value = false
  try {
    const result = await electronAPI.champions.openDetail(row.championId)
    if (active && sequence === openSequence) openError.value = !result.success
  } catch {
    if (active && sequence === openSequence) openError.value = true
  } finally {
    if (active && sequence === openSequence) opening.value = false
  }
}
async function load(): Promise<void> {
  const sequence = ++requestSequence
  const requestedLocale = locale.value
  loading.value = true
  errorKey.value = ''
  try {
    if (!hasElectronAPI()) throw new Error('api-unavailable')
    const result = await electronAPI.champions.getRankings()
    if (!active || sequence !== requestSequence || requestedLocale !== locale.value) return
    if (!result.success || !result.data || result.data.locale !== requestedLocale) {
      errorKey.value = 'championRankings.loadFailed'
      return
    }
    data.value = result.data
  } catch (error) {
    if (!active || sequence !== requestSequence || requestedLocale !== locale.value) return
    errorKey.value = error instanceof Error && error.message === 'api-unavailable'
      ? 'championRankings.apiUnavailable' : 'championRankings.loadFailed'
  } finally {
    if (active && sequence === requestSequence) loading.value = false
  }
}
watch(locale, () => {
  data.value = null
  keyword.value = ''
  failedIcons.value.clear()
  opening.value = false
  openSequence += 1
  openError.value = false
  void load()
}, { immediate: true })
onBeforeUnmount(() => { active = false; requestSequence += 1; openSequence += 1 })
</script>

<template>
  <section class="mt-3 min-w-0 rounded border border-border bg-card p-3 text-foreground" :aria-busy="loading">
    <header class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h2 class="m-0 text-sm font-semibold text-primary">{{ t('championRankings.title') }}</h2>
        <p class="mt-1 text-xs text-muted-foreground">{{ t('championRankings.description') }}</p>
      </div>
      <button type="button" class="flex size-8 shrink-0 items-center justify-center rounded border border-border text-primary focus-visible:outline-primary disabled:opacity-40" :disabled="loading" :aria-label="t('championRankings.retry')" :title="t('championRankings.retry')" @click="load">
        <RefreshCw class="size-3.5" :class="{ 'animate-spin motion-reduce:animate-none': loading }" aria-hidden="true" />
      </button>
    </header>
    <div v-if="data" class="mt-2 flex flex-wrap gap-x-3 gap-y-1 break-words text-[11px] text-muted-foreground">
      <span>{{ t('championRankings.dataVersion', { version: data.dataVersion }) }}</span>
      <span>{{ t('championRankings.gamePatch', { patch: data.gamePatch || '—' }) }}</span>
      <span>{{ t('championRankings.offlineReady') }}</span>
    </div>
    <p v-if="errorKey" class="mt-2 text-xs text-destructive" role="alert">{{ t(errorKey) }}</p>
    <p v-if="openError" class="mt-2 text-xs text-destructive" role="alert">{{ t('championRankings.openFailed') }}</p>
    <p v-if="loading" class="mt-2 text-xs text-muted-foreground" role="status">{{ t('championRankings.loading') }}</p>
    <template v-if="data?.champions.length">
      <div class="mt-3 flex items-center gap-2">
        <input v-model="keyword" type="search" class="h-8 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-primary" :placeholder="t('championRankings.search')" :aria-label="t('championRankings.search')" />
        <button v-if="keyword" type="button" class="h-8 shrink-0 rounded border border-border px-2 text-xs text-primary focus-visible:outline-primary" @click="keyword = ''">{{ t('championRankings.clearSearch') }}</button>
      </div>
      <p class="my-2 text-[11px] text-muted-foreground" aria-live="polite">{{ t('championRankings.count', { count: rows.length, total: data.champions.length }) }}</p>
      <div class="max-h-96 overflow-y-auto rounded border border-border">
        <table class="w-full table-fixed border-collapse text-[11px] tabular-nums">
          <colgroup><col class="w-[34%]" /><col class="w-[12%]" /><col class="w-[18%]" /><col class="w-[18%]" /><col class="w-[18%]" /></colgroup>
          <thead class="sticky top-0 z-10 bg-card text-muted-foreground">
            <tr>
              <th scope="col" class="px-2 py-2 text-left font-medium">{{ t('championRankings.hero') }}</th>
              <th v-for="key in columns" :key="key" scope="col" class="px-0.5 py-2 text-right font-medium" :aria-sort="sortKey === key ? direction : 'none'">
                <button type="button" class="w-full whitespace-normal rounded py-1 text-right leading-tight focus-visible:outline-primary" :class="{ 'text-primary': sortKey === key }" @click="sort(key)">
                  {{ t(`championRankings.${key}`) }}<span aria-hidden="true">{{ sortKey === key ? direction === 'ascending' ? ' ↑' : ' ↓' : ' ↕' }}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.championId" class="border-t border-border hover:bg-muted/40">
              <th scope="row" class="px-2 py-2 text-left font-normal">
                <button type="button" class="flex w-full min-w-0 items-center gap-1.5 rounded text-left focus-visible:outline-primary disabled:opacity-50" :disabled="opening" :aria-label="t('championRankings.openDetails', { name: name(row) })" :title="[name(row), row.title, row.alias, rowEvidence(row)].filter(Boolean).join(' · ')" @click="openDetails(row)">
                  <img v-if="row.iconUrl && !failedIcons.has(row.championId)" :src="row.iconUrl" alt="" class="size-6 shrink-0 rounded object-cover" loading="lazy" @error="failedIcons.add(row.championId)" />
                  <span v-else class="flex size-6 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground" aria-hidden="true">{{ name(row).slice(0, 1) }}</span>
                  <span class="min-w-0 truncate font-medium">{{ name(row) }}</span>
                  <span class="sr-only">{{ rowEvidence(row) }}</span>
                </button>
              </th>
              <td v-for="key in columns" :key="key" class="break-all px-0.5 py-2 text-right" :class="{ 'text-primary font-semibold': key === 'tier' && row.tier !== null }">{{ format(row, key) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!rows.length" class="m-0 px-3 py-5 text-center text-xs text-muted-foreground" role="status">{{ t('championRankings.noMatches') }}</p>
      </div>
      <details class="mt-2 text-[11px] text-muted-foreground">
        <summary class="cursor-pointer rounded py-1 focus-visible:outline-primary">{{ t('championRankings.scope') }}</summary>
        <p class="mt-1 leading-relaxed">{{ t('championRankings.scopeHint') }}</p>
        <p v-if="missingGames" class="mt-1">{{ t('championRankings.missingGames', { count: missingGames }) }}</p>
        <p class="mt-1 break-words">{{ evidence }}</p>
        <p class="mt-1 break-words">{{ t('championRankings.generatedAt', { value: data.generatedAt || t('championRankings.unknown') }) }}</p>
      </details>
    </template>
    <p v-else-if="data && !loading" class="mt-3 text-xs text-muted-foreground" role="status">{{ t('championRankings.noData') }}</p>
  </section>
</template>
