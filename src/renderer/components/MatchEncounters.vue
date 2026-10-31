<template>
  <details class="analysis-panel mt-3 p-3" @toggle="expanded = ($event.target as HTMLDetailsElement).open">
    <summary class="analysis-disclosure cursor-pointer text-sm font-semibold"><span class="inline-flex items-center gap-2 align-middle"><UsersRound class="size-3.5 shrink-0" aria-hidden="true" />{{ t('matchAnalysis.encounters') }}</span> <span class="text-xs text-muted-foreground">· {{ t('matchAnalysis.encounterPlayers', { count: analysis.players.length }) }}</span></summary>
    <div v-if="expanded" class="mt-3 space-y-3">
      <p class="text-xs leading-relaxed text-muted-foreground">{{ t('matchAnalysis.encounterScope', { count: analysis.coveredMatches, total: analysis.totalMatches }) }}</p>
      <p v-if="!analysis.players.length" class="text-xs text-muted-foreground">{{ t('matchAnalysis.noEncounters') }}</p>
      <ul class="max-h-[28rem] space-y-2 overflow-y-auto">
        <li v-for="player in analysis.players" :key="player.playerKey" class="analysis-inset p-3">
          <p class="break-words text-sm font-semibold text-foreground">{{ player.playerName || t('matchAnalysis.unknownPlayer') }}</p>
          <p class="mt-1 text-xs text-primary">{{ t('matchAnalysis.encounterTeams', { same: player.sameTeam, opponents: player.opponents }) }}</p>
          <p class="mt-1 text-xs text-muted-foreground">{{ t('matchAnalysis.encounterRecord', { wins: player.wins, losses: player.losses, remakes: player.remakes }) }}</p>
          <details class="mt-2 border-t border-border pt-2">
            <summary class="analysis-disclosure cursor-pointer py-1 text-xs">{{ t('matchAnalysis.encounterGames', { count: player.encounters.length }) }}</summary>
            <ul class="mt-1 space-y-1">
              <li v-for="encounter in player.encounters" :key="encounter.gameId">
                <button type="button" class="analysis-control w-full p-2 text-left" :disabled="loading" :aria-label="t('matchAnalysis.openEncounter', { time: formatTime(encounter.gameCreation) })" @click="$emit('selectGame', encounter.gameId)">
                  <span class="flex flex-wrap justify-between gap-1 text-muted-foreground"><span>{{ formatTime(encounter.gameCreation) }}</span><span>{{ t(encounter.sameTeam ? 'matchAnalysis.teammate' : 'matchAnalysis.opponent') }} · {{ t(resultKeys[encounter.result]) }}</span></span>
                  <span class="mt-1 flex flex-wrap justify-between gap-1 text-foreground"><span>{{ encounter.championName || t('matchHistory.championFallback', { id: encounter.championId }) }}</span><span>{{ encounter.kills }} / {{ encounter.deaths }} / {{ encounter.assists }}</span></span>
                </button>
              </li>
            </ul>
          </details>
        </li>
      </ul>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { UsersRound } from 'lucide-vue-next'
import type { HextechAramMatchHistoryMatch } from '../../shared/ipc-contract.ts'
import { buildMatchEncounters } from '../services/match-encounters.ts'

const props = defineProps<{ matches: HextechAramMatchHistoryMatch[]; loading: boolean }>()
defineEmits<{ selectGame: [gameId: number] }>()
const { t, locale } = useI18n()
const expanded = ref(false)
const analysis = computed(() => buildMatchEncounters(props.matches))
const resultKeys = { win: 'matchHistory.victory', loss: 'matchHistory.defeat', remake: 'matchHistory.remake' }
function formatTime(value: number) {
  return new Intl.DateTimeFormat(locale.value, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)
}
</script>
