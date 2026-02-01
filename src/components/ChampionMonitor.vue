<template>
    <div class="config-card">
        <div class="card-header">
            <span class="card-icon">🎯</span>
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
                    <span class="btn-icon">{{ isMonitoring ? '⏹' : '▶' }}</span>
                    {{ isMonitoring ? '停止监控' : '启动监控' }}
                </Button>

                <div class="secondary-actions">
                    <Button
                        @click="startChampionMonitor"
                        class="action-btn-sm"
                        :disabled="isMonitoring"
                    >
                        手动启动
                    </Button>
                    <Button
                        @click="stopChampionMonitor"
                        class="action-btn-sm action-btn-danger"
                        :disabled="!isMonitoring"
                    >
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
import configCache from '../service/config-cache'

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
        if (!window.ipcRenderer) {
            console.warn('🔴 IPC 通信不可用')
            return null
        }

        const result = await window.ipcRenderer.invoke('get-champion-id', {})

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
        // 检查 window.ipcRenderer 是否可用
        if (!window.ipcRenderer) {
            console.warn('IPC 通信不可用')
            return
        }

        const result = await window.ipcRenderer.invoke('get-winrate', {
            championId,
            augmentIds: null // 查询全部海克斯
        })

        if (result.success) {
            console.log('✅ 海克斯数据查询成功:', result.augments?.length, '个海克斯')

            // 触发显示胜率浮窗
            window.ipcRenderer.send('show-popup', {
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
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    overflow: hidden;
    backdrop-filter: blur(10px);
}

.card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 20px;
    background: rgba(34, 197, 94, 0.1);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.card-icon {
    font-size: 18px;
}

.card-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: #fff;
    flex: 1;
}

.monitor-status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
}

.monitor-status.status-active {
    background: rgba(34, 197, 94, 0.2);
    color: #22c55e;
}

.status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.4);
}

.status-active .status-dot {
    background: #22c55e;
    animation: blink 1.5s infinite;
}

@keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}

.card-content {
    padding: 20px;
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
    border: none;
    border-radius: 10px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    transition: all 0.2s;
}

.btn-icon {
    font-size: 14px;
}

.toggle-inactive {
    background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
    color: #fff;
}

.toggle-inactive:hover {
    background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(34, 197, 94, 0.4);
}

.toggle-active {
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    color: #fff;
}

.toggle-active:hover {
    background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
}

.secondary-actions {
    display: flex;
    gap: 8px;
}

.action-btn-sm {
    padding: 10px 16px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #fff;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s;
}

.action-btn-sm:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.15);
}

.action-btn-sm:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.action-btn-danger {
    border-color: rgba(239, 68, 68, 0.3);
}

.action-btn-danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.5);
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
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    min-width: 120px;
}

.info-label {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.info-value {
    font-size: 14px;
    font-weight: 500;
    color: #fff;
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