<template>
  <main class="min-h-full min-w-0 p-4">
    <p v-if="loading" role="status" class="text-sm text-muted-foreground">{{ t('matchDetail.loading') }}</p>
    <p v-else-if="!snapshot" role="alert" class="text-sm text-muted-foreground">{{ t('matchDetail.expired') }}</p>
    <template v-else>
      <header class="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div class="min-w-0">
          <h1 class="text-lg font-bold text-primary">{{ t('matchDetail.title') }}</h1>
          <p class="mt-1 break-words text-sm text-foreground">{{ snapshot.playerName }} · {{ snapshot.platformId }} · #{{ snapshot.match.gameId }}</p>
          <p class="mt-1 text-xs text-muted-foreground">{{ playedAt }} · {{ duration }} · {{ snapshot.match.gameVersion || '—' }}</p>
        </div>
        <span class="rounded border border-border px-3 py-1 text-sm font-semibold text-primary">{{ t(resultKeys[snapshot.match.result]) }}</span>
        <p class="w-full text-xs text-muted-foreground">{{ t('matchDetail.snapshotHint', { time: queriedAt }) }}</p>
      </header>
      <MatchScoreboardContent :match="snapshot.match" wide />
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MatchDetailSnapshot } from '../../shared/ipc-contract.ts'
import { electronAPI, hasElectronAPI } from '../native/electron-api.ts'
import { setAppLocale } from '../i18n/index.ts'
import MatchScoreboardContent from './MatchScoreboardContent.vue'

const { t, locale } = useI18n()
const snapshot = ref<MatchDetailSnapshot | null>(null)
const loading = ref(true)
const resultKeys = { win: 'matchHistory.victory', loss: 'matchHistory.defeat', remake: 'matchHistory.remake' }
const time = (value: number) => new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
const playedAt = computed(() => snapshot.value ? time(snapshot.value.match.gameCreation) : '')
const queriedAt = computed(() => snapshot.value ? time(snapshot.value.queriedAt) : '')
const duration = computed(() => {
  const seconds = Math.max(0, Math.floor(snapshot.value?.match.gameDuration || 0))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})

onMounted(async () => {
  try {
    if (!hasElectronAPI()) return
    const result = await electronAPI.matchHistory.getDetailSnapshot()
    if (result.success && result.data) {
      setAppLocale(result.data.locale)
      snapshot.value = result.data
      document.title = `${t('matchDetail.title')} · #${result.data.match.gameId} · ARAMGG`
    }
  } catch {
    snapshot.value = null
  } finally {
    loading.value = false
    await nextTick()
    if (hasElectronAPI()) electronAPI.windows.ready()
  }
})
</script>
