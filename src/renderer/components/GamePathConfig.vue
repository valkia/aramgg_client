<template>
    <div class="config-card">
        <div class="card-header">
            <span class="card-icon">📂</span>
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
                        浏览
                    </Button>
                    <Button @click="saveLolPath" class="btn-accent">
                        保存
                    </Button>
                </div>
            </div>
            <p v-if="lolPath" class="path-hint">
                <span class="hint-icon">✓</span> {{ lolPath }}
            </p>
        </div>
    </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import configCache from '../service/config-cache'

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
    if (window.ipcRenderer) {
        try {
            await window.ipcRenderer.invoke('store-set', 'lolPath', path)
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
        const { ipcRenderer } = require('electron')
        const result = await ipcRenderer?.invoke('select-lol-directory')

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
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    overflow: hidden;
    backdrop-filter: blur(10px);
}

.card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 20px;
    background: rgba(30, 136, 229, 0.1);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.card-icon {
    font-size: 18px;
}

.card-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: #fff;
}

.card-content {
    padding: 20px;
}

.input-group {
    display: flex;
    gap: 12px;
    align-items: center;
}

.path-input {
    flex: 1;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #fff;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 13px;
}

.path-input::placeholder {
    color: rgba(255, 255, 255, 0.4);
}

.path-input:focus {
    outline: none;
    border-color: #60a5fa;
    box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.2);
}

.button-group {
    display: flex;
    gap: 8px;
}

.btn-ghost {
    padding: 10px 16px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #fff;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s;
}

.btn-ghost:hover {
    background: rgba(255, 255, 255, 0.15);
}

.btn-accent {
    padding: 10px 20px;
    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
    border: none;
    color: #fff;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.2s;
}

.btn-accent:hover {
    background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
    transform: translateY(-1px);
}

.path-hint {
    margin: 12px 0 0;
    padding: 8px 12px;
    background: rgba(34, 197, 94, 0.1);
    border-radius: 6px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.7);
    display: flex;
    align-items: center;
    gap: 6px;
}

.hint-icon {
    color: #22c55e;
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