<template>
    <div class="config-card">
        <div class="card-header">
            <FolderOpen class="card-icon" />
            <h3 class="card-title">游戏路径配置</h3>
        </div>
        <div class="card-content">
            <div class="input-group">
                <Input
                    v-model="lolPath"
                    placeholder="例如: C:\\Riot Games\\League of Legends"
                    :class="['path-input', { 'path-input-error': validationStatus === 'invalid' }]"
                    @blur="validateCurrentPath({ silentEmpty: true })"
                />
                <div class="button-group">
                    <Button @click="selectLolDirectory" class="btn-ghost" title="浏览目录">
                        <FolderSearch class="btn-icon" />
                        浏览
                    </Button>
                    <Button @click="saveLolPath" class="btn-accent">
                        <Save class="btn-icon" />
                        保存
                    </Button>
                </div>
            </div>
            <div v-if="showPathGuide" class="path-guide" :class="pathGuideClass">
                <component :is="pathGuideIcon" class="guide-icon" />
                <span>{{ pathGuideMessage }}</span>
                <button
                    v-if="suggestedPath"
                    class="guide-action"
                    type="button"
                    @click="applySuggestedPath"
                >
                    使用上一层
                </button>
            </div>
            <p v-if="lolPath && validationStatus === 'valid'" class="path-hint">
                <Check class="hint-icon" /> {{ lolPath }}
            </p>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, onMounted, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import configCache from '../service/config-cache'
import { electronAPI, hasElectronAPI } from '../native/electron-api.js'
import { AlertTriangle, Check, FolderOpen, FolderSearch, Info, Save } from 'lucide-vue-next'

const lolPath = ref('')
const validationStatus = ref('idle')
const validationMessage = ref('')
const suggestedPath = ref('')
const lastValidatedPath = ref('')
const emit = defineEmits(['path-changed'])

const pathGuideClass = computed(() => ({
    invalid: validationStatus.value === 'invalid',
    checking: validationStatus.value === 'checking',
}))

const showPathGuide = computed(() => validationStatus.value !== 'valid')

const pathGuideIcon = computed(() => {
    if (validationStatus.value === 'invalid') {
        return AlertTriangle
    }

    return Info
})

const pathGuideMessage = computed(() => {
    if (validationStatus.value === 'checking') {
        return '正在检查游戏路径...'
    }

    if (validationMessage.value) {
        return validationMessage.value
    }

    return '请选择英雄联盟游戏目录：国际服通常是 C:\\Riot Games\\League of Legends，国服通常是 WeGameApps\\英雄联盟；不要选择 Riot Client、LeagueClient、Game 子目录或 exe 文件。'
})

const setInvalidPathGuide = (message) => {
    validationStatus.value = 'invalid'
    validationMessage.value = message
    suggestedPath.value = ''
}

const validateCurrentPath = async (options = {}) => {
    const path = lolPath.value.trim()

    if (!path) {
        if (options.silentEmpty) {
            validationStatus.value = 'idle'
            validationMessage.value = ''
            suggestedPath.value = ''
        } else {
            setInvalidPathGuide('请输入英雄联盟安装目录，或点击“浏览”选择目录。')
        }
        return false
    }

    if (!hasElectronAPI()) {
        validationStatus.value = 'valid'
        validationMessage.value = '路径已填写；自动校验需要在 Electron 应用内运行。'
        suggestedPath.value = ''
        lastValidatedPath.value = path
        return true
    }

    validationStatus.value = 'checking'
    validationMessage.value = ''
    suggestedPath.value = ''

    try {
        const result = await electronAPI.dialogs.validateLolDirectory(path)

        if (lolPath.value.trim() !== path) {
            return false
        }

        if (!result?.success) {
            throw new Error(result?.message || result?.error || '路径校验失败')
        }

        lastValidatedPath.value = path
        validationStatus.value = result.valid ? 'valid' : 'invalid'
        validationMessage.value = result.message || (result.valid ? '路径格式正确。' : '游戏路径不正确，请重新选择。')
        suggestedPath.value = result.suggestedPath || ''
        return Boolean(result.valid)
    } catch (error) {
        if (lolPath.value.trim() !== path) {
            return false
        }

        setInvalidPathGuide(error.message || '路径校验失败，请重试。')
        lastValidatedPath.value = path
        return false
    }
}

const applySuggestedPath = async () => {
    if (!suggestedPath.value) {
        return
    }

    lolPath.value = suggestedPath.value
    await validateCurrentPath()
}

/**
 * 保存游戏路径到缓存和主进程 store
 */
const saveLolPath = async () => {
    if (!lolPath.value.trim()) {
        setInvalidPathGuide('请输入英雄联盟安装目录，或点击“浏览”选择目录。')
        return
    }

    const path = lolPath.value.trim()
    const isValid = await validateCurrentPath()

    if (!isValid) {
        return
    }

    // 保存到 localStorage（本地缓存）
    const success = configCache.saveLolPath(path)

    // 同时保存到 electron-store（主进程存储）
    if (hasElectronAPI()) {
        try {
            await electronAPI.store.set('lolPath', path)
            console.log('✅ 游戏路径已保存到主进程 store')
        } catch (error) {
            console.warn('⚠️ 保存到主进程 store 失败:', error)
        }
    }

    if (success) {
        console.log('✅ 游戏路径已保存:', path)
        emit('path-changed', path)
    } else {
        alert('保存失败，请重试')
    }
}

/**
 * 选择游戏目录
 */
const selectLolDirectory = async () => {
    if (!hasElectronAPI()) {
        alert('目录选择只在 Electron 应用中可用')
        return
    }

    try {
        const result = await electronAPI.dialogs.selectLolDirectory()

        if (result.success && result.path) {
            lolPath.value = result.path
            await saveLolPath()
        } else {
            alert('目录选择失败: ' + (result.reason || result.error || '未知错误'))
        }
    } catch (error) {
        console.error('选择目录时出错:', error)
        alert('选择目录时出错: ' + error.message)
    }
}

/**
 * 加载缓存的游戏路径
 */
const loadLolPath = async () => {
    let stored = ''

    if (hasElectronAPI()) {
        try {
            stored = await electronAPI.store.get('lolPath') || ''
        } catch (error) {
            console.warn('⚠️ 读取主进程游戏路径失败:', error)
        }
    }

    const cached = configCache.getLolPath()
    const path = stored || cached

    if (path) {
        lolPath.value = path
        const isValid = await validateCurrentPath({ silentEmpty: true })
        if (isValid) {
            emit('path-changed', path)
        }
    }

    if (stored && stored !== cached) {
        configCache.saveLolPath(stored)
    } else if (cached && !stored && hasElectronAPI()) {
        try {
            await electronAPI.store.set('lolPath', cached)
        } catch (error) {
            console.warn('⚠️ 同步游戏路径到主进程失败:', error)
        }
    }
}

watch(lolPath, (path) => {
    if (path.trim() !== lastValidatedPath.value) {
        validationStatus.value = 'idle'
        validationMessage.value = ''
        suggestedPath.value = ''
    }
})

// 组件挂载时加载缓存路径
onMounted(() => {
    void loadLolPath()
})
</script>

<style scoped>
.config-card {
    height: auto;
    flex: 0 0 auto;
    background:
        linear-gradient(145deg, rgba(31, 43, 53, 0.62), rgba(7, 10, 13, 0.34));
    border: 1px solid var(--lol-border-soft);
    border-radius: 4px;
    padding: 14px;
    overflow: hidden;
    color: var(--lol-ivory);
    box-shadow: inset 0 0 18px rgba(194, 156, 109, 0.04);
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
    color: var(--lol-gold-2);
}

.card-title {
    margin: 0;
    color: var(--lol-gold-2);
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0;
    text-transform: uppercase;
}

.card-content {
    padding: 0;
}

.input-group {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
}

.path-input {
    width: 100%;
    min-width: 0;
    background: rgba(7, 10, 13, 0.5);
    border: 1px solid var(--lol-border-soft);
    color: var(--lol-ivory);
    padding: 11px 12px;
    border-radius: 4px;
    font-size: 13px;
}

.path-input::placeholder {
    color: var(--lol-faint);
}

.path-input:focus {
    outline: none;
    border-color: rgba(194, 156, 109, 0.55);
    box-shadow: 0 0 0 3px rgba(194, 156, 109, 0.12);
}

.path-input-error {
    border-color: rgba(255, 99, 99, 0.82);
    background: rgba(42, 12, 16, 0.42);
}

.path-input-error:focus {
    border-color: rgba(255, 126, 126, 0.95);
    box-shadow: 0 0 0 3px rgba(255, 99, 99, 0.16);
}

.button-group {
    display: flex;
    gap: 8px;
    flex: 0 0 auto;
}

.btn-ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 62px;
    padding: 9px 10px;
    background: rgba(7, 10, 13, 0.42);
    border: 1px solid var(--lol-border-soft);
    color: var(--lol-ivory);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 900;
    transition: all 0.2s;
}

.btn-ghost:hover {
    color: var(--lol-primary-2);
    border-color: rgba(194, 156, 109, 0.38);
    box-shadow: 0 0 16px rgba(194, 156, 109, 0.12);
}

.btn-accent {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 62px;
    padding: 9px 10px;
    background: rgba(194, 156, 109, 0.16);
    border: 1px solid rgba(194, 156, 109, 0.34);
    color: var(--lol-primary-2);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 900;
    transition: all 0.2s;
}

.btn-accent:hover {
    color: var(--lol-bg);
    border-color: rgba(226, 192, 143, 0.36);
    background: linear-gradient(135deg, var(--lol-primary-2), var(--lol-primary));
}

.btn-icon {
    width: 15px;
    height: 15px;
}

.path-guide {
    margin: 10px 0 0;
    padding: 8px 10px;
    display: flex;
    align-items: flex-start;
    gap: 7px;
    border: 1px solid rgba(244, 236, 220, 0.08);
    border-radius: 4px;
    background: rgba(4, 15, 24, 0.34);
    color: var(--lol-muted);
    font-size: 11px;
    line-height: 1.45;
}

.path-guide.invalid {
    color: #ffb4ab;
    border-color: rgba(255, 99, 99, 0.36);
    background: rgba(68, 14, 20, 0.34);
}

.path-guide.checking {
    color: var(--lol-primary-2);
    border-color: rgba(194, 156, 109, 0.2);
    background: rgba(194, 156, 109, 0.08);
}

.guide-icon {
    width: 14px;
    height: 14px;
    margin-top: 1px;
    flex: 0 0 auto;
}

.guide-action {
    margin-left: auto;
    flex: 0 0 auto;
    border: 1px solid rgba(255, 180, 171, 0.28);
    border-radius: 4px;
    background: rgba(255, 180, 171, 0.08);
    color: #ffcec8;
    padding: 2px 6px;
    font-size: 11px;
    font-weight: 800;
    cursor: pointer;
}

.guide-action:hover {
    border-color: rgba(255, 180, 171, 0.5);
    background: rgba(255, 180, 171, 0.15);
}

.path-hint {
    margin: 12px 0 0;
    padding: 8px 12px;
    background: rgba(4, 15, 24, 0.42);
    border: 1px solid var(--lol-border-soft);
    border-radius: 4px;
    font-size: 12px;
    color: var(--lol-muted);
    display: flex;
    align-items: center;
    gap: 6px;
    word-break: break-all;
}

.hint-icon {
    width: 14px;
    height: 14px;
    color: var(--lol-primary-2);
    flex: 0 0 auto;
}

@media (max-width: 640px) {
    .input-group {
        grid-template-columns: minmax(0, 1fr) auto;
    }

    .button-group {
        flex-direction: row;
    }

    .path-guide {
        align-items: flex-start;
    }
}
</style>
