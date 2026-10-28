<template>
  <details class="mt-3 border-t border-border pt-2" @toggle="onToggle">
    <summary class="cursor-pointer rounded py-2 text-xs font-semibold text-primary focus-visible:outline focus-visible:outline-primary">
      {{ t('matchAnalysis.details') }} · {{ t('matchHistory.players', { count: match.participants?.length || 0 }) }}
    </summary>
    <div v-if="expanded" class="mt-2 space-y-3">
      <p class="text-xs leading-relaxed text-muted-foreground">{{ t('matchAnalysis.metricsHint') }}</p>
      <section v-for="team in teams" :key="team.teamId" class="overflow-hidden rounded-md border border-border bg-card/50" :aria-label="teamName(team.teamId, team.isCurrentTeam)">
        <header class="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 p-3">
          <h4 class="text-sm font-bold text-foreground">{{ teamName(team.teamId, team.isCurrentTeam) }}</h4>
          <span v-if="team.result" class="text-xs font-semibold" :class="team.result === 'win' ? 'text-[var(--lol-success)]' : 'text-muted-foreground'">{{ t(resultKeys[team.result]) }}</span>
          <p class="w-full text-xs text-muted-foreground">
            {{ t('matchAnalysis.teamTotals', { kills: team.kills, gold: number(team.gold) }) }}
          </p>
          <p v-if="!team.complete" class="text-xs text-muted-foreground">{{ t('matchAnalysis.incompleteTeam') }}</p>
        </header>
        <ol class="divide-y divide-border">
          <li v-for="player in team.players" :key="player.participantId" class="p-3" :class="{ 'bg-primary/5': player.isCurrentPlayer }">
            <div class="flex items-center gap-2">
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
            <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs tabular-nums">
              <div>
                <dt class="text-muted-foreground">{{ t('matchAnalysis.damage') }}</dt>
                <dd class="mt-1 text-foreground">{{ number(player.damageToChampions) }} <span class="text-primary">{{ percent(player.damageShare) }}</span></dd>
                <div v-if="player.damageShare !== null" class="mt-1 h-1 overflow-hidden rounded bg-muted" aria-hidden="true"><div class="h-full bg-primary" :style="{ width: `${player.damageShare}%` }" /></div>
              </div>
              <div><dt class="text-muted-foreground">{{ t('matchAnalysis.taken') }}</dt><dd class="mt-1 text-foreground">{{ number(player.damageTaken) }}</dd></div>
              <div><dt class="text-muted-foreground">{{ t('matchAnalysis.gold') }}</dt><dd class="mt-1 text-foreground">{{ number(player.goldEarned) }}</dd></div>
              <div><dt class="text-muted-foreground">{{ t('matchAnalysis.cs') }}</dt><dd class="mt-1 text-foreground">{{ number(player.minionsKilled) }}</dd></div>
            </dl>
            <div v-for="kind in assetKinds" :key="kind" class="mt-2">
              <p class="mb-1 text-xs text-muted-foreground">{{ t(`matchHistory.${kind}`) }}</p>
              <ul v-if="player[kind].length" class="flex flex-wrap gap-1" :aria-label="t(`matchHistory.${kind}`)">
                <li v-for="(asset, index) in player[kind]" :key="`${asset.id}:${index}`" :title="assetName(asset, kind)" class="flex h-7 min-w-7 items-center justify-center overflow-hidden rounded border border-border bg-muted">
                  <img v-if="asset.iconUrl" :src="asset.iconUrl" :alt="assetName(asset, kind)" class="h-7 w-7 object-contain" loading="lazy" />
                  <span v-else class="max-w-24 truncate px-1 text-xs text-muted-foreground">{{ assetName(asset, kind) }}</span>
                </li>
              </ul>
              <p v-else class="text-xs text-muted-foreground">{{ t(kind === 'items' ? 'matchHistory.noItems' : 'matchHistory.noAugments') }}</p>
            </div>
          </li>
        </ol>
      </section>
      <p v-if="!teams.length" class="text-xs text-muted-foreground">{{ t('matchAnalysis.noDetails') }}</p>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HextechAramMatchHistoryAsset, HextechAramMatchHistoryMatch } from '../../shared/ipc-contract.ts'
import { buildScoreboardTeams } from '../services/match-history-insights.ts'

const props = defineProps<{ match: HextechAramMatchHistoryMatch }>()
const { t, locale } = useI18n()
const expanded = ref(false)
const teams = computed(() => buildScoreboardTeams(props.match.participants || []))
const hasCurrentTeam = computed(() => teams.value.some((team) => team.isCurrentTeam))
const resultKeys = { win: 'matchHistory.victory', loss: 'matchHistory.defeat', remake: 'matchHistory.remake' }
const assetKinds = ['augments', 'items'] as const
const multiKills = ['pentaKills', 'quadraKills', 'tripleKills'] as const
function onToggle(event: Event) { expanded.value = (event.target as HTMLDetailsElement).open }
function number(value: number | null) { return value === null ? '—' : new Intl.NumberFormat(locale.value).format(value) }
function percent(value: number | null) { return value === null ? '—' : `${value.toFixed(0)}%` }
function teamName(id: number, current: boolean) {
  if ((id === 100 || id === 200) && hasCurrentTeam.value) return t(current ? 'matchAnalysis.ourTeam' : 'matchAnalysis.enemyTeam')
  return t('matchAnalysis.team', { id })
}
function assetName(asset: HextechAramMatchHistoryAsset, kind: 'items' | 'augments') {
  return asset.name || t(kind === 'items' ? 'matchHistory.itemFallback' : 'matchHistory.augmentFallback', { id: asset.id })
}
</script>
