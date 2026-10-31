<template>
    <div class="scoreboard-content mt-2 space-y-3" :class="{ 'scoreboard-wide': wide }">
      <p class="text-xs leading-relaxed text-muted-foreground">{{ t('matchAnalysis.metricsHint') }}</p>
      <section v-for="team in teams" :key="team.teamId" class="analysis-panel overflow-hidden" :aria-label="teamName(team.teamId, team.isCurrentTeam)">
        <header class="scoreboard-team-header flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <h4 class="analysis-heading text-sm"><Swords aria-hidden="true" />{{ teamName(team.teamId, team.isCurrentTeam) }}</h4>
          <span v-if="team.result" class="text-xs font-semibold" :class="team.result === 'win' ? 'text-[var(--lol-success)]' : 'text-muted-foreground'">{{ t(resultKeys[team.result]) }}</span>
          <p class="w-full text-xs text-muted-foreground">
            {{ t('matchAnalysis.teamTotals', { kills: number(team.kills), gold: number(team.gold) }) }}
          </p>
          <p v-if="!team.complete" class="text-xs text-muted-foreground">{{ t('matchAnalysis.incompleteTeam') }}</p>
        </header>
        <ol class="divide-y divide-border">
          <li v-for="player in team.players" :key="player.participantId" class="scoreboard-player p-3" :class="{ 'bg-primary/5': player.isCurrentPlayer }">
            <div class="scoreboard-identity-group">
            <div class="scoreboard-identity flex items-center gap-2">
              <img v-if="player.championIconUrl" :src="player.championIconUrl" alt="" class="h-9 w-9 shrink-0 rounded border border-border" loading="lazy" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-xs font-semibold text-foreground" :title="player.playerName">
                  {{ player.playerName || t('matchAnalysis.playerFallback', { id: player.participantId }) }}
                  <span v-if="player.isCurrentPlayer" class="ml-1 text-primary">{{ t('matchAnalysis.you') }}</span>
                </p>
                <p class="mt-0.5 truncate text-xs text-muted-foreground">{{ player.championName || t('matchHistory.championFallback', { id: player.championId }) }}</p>
              </div>
              <div class="shrink-0 text-right text-xs tabular-nums">
                <p class="font-bold text-foreground">{{ player.kills }} / {{ player.deaths }} / {{ player.assists }}</p>
                <p class="mt-0.5 text-muted-foreground">{{ t('matchAnalysis.participation', { value: percent(player.killParticipation) }) }}</p>
              </div>
            </div>
            <div v-if="player.isTopDamage || player.tripleKills || player.quadraKills || player.pentaKills" class="mt-2 flex flex-wrap gap-1 text-xs text-primary">
              <span v-if="player.isTopDamage" class="rounded border border-primary/30 px-1.5 py-0.5">{{ t('matchAnalysis.topDamage') }}</span>
              <template v-for="kind in multiKills" :key="kind">
                <span v-if="player[kind]" class="rounded border border-primary/30 px-1.5 py-0.5">{{ t(`matchAnalysis.${kind}`, { count: player[kind] }) }}</span>
              </template>
            </div>
            </div>
            <dl class="scoreboard-metrics mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs tabular-nums">
              <div v-for="metric in comparisonMetrics" :key="metric.value" class="min-w-0" :data-metric="metric.value">
                <dt class="break-words text-muted-foreground">{{ t(`matchAnalysis.${metric.label}`) }}</dt>
                <dd class="mt-1 text-foreground">{{ number(player[metric.value]) }} <span class="text-primary">{{ percent(player[metric.share]) }}</span></dd>
                <div v-if="player[metric.share] !== null" class="mt-1 h-1 overflow-hidden rounded bg-muted" aria-hidden="true"><div class="h-full" :class="metric.color" :style="{ width: `${player[metric.share]}%` }" /></div>
              </div>
              <div data-metric="damageToTurrets"><dt class="text-muted-foreground">{{ t('matchAnalysis.turretDamage') }}</dt><dd class="mt-1 text-foreground">{{ number(player.damageToTurrets) }}</dd></div>
              <div data-metric="goldEarned"><dt class="text-muted-foreground">{{ t('matchAnalysis.gold') }}</dt><dd class="mt-1 text-foreground">{{ number(player.goldEarned) }}<span class="mt-0.5 block text-muted-foreground">{{ t('matchAnalysis.goldPerMinute', { value: rate(player.goldPerMinute) }) }}</span></dd></div>
              <div data-metric="minionsKilled"><dt class="text-muted-foreground">{{ t('matchAnalysis.cs') }}</dt><dd class="mt-1 text-foreground">{{ number(player.minionsKilled) }}<span class="mt-0.5 block text-muted-foreground">{{ t('matchAnalysis.csPerMinute', { value: rate(player.csPerMinute) }) }}</span></dd></div>
            </dl>
            <div class="scoreboard-spells mt-3">
              <p class="mb-1 text-xs text-muted-foreground">{{ t('matchAnalysis.summonerSpells') }}</p>
              <ul class="flex flex-wrap gap-2 text-xs" :aria-label="t('matchAnalysis.summonerSpells')">
                <li v-for="(spellId, index) in [player.spell1Id, player.spell2Id]" :key="`${index}:${spellId}`" class="analysis-inset flex min-w-0 max-w-full items-center gap-1.5 px-1.5 py-1">
                  <img v-if="validSpellId(spellId)" :src="getSpellIconUrl(spellId)" alt="" class="h-6 w-6 shrink-0 rounded" loading="lazy" @error="hideImage" />
                  <span class="break-words text-foreground">{{ spellName(spellId) }}</span>
                </li>
              </ul>
            </div>
            <div class="scoreboard-assets">
            <div v-for="kind in assetKinds" :key="kind" class="mt-2">
              <p class="mb-1 text-xs text-muted-foreground">{{ t(`matchHistory.${kind}`) }}</p>
              <ul v-if="player[kind].length" class="flex flex-wrap gap-1" :aria-label="t(`matchHistory.${kind}`)">
                <li v-for="(asset, index) in player[kind]" :key="`${asset.id}:${index}`" class="analysis-inset flex min-h-7 min-w-7 items-center justify-center">
                  <MatchAssetTooltip :asset="asset" :kind="kind === 'items' ? 'item' : 'augment'" :disabled="loading">
                    <img v-if="asset.iconUrl" :src="asset.iconUrl" alt="" class="h-7 w-7 rounded object-contain" loading="lazy" />
                    <span v-else class="max-w-24 truncate px-1 text-xs text-muted-foreground">{{ assetName(asset, kind) }}</span>
                  </MatchAssetTooltip>
                </li>
              </ul>
              <p v-else class="text-xs text-muted-foreground">{{ t(kind === 'items' ? 'matchHistory.noItems' : 'matchHistory.noAugments') }}</p>
            </div>
            </div>
          </li>
        </ol>
      </section>
      <p v-if="!teams.length" class="text-xs text-muted-foreground">{{ t('matchAnalysis.noDetails') }}</p>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Swords } from 'lucide-vue-next'
import type { HextechAramMatchHistoryAsset, HextechAramMatchHistoryMatch } from '../../shared/ipc-contract.ts'
import { buildScoreboardTeams } from '../services/match-history-insights.ts'
import { getSpellIconUrl } from '../service/cdn.js'
import MatchAssetTooltip from './MatchAssetTooltip.vue'

const props = defineProps<{ match: HextechAramMatchHistoryMatch; loading?: boolean; wide?: boolean }>()
const { t, te, locale } = useI18n()
const teams = computed(() => buildScoreboardTeams(props.match.participants || [], props.match.gameDuration))
const hasCurrentTeam = computed(() => teams.value.some((team) => team.isCurrentTeam))
const resultKeys = { win: 'matchHistory.victory', loss: 'matchHistory.defeat', remake: 'matchHistory.remake' }
const assetKinds = ['augments', 'items'] as const
const multiKills = ['pentaKills', 'quadraKills', 'tripleKills'] as const
const comparisonMetrics = [
  { value: 'damageToChampions', share: 'damageShare', label: 'damage', color: 'bg-primary' },
  { value: 'damageTaken', share: 'takenShare', label: 'taken', color: 'bg-foreground/50' },
  { value: 'totalHeal', share: 'healShare', label: 'healing', color: 'bg-[var(--lol-success)]' },
] as const
function number(value: number | null | undefined) { return typeof value !== 'number' || !Number.isFinite(value) ? '—' : new Intl.NumberFormat(locale.value).format(value) }
function percent(value: number | null) { return value === null ? '—' : `${value.toFixed(0)}%` }
function rate(value: number | null) { return value === null ? '—' : new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(value) }
function validSpellId(id: number | null | undefined): id is number { return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 }
function spellName(id: number | null | undefined) {
  if (!validSpellId(id)) return '—'
  const key = `matchAnalysis.spellNames.${id}`
  return te(key) ? t(key) : t('matchAnalysis.spellFallback', { id })
}
function hideImage(event: Event) { (event.target as HTMLImageElement).hidden = true }
function teamName(id: number, current: boolean) {
  if ((id === 100 || id === 200) && hasCurrentTeam.value) return t(current ? 'matchAnalysis.ourTeam' : 'matchAnalysis.enemyTeam')
  return t('matchAnalysis.team', { id })
}
function assetName(asset: HextechAramMatchHistoryAsset, kind: 'items' | 'augments') {
  return asset.name || t(kind === 'items' ? 'matchHistory.itemFallback' : 'matchHistory.augmentFallback', { id: asset.id })
}
</script>

<style scoped>
.scoreboard-content { container-type: inline-size; }
.scoreboard-team-header { border-color: var(--lol-border-soft); background: rgba(194, 156, 109, 0.06); }
@container (min-width: 1000px) {
  .scoreboard-wide .scoreboard-player {
    display: grid;
    grid-template-columns: minmax(175px, 1.4fr) minmax(0, 4fr) minmax(80px, .65fr) minmax(140px, 1.2fr);
    align-items: start;
    gap: 12px;
  }
  .scoreboard-wide .scoreboard-identity { flex-wrap: wrap; }
  .scoreboard-wide .scoreboard-identity > div:last-child { width: 100%; text-align: left; }
  .scoreboard-wide .scoreboard-metrics { grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; margin-top: 0; }
  .scoreboard-wide .scoreboard-spells { margin-top: 0; }
  .scoreboard-wide .scoreboard-spells ul { display: grid; gap: 4px; }
  .scoreboard-wide .scoreboard-spells li { padding: 2px; }
  .scoreboard-wide .scoreboard-spells img { width: 18px; height: 18px; }
  .scoreboard-wide .scoreboard-assets > div:first-child { margin-top: 0; }
  .scoreboard-wide .scoreboard-assets img { width: 22px; height: 22px; }
  .scoreboard-wide .scoreboard-assets li { min-width: 22px; min-height: 22px; }
}
</style>
