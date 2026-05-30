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
                    placeholder="例如: D:\\Program Files (x86)\\WeGameApps\\英雄联盟"
                    class="path-input"
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
            <p v-if="lolPath" class="path-hint">
                <Check class="hint-icon" /> {{ lolPath }}
            </p>
        </div>
    </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import configCache from '../service/config-cache'
import { electronAPI, hasElectronAPI } from '../native/electron-api.js'
import { Check, FolderOpen, FolderSearch, Save } from 'lucide-vue-next'

const lolPath = ref('')
const emit = defineEmits(['path-changed'])

/**
 * 保存游戏路径到缓存和主进程 store
 */
const saveLolPath = async () => {
    if (!lolPath.value.trim()) {
        alert('请输入游戏路径')
        return
    }

    const path = lolPath.value.trim()

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
        alert('游戏路径已保存')
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
            saveLolPath()
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
        emit('path-changed', path)
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

// 组件挂载时加载缓存路径
onMounted(() => {
    void loadLolPath()
})
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

.input-group {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
}

.path-input {
    width: 100%;
    min-width: 0;
    background: rgba(42, 54, 64, 0.82);
    border: 1px solid rgba(226, 195, 132, 0.34);
    color: #d7e4f1;
    padding: 11px 12px;
    border-radius: 6px;
    font-size: 13px;
}

.path-input::placeholder {
    color: #859491;
}

.path-input:focus {
    outline: none;
    border-color: rgba(71, 228, 213, 0.72);
    box-shadow: 0 0 0 3px rgba(10, 200, 185, 0.12);
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
    background: linear-gradient(180deg, rgba(42, 54, 64, 0.86), rgba(31, 43, 53, 0.86));
    border: 1px solid rgba(226, 195, 132, 0.36);
    color: #e2c384;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 900;
    transition: all 0.2s;
}

.btn-ghost:hover {
    color: #47e4d5;
    border-color: rgba(71, 228, 213, 0.54);
    box-shadow: 0 0 16px rgba(10, 200, 185, 0.14);
}

.btn-accent {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 62px;
    padding: 9px 10px;
    background: rgba(92, 70, 19, 0.22);
    border: 1px solid rgba(226, 195, 132, 0.52);
    color: #e2c384;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 900;
    transition: all 0.2s;
}

.btn-accent:hover {
    color: #47e4d5;
    border-color: rgba(71, 228, 213, 0.54);
    background: rgba(10, 200, 185, 0.08);
}

.btn-icon {
    width: 15px;
    height: 15px;
}

.path-hint {
    margin: 12px 0 0;
    padding: 8px 12px;
    background: rgba(4, 15, 24, 0.42);
    border: 1px solid rgba(60, 74, 71, 0.42);
    border-radius: 6px;
    font-size: 12px;
    color: #bacac6;
    display: flex;
    align-items: center;
    gap: 6px;
    word-break: break-all;
}

.hint-icon {
    width: 14px;
    height: 14px;
    color: #47e4d5;
    flex: 0 0 auto;
}

@media (max-width: 640px) {
    .input-group {
        grid-template-columns: minmax(0, 1fr) auto;
    }

    .button-group {
        flex-direction: row;
    }
}
</style>
