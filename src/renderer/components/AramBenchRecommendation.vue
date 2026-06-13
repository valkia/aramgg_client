<template>
    <section class="aram-panel" :class="{ compact }">
        <header class="panel-header">
            <div class="title-lockup">
                <Swords class="panel-icon" />
                <div>
                    <p class="section-kicker">ARAM</p>
                    <h3>席位推荐</h3>
                </div>
            </div>
            <div class="panel-actions">
                <span class="status-pill" :class="statusClass">{{ statusLabel }}</span>
                <button class="refresh-btn" type="button" title="刷新推荐" @click="refresh">
                    <RefreshCw class="refresh-icon" :class="{ spinning: loading }" />
                </button>
            </div>
        </header>

        <div v-if="loading && !recommendation" class="empty-state">
            <LoaderCircle class="empty-icon spinning" />
            <span>读取中</span>
        </div>

        <div v-else-if="error" class="empty-state error-state">
            <CircleAlert class="empty-icon" />
            <span>{{ error }}</span>
        </div>

        <div v-else-if="!isChampSelect" class="empty-state">
            <CircleDashed class="empty-icon" />
            <span>{{ emptyMessage }}</span>
        </div>

        <div v-else class="recommendation-body">

            <div class="candidate-list">
                <article
                    v-for="candidate in topCandidates"
                    :key="candidate.championId"
                    class="candidate-row"
                    :class="{ current: candidate.isCurrent, recommended: isRecommended(candidate) }"
                >
                    <div class="champion-mark">
                        <img
                            v-if="candidate.iconUrl"
                            :src="candidate.iconUrl"
                            :alt="candidate.name"
                            class="champion-icon"
                        />
                        <span v-else>{{ candidate.championId }}</span>
                    </div>
                    <div class="candidate-main">
                        <div class="candidate-title">
                            <strong>{{ candidate.name }}</strong>
                        </div>
                        <div class="stat-line">
                            <div>胜率 {{ formatPercent(candidate.winRate) }}</div>
                            <div>选取 {{ formatPercent(candidate.pickRate) }}</div>
                        </div>
                    </div>

                </article>
            </div>
        </div>
    </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
    CircleAlert,
    CircleDashed,
    LoaderCircle,
    RefreshCw,
    Swords,
} from 'lucide-vue-next'
import { electronAPI, hasElectronAPI } from '../native/electron-api.js'

const props = defineProps({
    compact: {
        type: Boolean,
        default: false,
    },
    previewRecommendation: {
        type: Object,
        default: null,
    },
})

const recommendation = ref(null)
const loading = ref(false)
const error = ref('')
const refreshTimer = ref(null)
const previewMode = ref(false)
const requestInFlight = ref(false)
const unsubscribeEvents = []
const BENCH_REFRESH_TIMEOUT_MS = 8 * 1000
let mounted = false

const isChampSelect = computed(() => recommendation.value?.gameflowPhase === 'ChampSelect')

const statusClass = computed(() => {
    const status = recommendation.value?.status
    if (loading.value) return 'loading'
    if (status === 'ready') return 'ready'
    if (status === 'no-bench') return 'muted'
    if (status === 'no-current-champion') return 'warning'
    return 'idle'
})

const statusLabel = computed(() => {
    if (loading.value) return '刷新中'

    const status = recommendation.value?.status
    if (status === 'ready') return '只读建议'
    if (status === 'no-bench') return '无席位'
    if (status === 'no-current-champion') return '未选英雄'
    if (status === 'no-candidates') return '暂无英雄'
    return '等待选人'
})

const emptyMessage = computed(() => {
    if (!hasElectronAPI()) return 'Electron API 不可用'
    if (recommendation.value?.reason === 'lcu-unavailable') return '等待客户端连接'
    return '等待进入选人阶段'
})

const topCandidates = computed(() => recommendation.value?.candidates || [])
const recommended = computed(() => recommendation.value?.recommendedChampion || null)

const withTimeout = (promise, timeoutMs, message) => {
    let timeoutId
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
    })

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId))
}

const applyPreviewRecommendation = (data) => {
    if (!data) {
        return
    }

    previewMode.value = data.refreshable !== true
    recommendation.value = data
    error.value = ''
    loading.value = false

    if (data.refreshable === true && mounted) {
        refresh(false)
    }
}

const refresh = async (showLoading = true) => {
    if (!hasElectronAPI()) {
        error.value = 'Electron API 不可用'
        return
    }

    if (previewMode.value && !showLoading) {
        return
    }

    if (previewMode.value && showLoading) {
        previewMode.value = false
    }

    if (requestInFlight.value) {
        return
    }

    requestInFlight.value = true
    if (showLoading) {
        loading.value = true
    }
    error.value = ''

    try {
        const result = await withTimeout(
            electronAPI.lcu.getAramBenchRecommendation(),
            BENCH_REFRESH_TIMEOUT_MS,
            `席位数据读取超过 ${BENCH_REFRESH_TIMEOUT_MS / 1000} 秒`
        )
        if (previewMode.value) {
            return
        }

        if (result?.success && result.recommendation) {
            recommendation.value = result.recommendation
        } else {
            error.value = result?.error || '推荐读取失败'
        }
    } catch (err) {
        if (previewMode.value) {
            return
        }

        error.value = err?.message || '推荐读取失败'
    } finally {
        requestInFlight.value = false
        loading.value = false
    }
}

const isRecommended = (candidate) =>
    recommended.value && candidate.championId === recommended.value.championId

const formatPercent = (value) => {
    if (value == null || Number.isNaN(Number(value))) return '--'
    return `${(Number(value) * 100).toFixed(1)}%`
}

watch(
    () => props.previewRecommendation,
    (data) => {
        if (data) {
            applyPreviewRecommendation(data)
            return
        }

        if (previewMode.value) {
            previewMode.value = false
            recommendation.value = null
            error.value = ''
            if (mounted) {
                refresh(false)
            }
        }
    },
    { immediate: true }
)

onMounted(() => {
    mounted = true

    if (hasElectronAPI()) {
        unsubscribeEvents.push(electronAPI.events.on('bench-recommendation-preview', (data) => {
            applyPreviewRecommendation(data)
        }))

        unsubscribeEvents.push(electronAPI.events.on('game-phase-changed', () => refresh(false)))
    }

    if (!previewMode.value) {
        refresh()
    }
    refreshTimer.value = setInterval(() => refresh(false), 3000)
})

onBeforeUnmount(() => {
    if (refreshTimer.value) {
        clearInterval(refreshTimer.value)
        refreshTimer.value = null
    }

    unsubscribeEvents.splice(0).forEach((unsubscribe) => unsubscribe())
    mounted = false
})
</script>

<style scoped>
.aram-panel {
    border: 1px solid rgba(60, 74, 71, 0.42);
    border-radius: 4px;
    padding: 14px;
    background: rgba(31, 43, 53, 0.42);
    color: #d7e4f1;
    overflow: hidden;
}

.panel-header,
.title-lockup,
.panel-actions,
.headline-row,
.candidate-row,
.candidate-title {
    display: flex;
    align-items: center;
}

.panel-header {
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
}

.title-lockup {
    gap: 10px;
    min-width: 0;
}

.panel-icon {
    width: 18px;
    height: 18px;
    color: #e2c384;
}

.section-kicker {
    margin: 0 0 3px;
    color: #e2c384;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0;
}

h3 {
    margin: 0;
    color: #d7e4f1;
    font-size: 15px;
    font-weight: 900;
}

.panel-actions {
    gap: 8px;
    flex: 0 0 auto;
}

.status-pill {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0 9px;
    border: 1px solid rgba(60, 74, 71, 0.46);
    border-radius: 4px;
    background: rgba(4, 15, 24, 0.42);
    color: #bacac6;
    font-size: 11px;
    font-weight: 900;
    white-space: nowrap;
}

.status-pill.ready {
    border-color: rgba(226, 192, 143, 0.32);
    background: rgba(194, 156, 109, 0.12);
    color: #e2c08f;
}

.status-pill.warning {
    border-color: rgba(226, 195, 132, 0.38);
    background: rgba(226, 195, 132, 0.1);
    color: #e2c384;
}

.status-pill.loading,
.status-pill.muted,
.status-pill.idle {
    color: #859491;
}

.refresh-btn {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(60, 74, 71, 0.46);
    border-radius: 4px;
    background: rgba(17, 29, 38, 0.72);
    color: #bacac6;
    cursor: pointer;
}

.refresh-btn:hover {
    border-color: rgba(226, 192, 143, 0.38);
    color: #e2c08f;
}

.refresh-icon,
.empty-icon {
    width: 15px;
    height: 15px;
}

.spinning {
    animation: spin 0.9s linear infinite;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

.empty-state {
    min-height: 74px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1px solid rgba(60, 74, 71, 0.28);
    border-radius: 4px;
    background: rgba(4, 15, 24, 0.32);
    color: #859491;
    font-size: 12px;
    font-weight: 800;
}

.error-state {
    color: #ffb4ab;
}

.recommendation-body {
    display: grid;
    gap: 10px;
}

.headline-row {
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
    padding: 11px 12px;
    border-radius: 4px;
    background: rgba(4, 15, 24, 0.42);
}

.headline-row div {
    min-width: 0;
}

.headline-label {
    display: block;
    margin-bottom: 3px;
    color: #859491;
    font-size: 11px;
    font-weight: 900;
}

.headline-row strong {
    display: block;
    overflow: hidden;
    color: #e2c08f;
    font-size: 16px;
    font-weight: 900;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.delta-chip {
    flex: 0 0 auto;
    min-width: 42px;
    padding: 5px 8px;
    border: 1px solid rgba(226, 195, 132, 0.36);
    border-radius: 4px;
    background: rgba(226, 195, 132, 0.1);
    color: #e2c384;
    text-align: center;
    font-size: 12px;
    font-weight: 900;
}

.reason-line {
    margin: 0;
    color: #bacac6;
    font-size: 12px;
    font-weight: 800;
    line-height: 1.45;
}

.candidate-list {
    display: grid;
    gap: 8px;
}

.candidate-row {
    gap: 10px;
    min-width: 0;
    padding: 9px;
    border: 1px solid rgba(60, 74, 71, 0.34);
    border-radius: 4px;
    background: rgba(17, 29, 38, 0.52);
}

.candidate-row.recommended {
    border-color: rgba(226, 195, 132, 0.5);
    background: rgba(35, 38, 37, 0.68);
}

.candidate-row.current:not(.recommended) {
    border-color: rgba(226, 192, 143, 0.28);
}

.champion-mark {
    width: 38px;
    height: 38px;
    flex: 0 0 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 1px solid rgba(226, 192, 143, 0.26);
    border-radius: 4px;
    background: rgba(4, 15, 24, 0.72);
    color: #e2c08f;
    font-size: 11px;
    font-weight: 900;
}

.champion-icon {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.candidate-main {
    min-width: 0;
    flex: 1;
}

.candidate-title {
    gap: 8px;
    min-width: 0;
    margin-bottom: 5px;
}

.candidate-title strong {
    overflow: hidden;
    color: #d7e4f1;
    font-size: 13px;
    font-weight: 900;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.candidate-title span {
    flex: 0 0 auto;
    color: #859491;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
}

.stat-line {
    flex-wrap: wrap;
    gap: 6px 10px;
    color: #bacac6;
    font-size: 11px;
    font-weight: 800;
}

.score-box {
    flex: 0 0 48px;
    display: grid;
    gap: 2px;
    text-align: right;
}

.score-box span {
    color: #859491;
    font-size: 10px;
    font-weight: 900;
}

.score-box strong {
    color: #e2c384;
    font-size: 15px;
    font-weight: 900;
}

.aram-panel.compact {
    padding: 10px;
    background: rgba(17, 29, 38, 0.6);
}

.aram-panel.compact .panel-header {
    margin-bottom: 8px;
}

.aram-panel.compact .panel-icon {
    width: 15px;
    height: 15px;
}

.aram-panel.compact h3 {
    font-size: 13px;
}

.aram-panel.compact .status-pill {
    min-height: 22px;
    padding: 0 7px;
    font-size: 10px;
}

.aram-panel.compact .refresh-btn {
    width: 26px;
    height: 26px;
}

.aram-panel.compact .recommendation-body {
    gap: 8px;
}

.aram-panel.compact .headline-row {
    min-height: 46px;
    padding: 8px 10px;
}

.aram-panel.compact .headline-row strong {
    font-size: 14px;
}

.aram-panel.compact .reason-line {
    font-size: 11px;
}

.aram-panel.compact .candidate-list {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 2px;
}

.aram-panel.compact .candidate-row {
    flex: 0 0 88px;
    display: grid;
    grid-template-rows: auto auto;
    gap: 7px;
    align-items: center;
}

.aram-panel.compact .champion-mark {
    width: 34px;
    height: 34px;
    flex-basis: 34px;
}

.aram-panel.compact .candidate-title {
    margin-bottom: 0;
}

.aram-panel.compact .stat-line {
    gap: 4px 8px;
    font-size: 10px;
}

.aram-panel.compact .score-box {
    grid-column: 1 / -1;
    display: flex;
    justify-content: space-between;
    text-align: left;
}

.aram-panel.compact .empty-state {
    min-height: 58px;
}

.aram-panel.compact .candidate-list::-webkit-scrollbar {
    height: 5px;
}

.aram-panel.compact .candidate-list::-webkit-scrollbar-track {
    background: rgba(4, 15, 24, 0.42);
}

.aram-panel.compact .candidate-list::-webkit-scrollbar-thumb {
    border-radius: 4px;
    background: rgba(226, 192, 143, 0.36);
}
</style>
