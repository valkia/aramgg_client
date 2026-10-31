<template>
    <section class="aram-panel" :class="{ compact }">
        <header class="panel-header">
            <div class="title-lockup">
                <Swords class="panel-icon" />
                <div>
                    <p class="section-kicker">ARAM</p>
                    <h3>{{ t('bench.title') }}</h3>
                </div>
            </div>
            <div class="panel-actions">
                <span class="status-pill" :class="statusClass">{{ statusLabel }}</span>
                <button class="refresh-btn" type="button" :title="t('bench.refreshTitle')" @click="refresh">
                    <RefreshCw class="refresh-icon" :class="{ spinning: loading }" />
                </button>
            </div>
        </header>

        <div v-if="loading && !recommendation" class="empty-state">
            <LoaderCircle class="empty-icon spinning" />
            <span>{{ t('bench.reading') }}</span>
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
            <div
                v-if="topCandidates.length"
                class="candidate-scroller"
                :class="{
                    'can-scroll-left': canScrollLeft,
                    'can-scroll-right': canScrollRight,
                }"
            >
                <div
                    ref="candidateListRef"
                    class="candidate-list"
                    role="region"
                    :aria-label="t('bench.candidateList')"
                    :tabindex="compact ? 0 : undefined"
                    @scroll.passive="updateCandidateScrollState"
                    @wheel="handleCandidateWheel"
                >
                    <article
                        v-for="candidate in topCandidates"
                        :key="candidate.championId"
                        class="candidate-row"
                        :class="{
                            current: candidate.isCurrent,
                            recommended: isRecommended(candidate),
                            teammate: candidate.source === 'teammate',
                        }"
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
                                <span class="source-tag" :class="`source-${candidate.source || 'bench'}`">
                                    {{ candidateSourceLabel(candidate) }}
                                </span>
                            </div>
                            <div class="stat-line">
                                <div>{{ t('bench.winRate', { value: formatPercent(candidate.winRate) }) }}</div>
                                <div>{{ t('bench.pickRate', { value: formatPercent(candidate.pickRate) }) }}</div>
                                <div>{{ t('bench.tier', { value: formatTier(candidate.tier) }) }}</div>
                            </div>
                        </div>
                    </article>
                </div>
            </div>
            <div class="recommendation-footer">
                <details v-if="topCandidates.length" class="evidence-method">
                    <summary>{{ t('bench.methodTitle') }}</summary>
                    <div class="recommendation-evidence">
                        <p class="decision-line">{{ decisionMessage }}</p>
                        <p v-if="hasNoStats" class="data-warning">{{ t('bench.noStats') }}</p>
                        <p v-else-if="hasLimitedComparison" class="data-warning">{{ t('bench.limitedComparison') }}</p>
                        <p v-if="hasTeammates" class="evidence-note">{{ t('bench.teammateNote') }}</p>
                        <p>{{ t('bench.methodDescription') }}</p>
                        <ul v-if="candidateDataNotes.length" class="candidate-data-notes">
                            <li v-for="note in candidateDataNotes" :key="note.championId">
                                <strong>{{ note.name }}</strong>{{ t('bench.noteSeparator') }}{{ note.text }}
                            </li>
                        </ul>
                    </div>
                </details>
                <p v-else class="decision-line">{{ decisionMessage }}</p>
                <div v-if="compact && (canScrollLeft || canScrollRight)" class="candidate-navigation">
                    <button
                        class="candidate-scroll-nav"
                        type="button"
                        :disabled="!canScrollLeft"
                        :aria-label="t('bench.scrollLeft')"
                        @click="scrollCandidates(-1)"
                    >
                        <ChevronLeft class="candidate-scroll-icon" />
                    </button>
                    <button
                        class="candidate-scroll-nav"
                        type="button"
                        :disabled="!canScrollRight"
                        :aria-label="t('bench.scrollRight')"
                        @click="scrollCandidates(1)"
                    >
                        <ChevronRight class="candidate-scroll-icon" />
                    </button>
                </div>
            </div>
        </div>
    </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
    ChevronLeft,
    ChevronRight,
    CircleAlert,
    CircleDashed,
    LoaderCircle,
    RefreshCw,
    Swords,
} from 'lucide-vue-next'
import { electronAPI, hasElectronAPI } from '../native/electron-api.ts'
import { useI18n } from 'vue-i18n'

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

const { t } = useI18n()

const recommendation = ref(null)
const loading = ref(false)
const error = ref('')
const refreshTimer = ref(null)
const previewMode = ref(false)
const requestInFlight = ref(false)
const candidateListRef = ref(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)
const unsubscribeEvents = []
const BENCH_REFRESH_TIMEOUT_MS = 8 * 1000
let mounted = false
let candidateResizeObserver = null

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
    if (loading.value) return t('bench.refreshing')

    const status = recommendation.value?.status
    if (status === 'ready') return t('bench.readOnly')
    if (status === 'no-bench') return t('bench.noBench')
    if (status === 'no-current-champion') return t('bench.noChampion')
    if (status === 'no-candidates') return t('bench.noCandidates')
    return t('bench.waitingSelection')
})

const emptyMessage = computed(() => {
    if (!hasElectronAPI()) return t('bench.apiUnavailable')
    if (recommendation.value?.reason === 'lcu-unavailable') return t('bench.waitingClient')
    return t('bench.waitingChampSelect')
})

const topCandidates = computed(() => recommendation.value?.candidates || [])
const recommended = computed(() => recommendation.value?.recommendedChampion || null)
const hasTeammates = computed(() => topCandidates.value.some((candidate) => candidate.source === 'teammate'))
const hasNoStats = computed(() => topCandidates.value.length > 0 && topCandidates.value.every((candidate) => missingStats(candidate).length === 3))
const hasLimitedComparison = computed(() => [recommendation.value?.currentChampion, recommended.value]
    .some((candidate) => candidate && missingStats(candidate).length > 0))
const decisionMessage = computed(() => {
    const key = recommendation.value?.decisionReason
    if (hasNoStats.value && key !== 'no-current-champion') return t('bench.decisions.noStats')
    const knownReasons = ['no-candidates', 'no-current-champion', 'no-alternatives', 'current-best', 'small-difference', 'teammate-higher', 'bench-higher']
    return t(`bench.decisions.${knownReasons.includes(key) ? key : 'reference'}`, {
        current: recommendation.value?.currentChampion?.name || '',
        recommended: recommended.value?.name || '',
    })
})
const candidateSourceLabels = computed(() => ({
    current: t('bench.sourceCurrent'),
    bench: t('bench.sourceBench'),
    teammate: t('bench.sourceTeammate'),
}))

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
        error.value = t('bench.apiUnavailable')
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
            t('bench.timeout', { seconds: BENCH_REFRESH_TIMEOUT_MS / 1000 })
        )
        if (previewMode.value) {
            return
        }

        if (result?.success && result.recommendation) {
            recommendation.value = result.recommendation
        } else {
            error.value = result?.error || t('bench.loadFailed')
        }
    } catch (err) {
        if (previewMode.value) {
            return
        }

        error.value = err?.message || t('bench.loadFailed')
    } finally {
        requestInFlight.value = false
        loading.value = false
    }
}

const isRecommended = (candidate) =>
    !hasNoStats.value && recommended.value && candidate.championId === recommended.value.championId

const candidateSourceLabel = (candidate) =>
    candidateSourceLabels.value[candidate?.source] || candidate?.sourceLabel || t('bench.sourceCandidate')

const formatPercent = (value) => {
    if (!Number.isFinite(value) || value < 0 || value > 1) return '—'
    return `${(value * 100).toFixed(1)}%`
}

const formatTier = (value) => Number.isInteger(value) && value > 0 ? value : '—'
const missingStats = (candidate) => [
    ...(formatPercent(candidate.winRate) === '—' ? [t('bench.fields.winRate')] : []),
    ...(formatPercent(candidate.pickRate) === '—' ? [t('bench.fields.pickRate')] : []),
    ...(formatTier(candidate.tier) === '—' ? [t('bench.fields.tier')] : []),
]
const candidateDataNotes = computed(() => topCandidates.value.flatMap((candidate) => {
    const fields = missingStats(candidate)
    return fields.length ? [{ championId: candidate.championId, name: candidate.name, text: t('bench.missingFields', { fields: fields.join(t('bench.fieldSeparator')) }) }] : []
}))

const updateCandidateScrollState = () => {
    const candidateList = candidateListRef.value
    if (!props.compact || !candidateList) {
        canScrollLeft.value = false
        canScrollRight.value = false
        return
    }

    const maxScrollLeft = Math.max(candidateList.scrollWidth - candidateList.clientWidth, 0)
    canScrollLeft.value = candidateList.scrollLeft > 2
    canScrollRight.value = candidateList.scrollLeft < maxScrollLeft - 2
}

const scrollCandidates = (direction) => {
    const candidateList = candidateListRef.value
    if (!candidateList) {
        return
    }

    candidateList.scrollBy({
        left: direction * Math.max(candidateList.clientWidth * 0.72, 96),
        behavior: 'smooth',
    })
}

const handleCandidateWheel = (event) => {
    const candidateList = candidateListRef.value
    if (!props.compact || !candidateList) {
        return
    }

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY
    if (!delta) {
        return
    }

    const maxScrollLeft = Math.max(candidateList.scrollWidth - candidateList.clientWidth, 0)
    const canScrollInDirection = delta < 0
        ? candidateList.scrollLeft > 0
        : candidateList.scrollLeft < maxScrollLeft

    if (!canScrollInDirection) {
        return
    }

    event.preventDefault()
    candidateList.scrollLeft += delta
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

watch(topCandidates, async () => {
    await nextTick()
    updateCandidateScrollState()
})

watch(candidateListRef, async (candidateList) => {
    candidateResizeObserver?.disconnect()
    candidateResizeObserver = null

    await nextTick()
    updateCandidateScrollState()

    if (
        candidateList &&
        candidateList === candidateListRef.value &&
        typeof ResizeObserver !== 'undefined'
    ) {
        candidateResizeObserver = new ResizeObserver(updateCandidateScrollState)
        candidateResizeObserver.observe(candidateList)
    }
})

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

    nextTick(updateCandidateScrollState)
})

onBeforeUnmount(() => {
    if (refreshTimer.value) {
        clearInterval(refreshTimer.value)
        refreshTimer.value = null
    }

    unsubscribeEvents.splice(0).forEach((unsubscribe) => unsubscribe())
    candidateResizeObserver?.disconnect()
    candidateResizeObserver = null
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

.recommendation-footer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 8px;
}

.recommendation-evidence {
    display: grid;
    gap: 4px;
    margin-top: 6px;
    padding: 9px 10px;
    border-left: 2px solid var(--lol-primary);
    border-radius: var(--radius-sm);
    background: var(--lol-bg-2);
    overflow-wrap: anywhere;
}

.decision-line,
.data-warning,
.evidence-note,
.evidence-method p {
    margin: 0;
    font-size: 11px;
    line-height: 1.5;
}

.decision-line {
    color: var(--lol-ivory);
    font-weight: 700;
}

.data-warning {
    color: var(--lol-gold-2);
}

.evidence-note,
.evidence-method {
    color: var(--lol-muted);
}

.evidence-method {
    min-width: 0;
    grid-column: 1 / -1;
    grid-row: 1;
    font-size: 11px;
    line-height: 1.5;
}

.evidence-method summary {
    width: fit-content;
    min-height: 24px;
    padding-right: 68px;
    cursor: pointer;
    color: var(--lol-primary-2);
}

.evidence-method summary:focus-visible {
    outline: 2px solid var(--lol-primary);
    outline-offset: 2px;
}

.evidence-method p {
    overflow-wrap: anywhere;
}

.candidate-data-notes {
    display: grid;
    gap: 4px;
    margin: 4px 0 0;
    padding-left: 16px;
    overflow-wrap: anywhere;
}

.candidate-scroller {
    position: relative;
    min-width: 0;
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

.candidate-row.teammate:not(.recommended) {
    border-color: rgba(96, 161, 176, 0.36);
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

.source-tag {
    flex: 0 0 auto;
    padding: 2px 5px;
    border: 1px solid rgba(60, 74, 71, 0.42);
    border-radius: 4px;
    background: rgba(4, 15, 24, 0.34);
    color: #859491;
    font-size: 10px;
    font-weight: 900;
    line-height: 1;
}

.source-tag.source-current {
    border-color: rgba(226, 192, 143, 0.28);
    color: #e2c08f;
}

.source-tag.source-teammate {
    border-color: rgba(96, 161, 176, 0.34);
    color: #a9cbd3;
}

.stat-line {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
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
    padding: 2px 3px 8px;
    overscroll-behavior-inline: contain;
    scroll-behavior: smooth;
    scroll-snap-type: x proximity;
}

.aram-panel.compact .candidate-row {
    flex: 0 0 156px;
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    grid-template-rows: auto auto;
    gap: 7px;
    align-items: center;
    align-content: start;
    scroll-snap-align: start;
    scroll-snap-stop: normal;
}

.aram-panel.compact .champion-mark {
    width: 34px;
    height: 34px;
    flex-basis: 34px;
}

.aram-panel.compact .candidate-main {
    display: contents;
}

.aram-panel.compact .candidate-title {
    margin-bottom: 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
}

.aram-panel.compact .candidate-title strong {
    width: 100%;
}

.aram-panel.compact .stat-line {
    grid-column: 1 / -1;
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

.candidate-navigation {
    grid-column: 2;
    grid-row: 1;
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    z-index: 1;
}

.candidate-scroll-nav {
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--lol-border);
    border-radius: var(--radius-sm);
    background: var(--lol-bg-2);
    color: var(--lol-primary-2);
    cursor: pointer;
    transition-property: background-color, color, box-shadow, scale;
    transition-duration: 150ms;
    transition-timing-function: ease-out;
}

.candidate-scroll-nav:hover:not(:disabled) {
    background: rgba(31, 43, 53, 0.98);
    box-shadow:
        0 0 0 1px rgba(226, 192, 143, 0.5),
        0 6px 18px rgba(0, 0, 0, 0.42);
    color: #f4ecdc;
}

.candidate-scroll-nav:disabled {
    opacity: 0.35;
    cursor: default;
}

.candidate-scroll-nav:active {
    scale: 0.96;
}

.candidate-scroll-nav:focus-visible {
    outline: 2px solid rgba(226, 192, 143, 0.82);
    outline-offset: 2px;
}

.candidate-scroll-icon {
    width: 17px;
    height: 17px;
}

.aram-panel.compact .candidate-list:focus-visible {
    outline: 2px solid rgba(226, 192, 143, 0.72);
    outline-offset: 2px;
}

.aram-panel.compact .candidate-list::-webkit-scrollbar {
    height: 7px;
}

.aram-panel.compact .candidate-list::-webkit-scrollbar-track {
    background: rgba(4, 15, 24, 0.42);
}

.aram-panel.compact .candidate-list::-webkit-scrollbar-thumb {
    border-radius: 4px;
    background: rgba(226, 192, 143, 0.36);
}
</style>
