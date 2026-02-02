<template id='Display'>
    <div class="display-page">
        <!-- 页面头部 -->
        <header class="page-header">
            <div class="header-content">
                <h1 class="page-title">🎮 LoL 助手控制台</h1>
                <p class="page-subtitle">配置游戏路径、获取符文数据、监控英雄选择</p>
            </div>
        </header>

        <!-- 主要内容区 -->
        <main class="main-content">
            <!-- 游戏路径配置 -->
            <section class="config-section">
                <GamePathConfig @path-changed="onPathChanged" />
            </section>

            <!-- 符文控制 -->
            <section class="config-section">
                <RuneControls @opgg-data-ready="onOpggDataReady" />
            </section>

            <!-- 英雄监控控制 -->
            <section class="config-section">
                <ChampionMonitor />
            </section>

            <!-- 窗口测试区域 -->
            <section class="config-section">
                <div class="test-section">
                    <div class="section-header">
                        <h3>🧪 窗口测试</h3>
                        <p class="section-description">测试海克斯推荐窗口的显示效果</p>
                    </div>

                    <div class="test-controls">
                        <button class="test-btn primary" @click="testFloatingWindow">
                            <span class="icon">🎯</span>
                            <span class="text">测试浮动窗口</span>
                            <span class="hint">游戏内透明浮窗</span>
                        </button>

                        <button class="test-btn secondary" @click="testPopupWindow">
                            <span class="icon">📋</span>
                            <span class="text">测试详情弹窗</span>
                            <span class="hint">完整数据展示</span>
                        </button>

                        <button class="test-btn danger" @click="hideAllWindows">
                            <span class="icon">❌</span>
                            <span class="text">隐藏所有窗口</span>
                            <span class="hint">关闭测试窗口</span>
                        </button>
                    </div>

                    <div v-if="testStatus" class="test-status" :class="testStatus.type">
                        {{ testStatus.message }}
                    </div>
                </div>
            </section>
        </main>
    </div>
</template>

<script setup>
import { ref } from 'vue'
import GamePathConfig from './GamePathConfig.vue'
import RuneControls from './RuneControls.vue'
import ChampionMonitor from './ChampionMonitor.vue'

const currentLolPath = ref('')
const testStatus = ref(null)

// 模拟海克斯数据（使用真实的英雄ID和海克斯ID，以便能查询到胜率）
const mockAugmentData = {
    success: true,
    gamePhase: 'augment-select',
    championId: 63, // 布兰德
    augments: [
        { id: 1205, name: '物理转魔法', rarity: 'kSilver', confidence: 0.95 },
        { id: 1103, name: '面包和黄油', rarity: 'kGold', confidence: 0.92 },
        { id: 1180, name: '超强大脑', rarity: 'kGold', confidence: 0.90 },
    ],
    analysisConfidence: 0.95,
    timestamp: Date.now(),
    dataSource: 'test',
}

/**
 * 处理路径变化
 */
const onPathChanged = (path) => {
    currentLolPath.value = path
    console.log('游戏路径已更新:', path)
}

/**
 * 处理 OP.GG 数据就绪
 */
const onOpggDataReady = (data) => {
    console.log('OP.GG 符文数据已就绪:', data)
}

/**
 * 测试浮动窗口
 */
const testFloatingWindow = () => {
    testStatus.value = { type: 'info', message: '正在发送测试数据到浮动窗口...' }

    // 通过 broadcast 发送给主进程，主进程再转发给浮动窗口
    window.ipcRenderer.invoke('test-show-floating', mockAugmentData)
        .then(() => {
            testStatus.value = { type: 'success', message: '浮动窗口测试数据已发送' }
        })
        .catch((err) => {
            testStatus.value = { type: 'error', message: '发送失败: ' + err.message }
        })
}

/**
 * 测试详情弹窗
 */
const testPopupWindow = () => {
    testStatus.value = { type: 'info', message: '正在发送测试数据到详情弹窗...' }

    window.ipcRenderer.send('show-popup', {
        championId: 63,
        augments: mockAugmentData.augments,
        dataSource: 'test',
        timestamp: Date.now(),
    })

    testStatus.value = { type: 'success', message: '详情弹窗测试数据已发送' }
}

/**
 * 隐藏所有测试窗口
 */
const hideAllWindows = () => {
    window.ipcRenderer.send('hide-popup')
    window.ipcRenderer.send('hide-floating')
    testStatus.value = { type: 'info', message: '已发送隐藏指令' }
}
</script>

<style scoped>
.display-page {
    min-height: 100vh;
    background: linear-gradient(135deg, #1a1c2c 0%, #2d3561 50%, #1a1c2c 100%);
}

.page-header {
    background: linear-gradient(90deg, rgba(30, 136, 229, 0.15) 0%, rgba(103, 58, 183, 0.15) 100%);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding: 24px;
}

.header-content {
    max-width: 1200px;
    margin: 0 auto;
}

.page-title {
    font-size: 24px;
    font-weight: 700;
    color: #fff;
    margin: 0 0 8px 0;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.page-subtitle {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.7);
    margin: 0;
}

.main-content {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px;
}

.config-section {
    margin-bottom: 16px;
    animation: slideUp 0.4s ease-out;
    animation-fill-mode: both;
}

.config-section:nth-child(1) { animation-delay: 0.1s; }
.config-section:nth-child(2) { animation-delay: 0.2s; }
.config-section:nth-child(3) { animation-delay: 0.3s; }

@keyframes slideUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

/* 测试区域样式 */
.test-section {
    background: linear-gradient(135deg, rgba(45, 52, 54, 0.8) 0%, rgba(30, 39, 46, 0.8) 100%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 20px;
}

.section-header {
    margin-bottom: 16px;
}

.section-header h3 {
    font-size: 18px;
    font-weight: 600;
    color: #fff;
    margin: 0 0 4px 0;
}

.section-description {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.6);
    margin: 0;
}

.test-controls {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
}

.test-btn {
    flex: 1;
    min-width: 200px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 16px 20px;
    border: 2px solid transparent;
    border-radius: 10px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
    overflow: hidden;
}

.test-btn::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
    transition: left 0.5s ease;
}

.test-btn:hover::before {
    left: 100%;
}

.test-btn.primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
}

.test-btn.primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
}

.test-btn.secondary {
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    color: white;
}

.test-btn.secondary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(240, 147, 251, 0.4);
}

.test-btn.danger {
    background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
    color: #333;
}

.test-btn.danger:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(250, 112, 154, 0.4);
}

.test-btn .icon {
    font-size: 28px;
}

.test-btn .text {
    font-size: 15px;
    font-weight: 600;
}

.test-btn .hint {
    font-size: 12px;
    opacity: 0.8;
}

.test-status {
    margin-top: 16px;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 13px;
    text-align: center;
}

.test-status.info {
    background: rgba(59, 130, 246, 0.15);
    color: #93c5fd;
    border: 1px solid rgba(59, 130, 246, 0.3);
}

.test-status.success {
    background: rgba(34, 197, 94, 0.15);
    color: #86efac;
    border: 1px solid rgba(34, 197, 94, 0.3);
}

.test-status.error {
    background: rgba(239, 68, 68, 0.15);
    color: #fca5a5;
    border: 1px solid rgba(239, 68, 68, 0.3);
}
</style>