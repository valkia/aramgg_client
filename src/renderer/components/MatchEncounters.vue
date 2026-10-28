<template>
  <details class="mt-3 rounded border border-border bg-card/50 p-3" @toggle="expanded = ($event.target as HTMLDetailsElement).open">
    <summary class="cursor-pointer text-sm font-semibold text-primary">{{ t('matchAnalysis.encounters') }} <span class="text-xs text-muted-foreground">· {{ t('matchAnalysis.encounterPlayers', { count: analysis.players.length }) }}</span></summary>
    <div v-if="expanded" class="mt-3 space-y-3">
      <p class="text-xs leading-relaxed text-muted-foreground">{{ t('matchAnalysis.encounterScope', { count: analysis.coveredMatches, total: analysis.totalMatches }) }}</p>
      <p v-if="!analysis.players.length" class="text-xs text-muted-foreground">{{ t('matchAnalysis.noEncounters') }}</p>
      <ul class="max-h-[28rem] space-y-2 overflow-y-auto">
        <li v-for="player in analysis.players" :key="player.playerKey" class="rounded border border-border p-3">
          <p class="break-words text-sm font-semibold text-foreground">{{ player.playerName || t('playerNotes.unknownPlayer') }}</p>
          <p class="mt-1 text-xs text-primary">{{ t('matchAnalysis.encounterTeams', { same: player.sameTeam, opponents: player.opponents }) }}</p>
          <p class="mt-1 text-xs text-muted-foreground">{{ t('matchAnalysis.encounterRecord', { wins: player.wins, losses: player.losses, remakes: player.remakes }) }}</p>
          <PlayerNoteEditor :player-key="player.playerKey" :player-name="player.playerName" />
          <details class="mt-2 border-t border-border pt-2">
            <summary class="cursor-pointer py-1 text-xs text-primary">{{ t('matchAnalysis.encounterGames', { count: player.encounters.length }) }}</summary>
            <ul class="mt-1 space-y-1">
              <li v-for="encounter in player.encounters" :key="encounter.gameId">
                <button type="button" class="w-full rounded border border-border bg-background p-2 text-left text-xs hover:border-primary/50 focus-visible:outline-primary disabled:opacity-50" :disabled="loading" :aria-label="t('matchAnalysis.openEncounter', { time: formatTime(encounter.gameCreation) })" @click="$emit('selectGame', encounter.gameId)">
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
import type { HextechAramMatchHistoryMatch } from '../../shared/ipc-contract.ts'
import { buildMatchEncounters } from '../services/match-encounters.ts'
import PlayerNoteEditor from './PlayerNoteEditor.vue'

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
