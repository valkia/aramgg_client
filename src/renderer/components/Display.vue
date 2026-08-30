<template id='Display'>
    <div class="display-page">
        <section class="hex-window">
            <header class="hex-titlebar">
                <div class="brand-lockup">
                    <Cpu class="brand-icon" />
                    <h1>{{ t('display.brand') }}</h1>
                </div>
                <div class="window-controls">
                    <button class="window-control" type="button" :title="t('common.hide')" @click="hideMainWindow">
                        <Minus class="window-icon" />
                    </button>
                    <button class="window-control danger" type="button" :title="t('common.exit')" @click="confirmQuitApp">
                        <X class="window-icon" />
                    </button>
                </div>
            </header>

            <main class="hex-scroll">
                <div class="status-strip">
                    <div class="status-header">
                        <div>
                            <span class="section-kicker">{{ t('display.runningStatus') }}</span>
                            <h2>{{ t('display.console') }}</h2>
                        </div>
                        <Select
                            v-model="selectedLocale"
                            :disabled="localeLoading"
                            @update:model-value="changeLocale"
                        >
                            <SelectTrigger
                                class="header-locale-trigger"
                                :aria-label="t('display.appLanguage')"
                                :title="t('display.appLanguage')"
                            >
                                <RefreshCw
                                    v-if="localeLoading"
                                    class="locale-loading-icon"
                                    aria-hidden="true"
                                />
                                <Languages v-else class="header-locale-icon" aria-hidden="true" />
                                <SelectValue class="header-locale-value">
                                    {{ selectedLocaleLabel }}
                                </SelectValue>
                                <span class="locale-live-status" aria-live="polite">
                                    {{ localeLoading ? t('display.switching') : selectedLocaleLabel }}
                                </span>
                            </SelectTrigger>
                            <SelectContent
                                align="end"
                                :side-offset="6"
                                class="locale-select-content"
                            >
                                <SelectItem
                                    v-for="localeOption in supportedLocales"
                                    :key="localeOption.code"
                                    :value="localeOption.code"
                                    :text-value="localeOption.nativeLabel"
                                    class="locale-select-item"
                                >
                                    <span class="locale-option-copy">
                                        <span>{{ localeOption.nativeLabel }}</span>
                                        <small>{{ localeOption.code }}</small>
                                    </span>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div class="status-grid">
                        <div>
                            <span>{{ t('display.clientVersion') }}</span>
                            <strong>{{ clientVersionLabel }}</strong>
                            <small v-if="versionHint">{{ versionHint }}</small>
                        </div>
                        <div>
                            <span>{{ t('display.dataVersion') }}</span>
                            <strong>{{ dataVersionLabel }}</strong>
                            <small>{{ dataLocaleStatusLabel }}</small>
                        </div>
                        <div class="lcu-status-card">
                            <span>{{ t('display.lcuConnection') }}</span>
                            <strong>{{ t('display.autoDiscover') }}</strong>
                            <small>{{ manualLolPath ? t('display.runningClientWithFallback') : t('display.runningClient') }}</small>
                        </div>
                    </div>

                    <section class="update-panel" :class="updatePanelClass">
                        <div class="update-main">
                            <div class="update-copy">
                                <div class="update-heading">
                                    <span>{{ t('display.appUpdate') }}</span>
                                    <strong>{{ updateTitle }}</strong>
                                </div>
                            </div>
                            <div class="update-actions">
                                <button
                                    v-if="showCheckUpdateAction"
                                    class="update-action"
                                    type="button"
                                    :title="t('display.checkUpdate')"
                                    :disabled="!canCheckUpdate"
                                    @click="checkAppUpdate"
                                >
                                    <RefreshCw class="update-action-icon" :class="{ spinning: updateIsChecking }" />
                                </button>
                                <button
                                    v-if="showInstallUpdateAction"
                                    class="update-action accent"
                                    type="button"
                                    :title="installUpdateTitle"
                                    :disabled="!canInstallUpdate"
                                    @click="installAppUpdate"
                                >
                                    <RotateCw class="update-action-icon" />
                                </button>
                                <button
                                    v-else-if="showManualDownloadLink"
                                    class="update-action accent"
                                    type="button"
                                    :title="t('display.openDownload')"
                                    @click="openDownloadUrl"
                                >
                                    <Download class="update-action-icon" />
                                </button>
                            </div>
                        </div>
                        <div v-if="showUpdateProgress" class="update-progress">
                            <div class="update-progress-track" aria-hidden="true">
                                <span :style="{ width: updateProgressWidth }"></span>
                            </div>
                            <span class="update-progress-text">{{ updateProgressText }}</span>
                        </div>
                    </section>

                    <button
                        class="game-directory-toggle"
                        type="button"
                        :aria-expanded="showAdvancedLcuConfig"
                        @click="toggleAdvancedLcuConfig"
                    >
                        <span>{{ t('display.gameDirectory') }}</span>
                        <ChevronRight
                            class="game-directory-arrow"
                            :class="{ open: showAdvancedLcuConfig }"
                        />
                    </button>
                    <p class="game-directory-hint">
                        {{ t('display.gameDirectoryAdminHint') }}
                    </p>

                    <section v-if="showAdvancedLcuConfig" class="advanced-lcu-panel">
                        <div class="manual-path-row">
                            <input
                                v-model="manualLolPath"
                                class="manual-path-input"
                                type="text"
                                spellcheck="false"
                                placeholder="C:\Riot Games\League of Legends"
                                @blur="validateManualLolPath"
                            />
                            <button
                                class="manual-path-button"
                                type="button"
                                :title="t('display.browseDirectory')"
                                :disabled="manualPathLoading"
                                @click="browseManualLolPath"
                            >
                                <FolderSearch class="manual-path-icon" />
                            </button>
                            <button
                                class="manual-path-button accent"
                                type="button"
                                :title="t('display.saveDirectory')"
                                :disabled="manualPathLoading"
                                @click="saveManualLolPath"
                            >
                                <Save class="manual-path-icon" />
                            </button>
                            <button
                                class="manual-path-button danger"
                                type="button"
                                :title="t('display.clearDirectory')"
                                :disabled="manualPathLoading || !manualLolPath"
                                @click="clearManualLolPath"
                            >
                                <Trash2 class="manual-path-icon" />
                            </button>
                        </div>
                    </section>
                    <div
                        v-if="manualPathStatus"
                        class="manual-path-status"
                        :class="manualPathStatus.type"
                    >
                        {{ manualPathStatus.message }}
                        <button
                            v-if="manualPathStatus.suggestedPath"
                            class="manual-path-suggestion"
                            type="button"
                            @click="applyManualPathSuggestion"
                        >
                            {{ t('display.useSuggestedDirectory') }}
                        </button>
                    </div>
                </div>

                <ItemSetInstaller />
                <OverlayPreferences
                    @post-game-auto-show-changed="setPostGameShareAutoShowEnabled"
                />
                <ChampionMonitor />
                <MatchHistoryPanel />

                <section class="post-game-panel">
                    <div class="section-header">
                        <p class="section-kicker">{{ t('display.postGamePoster') }}</p>
                    </div>
                    <button
                        class="post-game-share-button mock"
                        type="button"
                        :disabled="postGameShareLoading"
                        @click="createMockPostGameSharePoster"
                    >
                        <Sparkles class="icon" />
                        <span class="button-copy">
                            <span class="text">{{ t('display.mockGenerate') }}</span>
                            <span class="hint">{{ t('display.refreshPreviewEveryClick') }}</span>
                        </span>
                    </button>
                </section>

                <section class="diagnostic-panel">
                    <div class="section-header">
                        <p class="section-kicker">{{ t('display.windowPreview') }}</p>
                    </div>

                    <div class="test-controls">
                        <button class="test-btn primary" @click="testFloatingWindow">
                            <Target class="icon" />
                            <span class="button-copy">
                                <span class="text">{{ t('display.augmentOverlay') }}</span>
                                <span class="hint">{{ t('display.randomChampionAugments') }}</span>
                            </span>
                        </button>

                        <button class="test-btn secondary" @click="testPopupWindow">
                            <ClipboardList class="icon" />
                            <span class="button-copy">
                                <span class="text">{{ t('display.championDetails') }}</span>
                                <span class="hint">{{ t('display.randomChampionDetails') }}</span>
                            </span>
                        </button>

                        <button class="test-btn warning" @click="testDatabaseLoad">
                            <Database class="icon" />
                            <span class="button-copy">
                                <span class="text">{{ t('display.dataProbe') }}</span>
                                <span class="hint">{{ t('display.checkDataLoading') }}</span>
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
                    {{ t('display.brand') }} v{{ clientVersionLabel }} -
                    <a class="footer-link" :href="ARAMGG_HOME_URL" @click.prevent="openAramggHome">
                        {{ ARAMGG_HOME_LABEL }}
                    </a>
                    <span class="footer-separator">·</span>
                    <button class="footer-link footer-action" type="button" @click="openLogDirectory">
                        {{ t('display.logDirectory') }}
                    </button>
                    <span class="footer-separator">·</span>
                    <a class="footer-link" :href="DATA_API_URL" @click.prevent="openDataApi">
                        {{ DATA_API_LABEL }}
                    </a>
                </p>
                <p class="footer-feedback">
                    {{ t('display.feedback') }}
                    <button class="footer-link footer-action" type="button" @click="openFeedbackWidget">
                        {{ t('feedback.button') }}
                    </button>
                    <span class="footer-separator">·</span>
                    <a class="footer-link" :href="GITHUB_URL" @click.prevent="openGithub">
                        GitHub
                    </a>
                    <span class="footer-separator">·</span>
                    <button class="footer-link footer-action" type="button" @click="openChangelog">
                        {{ t('display.changelog') }}
                    </button>
                </p>
            </footer>

            <div v-if="showQuitConfirm" class="app-modal-overlay" @click.self="cancelQuitApp">
                <section class="app-modal" role="dialog" aria-modal="true" aria-labelledby="quit-title">
                    <div class="app-modal-copy">
                        <h2 id="quit-title">{{ t('display.quitTitle') }}</h2>
                        <p>{{ t('display.quitDescription') }}</p>
                    </div>
                    <div class="app-modal-actions">
                        <button class="app-modal-action secondary" type="button" @click="cancelQuitApp">
                            {{ t('common.cancel') }}
                        </button>
                        <button class="app-modal-action danger" type="button" @click="quitApp">
                            {{ t('common.exit') }}
                        </button>
                    </div>
                </section>
            </div>

            <div v-if="showChangelog" class="app-modal-overlay" @click.self="closeChangelog">
                <section class="app-modal changelog-modal" role="dialog" aria-modal="true" aria-labelledby="changelog-title">
                    <header class="changelog-modal-header">
                        <div class="changelog-title-group">
                            <ScrollText class="changelog-title-icon" />
                            <div>
                                <p class="section-kicker">{{ t('display.versionHistory') }}</p>
                                <h2 id="changelog-title">{{ t('display.changelog') }}</h2>
                            </div>
                        </div>
                        <button class="window-control changelog-close" type="button" :title="t('common.close')" @click="closeChangelog">
                            <X class="window-icon" />
                        </button>
                    </header>

                    <div v-if="hasChangelog" class="changelog-list">
                        <article
                            v-for="(entry, index) in changelogEntries"
                            :key="entry.version || index"
                            class="changelog-entry"
                            :class="{ current: isCurrentChangelogEntry(entry) }"
                        >
                            <header class="changelog-entry-header">
                                <div class="changelog-entry-title">
                                    <strong>{{ formatChangelogVersion(entry) }}</strong>
                                    <span v-if="isCurrentChangelogEntry(entry)" class="changelog-current">{{ t('display.currentVersion') }}</span>
                                </div>
                                <time v-if="entry.date" class="changelog-date">
                                    {{ formatChangelogDate(entry.date) }}
                                </time>
                            </header>
                            <h3 v-if="entry.title">{{ entry.title }}</h3>
                            <p v-if="entry.summary">{{ entry.summary }}</p>
                            <ul v-if="entry.changes?.length" class="changelog-changes">
                                <li v-for="change in entry.changes" :key="change">
                                    {{ change }}
                                </li>
                            </ul>
                        </article>
                    </div>

                    <p v-else class="changelog-empty">{{ t('display.noChangelog') }}</p>
                </section>
            </div>

            <PostGameShareModal
                v-if="showPostGameShare && postGamePoster"
                :poster="postGamePoster"
                @close="closePostGameShare"
            />

            <FeedbackWidget
                ref="feedbackWidget"
                @open-change="feedbackOpen = $event"
            />

            <button
                v-if="shouldShowPostGameFloatingShare && !feedbackOpen"
                class="post-game-floating-share"
                type="button"
                :title="t('display.shareReport')"
                :disabled="postGameShareLoading"
                @click="openPostGameShareFromFloatingButton"
            >
                <Share2 class="icon" />
                <span>{{ postGameShareFloatingLabel }}</span>
            </button>
        </section>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ItemSetInstaller from './ItemSetInstaller.vue'
import OverlayPreferences from './OverlayPreferences.vue'
import ChampionMonitor from './ChampionMonitor.vue'
import MatchHistoryPanel from './MatchHistoryPanel.vue'
import FeedbackWidget from './FeedbackWidget.vue'
import PostGameShareModal from './PostGameShareModal.vue'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from './ui/select/index.js'
import { useAppUpdate } from '../composables/use-app-update.ts'
import { usePostGameShare } from '../composables/use-post-game-share.ts'
import { electronAPI } from '../native/electron-api.js'
import { trackAnalyticsEvent } from '../services/analytics.ts'
import { useI18n } from 'vue-i18n'
import {
    ChevronRight,
    ClipboardList,
    Cpu,
    Database,
    Download,
    FolderSearch,
    Languages,
    Minus,
    RefreshCw,
    RotateCw,
    Save,
    ScrollText,
    Share2,
    Sparkles,
    Target,
    Trash2,
    X,
} from 'lucide-vue-next'

const testStatus = ref(null)
const { t } = useI18n()
const versionInfo = ref(null)
const showQuitConfirm = ref(false)
const showChangelog = ref(false)
const feedbackWidget = ref(null)
const feedbackOpen = ref(false)
const showAdvancedLcuConfig = ref(false)
const manualLolPath = ref('')
const manualPathStatus = ref(null)
const manualPathLoading = ref(false)
const selectedLocale = ref('zh-CN')
const activeLocale = ref('zh-CN')
const supportedLocales = ref([
    { code: 'zh-CN', label: 'Simplified Chinese', nativeLabel: '简体中文' },
    { code: 'en-US', label: 'English', nativeLabel: 'English' },
    { code: 'zh-TW', label: 'Traditional Chinese', nativeLabel: '繁體中文' },
])
const localeLoading = ref(false)
const ARAMGG_HOME_URL = 'https://aramgg.com'
const ARAMGG_HOME_LABEL = 'aramgg.com'
const DATA_API_URL = 'https://data.dtodo.cn'
const DATA_API_LABEL = computed(() => t('display.openApi'))
const GITHUB_URL = 'https://github.com/valkia/aramgg_client'
let removeQuitConfirmListener = null
let removeLocaleChangedListener = null

const clientVersionLabel = computed(() => {
    if (!versionInfo.value) {
        return '-'
    }

    return versionInfo.value.currentVersion || '-'
})

const dataVersionLabel = computed(() => versionInfo.value?.dataVersion || '-')

const selectedLocaleLabel = computed(() => {
    return supportedLocales.value.find((locale) => locale.code === selectedLocale.value)?.nativeLabel || selectedLocale.value
})

const dataLocaleStatusLabel = computed(() => {
    const parts = []
    if (versionInfo.value?.gamePatch) {
        parts.push(`LOL ${versionInfo.value.gamePatch}`)
    }
    if (versionInfo.value?.locale) {
        parts.push(versionInfo.value.locale)
    }

    return parts.join(' · ') || '-'
})

const versionHint = computed(() => {
    if (!versionInfo.value) {
        return ''
    }

    if (!versionInfo.value.isNewer) {
        return versionInfo.value.latestVersion ? t('display.latestVersion', { version: versionInfo.value.latestVersion }) : ''
    }

    if (versionInfo.value.severity === 'patch') {
        return t('display.patchVersion', { version: versionInfo.value.latestVersion })
    }

    return versionInfo.value.statusText + ' ' + versionInfo.value.latestVersion
})

const {
    manualUpdateDownloadUrl,
    updatePanelClass,
    updateTitle,
    updateIsChecking,
    canCheckUpdate,
    canInstallUpdate,
    showCheckUpdateAction,
    showInstallUpdateAction,
    installUpdateTitle,
    showManualDownloadLink,
    updateProgressWidth,
    showUpdateProgress,
    updateProgressText,
    checkAppUpdate,
    installAppUpdate,
} = useAppUpdate(versionInfo)

const changelogEntries = computed(() => {
    return Array.isArray(versionInfo.value?.changelog) ? versionInfo.value.changelog : []
})

const hasChangelog = computed(() => changelogEntries.value.length > 0)

const {
    showPostGameShare,
    postGamePoster,
    postGameShareLoading,
    shouldShowPostGameFloatingShare,
    postGameShareFloatingLabel,
    closePostGameShare,
    openPostGameShareFromFloatingButton,
    createMockPostGameSharePoster,
    setPostGameShareAutoShowEnabled,
} = usePostGameShare(testStatus)

const loadVersionInfo = async () => {
    const requestedLocale = activeLocale.value
    try {
        const result = await electronAPI.appInfo.getVersionInfo()
        const resultLocale = result.data?.locale
        if (result.success && (!resultLocale || resultLocale === activeLocale.value)) {
            versionInfo.value = result.data
        } else if (result.success) {
            console.debug('Ignored stale version info response', {
                requestedLocale,
                resultLocale,
                activeLocale: activeLocale.value,
            })
        }
    } catch (error) {
        console.warn('Failed to load version info:', error)
    }
}

const loadLocale = async () => {
    try {
        const result = await electronAPI.locale.get()
        if (result?.supportedLocales?.length) {
            supportedLocales.value = result.supportedLocales
        }
        if (result?.locale) {
            selectedLocale.value = result.locale
            activeLocale.value = result.locale
        }
    } catch (error) {
        console.warn('Failed to load locale:', error)
    }
}

const changeLocale = async (requestedLocale = selectedLocale.value) => {
    if (!requestedLocale || requestedLocale === activeLocale.value || localeLoading.value) {
        selectedLocale.value = activeLocale.value
        return
    }

    const previousLocale = activeLocale.value
    selectedLocale.value = requestedLocale
    localeLoading.value = true
    try {
        const result = await electronAPI.locale.set(requestedLocale)
        if (result?.supportedLocales?.length) {
            supportedLocales.value = result.supportedLocales
        }
        if (result?.locale) {
            selectedLocale.value = result.locale
            activeLocale.value = result.locale
        }
        if (versionInfo.value && result?.dataVersion) {
            versionInfo.value = {
                ...versionInfo.value,
                locale: result.locale,
                dataVersion: result.dataVersion,
            }
        }
        testStatus.value = {
            type: 'success',
            message: t('display.localeChanged', { locale: selectedLocaleLabel.value }),
        }
        trackAnalyticsEvent('language_switch', {
            from_language: previousLocale,
            to_language: activeLocale.value,
            data_version: result?.dataVersion || '',
        })
    } catch (error) {
        selectedLocale.value = activeLocale.value
        console.warn('Failed to change locale:', error)
        testStatus.value = {
            type: 'error',
            message: t('display.localeChangeFailed', { error: error.message || error }),
        }
        trackAnalyticsEvent('language_switch_failure', {
            from_language: previousLocale,
            to_language: requestedLocale,
            error_message: error?.message || String(error),
        })
    } finally {
        localeLoading.value = false
    }
}

const setManualPathStatus = (type, message, extra = {}) => {
    manualPathStatus.value = {
        type,
        message,
        ...extra,
    }
}

const loadManualLolPath = async () => {
    try {
        const result = await electronAPI.lcu.getManualLeaguePath()
        if (result?.success) {
            manualLolPath.value = result.path || result.configuredPath || ''
            if (result.path && result.valid === false) {
                setManualPathStatus('error', result.message || t('display.savedDirectoryUnavailable'), {
                    suggestedPath: result.suggestedPath || '',
                })
            }
        }
    } catch (error) {
        console.warn('Failed to load manual League path:', error)
    }
}

const toggleAdvancedLcuConfig = async () => {
    showAdvancedLcuConfig.value = !showAdvancedLcuConfig.value
    if (showAdvancedLcuConfig.value) {
        await loadManualLolPath()
    }
}

const validateManualLolPath = async () => {
    const path = manualLolPath.value.trim()
    if (!path) {
        manualPathStatus.value = null
        return false
    }

    try {
        const result = await electronAPI.lcu.validateManualLeaguePath(path)
        if (!result?.success) {
            throw new Error(result?.message || result?.error || t('display.directoryValidationFailed'))
        }

        if (result.valid) {
            setManualPathStatus('success', result.message || t('display.directoryAvailable'))
            return true
        }

        setManualPathStatus('error', result.message || t('display.directoryUnavailable'), {
            suggestedPath: result.suggestedPath || '',
        })
        return false
    } catch (error) {
        setManualPathStatus('error', error.message || t('display.directoryValidationFailed'))
        return false
    }
}

const browseManualLolPath = async () => {
    manualPathLoading.value = true
    try {
        const result = await electronAPI.lcu.selectManualLeaguePath()
        if (!result?.success) {
            if (result?.reason !== 'cancelled') {
                throw new Error(result?.message || result?.error || t('display.directorySelectionFailed'))
            }
            return
        }

        manualLolPath.value = result.path || result.normalizedPath || ''
        if (result.valid) {
            setManualPathStatus('success', result.message || t('display.directoryAvailableAfterSave'))
        } else {
            setManualPathStatus('error', result.message || t('display.directoryUnavailable'), {
                suggestedPath: result.suggestedPath || '',
            })
        }
    } catch (error) {
        setManualPathStatus('error', error.message || t('display.directorySelectionFailed'))
    } finally {
        manualPathLoading.value = false
    }
}

const saveManualLolPath = async () => {
    const path = manualLolPath.value.trim()
    if (!path) {
        setManualPathStatus('error', t('display.enterLeagueDirectory'))
        return
    }

    manualPathLoading.value = true
    try {
        const result = await electronAPI.lcu.setManualLeaguePath(path)
        if (!result?.success || !result.valid) {
            setManualPathStatus('error', result?.message || result?.error || t('display.directoryUnavailable'), {
                suggestedPath: result?.suggestedPath || '',
            })
            return
        }

        manualLolPath.value = result.path || result.configuredPath || path
        setManualPathStatus(
            'success',
            result.connected ? t('display.directorySavedConnected') : t('display.directorySavedWaiting')
        )
    } catch (error) {
        setManualPathStatus('error', error.message || t('display.directorySaveFailed'))
    } finally {
        manualPathLoading.value = false
    }
}

const clearManualLolPath = async () => {
    manualPathLoading.value = true
    try {
        const result = await electronAPI.lcu.clearManualLeaguePath()
        if (!result?.success) {
            throw new Error(result?.error || t('display.directoryClearFailed'))
        }

        manualLolPath.value = ''
        setManualPathStatus('info', t('display.directoryCleared'))
    } catch (error) {
        setManualPathStatus('error', error.message || t('display.directoryClearFailed'))
    } finally {
        manualPathLoading.value = false
    }
}

const applyManualPathSuggestion = async () => {
    if (!manualPathStatus.value?.suggestedPath) {
        return
    }

    manualLolPath.value = manualPathStatus.value.suggestedPath
    await validateManualLolPath()
}

const openDownloadUrl = async () => {
    const url = manualUpdateDownloadUrl.value
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

const openDataApi = async () => {
    try {
        await electronAPI.shell.openExternal(DATA_API_URL)
    } catch (error) {
        console.warn('Failed to open data API:', error)
    }
}

const openFeedbackWidget = () => {
    feedbackWidget.value?.open()
}

const openGithub = async () => {
    try {
        await electronAPI.shell.openExternal(GITHUB_URL)
    } catch (error) {
        console.warn('Failed to open GitHub:', error)
    }
}

const openChangelog = () => {
    showChangelog.value = true
}

const closeChangelog = () => {
    showChangelog.value = false
}

const formatChangelogVersion = (entry) => {
    const version = String(entry?.version || '').trim()
    if (!version) {
        return t('display.untaggedVersion')
    }

    return version.startsWith('v') ? version : `v${version}`
}

const formatChangelogDate = (date) => {
    const value = String(date || '').trim()
    const isoDate = value.match(/^\d{4}-\d{2}-\d{2}/)
    if (isoDate) {
        return isoDate[0]
    }

    return value
}

const isCurrentChangelogEntry = (entry) => {
    return String(entry?.version || '').replace(/^v/i, '') === clientVersionLabel.value
}

const openLogDirectory = async () => {
    try {
        const result = await electronAPI.appInfo.openLogDirectory()
        if (!result?.success) {
            throw new Error(result?.error || t('display.logOpenFailed'))
        }
        testStatus.value = {
            type: 'success',
            message: t('display.logOpened'),
        }
    } catch (error) {
        console.warn('Failed to open log directory:', error)
        testStatus.value = {
            type: 'error',
            message: `${t('display.logOpenFailed')}：${error.message || error}`,
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
    const benchText = benchCount ? ` | ${t('display.benchCount', { count: benchCount })}` : ''

    return `${prefix}：${data.championName || t('display.randomChampion')}${augmentNames ? ' | ' + augmentNames : ''}${benchText}`
}

const testFloatingWindow = async () => {
    testStatus.value = { type: 'info', message: t('display.openingAugmentPreview') }

    try {
        const result = await electronAPI.diagnostics.testShowRandomFloating()
        if (!result.success) {
            throw new Error(result.error || t('display.sendingFailed'))
        }
        testStatus.value = {
            type: 'success',
            message: formatRandomPreviewMessage(t('display.augmentPreviewSent'), result),
        }
    } catch (err) {
        testStatus.value = { type: 'error', message: t('display.sendingFailedWithReason', { error: err.message }) }
    }
}

const testPopupWindow = async () => {
    testStatus.value = { type: 'info', message: t('display.openingChampionPreview') }

    try {
        const result = await electronAPI.diagnostics.testShowRandomPopup()
        if (!result.success) {
            throw new Error(result.error || t('display.sendingFailed'))
        }
        testStatus.value = {
            type: 'success',
            message: formatRandomPreviewMessage(t('display.championPreviewSent'), result),
        }
    } catch (err) {
        testStatus.value = { type: 'error', message: t('display.sendingFailedWithReason', { error: err.message }) }
    }
}

const testDatabaseLoad = async () => {
    testStatus.value = { type: 'info', message: t('display.testingData') }

    try {
        const result = await electronAPI.diagnostics.testDatabaseLoad()
        console.log('Database test result', result)

        if (result.success) {
            testStatus.value = {
                type: 'success',
                message: t('display.dataLoaded', { count: result.dataCount }),
            }
        } else {
            let errorMsg = result.error || t('common.unknownError')
            if (result.tests) {
                const failedTests = result.tests
                    .map((t, i) => '[' + (i + 1) + '] ' + (t.exists ? 'OK' : 'MISS') + ' ' + t.path.substring(0, 60) + '...')
                    .join('\\n')
                errorMsg += `\\n\\n${t('display.pathCheckResults')}\\n${failedTests}`
            }
            testStatus.value = { type: 'error', message: errorMsg }
        }
    } catch (err) {
        testStatus.value = { type: 'error', message: t('display.testFailed', { error: err.message }) }
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
    void loadLocale().finally(() => loadVersionInfo())
    loadManualLolPath()
    removeQuitConfirmListener = electronAPI.events.on('quit-confirm-requested', confirmQuitApp)
    removeLocaleChangedListener = electronAPI.events.on('locale-changed', ({ locale } = {}) => {
        if (locale) {
            selectedLocale.value = locale
            activeLocale.value = locale
            loadVersionInfo()
        }
    })
})

onBeforeUnmount(() => {
    removeQuitConfirmListener?.()
    removeQuitConfirmListener = null
    removeLocaleChangedListener?.()
    removeLocaleChangedListener = null
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

.header-locale-trigger {
    width: 132px;
    height: 40px;
    position: relative;
    flex: 0 0 auto;
    justify-content: flex-start;
    gap: 8px;
    padding: 0 10px;
    border-radius: 6px;
    background: rgba(7, 18, 27, 0.78) !important;
    border-color: rgba(226, 192, 143, 0.22) !important;
    box-shadow:
        0 8px 18px rgba(0, 0, 0, 0.14),
        inset 0 1px 0 rgba(255, 255, 255, 0.035);
    color: #e2c08f !important;
    cursor: pointer;
    font-size: 12px;
    font-weight: 850;
    transition-property: background-color, border-color, box-shadow, scale;
    transition-duration: 150ms;
    transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
}

.header-locale-trigger:hover {
    background: rgba(194, 156, 109, 0.13) !important;
    border-color: rgba(226, 192, 143, 0.42) !important;
}

.header-locale-trigger:focus-visible,
.header-locale-trigger[data-state='open'] {
    background: rgba(194, 156, 109, 0.15) !important;
    border-color: rgba(226, 192, 143, 0.58) !important;
    box-shadow:
        0 0 0 2px rgba(194, 156, 109, 0.12),
        0 10px 24px rgba(0, 0, 0, 0.22);
}

.header-locale-trigger:active:not(:disabled) {
    scale: 0.96;
}

.header-locale-trigger:disabled {
    cursor: default;
    opacity: 0.72;
}

.header-locale-value {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.header-locale-trigger :deep(.select-trigger-chevron) {
    margin-left: auto;
    color: #859491;
    transition-property: transform, color;
    transition-duration: 150ms;
    transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
}

.header-locale-icon,
.locale-loading-icon {
    width: 14px;
    height: 14px;
    flex: 0 0 auto;
    pointer-events: none;
}

.header-locale-trigger[data-state='open'] :deep(.select-trigger-chevron) {
    color: #e2c08f;
    transform: rotate(180deg);
}

.locale-loading-icon {
    animation: update-spin 0.9s linear infinite;
}

.locale-live-status {
    width: 1px;
    height: 1px;
    position: absolute;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    clip-path: inset(50%);
    white-space: nowrap;
}

:global(.locale-select-content) {
    min-width: 148px !important;
    padding: 0;
    border-color: rgba(226, 192, 143, 0.2) !important;
    border-radius: 8px !important;
    background: rgba(10, 22, 31, 0.98) !important;
    box-shadow:
        0 18px 40px rgba(0, 0, 0, 0.42),
        inset 0 1px 0 rgba(255, 255, 255, 0.04) !important;
}

:global(.locale-select-item) {
    min-height: 40px;
    padding: 6px 30px 6px 9px !important;
    border-radius: 4px !important;
    cursor: pointer !important;
    transition-property: background-color, color;
    transition-duration: 120ms;
    transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
}

:global(.locale-select-item[data-highlighted]) {
    background: rgba(194, 156, 109, 0.13) !important;
    color: #f4ecdc !important;
}

:global(.locale-select-item[data-state='checked']) {
    color: #e2c08f !important;
}

.locale-option-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    line-height: 1.2;
}

.locale-option-copy > span {
    color: inherit;
    font-size: 12px;
    font-weight: 800;
}

.locale-option-copy small {
    color: #6f817e;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
}

.status-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
}

.status-grid > div {
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

.update-panel {
    margin-top: 8px;
    padding: 6px 8px;
    border: 1px solid rgba(226, 192, 143, 0.18);
    border-radius: 4px;
    background: rgba(4, 15, 24, 0.42);
    box-shadow: inset 0 1px 0 rgba(244, 236, 220, 0.04);
}

.update-panel.phase-downloading,
.update-panel.phase-downloaded,
.update-panel.phase-available {
    border-color: rgba(226, 192, 143, 0.34);
    background: rgba(194, 156, 109, 0.08);
}

.update-panel.phase-error {
    border-color: rgba(255, 180, 171, 0.26);
    background: rgba(68, 14, 20, 0.2);
}

.update-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.update-copy {
    min-width: 0;
}

.update-heading {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 7px;
}

.update-copy span {
    flex: 0 0 auto;
    color: #bacac6;
    font-size: 12px;
    font-weight: 900;
    line-height: 1.1;
}

.update-copy strong {
    min-width: 0;
    color: #e2c08f;
    font-size: 10px;
    font-weight: 800;
    line-height: 1.15;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.update-actions {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    gap: 4px;
}

.update-action {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(244, 236, 220, 0.1);
    border-radius: 4px;
    background: rgba(17, 29, 38, 0.72);
    color: #d7e4f1;
    cursor: pointer;
    transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease, color 0.16s ease, opacity 0.16s ease;
}

.update-action:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: rgba(226, 192, 143, 0.4);
    color: #e2c08f;
}

.update-action:active:not(:disabled) {
    transform: scale(0.96);
}

.update-action:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}

.update-action.accent {
    border-color: rgba(226, 192, 143, 0.34);
    background: rgba(194, 156, 109, 0.14);
    color: #e2c08f;
}

.update-action-icon {
    width: 13px;
    height: 13px;
}

.update-action-icon.spinning {
    animation: update-spin 0.9s linear infinite;
}

.update-progress {
    margin-top: 6px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 58px;
    align-items: center;
    gap: 6px;
}

.update-progress-track {
    height: 4px;
    overflow: hidden;
    border-radius: 4px;
    background: rgba(7, 10, 13, 0.58);
    box-shadow: inset 0 0 0 1px rgba(244, 236, 220, 0.06);
}

.update-progress-track span {
    display: block;
    width: 0;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, rgba(194, 156, 109, 0.72), #e2c08f);
    transition: width 0.18s ease;
}

.update-progress-text {
    color: #e2c08f;
    font-size: 9px;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
}

@keyframes update-spin {
    from {
        transform: rotate(0deg);
    }

    to {
        transform: rotate(360deg);
    }
}

.lcu-status-card {
    position: relative;
}

.game-directory-toggle {
    width: 100%;
    min-height: 40px;
    margin-top: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid rgba(226, 192, 143, 0.22);
    border-radius: 4px;
    background: rgba(4, 15, 24, 0.46);
    color: #d7e4f1;
    cursor: pointer;
    font-size: 12px;
    font-weight: 900;
    text-align: left;
}

.game-directory-hint {
    margin: 6px 2px 0;
    color: #859491;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.45;
    text-wrap: pretty;
}

.game-directory-toggle:hover {
    border-color: rgba(226, 192, 143, 0.42);
    background: rgba(194, 156, 109, 0.1);
}

.game-directory-arrow {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    color: #e2c08f;
    transition: transform 0.18s ease;
}

.game-directory-arrow.open {
    transform: rotate(90deg);
}

.advanced-lcu-panel {
    margin-top: 6px;
    padding: 10px;
    border: 1px solid rgba(244, 236, 220, 0.07);
    border-radius: 4px;
    background: rgba(4, 15, 24, 0.38);
}

.manual-path-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 34px 34px 34px;
    gap: 6px;
    align-items: center;
}

.manual-path-input {
    width: 100%;
    min-width: 0;
    height: 34px;
    padding: 0 9px;
    border: 1px solid rgba(244, 236, 220, 0.1);
    border-radius: 4px;
    background: rgba(7, 10, 13, 0.52);
    color: var(--lol-ivory);
    font-size: 12px;
    outline: none;
}

.manual-path-input::placeholder {
    color: #5f6f70;
}

.manual-path-input:focus {
    border-color: rgba(226, 192, 143, 0.42);
    box-shadow: 0 0 0 2px rgba(226, 192, 143, 0.1);
}

.manual-path-button {
    width: 34px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(244, 236, 220, 0.1);
    border-radius: 4px;
    background: rgba(17, 29, 38, 0.72);
    color: #d7e4f1;
    cursor: pointer;
}

.manual-path-button:hover:not(:disabled) {
    border-color: rgba(226, 192, 143, 0.38);
    color: #e2c08f;
}

.manual-path-button.accent {
    color: #e2c08f;
    background: rgba(194, 156, 109, 0.1);
}

.manual-path-button.danger {
    color: #ffb4ab;
    background: rgba(68, 14, 20, 0.26);
}

.manual-path-button:disabled {
    cursor: not-allowed;
    opacity: 0.48;
}

.manual-path-icon {
    width: 15px;
    height: 15px;
}

.manual-path-status {
    margin-top: 8px;
    padding: 8px 9px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: 4px;
    font-size: 11px;
    line-height: 1.4;
}

.manual-path-status.info {
    background: rgba(226, 192, 143, 0.08);
    color: #e2c08f;
    border: 1px solid rgba(226, 192, 143, 0.18);
}

.manual-path-status.success {
    background: rgba(84, 216, 132, 0.08);
    color: #54d884;
    border: 1px solid rgba(84, 216, 132, 0.2);
}

.manual-path-status.error {
    background: rgba(255, 180, 171, 0.08);
    color: #ffb4ab;
    border: 1px solid rgba(255, 180, 171, 0.22);
}

.manual-path-suggestion {
    margin-left: auto;
    flex: 0 0 auto;
    padding: 3px 6px;
    border: 1px solid rgba(255, 180, 171, 0.26);
    border-radius: 4px;
    background: rgba(255, 180, 171, 0.08);
    color: #ffcec8;
    font-size: 10px;
    font-weight: 900;
    cursor: pointer;
}

.manual-path-suggestion:hover {
    border-color: rgba(255, 180, 171, 0.48);
    background: rgba(255, 180, 171, 0.14);
}

.post-game-panel {
    padding: 14px;
    border-top: 1px solid rgba(244, 236, 220, 0.06);
}

.post-game-share-button {
    width: 100%;
    min-height: 58px;
    display: flex;
    align-items: center;
    gap: 10px;
    position: relative;
    overflow: hidden;
    padding: 10px 12px;
    border: 0;
    border-radius: 6px;
    color: #061116;
    background:
        linear-gradient(135deg, rgba(155, 232, 220, 0.96), rgba(231, 189, 104, 0.92));
    box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.12),
        0 14px 28px rgba(0, 0, 0, 0.28);
    text-align: left;
    cursor: pointer;
    transition-property: scale, filter, box-shadow, opacity;
    transition-duration: 150ms;
    transition-timing-function: ease-out;
}

.post-game-share-button::before {
    content: '';
    position: absolute;
    inset: 0;
    opacity: 0;
    pointer-events: none;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.32), transparent);
    transition-property: opacity;
    transition-duration: 160ms;
    transition-timing-function: ease-out;
}

.post-game-share-button:hover:not(:disabled) {
    filter: brightness(1.05);
    box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.16),
        0 18px 34px rgba(0, 0, 0, 0.34);
}

.post-game-share-button:hover:not(:disabled)::before {
    opacity: 1;
}

.post-game-share-button:active:not(:disabled) {
    scale: 0.96;
}

.post-game-share-button:disabled {
    cursor: not-allowed;
    opacity: 0.58;
}

.post-game-share-button.mock {
    color: #d7e4f1;
    background:
        linear-gradient(135deg, rgba(25, 38, 48, 0.95), rgba(37, 49, 57, 0.9));
    box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.1),
        0 12px 24px rgba(0, 0, 0, 0.24);
}

.post-game-share-button.mock:hover:not(:disabled) {
    filter: brightness(1.08);
    box-shadow:
        0 0 0 1px rgba(155, 232, 220, 0.22),
        0 16px 30px rgba(0, 0, 0, 0.3);
}

.post-game-share-button .icon {
    width: 19px;
    height: 19px;
    flex: 0 0 auto;
    color: #061116;
}

.post-game-share-button.mock .icon {
    color: #9be8dc;
}

.post-game-share-button .text,
.post-game-share-button .hint {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.post-game-share-button .text {
    font-size: 13px;
    font-weight: 900;
}

.post-game-share-button .hint {
    margin-top: 2px;
    color: rgba(6, 17, 22, 0.72);
    font-size: 10px;
    font-weight: 800;
}

.post-game-share-button.mock .hint {
    color: rgba(215, 228, 241, 0.62);
}

.post-game-floating-share {
    position: absolute;
    left: 16px;
    bottom: 78px;
    z-index: 8;
    min-width: 112px;
    min-height: 46px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0 14px 0 16px;
    border: 0;
    border-radius: 23px;
    color: #061116;
    background:
        linear-gradient(135deg, rgba(155, 232, 220, 0.98), rgba(231, 189, 104, 0.96));
    box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.16),
        0 14px 28px rgba(0, 0, 0, 0.34),
        0 0 22px rgba(155, 232, 220, 0.16);
    cursor: pointer;
    font-size: 13px;
    font-weight: 900;
    transition-property: scale, filter, box-shadow, opacity;
    transition-duration: 150ms;
    transition-timing-function: ease-out;
}

.post-game-floating-share:hover:not(:disabled) {
    filter: brightness(1.06);
    box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.2),
        0 18px 34px rgba(0, 0, 0, 0.4),
        0 0 28px rgba(155, 232, 220, 0.22);
}

.post-game-floating-share:active:not(:disabled) {
    scale: 0.96;
}

.post-game-floating-share:disabled {
    cursor: not-allowed;
    opacity: 0.58;
}

.post-game-floating-share .icon {
    width: 17px;
    height: 17px;
    flex: 0 0 auto;
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
    line-height: 1.25;
    letter-spacing: 0;
    white-space: nowrap;
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

.changelog-modal {
    max-height: min(620px, calc(100% - 36px));
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.changelog-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(244, 236, 220, 0.08);
}

.changelog-title-group {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
}

.changelog-title-icon {
    width: 20px;
    height: 20px;
    flex: 0 0 auto;
    color: #e2c08f;
}

.changelog-modal-header h2 {
    margin: 0;
    color: var(--lol-ivory);
    font-size: 17px;
    font-weight: 900;
    line-height: 1.2;
}

.changelog-close {
    flex: 0 0 auto;
}

.changelog-list {
    max-height: min(430px, 62dvh);
    min-height: 0;
    overflow-y: auto;
    padding-right: 3px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.changelog-entry {
    padding: 10px 11px;
    border: 1px solid rgba(244, 236, 220, 0.07);
    border-radius: 4px;
    background: rgba(4, 15, 24, 0.42);
}

.changelog-entry.current {
    border-color: rgba(226, 192, 143, 0.32);
    background: rgba(194, 156, 109, 0.08);
}

.changelog-entry-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}

.changelog-entry-title {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
}

.changelog-entry-title strong {
    color: #e2c08f;
    font-size: 13px;
    font-weight: 900;
    line-height: 1.2;
}

.changelog-current {
    padding: 2px 5px;
    border: 1px solid rgba(226, 192, 143, 0.28);
    border-radius: 4px;
    background: rgba(194, 156, 109, 0.12);
    color: #e2c08f;
    font-size: 10px;
    font-weight: 900;
    line-height: 1.2;
}

.changelog-date {
    flex: 0 0 auto;
    color: #859491;
    font-size: 10px;
    font-weight: 800;
}

.changelog-entry h3 {
    margin: 8px 0 0;
    color: #d7e4f1;
    font-size: 13px;
    font-weight: 900;
    line-height: 1.3;
}

.changelog-entry p {
    margin: 6px 0 0;
    color: #bacac6;
    font-size: 12px;
    line-height: 1.45;
}

.changelog-changes {
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.changelog-changes li {
    position: relative;
    padding-left: 12px;
    color: #d7e4f1;
    font-size: 12px;
    line-height: 1.45;
}

.changelog-changes li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0.6em;
    width: 4px;
    height: 4px;
    border-radius: 4px;
    background: #e2c08f;
}

.changelog-empty {
    margin: 0;
    padding: 16px;
    border: 1px solid rgba(244, 236, 220, 0.07);
    border-radius: 4px;
    background: rgba(4, 15, 24, 0.42);
    color: #859491;
    font-size: 12px;
    text-align: center;
}

.changelog-list::-webkit-scrollbar {
    width: 6px;
}

.changelog-list::-webkit-scrollbar-track {
    background: rgba(4, 15, 24, 0.55);
}

.changelog-list::-webkit-scrollbar-thumb {
    border-radius: 4px;
    background: rgba(226, 195, 132, 0.48);
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
