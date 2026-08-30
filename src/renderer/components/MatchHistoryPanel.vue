<template>
  <section class="match-history-panel">
    <header class="match-history-header">
      <div>
        <p class="section-kicker">{{ t('matchHistory.title') }}</p>
        <p class="match-history-description">{{ t('matchHistory.description') }}</p>
      </div>
      <button
        class="match-history-refresh"
        type="button"
        :title="t('matchHistory.refresh')"
        :aria-label="t('matchHistory.refresh')"
        :disabled="loading"
        @click="queryPage(page?.startIndex || 0)"
      >
        <RefreshCw class="match-history-refresh-icon" :class="{ spinning: loading }" />
      </button>
    </header>

    <p v-if="status" class="match-history-status error" role="alert">
      {{ status }}
    </p>

    <div v-if="page" class="match-history-overview">
      <strong>{{ page.playerName || t('matchHistory.currentPlayerFallback') }}</strong>
      <div class="match-history-meta">
        <span>{{ t('matchHistory.platform', { platform: page.platformId }) }}</span>
        <span>{{ t('matchHistory.currentPageMatches', { count: page.returnedCount }) }}</span>
        <span>{{ t('matchHistory.hextechOnly') }}</span>
      </div>
      <small>{{ t('matchHistory.queriedAt', { time: formatTime(page.queriedAt) }) }}</small>
    </div>

    <div v-if="loading && !page" class="match-history-loading" role="status">
      <RefreshCw class="match-history-loading-icon spinning" aria-hidden="true" />
      <span>{{ t('matchHistory.querying') }}</span>
    </div>

    <div v-else-if="page?.matches.length" class="recent-match-list">
      <article
        v-for="match in page.matches"
        :key="match.gameId"
        class="recent-match"
        :class="match.result"
      >
        <div class="recent-match-main">
          <span class="recent-match-result" :class="match.result">
            {{ resultLabel(match.result) }}
          </span>
          <img
            v-if="match.championIconUrl"
            class="champion-icon"
            :src="match.championIconUrl"
            :alt="championName(match)"
          />
          <div class="recent-match-copy">
            <strong>{{ championName(match) }}</strong>
            <small>{{ formatTime(match.gameCreation) }} · {{ formatDuration(match.gameDuration) }}</small>
          </div>
          <div class="recent-match-kda">
            <strong>{{ match.kills }}/{{ match.deaths }}/{{ match.assists }}</strong>
            <small>KDA {{ formatKda(match) }}</small>
          </div>
        </div>

        <div class="match-assets">
          <div class="match-asset-group">
            <span class="match-asset-label">{{ t('matchHistory.augments') }}</span>
            <div v-if="match.augments.length" class="match-asset-list">
              <span
                v-for="augment in match.augments"
                :key="augment.id"
                class="match-asset"
                :title="assetName(augment, 'augment')"
              >
                <img v-if="augment.iconUrl" :src="augment.iconUrl" :alt="assetName(augment, 'augment')" />
                <span v-else>{{ assetName(augment, 'augment') }}</span>
              </span>
            </div>
            <small v-else>{{ t('matchHistory.noAugments') }}</small>
          </div>

          <div class="match-asset-group">
            <span class="match-asset-label">{{ t('matchHistory.items') }}</span>
            <div v-if="match.items.length" class="match-asset-list">
              <span
                v-for="(item, index) in match.items"
                :key="`${item.id}:${index}`"
                class="match-asset"
                :title="assetName(item, 'item')"
              >
                <img v-if="item.iconUrl" :src="item.iconUrl" :alt="assetName(item, 'item')" />
                <span v-else>{{ assetName(item, 'item') }}</span>
              </span>
            </div>
            <small v-else>{{ t('matchHistory.noItems') }}</small>
          </div>
        </div>
      </article>
    </div>

    <p v-else-if="page && !loading" class="match-history-empty">
      {{ t('matchHistory.noMatches') }}
    </p>

    <footer v-if="page" class="match-history-pagination">
      <button
        type="button"
        :disabled="loading || !page.hasPrevious"
        @click="queryPage(Math.max(0, page.startIndex - page.count))"
      >
        <ChevronLeft aria-hidden="true" />
        {{ t('matchHistory.previousPage') }}
      </button>
      <span>{{ t('matchHistory.pageNumber', { page: Math.floor(page.startIndex / page.count) + 1 }) }}</span>
      <button
        type="button"
        :disabled="loading || !page.hasMore"
        @click="queryPage(page.startIndex + page.count)"
      >
        {{ t('matchHistory.nextPage') }}
        <ChevronRight aria-hidden="true" />
      </button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-vue-next'
import type {
  HextechAramMatchHistoryAsset,
  HextechAramMatchHistoryMatch,
  HextechAramMatchHistoryPage,
  HextechAramMatchResult,
} from '../../shared/ipc-contract.ts'
import { electronAPI, hasElectronAPI } from '../native/electron-api.js'

const PAGE_SIZE = 10

const { t } = useI18n()
const page = ref<HextechAramMatchHistoryPage | null>(null)
const loading = ref(false)
const status = ref('')

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function formatDuration(durationSeconds: number): string {
  const minutes = Math.max(0, Math.floor(durationSeconds / 60))
  const seconds = Math.max(0, Math.floor(durationSeconds % 60))
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatKda(match: HextechAramMatchHistoryMatch): string {
  return ((match.kills + match.assists) / Math.max(1, match.deaths)).toFixed(1)
}

function championName(match: HextechAramMatchHistoryMatch): string {
  return match.championName || t('matchHistory.championFallback', { id: match.championId })
}

function assetName(asset: HextechAramMatchHistoryAsset, kind: 'augment' | 'item'): string {
  if (asset.name) return asset.name
  return kind === 'augment'
    ? t('matchHistory.augmentFallback', { id: asset.id })
    : t('matchHistory.itemFallback', { id: asset.id })
}

function resultLabel(result: HextechAramMatchResult): string {
  if (result === 'win') return t('matchHistory.victory')
  if (result === 'remake') return t('matchHistory.remake')
  return t('matchHistory.defeat')
}

async function queryPage(startIndex: number): Promise<void> {
  if (loading.value) return
  if (!hasElectronAPI()) {
    status.value = t('matchHistory.apiUnavailable')
    return
  }

  loading.value = true
  status.value = ''
  try {
    const result = await electronAPI.matchHistory.queryCurrent({
      startIndex,
      count: PAGE_SIZE,
    })
    if (!result.success || !result.data) {
      status.value = t('matchHistory.queryFailed', { error: result.error || '' })
      return
    }
    page.value = result.data
  } catch (error) {
    status.value = t('matchHistory.queryFailed', {
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void queryPage(0)
})
</script>

<style scoped>
.match-history-panel {
  margin-top: 12px;
  border: 1px solid var(--lol-border-soft);
  border-radius: 4px;
  padding: 12px;
  background: linear-gradient(145deg, rgba(31, 43, 53, 0.62), rgba(7, 10, 13, 0.32));
  box-shadow: inset 0 0 18px rgba(194, 156, 109, 0.04);
}

.match-history-header,
.recent-match-main,
.match-history-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.match-history-header {
  align-items: flex-start;
}

.match-history-description,
.match-history-empty,
.match-history-overview small,
.match-history-loading,
.match-asset-group small {
  margin: 5px 0 0;
  color: #859491;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.45;
}

.match-history-refresh {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgba(194, 156, 109, 0.26);
  border-radius: 4px;
  background: rgba(194, 156, 109, 0.08);
  color: #e2c08f;
  cursor: pointer;
}

.match-history-refresh:disabled,
.match-history-pagination button:disabled {
  cursor: default;
  opacity: 0.45;
}

.match-history-refresh-icon,
.match-history-loading-icon {
  width: 14px;
  height: 14px;
}

.spinning {
  animation: match-history-spin 0.9s linear infinite;
}

.match-history-status {
  margin: 8px 0 0;
  padding: 7px 8px;
  border: 1px solid rgba(255, 180, 171, 0.28);
  border-radius: 4px;
  color: #ffb4ab;
  font-size: 10px;
  font-weight: 800;
  line-height: 1.4;
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

.match-history-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.match-history-meta span {
  padding: 2px 4px;
  border-radius: 3px;
  background: rgba(194, 156, 109, 0.1);
  color: #bacac6;
  font-size: 9px;
  font-weight: 800;
}

.match-history-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 72px;
}

.recent-match-list {
  display: grid;
  gap: 7px;
  margin-top: 9px;
}

.recent-match {
  padding: 8px;
  border: 1px solid rgba(244, 236, 220, 0.07);
  border-left: 2px solid rgba(255, 180, 171, 0.65);
  border-radius: 3px;
  background: rgba(4, 15, 24, 0.34);
}

.recent-match.win {
  border-left-color: rgba(126, 212, 158, 0.78);
}

.recent-match.remake {
  border-left-color: rgba(173, 181, 189, 0.62);
}

.recent-match-result {
  width: 28px;
  flex: 0 0 auto;
  color: #ffb4ab;
  font-size: 10px;
  font-weight: 950;
  text-align: center;
}

.recent-match-result.win {
  color: #9edbb0;
}

.recent-match-result.remake {
  color: #aeb8bf;
}

.champion-icon {
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  border: 1px solid rgba(194, 156, 109, 0.34);
  border-radius: 4px;
  object-fit: cover;
}

.recent-match-copy {
  min-width: 0;
  flex: 1;
}

.recent-match-copy strong,
.recent-match-copy small,
.recent-match-kda strong,
.recent-match-kda small {
  display: block;
}

.recent-match-copy strong,
.recent-match-kda strong {
  color: #d7e4f1;
  font-size: 10px;
  font-weight: 850;
}

.recent-match-copy small,
.recent-match-kda small {
  margin-top: 2px;
  color: #859491;
  font-size: 9px;
  font-weight: 700;
}

.recent-match-kda {
  flex: 0 0 auto;
  text-align: right;
}

.match-assets {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px solid rgba(244, 236, 220, 0.06);
}

.match-asset-label {
  display: block;
  margin-bottom: 4px;
  color: #859491;
  font-size: 8px;
  font-weight: 850;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.match-asset-list {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.match-asset {
  display: grid;
  min-width: 24px;
  height: 24px;
  place-items: center;
  overflow: hidden;
  border: 1px solid rgba(244, 236, 220, 0.1);
  border-radius: 3px;
  background: rgba(31, 43, 53, 0.75);
  color: #bacac6;
  font-size: 8px;
}

.match-asset img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.match-history-empty {
  padding: 22px 8px;
  text-align: center;
}

.match-history-pagination {
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid rgba(244, 236, 220, 0.08);
}

.match-history-pagination button {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 0;
  background: transparent;
  color: #e2c08f;
  font-size: 9px;
  font-weight: 850;
  cursor: pointer;
}

.match-history-pagination button svg {
  width: 12px;
  height: 12px;
}

.match-history-pagination > span {
  color: #859491;
  font-size: 9px;
  font-weight: 750;
}

@keyframes match-history-spin {
  to { transform: rotate(360deg); }
}
</style>
