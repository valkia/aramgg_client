<template>
    <div class="config-card">
        <div class="card-header">
            <Radar class="card-icon" />
            <h3 class="card-title">英雄监控</h3>
            <div class="monitor-status" :class="{ 'status-active': isMonitoring }">
                <span class="status-dot"></span>
                {{ isMonitoring ? '监控中' : '未启动' }}
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
                    {{ isMonitoring ? '停止监控' : '启动监控' }}
                </Button>
            </div>

            <!-- 状态信息 -->
            <div v-if="selectedChampion || lastChampion" class="champion-info">
                <div v-if="selectedChampion" class="info-item">
                    <span class="info-label">当前选择</span>
                    <span class="info-value">{{ selectedChampion }}</span>
                </div>
                <div v-if="lastChampion" class="info-item">
                    <span class="info-label">最后检测</span>
                    <span class="info-value">{{ lastChampion }}</span>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, onBeforeUnmount, onMounted } from 'vue'
import { Button } from '@/components/ui/button'
import { electronAPI, hasElectronAPI } from '../native/electron-api.js'
import { Play, Radar, Square } from 'lucide-vue-next'

const isMonitoring = ref(false)
const selectedChampion = ref('')
const lastChampion = ref('')
const monitorTimer = ref(null)
const lastQueryChampionId = ref(null) // 追踪最后一次查询的英雄ID，避免重复查询

/**
 * 通过 IPC 向主进程查询当前选择的英雄ID
 */
const getChampionIdViaIpc = async () => {
    try {
        if (!hasElectronAPI()) {
            console.warn('🔴 IPC 通信不可用')
            return null
        }

        const snapshotResult = await electronAPI.lcu.getChampSelectSnapshot()
        if (snapshotResult?.success && snapshotResult.snapshot?.selfChampionId) {
            console.log('✅ 从只读选人快照获取英雄ID:', snapshotResult.snapshot.selfChampionId)
            return snapshotResult.snapshot.selfChampionId
        }

        const result = await electronAPI.lcu.getChampionId()

        if (result && result.success && result.championId) {
            console.log('✅ 从主进程获取英雄ID:', result.championId)
            return result.championId
        }

        return null
    } catch (error) {
        console.warn('⚠️ 通过IPC查询英雄ID失败:', error.message)
        return null
    }
}

/**
 * 启动英雄监控
 */
const startChampionMonitor = async () => {
    if (isMonitoring.value) {
        console.log('⚠️ 监控已启动，无需重复启动')
        return
    }

    isMonitoring.value = true
    console.log('🚀 [CHAMPION_MONITOR] 开始英雄选择监控（使用 IPC 模式）')

    // 检查当前是否已经选择了英雄
    try {
        const championId = await getChampionIdViaIpc()
        if (championId) {
            console.log('✅ 检测到已选择的英雄:', championId)
            lastChampion.value = `英雄ID：${championId}`
        }
    } catch (error) {
        console.warn('检查当前英雄选择失败:', error.message)
    }

    // 定期检查英雄选择（每2秒）
    monitorTimer.value = setInterval(async () => {
        try {
            const championId = await getChampionIdViaIpc()
            if (championId) {
                selectedChampion.value = `英雄ID：${championId}`
                lastChampion.value = `英雄ID：${championId}`
                console.log('🎯 英雄选择更新:', championId)

                // 缓存英雄ID到主进程store，供海克斯检测使用
                try {
                    await electronAPI.store.set('lastSelectedChampionId', championId)
                    console.log('💾 英雄ID已缓存到store:', championId)
                } catch (err) {
                    console.warn('⚠️ 缓存英雄ID失败:', err.message)
                }

                // 如果英雄ID变化，查询胜率数据
                if (lastQueryChampionId.value !== championId) {
                    lastQueryChampionId.value = championId
                    console.log('📊 查询英雄', championId, '的海克斯胜率数据...')
                    await queryAugmentWinrates(championId)
                }
            }
        } catch (error) {
            console.warn('监控检查失败:', error.message)
        }
    }, 2000) // 每2秒检查一次
}

/**
 * 停止英雄监控
 */
const stopChampionMonitor = () => {
    if (!isMonitoring.value) {
        console.log('监控未启动，无需停止')
        return
    }

    isMonitoring.value = false
    if (monitorTimer.value) {
        clearInterval(monitorTimer.value)
        monitorTimer.value = null
    }
    console.log('🛑 停止英雄选择监控')
}

/**
 * 切换英雄监控状态
 */
const toggleChampionMonitor = () => {
    if (isMonitoring.value) {
        stopChampionMonitor()
    } else {
        startChampionMonitor()
    }
}

/**
 * 查询英雄的海克斯胜率数据
 */
const queryAugmentWinrates = async (championId) => {
    try {
        // 检查 Electron API 是否可用
        if (!hasElectronAPI()) {
            console.warn('IPC 通信不可用')
            return
        }

        const basePopupData = {
            championId,
            augments: [],
            dataSource: 'pending',
            timestamp: Date.now()
        }

        // 先显示窗口，再补数据。安装版首次运行或网络超时时，避免用户看到“检测到了ID但没有窗口”。
        electronAPI.windows.showPopup(basePopupData)

        const result = await electronAPI.winrate.get({
            championId,
            augmentIds: null // 查询全部海克斯
        })

        if (result.success) {
            console.log('✅ 海克斯数据查询成功:', result.augments?.length, '个海克斯')

            // 触发显示胜率浮窗
            electronAPI.windows.showPopup({
                championId,
                augments: result.augments,
                dataSource: result.dataSource,
                timestamp: result.timestamp
            })
        } else {
            console.warn('❌ 海克斯数据查询失败:', result.error)
            electronAPI.windows.showPopup({
                ...basePopupData,
                dataSource: 'unavailable',
                error: result.error || '胜率数据加载失败'
            })
        }
    } catch (error) {
        console.error('查询海克斯数据时出错:', error)
        electronAPI.windows.showPopup({
            championId,
            augments: [],
            dataSource: 'unavailable',
            error: error.message || '胜率数据加载失败',
            timestamp: Date.now()
        })
    }
}

// 组件挂载时自动启动英雄监控
onMounted(() => {
    console.log('🎯 ChampionMonitor 组件已挂载，自动启动英雄监控...')
    startChampionMonitor()
})

// 组件卸载时清理定时器
onBeforeUnmount(() => {
    stopChampionMonitor()
})
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
