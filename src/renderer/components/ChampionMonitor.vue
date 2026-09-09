<template>
    <div class="config-card">
        <div class="card-header">
            <Radar class="card-icon" />
            <h3 class="card-title">{{ t('monitor.title') }}</h3>
            <div class="monitor-status" :class="{ 'status-active': isMonitoring }">
                <span class="status-dot"></span>
                {{ isMonitoring ? t('monitor.monitoring') : t('monitor.stopped') }}
            </div>
        </div>
        <div class="card-content">
            <div class="monitor-controls">
                <Button
                    :class="['toggle-btn', isMonitoring ? 'toggle-active' : 'toggle-inactive']"
                    @click="toggleChampionMonitor"
                >
                    <Square v-if="isMonitoring" class="btn-icon" />
                    <Play v-else class="btn-icon" />
                    {{ isMonitoring ? t('monitor.stop') : t('monitor.start') }}
                </Button>
            </div>

            <!-- 状态信息 -->
            <div v-if="selectedChampionId || lastChampionId" class="champion-info">
                <div v-if="selectedChampionId" class="info-item">
                    <span class="info-label">{{ t('monitor.currentSelection') }}</span>
                    <span class="info-value">{{ t('monitor.championId', { id: selectedChampionId }) }}</span>
                </div>
                <div v-if="lastChampionId" class="info-item">
                    <span class="info-label">{{ t('monitor.lastDetected') }}</span>
                    <span class="info-value">{{ t('monitor.championId', { id: lastChampionId }) }}</span>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, onBeforeUnmount, onMounted } from 'vue'
import { Button } from '@/components/ui/button'
import { electronAPI, hasElectronAPI } from '../native/electron-api.ts'
import { Play, Radar, Square } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const isMonitoring = ref(false)
const selectedChampionId = ref(null)
const lastChampionId = ref(null)
let unsubscribe = null
let generation = 0
let lastRevision = -1

function applyState(state, currentGeneration) {
    if (!isMonitoring.value || generation !== currentGeneration || state.revision < lastRevision) return
    lastRevision = state.revision
    selectedChampionId.value = state.selectedChampionId
    lastChampionId.value = state.lastChampionId
}

async function startChampionMonitor() {
    if (isMonitoring.value || !hasElectronAPI()) return
    isMonitoring.value = true
    const currentGeneration = ++generation
    unsubscribe = electronAPI.events.on('champion-monitor-changed', (state) => {
        applyState(state, currentGeneration)
    })

    try {
        const state = await electronAPI.lcu.getChampionMonitorState()
        applyState(state, currentGeneration)
    } catch (error) {
        console.warn('Failed to read champion monitor state:', error)
    }
}

function stopChampionMonitor() {
    isMonitoring.value = false
    generation += 1
    unsubscribe?.()
    unsubscribe = null
}

function toggleChampionMonitor() {
    if (isMonitoring.value) stopChampionMonitor()
    else void startChampionMonitor()
}

onMounted(() => { void startChampionMonitor() })
onBeforeUnmount(stopChampionMonitor)
</script>

<style scoped>
.config-card {
    flex: 0 0 auto;
    background:
        linear-gradient(145deg, rgba(31, 43, 53, 0.62), rgba(7, 10, 13, 0.34));
    border: 1px solid var(--lol-border-soft);
    border-radius: 4px;
    padding: 14px;
    overflow: hidden;
    color: var(--lol-ivory);
    box-shadow: inset 0 0 18px rgba(194, 156, 109, 0.04);
}

.card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 0 12px;
    background: transparent;
    border-bottom: 0;
}

.card-icon {
    width: 16px;
    height: 16px;
    color: var(--lol-gold-2);
}

.card-title {
    margin: 0;
    color: var(--lol-gold-2);
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0;
    text-transform: uppercase;
    flex: 1;
}

.monitor-status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: rgba(4, 15, 24, 0.42);
    border: 1px solid var(--lol-border-soft);
    border-radius: 4px;
    font-size: 11px;
    color: var(--lol-muted);
}

.monitor-status.status-active {
    background: rgba(194, 156, 109, 0.12);
    border-color: rgba(194, 156, 109, 0.28);
    color: var(--lol-primary-2);
}

.status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--lol-faint);
}

.status-active .status-dot {
    background: var(--lol-primary-2);
    box-shadow: 0 0 8px rgba(194, 156, 109, 0.72);
    animation: blink 1.5s infinite;
}

@keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}

@media (prefers-reduced-motion: reduce) {
    .status-active .status-dot {
        animation: none;
    }
}

.card-content {
    padding: 0;
}

.monitor-controls {
    display: flex;
    gap: 8px;
}

.toggle-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 0;
    width: 100%;
    padding: 9px 8px;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 900;
    transition: all 0.2s;
}

.btn-icon {
    width: 15px;
    height: 15px;
}

.toggle-inactive {
    background: rgba(194, 156, 109, 0.16);
    border-color: rgba(194, 156, 109, 0.34);
    color: var(--lol-primary-2);
}

.toggle-inactive:hover {
    background: rgba(194, 156, 109, 0.24);
    transform: translateY(-1px);
    box-shadow: 0 0 18px rgba(194, 156, 109, 0.14);
}

.toggle-active {
    background: rgba(255, 180, 171, 0.12);
    border-color: rgba(255, 180, 171, 0.34);
    color: #ffb4ab;
}

.toggle-active:hover {
    background: rgba(255, 180, 171, 0.18);
    transform: translateY(-1px);
    box-shadow: 0 10px 24px rgba(255, 180, 171, 0.12);
}

.champion-info {
    margin-top: 12px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
}

.info-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px;
    background: rgba(4, 15, 24, 0.42);
    border: 1px solid var(--lol-border-soft);
    border-radius: 4px;
    min-width: 0;
}

.info-label {
    font-size: 11px;
    color: var(--lol-faint);
    text-transform: uppercase;
    letter-spacing: 0;
}

.info-value {
    font-size: 14px;
    font-weight: 800;
    color: var(--lol-ivory);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

@media (max-width: 640px) {
    .champion-info {
        grid-template-columns: 1fr;
    }
}
</style>
