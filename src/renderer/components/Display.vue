<template id='Display'>
    <div class="display-page">
        <section class="hex-window">
            <header class="hex-titlebar">
                <div class="brand-lockup">
                    <Cpu class="brand-icon" />
                    <h1>ARAMGG助手</h1>
                </div>
                <div class="window-controls">
                    <button class="window-control" type="button" title="隐藏" @click="hideMainWindow">
                        <Minus class="window-icon" />
                    </button>
                    <button class="window-control danger" type="button" title="退出" @click="confirmQuitApp">
                        <X class="window-icon" />
                    </button>
                </div>
            </header>

            <main class="hex-scroll">
                <div class="status-strip">
                    <div class="status-header">
                        <div>
                            <span class="section-kicker">运行状态</span>
                            <h2>控制台</h2>
                        </div>
                        <strong class="connection-pill" :class="{ muted: !currentLolPath }">
                            {{ currentLolPath ? '已同步' : '未连接' }}
                        </strong>
                    </div>
                    <div class="status-grid">
                        <div>
                            <span>客户端版本</span>
                            <strong>{{ clientVersionLabel }}</strong>
                            <small v-if="versionHint">{{ versionHint }}</small>
                            <button
                                v-if="showUpdateLink"
                                class="version-download"
                                type="button"
                                @click="openDownloadUrl"
                            >
                                下载更新
                            </button>
                        </div>
                        <div>
                            <span>数据版本</span>
                            <strong>{{ dataVersionLabel }}</strong>
                            <small v-if="versionInfo?.gamePatch">LOL {{ versionInfo.gamePatch }}</small>
                        </div>
                        <div>
                            <span>游戏路径</span>
                            <strong>{{ currentLolPath ? '已配置' : '待配置' }}</strong>
                            <small>{{ currentLolPath ? '可读取本地资源' : '先选择目录' }}</small>
                        </div>
                    </div>
                </div>

                <GamePathConfig @path-changed="onPathChanged" />
                <ItemSetInstaller :lol-path="currentLolPath" />
                <ChampionMonitor />

                <section class="diagnostic-panel">
                    <div class="section-header">
                        <p class="section-kicker">窗口预览</p>
                    </div>

                    <div class="test-controls">
                        <button class="test-btn primary" @click="testFloatingWindow">
                            <Target class="icon" />
                            <span class="button-copy">
                                <span class="text">海克斯浮窗</span>
                                <span class="hint">随机英雄与海克斯</span>
                            </span>
                        </button>

                        <button class="test-btn secondary" @click="testPopupWindow">
                            <ClipboardList class="icon" />
                            <span class="button-copy">
                                <span class="text">英雄详情</span>
                                <span class="hint">随机英雄详情</span>
                            </span>
                        </button>

                        <button class="test-btn warning" @click="testDatabaseLoad">
                            <Database class="icon" />
                            <span class="button-copy">
                                <span class="text">数据探测</span>
                                <span class="hint">检查数据加载</span>
                            </span>
                        </button>

                    </div>

                    <div v-if="testStatus" class="test-status" :class="testStatus.type">
                        {{ testStatus.message }}
                    </div>
                </section>
            </main>

            <footer class="hex-footer">
                <p>
                    ARAMGG助手 v{{ clientVersionLabel }} -
                    <a class="footer-link" :href="ARAMGG_HOME_URL" @click.prevent="openAramggHome">
                        {{ ARAMGG_HOME_LABEL }}
                    </a>
                </p>
                <p class="footer-feedback">
                    反馈或者建议：
                    <a class="footer-link" :href="FEEDBACK_URL" @click.prevent="openFeedbackEmail">
                        {{ FEEDBACK_EMAIL }}
                    </a>
                    <span class="footer-separator">·</span>
                    <a class="footer-link" :href="GITHUB_URL" @click.prevent="openGithub">
                        GitHub
                    </a>
                    <span class="footer-separator">·</span>
                    <button class="footer-link footer-action" type="button" @click="openLogDirectory">
                        打开日志目录
                    </button>
                </p>
            </footer>

            <div v-if="showQuitConfirm" class="app-modal-overlay" @click.self="cancelQuitApp">
                <section class="app-modal" role="dialog" aria-modal="true" aria-labelledby="quit-title">
                    <div class="app-modal-copy">
                        <h2 id="quit-title">退出ARAMGG助手？</h2>
                        <p>退出后，英雄监控、自动截图和浮窗更新都会停止。</p>
                    </div>
                    <div class="app-modal-actions">
                        <button class="app-modal-action secondary" type="button" @click="cancelQuitApp">
                            取消
                        </button>
                        <button class="app-modal-action danger" type="button" @click="quitApp">
                            退出
                        </button>
                    </div>
                </section>
            </div>

        </section>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import GamePathConfig from './GamePathConfig.vue'
import ItemSetInstaller from './ItemSetInstaller.vue'
import ChampionMonitor from './ChampionMonitor.vue'
import { electronAPI } from '../native/electron-api.js'
import { ClipboardList, Cpu, Database, Minus, Target, X } from 'lucide-vue-next'

const currentLolPath = ref('')
const testStatus = ref(null)
const versionInfo = ref(null)
const showQuitConfirm = ref(false)
const ARAMGG_HOME_URL = 'https://aramgg.com'
const ARAMGG_HOME_LABEL = 'aramgg.com'
const FEEDBACK_EMAIL = 'djlinguge@gmail.com'
const FEEDBACK_URL = `mailto:${FEEDBACK_EMAIL}`
const GITHUB_URL = 'https://github.com/valkia/aramgg_client'
let removeQuitConfirmListener = null

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
        return versionInfo.value.latestVersion ? '最新 ' + versionInfo.value.latestVersion : ''
    }

    if (versionInfo.value.severity === 'patch') {
        return '补丁 ' + versionInfo.value.latestVersion
    }

    return versionInfo.value.statusText + ' ' + versionInfo.value.latestVersion
})

const showUpdateLink = computed(() => {
    return Boolean(versionInfo.value?.isNewer && versionInfo.value?.downloadUrl)
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

const onPathChanged = (path) => {
    currentLolPath.value = path
    console.log('Game path updated', path)
}

const openDownloadUrl = async () => {
    const url = versionInfo.value?.downloadUrl
    if (!url) {
        return
    }

    try {
        await electronAPI.shell.openExternal(url)
    } catch (error) {
        console.warn('Failed to open update download url:', error)
    }
}

const openAramggHome = async () => {
    try {
        await electronAPI.shell.openExternal(ARAMGG_HOME_URL)
    } catch (error) {
        console.warn('Failed to open ARAMGG home:', error)
    }
}

const openFeedbackEmail = async () => {
    try {
        await electronAPI.shell.openExternal(FEEDBACK_URL)
    } catch (error) {
        console.warn('Failed to open feedback email:', error)
    }
}

const openGithub = async () => {
    try {
        await electronAPI.shell.openExternal(GITHUB_URL)
    } catch (error) {
        console.warn('Failed to open GitHub:', error)
    }
}

const openLogDirectory = async () => {
    try {
        const result = await electronAPI.appInfo.openLogDirectory()
        if (!result?.success) {
            throw new Error(result?.error || '打开日志目录失败')
        }
        testStatus.value = {
            type: 'success',
            message: '日志目录已打开。请发送今天的 app-YYYY-MM-DD.log。',
        }
    } catch (error) {
        console.warn('Failed to open log directory:', error)
        testStatus.value = {
            type: 'error',
            message: '打开日志目录失败：' + (error.message || error),
        }
    }
}

const formatRandomPreviewMessage = (prefix, result) => {
    const data = result?.data
    if (!data) {
        return prefix
    }

    const augmentNames = (data.augments || [])
        .map((augment) => augment.name || augment.id)
        .filter(Boolean)
        .join('、')
    const benchCount = result?.benchRecommendation?.candidates?.length || 0
    const benchText = benchCount ? ` | 席位 ${benchCount} 个` : ''

    return `${prefix}：${data.championName || '随机英雄'}${augmentNames ? ' | ' + augmentNames : ''}${benchText}`
}

const testFloatingWindow = async () => {
    testStatus.value = { type: 'info', message: '正在抽取真实数据并打开海克斯浮窗...' }

    try {
        const result = await electronAPI.diagnostics.testShowRandomFloating()
        if (!result.success) {
            throw new Error(result.error || '发送失败')
        }
        testStatus.value = {
            type: 'success',
            message: formatRandomPreviewMessage('海克斯浮窗测试数据已发送', result),
        }
    } catch (err) {
        testStatus.value = { type: 'error', message: '发送失败：' + err.message }
    }
}

const testPopupWindow = async () => {
    testStatus.value = { type: 'info', message: '正在抽取真实数据并打开英雄详情...' }

    try {
        const result = await electronAPI.diagnostics.testShowRandomPopup()
        if (!result.success) {
            throw new Error(result.error || '发送失败')
        }
        testStatus.value = {
            type: 'success',
            message: formatRandomPreviewMessage('英雄详情测试数据已发送', result),
        }
    } catch (err) {
        testStatus.value = { type: 'error', message: '发送失败：' + err.message }
    }
}

const testDatabaseLoad = async () => {
    testStatus.value = { type: 'info', message: '正在测试数据加载...' }

    try {
        const result = await electronAPI.diagnostics.testDatabaseLoad()
        console.log('Database test result', result)

        if (result.success) {
            testStatus.value = {
                type: 'success',
                message: '数据加载成功：' + result.dataCount + ' 条记录 | 路径：' + result.successPath,
            }
        } else {
            let errorMsg = result.error || '未知错误'
            if (result.tests) {
                const failedTests = result.tests
                    .map((t, i) => '[' + (i + 1) + '] ' + (t.exists ? 'OK' : 'MISS') + ' ' + t.path.substring(0, 60) + '...')
                    .join('\\n')
                errorMsg += '\\n\\n路径检查结果：\\n' + failedTests
            }
            testStatus.value = { type: 'error', message: errorMsg }
        }
    } catch (err) {
        testStatus.value = { type: 'error', message: '测试失败：' + err.message }
        console.error('Database test error', err)
    }
}

const hideMainWindow = () => {
    try {
        electronAPI.windows.toggleMain()
    } catch (error) {
        console.warn('Failed to hide main window:', error)
    }
}

const confirmQuitApp = () => {
    showQuitConfirm.value = true
}

const cancelQuitApp = () => {
    showQuitConfirm.value = false
}

const quitApp = async () => {
    try {
        await electronAPI.windows.confirmQuit()
    } catch (error) {
        console.warn('Failed to quit app:', error)
    }
}

onMounted(() => {
    loadVersionInfo()
    removeQuitConfirmListener = electronAPI.events.on('quit-confirm-requested', confirmQuitApp)
})

onBeforeUnmount(() => {
    removeQuitConfirmListener?.()
    removeQuitConfirmListener = null
})
</script>

<style scoped>
.display-page {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background:
        radial-gradient(circle at 50% 0%, rgba(194, 156, 109, 0.15), transparent 42rem),
        #08151e;
    color: #d7e4f1;
}

.hex-window {
    width: min(440px, 100%);
    height: min(720px, calc(100dvh - 32px));
    min-height: 480px;
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid rgba(226, 195, 132, 0.24);
    border-radius: 4px;
    background:
        linear-gradient(180deg, rgba(17, 29, 38, 0.95), rgba(4, 15, 24, 0.98)),
        #08151e;
    box-shadow:
        inset -10px 0 20px -10px rgba(226, 195, 132, 0.12),
        0 28px 80px rgba(0, 0, 0, 0.5),
        0 0 42px rgba(194, 156, 109, 0.12);
}

.hex-window::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    background:
        linear-gradient(180deg, rgba(226, 192, 143, 0.14), transparent 36%),
        radial-gradient(circle at 50% 0%, rgba(194, 156, 109, 0.12), transparent 44%);
}

.hex-titlebar {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    background: rgba(42, 54, 64, 0.84);
    border-bottom: 1px solid rgba(226, 192, 143, 0.28);
    box-shadow: inset 0 -1px 14px rgba(194, 156, 109, 0.12);
    -webkit-app-region: drag;
}

.hex-titlebar::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(226, 192, 143, 0.72), transparent);
}

.brand-lockup,
.window-controls,
.status-row {
    display: flex;
    align-items: center;
}

.brand-lockup {
    gap: 10px;
    min-width: 0;
}

.brand-icon {
    width: 20px;
    height: 20px;
    color: #e2c08f;
    filter: drop-shadow(0 0 10px rgba(226, 192, 143, 0.65));
    flex: 0 0 auto;
}

.brand-lockup h1 {
    margin: 0;
    color: #e2c08f;
    font-size: 18px;
    font-weight: 700;
    line-height: 1.1;
    text-shadow: 0 0 8px rgba(194, 156, 109, 0.36);
}

.window-controls {
    gap: 8px;
    -webkit-app-region: no-drag;
}

.window-control {
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: #bacac6;
    cursor: pointer;
    -webkit-app-region: no-drag;
}

.window-control:hover {
    color: #e2c08f;
    background: rgba(226, 192, 143, 0.08);
    border-color: rgba(226, 192, 143, 0.18);
}

.window-control.danger:hover {
    color: #ffb4ab;
    background: rgba(255, 180, 171, 0.1);
    border-color: rgba(255, 180, 171, 0.24);
}

.window-icon {
    width: 16px;
    height: 16px;
}

.hex-scroll {
    position: relative;
    z-index: 1;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    overflow-y: auto;
    padding: 16px;
    background:
        radial-gradient(circle at 50% 0%, rgba(194, 156, 109, 0.08), transparent 60%),
        rgba(8, 21, 30, 0.58);
}

.hex-scroll > * {
    flex: 0 0 auto;
}

.status-strip,
.diagnostic-panel {
    border: 1px solid var(--lol-border-soft);
    border-radius: 4px;
    background:
        linear-gradient(145deg, rgba(31, 43, 53, 0.62), rgba(7, 10, 13, 0.32));
    box-shadow: inset 0 0 18px rgba(194, 156, 109, 0.04);
}

.status-strip {
    padding: 12px;
}

.status-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
}

.status-header h2 {
    margin: 4px 0 0;
    color: var(--lol-ivory);
    font-size: 18px;
    font-weight: 900;
    line-height: 1.2;
}

.status-grid span {
    color: #bacac6;
    font-size: 11px;
}

.status-grid strong {
    color: #e2c08f;
    font-size: 12px;
    letter-spacing: 0;
}

.connection-pill {
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    gap: 8px;
    padding: 7px 10px;
    color: var(--lol-primary-2);
    background: rgba(194, 156, 109, 0.1);
    border: 1px solid rgba(194, 156, 109, 0.22);
    border-radius: 4px;
    font-size: 12px;
    font-weight: 900;
}

.connection-pill::before {
    content: '';
    display: block;
    width: 8px;
    height: 8px;
    border-radius: 4px;
    background: #e2c08f;
    box-shadow: 0 0 10px rgba(226, 192, 143, 0.85);
}

.connection-pill.muted {
    color: #859491;
    background: rgba(244, 236, 220, 0.05);
    border-color: var(--lol-border-soft);
}

.connection-pill.muted::before {
    background: #859491;
    box-shadow: none;
}

.status-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
}

.status-grid div {
    min-width: 0;
    min-height: 62px;
    padding: 8px 7px;
    border-radius: 4px;
    background: rgba(4, 15, 24, 0.48);
    border: 1px solid rgba(244, 236, 220, 0.06);
}

.status-grid span,
.status-grid strong,
.status-grid small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.status-grid small {
    margin-top: 3px;
    color: #859491;
    font-size: 10px;
}

.version-download {
    max-width: 100%;
    margin-top: 5px;
    padding: 3px 6px;
    border: 1px solid rgba(226, 192, 143, 0.35);
    border-radius: 4px;
    background: rgba(194, 156, 109, 0.12);
    color: #e2c08f;
    font-size: 10px;
    font-weight: 800;
    line-height: 1.2;
    cursor: pointer;
}

.version-download:hover {
    border-color: rgba(226, 192, 143, 0.58);
    background: rgba(194, 156, 109, 0.2);
}

.diagnostic-panel {
    padding: 14px;
}

.section-kicker {
    margin: 0 0 6px;
    color: #e2c384;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0;
}

.section-header {
    margin-bottom: 12px;
}

.section-header h3 {
    margin: 0;
    color: #d7e4f1;
    font-size: 16px;
    font-weight: 800;
}

.test-controls {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
}

.test-btn {
    width: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 58px;
    padding: 9px 8px;
    position: relative;
    overflow: hidden;
    border: 1px solid rgba(60, 74, 71, 0.46);
    border-radius: 4px;
    background: rgba(17, 29, 38, 0.78);
    color: #d7e4f1;
    text-align: left;
    cursor: pointer;
    transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.test-btn::before {
    content: '';
    position: absolute;
    inset: 0;
    opacity: 0;
    pointer-events: none;
    background: linear-gradient(90deg, transparent, rgba(226, 192, 143, 0.1), transparent);
    transition: opacity 0.2s;
}

.test-btn:hover::before {
    opacity: 1;
}

.test-btn:hover {
    transform: translateY(-1px);
    border-color: rgba(226, 192, 143, 0.38);
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.22);
}

.test-btn.secondary:hover,
.test-btn.warning:hover {
    border-color: rgba(226, 195, 132, 0.44);
}

.test-btn.danger:hover {
    border-color: rgba(255, 180, 171, 0.44);
}

.test-btn .icon {
    width: 18px;
    height: 18px;
    color: #e2c08f;
    flex: 0 0 auto;
}

.test-btn.warning .icon {
    color: var(--lol-gold-2);
}

.test-btn.danger .icon {
    color: #ffb4ab;
}

.button-copy {
    min-width: 0;
}

.test-btn .text,
.test-btn .hint {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.test-btn .text {
    font-size: 12px;
    font-weight: 800;
}

.test-btn .hint {
    margin-top: 2px;
    color: #859491;
    font-size: 10px;
}

.test-status {
    margin-top: 12px;
    padding: 10px 12px;
    border-radius: 4px;
    font-size: 12px;
    white-space: pre-line;
}

.test-status.info {
    background: rgba(226, 192, 143, 0.1);
    color: #e2c08f;
    border: 1px solid rgba(226, 192, 143, 0.22);
}

.test-status.success {
    background: rgba(84, 216, 132, 0.1);
    color: #54d884;
    border: 1px solid rgba(84, 216, 132, 0.24);
}

.test-status.error {
    background: rgba(255, 180, 171, 0.1);
    color: #ffb4ab;
    border: 1px solid rgba(255, 180, 171, 0.24);
}

.hex-footer {
    position: relative;
    z-index: 2;
    padding: 14px 18px 18px;
    border-top: 1px solid rgba(226, 195, 132, 0.32);
    background: rgba(42, 54, 64, 0.92);
    text-align: center;
}

.hex-footer::before {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    width: 34%;
    height: 2px;
    transform: translateX(-50%);
    background: linear-gradient(90deg, transparent, #e2c08f, transparent);
    opacity: 0.55;
}

.hex-footer p {
    margin: 0;
    color: #bacac6;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0;
}

.hex-footer .footer-feedback {
    margin-top: 6px;
}

.footer-separator {
    margin: 0 5px;
    color: #859491;
}

.app-modal-overlay {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px;
    background: rgba(4, 10, 14, 0.42);
    backdrop-filter: blur(4px);
}

.app-modal {
    width: min(350px, 100%);
    position: relative;
    overflow: hidden;
    padding: 16px;
    border: 1px solid rgba(226, 195, 132, 0.32);
    border-radius: 4px;
    background:
        linear-gradient(180deg, rgba(38, 50, 58, 0.98), rgba(9, 18, 24, 0.98));
    box-shadow:
        0 22px 64px rgba(0, 0, 0, 0.46),
        inset 0 1px 0 rgba(244, 236, 220, 0.08),
        inset 0 0 24px rgba(194, 156, 109, 0.05);
}

.app-modal::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(90deg, transparent, #e2c08f, transparent);
    opacity: 0.72;
}

.app-modal-copy {
    margin-top: 0;
    padding: 11px 12px;
    border: 1px solid rgba(244, 236, 220, 0.07);
    border-radius: 4px;
    background: rgba(4, 15, 24, 0.42);
}

.app-modal-copy h2 {
    margin: 0;
    color: var(--lol-ivory);
    font-size: 17px;
    font-weight: 900;
    line-height: 1.2;
}

.app-modal-copy p {
    margin: 8px 0 0;
    color: #bacac6;
    font-size: 12px;
    line-height: 1.5;
}

.app-modal-actions {
    margin-top: 12px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
}

.app-modal-action {
    min-height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 900;
    cursor: pointer;
    transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}

.app-modal-action.secondary {
    border: 1px solid var(--lol-border-soft);
    background: rgba(7, 10, 13, 0.42);
    color: var(--lol-ivory);
}

.app-modal-action.secondary:hover {
    color: var(--lol-primary-2);
    border-color: rgba(194, 156, 109, 0.38);
}

.app-modal-action.danger {
    border: 1px solid rgba(226, 192, 143, 0.35);
    background: rgba(194, 156, 109, 0.12);
    color: #e2c08f;
}

.app-modal-action.danger:hover {
    border-color: rgba(226, 192, 143, 0.58);
    background: linear-gradient(135deg, var(--lol-primary-2), var(--lol-primary));
    color: var(--lol-bg);
}

.footer-link {
    color: #e2c08f;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
}

.footer-link:hover {
    color: #f4ecdc;
}

.footer-action {
    padding: 0;
    border: 0;
    background: transparent;
    font: inherit;
}

.hex-scroll::-webkit-scrollbar {
    width: 8px;
}

.hex-scroll::-webkit-scrollbar-track {
    background: rgba(4, 15, 24, 0.65);
}

.hex-scroll::-webkit-scrollbar-thumb {
    border: 2px solid rgba(4, 15, 24, 0.85);
    border-radius: 4px;
    background: linear-gradient(180deg, rgba(226, 195, 132, 0.72), rgba(226, 192, 143, 0.48));
}

@media (max-width: 460px) {
    .display-page {
        padding: 0;
    }

    .hex-window {
        width: 100%;
        height: 100dvh;
        border-radius: 0;
        border-left: none;
        border-right: none;
    }

    .test-controls {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}
</style>
