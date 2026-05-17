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
const loadLolPath = () => {
    const cached = configCache.getLolPath()
    if (cached) {
        lolPath.value = cached
        emit('path-changed', cached)
    }
}

// 组件挂载时加载缓存路径
onMounted(() => {
    loadLolPath()
})
</script>

<style scoped>
.config-card {
    height: 100%;
    background: var(--lol-panel);
    border: 1px solid var(--lol-border-soft);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: var(--lol-shadow);
}

.card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 15px 18px;
    background: rgba(200, 169, 106, 0.08);
    border-bottom: 1px solid var(--lol-border-soft);
}

.card-icon {
    width: 18px;
    height: 18px;
    color: var(--lol-gold-2);
}

.card-title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--lol-ivory);
}

.card-content {
    padding: 18px;
}

.input-group {
    display: flex;
    gap: 12px;
    align-items: center;
}

.path-input {
    flex: 1;
    background: rgba(7, 10, 13, 0.55);
    border: 1px solid var(--lol-border-soft);
    color: var(--lol-ivory);
    padding: 10px 14px;
    border-radius: 6px;
    font-size: 13px;
}

.path-input::placeholder {
    color: var(--lol-faint);
}

.path-input:focus {
    outline: none;
    border-color: rgba(40, 217, 200, 0.55);
    box-shadow: 0 0 0 3px rgba(40, 217, 200, 0.12);
}

.button-group {
    display: flex;
    gap: 8px;
}

.btn-ghost {
    padding: 10px 16px;
    background: rgba(244, 236, 220, 0.05);
    border: 1px solid var(--lol-border-soft);
    color: var(--lol-ivory);
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s;
}

.btn-ghost:hover {
    background: rgba(244, 236, 220, 0.09);
    border-color: var(--lol-border);
}

.btn-accent {
    padding: 10px 20px;
    background: linear-gradient(135deg, var(--lol-teal), #169a91);
    border: 1px solid rgba(108, 241, 229, 0.32);
    color: var(--lol-bg);
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 700;
    transition: all 0.2s;
}

.btn-accent:hover {
    background: linear-gradient(135deg, var(--lol-teal-2), var(--lol-teal));
    transform: translateY(-1px);
}

.btn-icon {
    width: 15px;
    height: 15px;
}

.path-hint {
    margin: 12px 0 0;
    padding: 8px 12px;
    background: rgba(84, 216, 132, 0.08);
    border: 1px solid rgba(84, 216, 132, 0.16);
    border-radius: 6px;
    font-size: 12px;
    color: var(--lol-muted);
    display: flex;
    align-items: center;
    gap: 6px;
}

.hint-icon {
    width: 14px;
    height: 14px;
    color: var(--lol-success);
    flex: 0 0 auto;
}

@media (max-width: 640px) {
    .input-group {
        flex-direction: column;
    }

    .path-input {
        width: 100%;
    }

    .button-group {
        width: 100%;
        justify-content: flex-end;
    }
}
</style>
