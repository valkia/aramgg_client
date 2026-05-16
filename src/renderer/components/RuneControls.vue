<template>
    <div class="config-card">
        <div class="card-header">
            <span class="card-icon">⚡</span>
            <h3 class="card-title">符文数据</h3>
        </div>
        <div class="card-content">
            <div class="action-buttons">
                <Button @click="getOpggPerks" class="action-btn action-btn-primary">
                    <span class="btn-icon">🗂️</span>
                    获取符文
                </Button>
                <Button @click="time" class="action-btn action-btn-secondary">
                    <span class="btn-icon">🔧</span>
                    测试
                </Button>
                <Button @click="goToChampionStats" class="action-btn action-btn-accent">
                    <span class="btn-icon">📊</span>
                    英雄统计
                </Button>
            </div>

            <!-- 状态显示 -->
            <div v-if="statusMessage" class="status-message">
                <span class="status-icon">{{ statusMessage.startsWith('✅') || statusMessage.startsWith('❌') ? '' : '⏳' }}</span>
                {{ statusMessage }}
            </div>

            <!-- 进度条 -->
            <div v-if="isLoading" class="progress-container">
                <div class="progress-bar" :style="{ width: progress + '%' }"></div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { getLolVer } from "../service/data-source/lol-qq"
import OpGG from "../service/data-source/op-gg"
import configCache from '../service/config-cache'

const router = useRouter()
const isLoading = ref(false)
const progress = ref(0)
const statusMessage = ref('')
const emit = defineEmits(['opgg-data-ready'])

/**
 * 获取 OP.GG 符文数据
 */
const getOpggPerks = async () => {
    isLoading.value = true
    progress.value = 0
    statusMessage.value = '正在获取游戏路径...'

    try {
        const currentLolPath = configCache.getLolPath() || "E:\\wegame\\英雄联盟(26)"
        statusMessage.value = '正在获取游戏版本...'

        const lolVer = await getLolVer()
        statusMessage.value = `检测到游戏版本: ${lolVer}`
        progress.value = 20

        const instance = new OpGG(lolVer, currentLolPath)

        // 获取英雄统计数据
        statusMessage.value = '正在获取英雄统计数据...'
        const stats = await instance.getStat()
        progress.value = 50

        if (stats && stats.length > 0) {
            statusMessage.value = `已获取 ${stats.length} 个英雄数据`
            progress.value = 100

            // 发送数据到父组件
            emit('opgg-data-ready', { stats, version: lolVer })
            statusMessage.value = '✅ 符文数据获取完成'
        } else {
            statusMessage.value = '⚠️ 未获取到英雄数据'
        }

    } catch (error) {
        console.error('获取符文数据失败:', error)
        statusMessage.value = `❌ 获取失败: ${error.message}`
        alert('获取符文数据失败: ' + error.message)
    } finally {
        isLoading.value = false
    }
}

/**
 * 测试函数
 */
const time = () => {
    console.log('测试按钮被点击')
    statusMessage.value = '测试功能执行中...'
    setTimeout(() => {
        statusMessage.value = '测试完成'
    }, 1000)
}

/**
 * 跳转到英雄统计页面
 */
const goToChampionStats = () => {
    // 可以使用默认的英雄ID，或者让用户选择
    const defaultChampionId = '1' // 默认英雄ID
    router.push(`/champion-stats/${defaultChampionId}`)
}
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
    background: rgba(168, 85, 247, 0.1);
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
}

.card-content {
    padding: 20px;
}

.action-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
}

.action-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s;
}

.btn-icon {
    font-size: 16px;
}

.action-btn-primary {
    background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
    color: #fff;
}

.action-btn-primary:hover {
    background: linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
}

.action-btn-secondary {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #fff;
}

.action-btn-secondary:hover {
    background: rgba(255, 255, 255, 0.15);
    transform: translateY(-2px);
}

.action-btn-accent {
    background: linear-gradient(135deg, #06b6d4 0%, #0891b2 100%);
    color: #fff;
}

.action-btn-accent:hover {
    background: linear-gradient(135deg, #22d3ee 0%, #06b6d4 100%);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(6, 182, 212, 0.4);
}

.status-message {
    margin-top: 16px;
    padding: 10px 14px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.8);
    display: flex;
    align-items: center;
    gap: 8px;
}

.status-icon {
    font-size: 14px;
}

.progress-container {
    margin-top: 16px;
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    overflow: hidden;
}

.progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #8b5cf6 0%, #a78bfa 100%);
    border-radius: 3px;
    transition: width 0.3s ease;
    animation: pulse 1.5s infinite;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

@media (max-width: 640px) {
    .action-buttons {
        flex-direction: column;
    }

    .action-btn {
        justify-content: center;
    }
}
</style>