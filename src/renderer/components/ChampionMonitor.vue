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

                <div class="secondary-actions">
                    <Button
                    @click="startChampionMonitor"
                    class="action-btn-sm"
                    :disabled="isMonitoring"
                >
                        <Power class="btn-icon" />
                        手动启动
                    </Button>
                    <Button
                        @click="stopChampionMonitor"
                    class="action-btn-sm action-btn-danger"
                    :disabled="!isMonitoring"
                >
                        <OctagonX class="btn-icon" />
                        强制停止
                    </Button>
                </div>
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
import { OctagonX, Play, Power, Radar, Square } from 'lucide-vue-next'

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
            lastChampion.value = `ID: ${championId}`
        }
    } catch (error) {
        console.warn('检查当前英雄选择失败:', error.message)
    }

    // 定期检查英雄选择（每2秒）
    monitorTimer.value = setInterval(async () => {
        try {
            const championId = await getChampionIdViaIpc()
            if (championId) {
                selectedChampion.value = `ID: ${championId}`
                lastChampion.value = `ID: ${championId}`
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
        }
    } catch (error) {
        console.error('查询海克斯数据时出错:', error)
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
    background: var(--lol-panel);
    border: 1px solid var(--lol-border-soft);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: var(--lol-shadow);
}

.card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 15px 18px;
    background: rgba(84, 216, 132, 0.08);
    border-bottom: 1px solid var(--lol-border-soft);
}

.card-icon {
    width: 18px;
    height: 18px;
    color: var(--lol-success);
}

.card-title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--lol-ivory);
    flex: 1;
}

.monitor-status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: rgba(244, 236, 220, 0.06);
    border: 1px solid var(--lol-border-soft);
    border-radius: 999px;
    font-size: 12px;
    color: var(--lol-muted);
}

.monitor-status.status-active {
    background: rgba(84, 216, 132, 0.12);
    border-color: rgba(84, 216, 132, 0.24);
    color: var(--lol-success);
}

.status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--lol-faint);
}

.status-active .status-dot {
    background: var(--lol-success);
    animation: blink 1.5s infinite;
}

@keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}

.card-content {
    padding: 18px;
}

.monitor-controls {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
}

.toggle-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 24px;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 700;
    transition: all 0.2s;
}

.btn-icon {
    width: 15px;
    height: 15px;
}

.toggle-inactive {
    background: linear-gradient(135deg, var(--lol-teal), #169a91);
    border-color: rgba(108, 241, 229, 0.32);
    color: var(--lol-bg);
}

.toggle-inactive:hover {
    background: linear-gradient(135deg, var(--lol-teal-2), var(--lol-teal));
    transform: translateY(-2px);
    box-shadow: var(--lol-glow);
}

.toggle-active {
    background: rgba(229, 83, 75, 0.16);
    border-color: rgba(229, 83, 75, 0.38);
    color: #ffb0aa;
}

.toggle-active:hover {
    background: rgba(229, 83, 75, 0.24);
    transform: translateY(-2px);
    box-shadow: 0 10px 24px rgba(229, 83, 75, 0.14);
}

.secondary-actions {
    display: flex;
    gap: 8px;
}

.action-btn-sm {
    padding: 10px 16px;
    background: rgba(244, 236, 220, 0.05);
    border: 1px solid var(--lol-border-soft);
    color: var(--lol-ivory);
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s;
}

.action-btn-sm:hover:not(:disabled) {
    background: rgba(244, 236, 220, 0.09);
    border-color: var(--lol-border);
}

.action-btn-sm:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.action-btn-danger {
    border-color: rgba(229, 83, 75, 0.32);
    color: #ffb0aa;
}

.action-btn-danger:hover:not(:disabled) {
    background: rgba(229, 83, 75, 0.14);
    border-color: rgba(229, 83, 75, 0.5);
}

.champion-info {
    margin-top: 16px;
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
}

.info-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 14px;
    background: rgba(7, 10, 13, 0.34);
    border: 1px solid var(--lol-border-soft);
    border-radius: 6px;
    min-width: 120px;
}

.info-label {
    font-size: 11px;
    color: var(--lol-faint);
    text-transform: uppercase;
    letter-spacing: 0;
}

.info-value {
    font-size: 14px;
    font-weight: 700;
    color: var(--lol-ivory);
}

@media (max-width: 640px) {
    .monitor-controls {
        flex-direction: column;
        align-items: stretch;
    }

    .toggle-btn {
        justify-content: center;
    }

    .secondary-actions {
        justify-content: center;
    }
}
</style>
