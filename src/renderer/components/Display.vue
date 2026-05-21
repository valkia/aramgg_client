<template id='Display'>
    <div class="display-page">
        <section class="hex-window">
            <div class="corner-accent corner-accent-tl"></div>
            <div class="corner-accent corner-accent-br"></div>

            <header class="hex-titlebar">
                <div class="brand-lockup">
                    <Cpu class="brand-icon" />
                    <h1>AETHERIS HEX-CORE</h1>
                </div>
                <div class="window-controls">
                    <button class="window-control" type="button" title="Hide" @click="hideMainWindow">
                        <Minus class="window-icon" />
                    </button>
                    <button class="window-control danger" type="button" title="Exit" @click="confirmQuitApp">
                        <X class="window-icon" />
                    </button>
                </div>
            </header>

            <main class="hex-scroll">
                <div class="status-strip">
                    <div class="status-row">
                        <span>Link Status</span>
                        <strong :class="{ muted: !currentLolPath }">
                            {{ currentLolPath ? 'SYNCHRONIZED' : 'UNLINKED' }}
                        </strong>
                    </div>
                    <div class="status-grid">
                        <div>
                            <span>Client</span>
                            <strong>{{ clientVersionLabel }}</strong>
                            <small v-if="versionHint">{{ versionHint }}</small>
                        </div>
                        <div>
                            <span>Data</span>
                            <strong>{{ dataVersionLabel }}</strong>
                            <small v-if="versionInfo?.gamePatch">LOL {{ versionInfo.gamePatch }}</small>
                        </div>
                    </div>
                </div>

                <GamePathConfig @path-changed="onPathChanged" />
                <RuneControls @opgg-data-ready="onOpggDataReady" />
                <ChampionMonitor />

                <section class="diagnostic-panel">
                    <div class="section-header">
                        <p class="section-kicker">WINDOW PREVIEW</p>
                        <h3>Overlay Diagnostics</h3>
                    </div>

                    <div class="test-controls">
                        <button class="test-btn primary" @click="testFloatingWindow">
                            <Target class="icon" />
                            <span class="button-copy">
                                <span class="text">Floating Overlay</span>
                                <span class="hint">Transparent in-game bar</span>
                            </span>
                        </button>

                        <button class="test-btn secondary" @click="testPopupWindow">
                            <ClipboardList class="icon" />
                            <span class="button-copy">
                                <span class="text">Champion Insight</span>
                                <span class="hint">Detail popup preview</span>
                            </span>
                        </button>

                        <button class="test-btn warning" @click="testDatabaseLoad">
                            <Database class="icon" />
                            <span class="button-copy">
                                <span class="text">Database Probe</span>
                                <span class="hint">Check bundled data</span>
                            </span>
                        </button>

                        <button class="test-btn danger" @click="hideAllWindows">
                            <EyeOff class="icon" />
                            <span class="button-copy">
                                <span class="text">Hide Windows</span>
                                <span class="hint">Clear previews</span>
                            </span>
                        </button>
                    </div>

                    <div v-if="testStatus" class="test-status" :class="testStatus.type">
                        {{ testStatus.message }}
                    </div>
                </section>
            </main>

            <footer class="hex-footer">
                <p>HEX-CORE v{{ clientVersionLabel }} - BUILD 89A</p>
                <button type="button" @click="loadVersionInfo">RECALIBRATE CORE</button>
            </footer>
        </section>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import GamePathConfig from './GamePathConfig.vue'
import RuneControls from './RuneControls.vue'
import ChampionMonitor from './ChampionMonitor.vue'
import { electronAPI } from '../native/electron-api.js'
import { ClipboardList, Cpu, Database, EyeOff, Minus, Target, X } from 'lucide-vue-next'

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
        return versionInfo.value.latestVersion ? 'Latest ' + versionInfo.value.latestVersion : ''
    }

    if (versionInfo.value.severity === 'patch') {
        return 'Patch ' + versionInfo.value.latestVersion
    }

    return versionInfo.value.statusText + ' ' + versionInfo.value.latestVersion
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

const mockAugmentData = {
    success: true,
    gamePhase: 'augment-select',
    championId: 63,
    championName: 'Brand',
    augments: [
        { id: 1205, name: 'Physical Magic', rarity: 'kSilver', confidence: 0.95 },
        { id: 1103, name: 'Bread And Butter', rarity: 'kGold', confidence: 0.92 },
        { id: 1180, name: 'Big Brain', rarity: 'kGold', confidence: 0.90 },
    ],
    analysisConfidence: 0.95,
    timestamp: Date.now(),
    dataSource: 'test',
}

const onPathChanged = (path) => {
    currentLolPath.value = path
    console.log('Game path updated', path)
}

const onOpggDataReady = (data) => {
    console.log('OP.GG rune data ready', data)
}

const testFloatingWindow = () => {
    testStatus.value = { type: 'info', message: 'Sending test data to floating overlay...' }

    electronAPI.diagnostics.testShowFloating(mockAugmentData)
        .then(() => {
            testStatus.value = { type: 'success', message: 'Floating overlay test data sent' }
        })
        .catch((err) => {
            testStatus.value = { type: 'error', message: 'Send failed: ' + err.message }
        })
}

const testPopupWindow = () => {
    testStatus.value = { type: 'info', message: 'Sending test data to champion insight...' }

    electronAPI.windows.showPopup({
        championId: 63,
        championName: 'Brand',
        augments: mockAugmentData.augments,
        dataSource: 'test',
        timestamp: Date.now(),
    })

    testStatus.value = { type: 'success', message: 'Champion insight test data sent' }
}

const testDatabaseLoad = async () => {
    testStatus.value = { type: 'info', message: 'Testing database load...' }

    try {
        const result = await electronAPI.diagnostics.testDatabaseLoad()
        console.log('Database test result', result)

        if (result.success) {
            testStatus.value = {
                type: 'success',
                message: 'Database loaded: ' + result.dataCount + ' records | Path: ' + result.successPath,
            }
        } else {
            let errorMsg = result.error || 'Unknown error'
            if (result.tests) {
                const failedTests = result.tests
                    .map((t, i) => '[' + (i + 1) + '] ' + (t.exists ? 'OK' : 'MISS') + ' ' + t.path.substring(0, 60) + '...')
                    .join('\\n')
                errorMsg += '\\n\\nPath check result:\\n' + failedTests
            }
            testStatus.value = { type: 'error', message: errorMsg }
        }
    } catch (err) {
        testStatus.value = { type: 'error', message: 'Test failed: ' + err.message }
        console.error('Database test error', err)
    }
}

const hideAllWindows = () => {
    electronAPI.windows.hidePopup()
    electronAPI.windows.hideFloating()
    testStatus.value = { type: 'info', message: 'Hide command sent' }
}

const hideMainWindow = () => {
    try {
        electronAPI.windows.toggleMain()
    } catch (error) {
        console.warn('Failed to hide main window:', error)
    }
}

const confirmQuitApp = async () => {
    try {
        await electronAPI.windows.confirmQuit()
    } catch (error) {
        console.warn('Failed to quit app:', error)
    }
}

onMounted(() => {
    loadVersionInfo()
})
</script>

<style scoped>
.display-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background:
        radial-gradient(circle at 50% 0%, rgba(10, 200, 185, 0.15), transparent 42rem),
        #08151e;
    color: #d7e4f1;
}

.hex-window {
    width: min(430px, 100%);
    height: min(740px, calc(100vh - 32px));
    min-height: 560px;
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid rgba(226, 195, 132, 0.24);
    border-radius: 12px;
    background:
        linear-gradient(180deg, rgba(17, 29, 38, 0.95), rgba(4, 15, 24, 0.98)),
        #08151e;
    box-shadow:
        inset -10px 0 20px -10px rgba(226, 195, 132, 0.12),
        0 28px 80px rgba(0, 0, 0, 0.5),
        0 0 42px rgba(10, 200, 185, 0.12);
}

.hex-window::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    background:
        linear-gradient(180deg, rgba(71, 228, 213, 0.14), transparent 36%),
        radial-gradient(circle at 50% 0%, rgba(10, 200, 185, 0.12), transparent 44%);
}

.corner-accent {
    position: absolute;
    width: 18px;
    height: 18px;
    z-index: 3;
    pointer-events: none;
}

.corner-accent-tl {
    top: 0;
    left: 0;
    border-top: 2px solid rgba(226, 195, 132, 0.72);
    border-left: 2px solid rgba(226, 195, 132, 0.72);
    border-top-left-radius: 12px;
}

.corner-accent-br {
    right: 0;
    bottom: 0;
    border-right: 2px solid rgba(226, 195, 132, 0.72);
    border-bottom: 2px solid rgba(226, 195, 132, 0.72);
    border-bottom-right-radius: 12px;
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
    border-bottom: 1px solid rgba(71, 228, 213, 0.28);
    box-shadow: inset 0 -1px 14px rgba(10, 200, 185, 0.12);
}

.hex-titlebar::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(71, 228, 213, 0.72), transparent);
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
    color: #47e4d5;
    filter: drop-shadow(0 0 10px rgba(71, 228, 213, 0.65));
    flex: 0 0 auto;
}

.brand-lockup h1 {
    margin: 0;
    color: #47e4d5;
    font-size: 18px;
    font-weight: 700;
    line-height: 1.1;
    text-shadow: 0 0 8px rgba(10, 200, 185, 0.36);
}

.window-controls {
    gap: 8px;
}

.window-control {
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: #bacac6;
    cursor: pointer;
}

.window-control:hover {
    color: #47e4d5;
    background: rgba(71, 228, 213, 0.08);
    border-color: rgba(71, 228, 213, 0.18);
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
    gap: 14px;
    min-height: 0;
    overflow-y: auto;
    padding: 18px;
    background:
        radial-gradient(circle at 50% 0%, rgba(10, 200, 185, 0.08), transparent 60%),
        rgba(8, 21, 30, 0.58);
}

.hex-scroll > * {
    flex: 0 0 auto;
}

.status-strip,
.diagnostic-panel {
    border: 1px solid rgba(60, 74, 71, 0.42);
    border-radius: 8px;
    background: rgba(31, 43, 53, 0.42);
}

.status-strip {
    padding: 12px;
}

.status-row {
    justify-content: space-between;
    gap: 12px;
    padding: 10px;
    margin-bottom: 10px;
    border-radius: 6px;
    background: rgba(4, 15, 24, 0.48);
}

.status-row span,
.status-grid span {
    color: #bacac6;
    font-size: 12px;
}

.status-row strong,
.status-grid strong {
    color: #47e4d5;
    font-size: 12px;
    letter-spacing: 0;
}

.status-row strong::before {
    content: '';
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 8px;
    border-radius: 999px;
    background: #47e4d5;
    box-shadow: 0 0 10px rgba(71, 228, 213, 0.85);
}

.status-row strong.muted {
    color: #859491;
}

.status-row strong.muted::before {
    background: #859491;
    box-shadow: none;
}

.status-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
}

.status-grid div {
    min-width: 0;
    padding: 10px;
    border-radius: 6px;
    background: rgba(17, 29, 38, 0.64);
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
    margin-top: 4px;
    color: #859491;
    font-size: 10px;
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
    grid-template-columns: 1fr;
    gap: 10px;
}

.test-btn {
    width: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    position: relative;
    overflow: hidden;
    border: 1px solid rgba(60, 74, 71, 0.46);
    border-radius: 8px;
    background: rgba(17, 29, 38, 0.78);
    color: #d7e4f1;
    text-align: left;
    cursor: pointer;
}

.test-btn::before {
    content: '';
    position: absolute;
    inset: 0;
    opacity: 0;
    pointer-events: none;
    background: linear-gradient(90deg, transparent, rgba(71, 228, 213, 0.1), transparent);
    transition: opacity 0.2s;
}

.test-btn:hover::before {
    opacity: 1;
}

.test-btn:hover {
    transform: translateY(-1px);
    border-color: rgba(71, 228, 213, 0.38);
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
    width: 22px;
    height: 22px;
    color: #47e4d5;
    flex: 0 0 auto;
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
    font-size: 14px;
    font-weight: 800;
}

.test-btn .hint {
    margin-top: 3px;
    color: #859491;
    font-size: 11px;
}

.test-status {
    margin-top: 12px;
    padding: 10px 12px;
    border-radius: 6px;
    font-size: 12px;
    white-space: pre-line;
}

.test-status.info {
    background: rgba(71, 228, 213, 0.1);
    color: #47e4d5;
    border: 1px solid rgba(71, 228, 213, 0.22);
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
    background: linear-gradient(90deg, transparent, #47e4d5, transparent);
    opacity: 0.55;
}

.hex-footer p {
    margin: 0 0 10px;
    color: #bacac6;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0;
}

.hex-footer button {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid rgba(226, 195, 132, 0.52);
    border-radius: 6px;
    background: rgba(92, 70, 19, 0.16);
    color: #e2c384;
    cursor: pointer;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0;
}

.hex-footer button:hover {
    border-color: rgba(71, 228, 213, 0.56);
    color: #47e4d5;
    background: rgba(10, 200, 185, 0.08);
}

.hex-scroll::-webkit-scrollbar {
    width: 8px;
}

.hex-scroll::-webkit-scrollbar-track {
    background: rgba(4, 15, 24, 0.65);
}

.hex-scroll::-webkit-scrollbar-thumb {
    border: 2px solid rgba(4, 15, 24, 0.85);
    border-radius: 999px;
    background: linear-gradient(180deg, rgba(226, 195, 132, 0.72), rgba(71, 228, 213, 0.48));
}

@media (max-width: 460px) {
    .display-page {
        padding: 0;
    }

    .hex-window {
        width: 100%;
        height: 100vh;
        border-radius: 0;
        border-left: none;
        border-right: none;
    }
}
</style>
