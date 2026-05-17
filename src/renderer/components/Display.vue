<template id='Display'>
    <div class="display-page">
        <header class="page-header">
            <div class="header-content">
                <div class="title-block">
                    <p class="page-kicker">ARENA ASSISTANT</p>
                    <h1 class="page-title">LoL 助手控制台</h1>
                    <p class="page-subtitle">配置游戏路径、拉取符文数据、监控英雄选择与海克斯推荐。</p>
                </div>

                <div class="header-metrics">
                    <div class="metric-card">
                        <span class="metric-label">路径状态</span>
                        <strong>{{ currentLolPath ? '已配置' : '待配置' }}</strong>
                    </div>
                    <div class="metric-card">
                        <span class="metric-label">监控模式</span>
                        <strong>实时</strong>
                    </div>
                    <div class="metric-card">
                        <span class="metric-label">客户端版本</span>
                        <strong>{{ clientVersionLabel }}</strong>
                        <small v-if="versionHint">{{ versionHint }}</small>
                    </div>
                    <div class="metric-card">
                        <span class="metric-label">数据版本</span>
                        <strong>{{ dataVersionLabel }}</strong>
                        <small v-if="versionInfo?.gamePatch">LOL {{ versionInfo.gamePatch }}</small>
                    </div>
                </div>
            </div>
        </header>

        <main class="main-content">
            <section class="config-section">
                <GamePathConfig @path-changed="onPathChanged" />
            </section>

            <section class="config-section">
                <RuneControls @opgg-data-ready="onOpggDataReady" />
            </section>

            <section class="config-section">
                <ChampionMonitor />
            </section>

            <section class="config-section">
                <div class="test-section">
                    <div class="section-header">
                        <p class="section-kicker">WINDOW PREVIEW</p>
                        <h3>窗口测试</h3>
                        <p class="section-description">测试海克斯推荐窗口的显示效果</p>
                    </div>

                    <div class="test-controls">
                        <button class="test-btn primary" @click="testFloatingWindow">
                            <Target class="icon" />
                            <span class="button-copy">
                                <span class="text">测试浮动窗口</span>
                                <span class="hint">游戏内透明浮窗</span>
                            </span>
                        </button>

                        <button class="test-btn secondary" @click="testPopupWindow">
                            <ClipboardList class="icon" />
                            <span class="button-copy">
                                <span class="text">测试详情弹窗</span>
                                <span class="hint">完整数据展示</span>
                            </span>
                        </button>

                        <button class="test-btn warning" @click="testDatabaseLoad">
                            <Database class="icon" />
                            <span class="button-copy">
                                <span class="text">测试数据库路径</span>
                                <span class="hint">检查 augments 文件</span>
                            </span>
                        </button>

                        <button class="test-btn danger" @click="hideAllWindows">
                            <EyeOff class="icon" />
                            <span class="button-copy">
                                <span class="text">隐藏所有窗口</span>
                                <span class="hint">关闭测试窗口</span>
                            </span>
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
import { computed, onMounted, ref } from 'vue'
import GamePathConfig from './GamePathConfig.vue'
import RuneControls from './RuneControls.vue'
import ChampionMonitor from './ChampionMonitor.vue'
import { electronAPI } from '../native/electron-api.js'
import { ClipboardList, Database, EyeOff, Target } from 'lucide-vue-next'

const currentLolPath = ref('')
const testStatus = ref(null)
const versionInfo = ref(null)

const clientVersionLabel = computed(() => {
    if (!versionInfo.value) {
        return '-'
    }

    return versionInfo.value.currentVersion || '-'
})

const dataVersionLabel = computed(() => versionInfo.value?.dataVersion || '-')

const versionHint = computed(() => {
    if (!versionInfo.value) {
        return ''
    }

    if (!versionInfo.value.isNewer) {
        return versionInfo.value.latestVersion ? `最新 ${versionInfo.value.latestVersion}` : ''
    }

    if (versionInfo.value.severity === 'patch') {
        return `小版本 ${versionInfo.value.latestVersion}`
    }

    return `${versionInfo.value.statusText} ${versionInfo.value.latestVersion}`
})

const loadVersionInfo = async () => {
    try {
        const result = await electronAPI.appInfo.getVersionInfo()
        if (result.success) {
            versionInfo.value = result.data
        }
    } catch (error) {
        console.warn('Failed to load version info:', error)
    }
}

// 模拟海克斯数据（使用真实的英雄ID和海克斯ID，以便能查询到胜率）
const mockAugmentData = {
    success: true,
    gamePhase: 'augment-select',
    championId: 63, // 布兰德
    championName: '布兰德',
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
    electronAPI.diagnostics.testShowFloating(mockAugmentData)
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

    electronAPI.windows.showPopup({
        championId: 63,
        championName: '布兰德',
        augments: mockAugmentData.augments,
        dataSource: 'test',
        timestamp: Date.now(),
    })

    testStatus.value = { type: 'success', message: '详情弹窗测试数据已发送' }
}

/**
 * 测试数据库路径加载
 */
const testDatabaseLoad = async () => {
    testStatus.value = { type: 'info', message: '正在测试数据库加载...' }

    try {
        const result = await electronAPI.diagnostics.testDatabaseLoad()
        console.log('数据库测试结果:', result)

        if (result.success) {
            testStatus.value = {
                type: 'success',
                message: `数据库加载成功: ${result.dataCount} 条数据 | 路径: ${result.successPath}`,
            }
        } else {
            let errorMsg = result.error || '未知错误'
            if (result.tests) {
                const failedTests = result.tests
                    .map((t, i) => `[${i + 1}] ${t.exists ? '✓' : '✗'} ${t.path.substring(0, 60)}...`)
                    .join('\n')
                errorMsg += `\n\n路径检查结果:\n${failedTests}`
            }
            testStatus.value = { type: 'error', message: errorMsg }
        }
    } catch (err) {
        testStatus.value = { type: 'error', message: '测试失败: ' + err.message }
        console.error('数据库测试错误:', err)
    }
}

/**
 * 隐藏所有测试窗口
 */
const hideAllWindows = () => {
    electronAPI.windows.hidePopup()
    electronAPI.windows.hideFloating()
    testStatus.value = { type: 'info', message: '已发送隐藏指令' }
}
onMounted(() => {
    loadVersionInfo()
})
</script>

<style scoped>
.display-page {
    min-height: 100vh;
    background:
        linear-gradient(180deg, rgba(40, 217, 200, 0.06) 0%, transparent 260px),
        radial-gradient(circle at 88% 8%, rgba(200, 169, 106, 0.12), transparent 280px),
        var(--lol-bg);
    color: var(--lol-ivory);
}

.page-header {
    border-bottom: 1px solid var(--lol-border);
    background: rgba(7, 10, 13, 0.72);
    backdrop-filter: blur(18px);
    padding: 28px 24px 24px;
}

.header-content {
    max-width: 1220px;
    margin: 0 auto;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
}

.page-kicker,
.section-kicker {
    margin: 0 0 8px;
    color: var(--lol-gold-2);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
}

.page-title {
    font-size: 30px;
    font-weight: 800;
    color: var(--lol-ivory);
    margin: 0 0 8px;
}

.page-subtitle {
    font-size: 14px;
    color: var(--lol-muted);
    margin: 0;
    max-width: 580px;
}

.header-metrics {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: flex-end;
}

.metric-card {
    min-width: 118px;
    padding: 12px 14px;
    background: rgba(17, 25, 35, 0.78);
    border: 1px solid var(--lol-border-soft);
    border-radius: 8px;
}

.metric-label {
    display: block;
    margin-bottom: 4px;
    color: var(--lol-faint);
    font-size: 11px;
}

.metric-card strong {
    display: block;
    color: var(--lol-teal-2);
    font-size: 15px;
}

.metric-card small {
    display: block;
    margin-top: 4px;
    color: var(--lol-muted);
    font-size: 11px;
}

.main-content {
    max-width: 1220px;
    margin: 0 auto;
    padding: 24px;
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 16px;
}

.config-section {
    grid-column: span 6;
    animation: slideUp 0.4s ease-out;
    animation-fill-mode: both;
}

.config-section:nth-child(1) { animation-delay: 0.1s; }
.config-section:nth-child(2) { animation-delay: 0.2s; }
.config-section:nth-child(3) { animation-delay: 0.3s; }
.config-section:nth-child(4) { animation-delay: 0.4s; }
.config-section:nth-child(3),
.config-section:nth-child(4) {
    grid-column: 1 / -1;
}

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

.test-section {
    background: var(--lol-panel);
    border: 1px solid var(--lol-border-soft);
    border-radius: 8px;
    padding: 18px;
    box-shadow: var(--lol-shadow);
}

.section-header {
    margin-bottom: 14px;
}

.section-header h3 {
    font-size: 18px;
    font-weight: 700;
    color: var(--lol-ivory);
    margin: 0 0 4px 0;
}

.section-description {
    font-size: 13px;
    color: var(--lol-muted);
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
    flex-direction: row;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border: 1px solid var(--lol-border-soft);
    border-radius: 8px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
    overflow: hidden;
    text-align: left;
    background: rgba(17, 25, 35, 0.78);
    color: var(--lol-ivory);
}

.test-btn::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(40, 217, 200, 0.12), transparent);
    transition: left 0.5s ease;
}

.test-btn:hover::before {
    left: 100%;
}

.test-btn.primary {
    border-color: rgba(40, 217, 200, 0.34);
}

.test-btn.primary:hover {
    transform: translateY(-2px);
    box-shadow: var(--lol-glow);
}

.test-btn.secondary {
    border-color: rgba(200, 169, 106, 0.36);
}

.test-btn.secondary:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 26px rgba(200, 169, 106, 0.12);
}

.test-btn.warning {
    border-color: rgba(226, 194, 122, 0.4);
}

.test-btn.warning:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 26px rgba(226, 194, 122, 0.12);
}

.test-btn.danger {
    border-color: rgba(229, 83, 75, 0.36);
}

.test-btn.danger:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 26px rgba(229, 83, 75, 0.14);
}

.test-btn .icon {
    width: 24px;
    height: 24px;
    color: var(--lol-teal-2);
    flex: 0 0 auto;
}

.button-copy {
    min-width: 0;
}

.test-btn .text {
    display: block;
    font-size: 15px;
    font-weight: 700;
    line-height: 1.2;
}

.test-btn .hint {
    display: block;
    margin-top: 3px;
    font-size: 12px;
    color: var(--lol-muted);
}

.test-status {
    margin-top: 16px;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 13px;
    white-space: pre-line;
}

.test-status.info {
    background: rgba(40, 217, 200, 0.1);
    color: var(--lol-teal-2);
    border: 1px solid rgba(40, 217, 200, 0.24);
}

.test-status.success {
    background: rgba(84, 216, 132, 0.1);
    color: var(--lol-success);
    border: 1px solid rgba(84, 216, 132, 0.24);
}

.test-status.error {
    background: rgba(229, 83, 75, 0.1);
    color: #ff9c96;
    border: 1px solid rgba(229, 83, 75, 0.24);
}

@media (max-width: 860px) {
    .header-content {
        align-items: flex-start;
        flex-direction: column;
    }

    .header-metrics {
        width: 100%;
    }

    .metric-card {
        flex: 1;
    }

    .config-section {
        grid-column: 1 / -1;
    }
}

@media (max-width: 560px) {
    .main-content,
    .page-header {
        padding-left: 16px;
        padding-right: 16px;
    }

    .test-btn {
        min-width: 100%;
    }
}
</style>
