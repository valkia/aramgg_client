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
        </main>
    </div>
</template>

<script setup>
import { ref } from 'vue'
import GamePathConfig from './GamePathConfig.vue'
import RuneControls from './RuneControls.vue'
import ChampionMonitor from './ChampionMonitor.vue'

const currentLolPath = ref('')

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
</style>