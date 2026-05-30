<template>
    <div class="config-card">
        <div class="card-header">
            <Sparkles class="card-icon" />
            <h3 class="card-title">符文数据</h3>
        </div>
        <div class="card-content">
            <div class="action-buttons">
                <Button @click="getOpggPerks" class="action-btn action-btn-primary">
                    <DownloadCloud class="btn-icon" />
                    获取符文
                </Button>
                <Button @click="time" class="action-btn action-btn-secondary">
                    <Wrench class="btn-icon" />
                    测试
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
import { Button } from '@/components/ui/button'
import { getLolVer } from "../service/data-source/lol-qq"
import OpGG from "../service/data-source/op-gg"
import configCache from '../service/config-cache'
import { electronAPI, hasElectronAPI } from '../native/electron-api.js'
import { DownloadCloud, Sparkles, Wrench } from 'lucide-vue-next'

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
        let storedLolPath = ''
        if (hasElectronAPI()) {
            storedLolPath = await electronAPI.store.get('lolPath') || ''
        }

        const currentLolPath = storedLolPath || configCache.getLolPath() || ''
        if (!currentLolPath) {
            throw new Error('请先配置英雄联盟游戏目录')
        }

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

</script>

<style scoped>
.config-card {
    height: auto;
    flex: 0 0 auto;
    background: rgba(31, 43, 53, 0.42);
    border: 1px solid rgba(60, 74, 71, 0.42);
    border-radius: 8px;
    padding: 14px;
    overflow: hidden;
    color: #d7e4f1;
    box-shadow: inset 0 0 18px rgba(10, 200, 185, 0.04);
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
    color: #e2c384;
}

.card-title {
    margin: 0;
    color: #e2c384;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0;
    text-transform: uppercase;
}

.card-content {
    padding: 0;
}

.action-buttons {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
}

.action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: center;
    min-width: 0;
    width: 100%;
    padding: 9px 8px;
    border: 1px solid rgba(60, 74, 71, 0.46);
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 900;
    transition: all 0.2s;
}

.btn-icon {
    width: 15px;
    height: 15px;
}

.action-btn-primary {
    background: rgba(10, 200, 185, 0.16);
    border-color: rgba(71, 228, 213, 0.36);
    color: #47e4d5;
}

.action-btn-primary:hover {
    background: rgba(10, 200, 185, 0.24);
    transform: translateY(-1px);
    box-shadow: 0 0 18px rgba(10, 200, 185, 0.14);
}

.action-btn-secondary {
    background: rgba(17, 29, 38, 0.72);
    border-color: rgba(60, 74, 71, 0.46);
    color: #d7e4f1;
}

.action-btn-secondary:hover {
    background: rgba(42, 54, 64, 0.7);
    border-color: rgba(71, 228, 213, 0.38);
    transform: translateY(-1px);
}

.action-btn-accent {
    background: rgba(226, 195, 132, 0.12);
    border-color: rgba(226, 195, 132, 0.42);
    color: #e2c384;
}

.action-btn-accent:hover {
    background: rgba(226, 195, 132, 0.18);
    transform: translateY(-1px);
    box-shadow: 0 10px 24px rgba(226, 195, 132, 0.12);
}

.status-message {
    margin-top: 12px;
    padding: 10px 14px;
    background: rgba(4, 15, 24, 0.42);
    border: 1px solid rgba(60, 74, 71, 0.42);
    border-radius: 6px;
    font-size: 12px;
    color: #bacac6;
    display: flex;
    align-items: center;
    gap: 8px;
}

.status-icon {
    font-size: 14px;
}

.progress-container {
    margin-top: 12px;
    height: 6px;
    background: rgba(4, 15, 24, 0.64);
    border-radius: 3px;
    overflow: hidden;
}

.progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #47e4d5, #e2c384);
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
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .action-btn {
        justify-content: center;
    }
}
</style>
