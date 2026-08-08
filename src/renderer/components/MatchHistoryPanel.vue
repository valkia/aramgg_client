<template>
  <section class="match-history-panel">
    <header class="match-history-header">
      <div>
        <p class="section-kicker">{{ t('matchHistory.title') }}</p>
        <p class="match-history-description">{{ t('matchHistory.description') }}</p>
      </div>
      <RefreshCw v-if="loading" class="match-history-spinner" aria-hidden="true" />
    </header>

    <p v-if="status" class="match-history-status" :class="status.type" role="status">
      {{ status.message }}
    </p>

    <template v-if="summary">
      <div class="match-history-overview">
        <strong v-if="summary.currentPlayer">{{ t('matchHistory.currentPlayer', { name: summary.currentPlayer.name }) }}</strong>
        <strong v-else>{{ t('matchHistory.noCurrentPlayer') }}</strong>
        <div class="match-history-counts">
          <span v-if="summary.overview.platformId">{{ t('matchHistory.platform', { platform: summary.overview.platformId }) }}</span>
          <span>{{ t('matchHistory.games', { count: summary.overview.gameCount }) }}</span>
          <span>{{ t('matchHistory.players', { count: summary.overview.playerCount }) }}</span>
          <span>{{ t('matchHistory.hextechAramGames', { count: summary.overview.hextechAramGameCount }) }}</span>
        </div>
        <small v-if="summary.overview.availableMatchedPlayerCount">
          {{ t('matchHistory.pendingPlayers', { count: summary.overview.availableMatchedPlayerCount }) }}
        </small>
        <small v-if="summary.overview.pendingUploadCount">
          {{ t('matchHistory.pendingUploads', { count: summary.overview.pendingUploadCount }) }}
        </small>
        <small v-if="summary.updatedAt">{{ t('matchHistory.updatedAt', { time: formatTime(summary.updatedAt) }) }}</small>
      </div>

      <section class="match-history-section">
        <div class="match-history-section-heading">
          <div>
            <h3>{{ t('matchHistory.recentMatches') }}</h3>
          </div>
        </div>
        <div v-if="summary.recentMatches.length" class="recent-match-list">
          <article v-for="match in summary.recentMatches" :key="match.gameId" class="recent-match">
            <span class="recent-match-result" :class="match.win ? 'win' : 'loss'">
              {{ match.win ? t('matchHistory.victory') : t('matchHistory.defeat') }}
            </span>
            <div class="recent-match-copy">
              <strong>{{ championName(match) }}</strong>
              <small>{{ match.gameMode }} · {{ match.kills }}/{{ match.deaths }}/{{ match.assists }}</small>
            </div>
            <small v-if="match.subteamPlacement" class="recent-match-placement">
              {{ t('matchHistory.placement', { placement: match.subteamPlacement }) }}
            </small>
          </article>
        </div>
        <p v-else class="match-history-empty">{{ t('matchHistory.noRecentMatches') }}</p>
      </section>

      <MatchHistoryStatList
        :title="t('matchHistory.hextechAramAugments')"
        :hint="t('matchHistory.hextechAramAugmentsHint')"
        :rows="summary.augmentStats"
        :empty="t('matchHistory.noHextechAramAugmentStats')"
        kind="augment"
        :format-champion-name="championName"
        :format-subject-name="augmentName"
        :format-win-rate="formatWinRate"
        :format-samples="formatSamples"
      />

      <MatchHistoryStatList
        :title="t('matchHistory.hextechAramItems')"
        :hint="t('matchHistory.hextechAramItemsHint')"
        :rows="summary.itemStats"
        :empty="t('matchHistory.noHextechAramItemStats')"
        kind="item"
        :format-champion-name="championName"
        :format-subject-name="itemName"
        :format-win-rate="formatWinRate"
        :format-samples="formatSamples"
      />
    </template>
  </section>
</template>

<script setup lang="ts">
import { defineComponent, h, onMounted, onUnmounted, ref, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { RefreshCw } from 'lucide-vue-next'
import type {
  LocalMatchHistoryRecentMatch,
  LocalMatchHistoryStat,
  LocalMatchHistorySummary,
} from '../../shared/ipc-contract.ts'
import { electronAPI, hasElectronAPI } from '../native/electron-api.js'

const MatchHistoryStatList = defineComponent({
  name: 'MatchHistoryStatList',
  props: {
    title: { type: String, required: true },
    hint: { type: String, required: true },
    rows: { type: Array as PropType<LocalMatchHistoryStat[]>, required: true },
    empty: { type: String, required: true },
    kind: { type: String as PropType<'augment' | 'item'>, required: true },
    formatChampionName: { type: Function as PropType<(_row: LocalMatchHistoryStat) => string>, required: true },
    formatSubjectName: { type: Function as PropType<(_row: LocalMatchHistoryStat) => string>, required: true },
    formatWinRate: { type: Function as PropType<(_row: LocalMatchHistoryStat) => string>, required: true },
    formatSamples: { type: Function as PropType<(_row: LocalMatchHistoryStat) => string>, required: true },
  },
  setup(props) {
    return () => h('section', { class: 'match-history-section' }, [
      h('div', { class: 'match-history-section-heading' }, [
        h('div', [h('h3', props.title), h('p', props.hint)]),
      ]),
      props.rows.length
        ? h('div', { class: 'match-stat-list' }, props.rows.slice(0, 5).map((row) => h('article', {
          key: `${row.championId}:${row.subjectId}`,
          class: 'match-stat-row',
        }, [
          h('div', { class: 'match-stat-name' }, [
            h('strong', props.formatChampionName(row)),
            h('span', props.formatSubjectName(row)),
          ]),
          h('div', { class: 'match-stat-metrics' }, [
            h('strong', props.formatWinRate(row)),
            h('small', props.formatSamples(row)),
          ]),
        ])))
        : h('p', { class: 'match-history-empty' }, props.empty),
    ])
  },
})

const { t } = useI18n()
const summary = ref<LocalMatchHistorySummary | null>(null)
const loading = ref(false)
const status = ref<{ type: 'error'; message: string } | null>(null)
let stopUpdatedListener: (() => void) | null = null

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function championName(row: LocalMatchHistoryStat | LocalMatchHistoryRecentMatch): string {
  return row.championName || t('matchHistory.championFallback', { id: row.championId })
}

function augmentName(row: LocalMatchHistoryStat): string {
  return row.subjectName || t('matchHistory.augmentFallback', { id: row.subjectId })
}

function itemName(row: LocalMatchHistoryStat): string {
  return row.subjectName || t('matchHistory.itemFallback', { id: row.subjectId })
}

function formatWinRate(row: LocalMatchHistoryStat): string {
  return t('matchHistory.winRate', { value: `${Math.round(row.winRate * 100)}%` })
}

function formatSamples(row: LocalMatchHistoryStat): string {
  return t('matchHistory.samples', { count: row.samples })
}

async function loadLocalSummary(): Promise<void> {
  if (!hasElectronAPI() || loading.value) {
    return
  }

  loading.value = true
  try {
    const result = await electronAPI.matchHistory.getLocalSummary()
    summary.value = result.data
    status.value = result.success
      ? null
      : {
          type: 'error',
          message: t('matchHistory.localLoadFailed', { error: result.error || '' }),
        }
  } catch (error) {
    status.value = {
      type: 'error',
      message: t('matchHistory.localLoadFailed', { error: error instanceof Error ? error.message : String(error) }),
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadLocalSummary()
  if (hasElectronAPI()) {
    stopUpdatedListener = electronAPI.events.on('match-history-updated', () => {
      void loadLocalSummary()
    })
  }
})

onUnmounted(() => {
  stopUpdatedListener?.()
  stopUpdatedListener = null
})
</script>

<style scoped>
.match-history-panel {
  border: 1px solid var(--lol-border-soft);
  border-radius: 4px;
  padding: 12px;
  background: linear-gradient(145deg, rgba(31, 43, 53, 0.62), rgba(7, 10, 13, 0.32));
  box-shadow: inset 0 0 18px rgba(194, 156, 109, 0.04);
}

.match-history-header,
.match-history-section-heading,
.recent-match,
.match-stat-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.match-history-description,
.match-history-section-heading p,
.match-history-empty,
.match-history-overview small {
  margin: 5px 0 0;
  color: #859491;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.45;
}

.match-history-spinner {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: #e2c08f;
  animation: match-history-spin 0.9s linear infinite;
}

.match-history-status {
  margin: 8px 0 0;
  padding: 6px 8px;
  border: 1px solid rgba(244, 236, 220, 0.1);
  border-radius: 4px;
  font-size: 10px;
  font-weight: 800;
  line-height: 1.35;
}

.match-history-status.error {
  border-color: rgba(255, 180, 171, 0.28);
  color: #ffb4ab;
}

.match-history-overview {
  margin-top: 9px;
  padding: 8px;
  border: 1px solid rgba(244, 236, 220, 0.07);
  border-radius: 4px;
  background: rgba(4, 15, 24, 0.36);
}

.match-history-overview > strong {
  display: block;
  overflow: hidden;
  color: #d7e4f1;
  font-size: 11px;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.match-history-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.match-history-counts span {
  padding: 2px 4px;
  border-radius: 3px;
  background: rgba(194, 156, 109, 0.1);
  color: #bacac6;
  font-size: 9px;
  font-weight: 800;
}

.match-history-section {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(244, 236, 220, 0.08);
}

.match-history-section-heading h3 {
  margin: 0;
  color: #e2c08f;
  font-size: 11px;
  font-weight: 900;
  line-height: 1.2;
}

.recent-match-list,
.match-stat-list {
  display: grid;
  gap: 4px;
  margin-top: 7px;
}

.recent-match,
.match-stat-row {
  align-items: center;
  padding: 6px;
  border: 1px solid rgba(244, 236, 220, 0.06);
  border-radius: 3px;
  background: rgba(4, 15, 24, 0.3);
}

.recent-match-result {
  width: 24px;
  flex: 0 0 auto;
  color: #ffb4ab;
  font-size: 10px;
  font-weight: 950;
  text-align: center;
}

.recent-match-result.win {
  color: #9edbb0;
}

.recent-match-copy,
.match-stat-name {
  min-width: 0;
  flex: 1;
}

.recent-match-copy strong,
.recent-match-copy small,
.match-stat-name strong,
.match-stat-name span,
.match-stat-metrics strong,
.match-stat-metrics small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-match-copy strong,
.match-stat-name strong {
  color: #d7e4f1;
  font-size: 10px;
  font-weight: 850;
}

.recent-match-copy small,
.match-stat-name span,
.match-stat-metrics small,
.recent-match-placement {
  margin-top: 2px;
  color: #859491;
  font-size: 9px;
  font-weight: 700;
}

.recent-match-placement {
  flex: 0 0 auto;
  margin: 0;
}

.match-stat-metrics {
  min-width: 68px;
  flex: 0 0 auto;
  text-align: right;
}

.match-stat-metrics strong {
  color: #e2c08f;
  font-size: 10px;
  font-weight: 900;
}

@keyframes match-history-spin {
  to { transform: rotate(360deg); }
}
</style>
