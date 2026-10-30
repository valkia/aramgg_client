<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChartNoAxesCombined } from 'lucide-vue-next'
import type { ChampionPatchEvidence, PatchChangeRecord } from '../../shared/patch-evidence.ts'
import { electronAPI, hasElectronAPI } from '../native/electron-api.ts'

const props = defineProps<{
  evidence: ChampionPatchEvidence | null
  championId: number
  augmentNames?: Record<number, string>
}>()
const { t, locale } = useI18n()
const linkFailed = ref(false)
const data = computed(() => props.evidence?.locale === locale.value && props.evidence.championId === props.championId ? props.evidence : null)
const championNotes = computed(() => data.value?.notes?.records.filter((record) => record.kind === 'champion') || [])
const poolNotes = computed(() => data.value?.notes?.records.filter((record) => record.kind !== 'champion') || [])
const points = computed(() => data.value?.history.points || [])
const previous = computed(() => data.value?.history.status === 'ready' ? points.value.at(-2) : null)
const delta = computed(() => {
  const current = data.value?.current.winRate
  const before = previous.value?.winRate
  if (current == null || before == null) return null
  return new Intl.NumberFormat(locale.value, { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' }).format((current - before) * 100)
})
function formatRate(value: number | null): string {
  return value === null ? '—' : new Intl.NumberFormat(locale.value, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}
function title(record: PatchChangeRecord): string {
  return record.title || (record.subjectId !== null ? props.augmentNames?.[record.subjectId] || t('patchEvidence.augment', { id: record.subjectId }) : '')
}
async function openSource(url: string): Promise<void> {
  linkFailed.value = false
  try {
    if (!hasElectronAPI() || !(await electronAPI.shell.openExternal(url)).success) linkFailed.value = true
  } catch { linkFailed.value = true }
}
</script>

<template>
  <section v-if="data" class="analysis-panel min-w-0 p-3" :aria-label="t('patchEvidence.title')">
    <h3 class="analysis-heading m-0 text-sm"><ChartNoAxesCombined aria-hidden="true" />{{ t('patchEvidence.title') }}</h3>
    <p class="mt-1 text-[11px] text-muted-foreground">{{ t('patchEvidence.scope') }}</p>
    <p class="mt-1 break-words text-[11px] text-muted-foreground">{{ data.current.publicPatch ? t('patchEvidence.version', { publicPatch: data.current.publicPatch, gamePatch: data.current.gamePatch }) : t('patchEvidence.unmapped', { gamePatch: data.current.gamePatch || '—' }) }}</p>
    <p class="mt-1 text-[11px] text-muted-foreground">{{ t('patchEvidence.date', { date: data.current.date || '—' }) }}</p>
    <p class="mt-1 break-words text-[11px] text-muted-foreground">{{ t('patchEvidence.source', { source: data.source === 'tencent' ? t('patchEvidence.tencent') : data.source || t('patchEvidence.unknown'), region: data.region || t('patchEvidence.unknown') }) }}</p>

    <details class="analysis-inset mt-3 p-2 text-xs" data-testid="patch-notes">
      <summary class="analysis-disclosure cursor-pointer font-semibold">{{ t('patchEvidence.notes') }}</summary>
      <p class="mt-2 leading-relaxed text-muted-foreground">{{ t('patchEvidence.noteScope') }}</p>
      <template v-if="data.notes">
        <p class="mt-2 text-[11px] text-muted-foreground">{{ t('patchEvidence.effective', { date: data.notes.effectiveDate, verified: data.notes.verifiedAt }) }}</p>
        <button type="button" class="mt-2 rounded text-primary underline underline-offset-2 focus-visible:outline-primary" @click="openSource(data.notes.sourceUrl)">{{ t('patchEvidence.official') }}</button>
        <div v-if="championNotes.length" class="mt-3">
          <h4 class="font-medium">{{ t('patchEvidence.championChanges') }}</h4>
          <ul v-for="(record, index) in championNotes" :key="index" class="mt-1 list-disc space-y-1 pl-4 leading-relaxed">
            <li v-for="(line, lineIndex) in record.lines" :key="lineIndex" class="break-words">{{ line }}</li>
          </ul>
        </div>
        <details v-if="poolNotes.length" class="mt-3">
          <summary class="analysis-disclosure cursor-pointer font-medium">{{ t('patchEvidence.poolChanges') }}</summary>
          <div class="mt-2 max-h-72 space-y-3 overflow-y-auto">
            <div v-for="(record, index) in poolNotes" :key="index">
              <h4 class="break-words font-medium">{{ title(record) }}</h4>
              <ul class="mt-1 list-disc space-y-1 pl-4 leading-relaxed text-muted-foreground"><li v-for="(line, lineIndex) in record.lines" :key="lineIndex" class="break-words">{{ line }}</li></ul>
            </div>
          </div>
        </details>
      </template>
      <p v-else class="mt-2 leading-relaxed text-muted-foreground">{{ t('patchEvidence.noNotes') }}</p>
    </details>

    <details class="analysis-inset mt-2 p-2 text-xs" data-testid="patch-history">
      <summary class="analysis-disclosure cursor-pointer font-semibold">{{ t('patchEvidence.history') }}</summary>
      <p v-if="delta !== null && previous" class="mt-2 font-medium" data-testid="trend-delta">{{ t('patchEvidence.delta', { patch: previous.publicPatch || previous.gamePatch, value: delta }) }}</p>
      <p v-if="previous?.tier !== null && previous?.tier !== undefined && data.current.tier !== null" class="mt-1">{{ t('patchEvidence.tierDelta', { before: previous.tier, after: data.current.tier }) }}</p>
      <p v-if="data.history.status !== 'ready'" class="mt-2 leading-relaxed text-muted-foreground" role="status">{{ t(`patchEvidence.${data.history.status}`) }}</p>
      <table class="analysis-table mt-3 w-full table-fixed border-collapse text-[11px] tabular-nums">
        <colgroup><col class="w-[36%]" /><col class="w-[24%]" /><col class="w-[24%]" /><col class="w-[16%]" /></colgroup>
        <thead><tr class="text-muted-foreground"><th v-for="key in ['patch', 'winRate', 'pickRate', 'tier']" :key="key" scope="col" class="break-words px-0.5 py-1 text-right font-normal first:text-left">{{ t(`patchEvidence.${key}`) }}</th></tr></thead>
        <tbody><tr v-for="point in points" :key="`${point.gamePatch}:${point.date}`" class="border-t border-border">
          <th scope="row" class="px-0.5 py-2 text-left font-normal"><span>{{ point.publicPatch || point.gamePatch || '—' }}</span><span class="mt-0.5 block break-words text-[10px] text-muted-foreground">{{ point.date || '—' }}</span></th>
          <td class="px-0.5 text-right">{{ formatRate(point.winRate) }}</td><td class="px-0.5 text-right">{{ formatRate(point.pickRate) }}</td>
          <td class="px-0.5 text-right">{{ point.tier === null ? '—' : `T${point.tier}` }}</td>
        </tr></tbody>
      </table>
      <p class="mt-2 leading-relaxed text-muted-foreground">{{ t('patchEvidence.historyScope') }}</p>
      <p class="mt-2 leading-relaxed text-muted-foreground">{{ t('patchEvidence.currentRecord') }}</p>
      <p class="mt-2 break-words text-[11px] text-muted-foreground">{{ t('patchEvidence.archive', { date: data.history.archivedAt }) }}</p>
      <button type="button" class="mt-2 rounded text-primary underline underline-offset-2 focus-visible:outline-primary" @click="openSource(data.history.sourceUrl)">{{ t('patchEvidence.archiveLink') }}</button>
    </details>
    <p v-if="linkFailed" class="mt-2 text-xs text-destructive" role="alert">{{ t('patchEvidence.linkFailed') }}</p>
  </section>
</template>
