<template>
  <section class="config-card">
    <div class="card-header">
      <PackageCheck class="setting-icon" />
      <h3 class="card-title">出装推荐</h3>
    </div>

    <div class="card-content">
      <div class="setting-row">
        <div class="setting-copy">
          <strong>默认配置当前英雄装备</strong>
          <span>开启后，选到英雄并加载到出装数据时，自动把该英雄的 ARAMGG 出装写入游戏商店推荐。关闭后，不会自动写入，你可以在英雄详情里手动配置。</span>
        </div>

        <button
          class="switch-control"
          type="button"
          role="switch"
          :aria-checked="String(enabled)"
          :class="{ active: enabled }"
          :disabled="saving"
          @click="toggleEnabled"
        >
          <span class="switch-thumb"></span>
        </button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { PackageCheck } from 'lucide-vue-next'
import { electronAPI, hasElectronAPI } from '../native/electron-api.js'

const STORE_KEY = 'itemSets.autoApplyAram'
const enabled = ref(true)
const saving = ref(false)

const loadEnabled = async () => {
  if (!hasElectronAPI()) {
    return
  }

  try {
    const storedValue = await electronAPI.store.get(STORE_KEY)
    if (storedValue == null) {
      await electronAPI.store.set(STORE_KEY, true)
      enabled.value = true
      return
    }

    enabled.value = Boolean(storedValue)
  } catch (error) {
    console.warn('读取装备配置偏好失败:', error)
  }
}

const toggleEnabled = async () => {
  if (!hasElectronAPI() || saving.value) {
    enabled.value = !enabled.value
    return
  }

  saving.value = true
  const nextValue = !enabled.value

  try {
    await electronAPI.store.set(STORE_KEY, nextValue)
    enabled.value = nextValue
  } catch (error) {
    console.warn('保存装备配置偏好失败:', error)
  } finally {
    saving.value = false
  }
}

onMounted(loadEnabled)
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

.card-header,
.setting-row {
  display: flex;
  align-items: center;
}

.card-header {
  gap: 10px;
  padding: 0 0 12px;
  background: transparent;
  border-bottom: 0;
}

.setting-icon {
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

.setting-row {
  justify-content: space-between;
  gap: 14px;
}

.setting-copy {
  min-width: 0;
}

.setting-copy strong {
  display: block;
  margin: 0;
  color: var(--lol-ivory);
  font-size: 13px;
  font-weight: 900;
  line-height: 1.25;
}

.setting-copy span {
  display: block;
  margin-top: 5px;
  color: var(--lol-muted);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.45;
}

.switch-control {
  width: 42px;
  height: 24px;
  flex: 0 0 auto;
  padding: 2px;
  border: 1px solid rgba(244, 236, 220, 0.12);
  border-radius: 999px;
  background: rgba(4, 15, 24, 0.64);
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease;
}

.switch-control.active {
  border-color: rgba(226, 192, 143, 0.44);
  background: rgba(194, 156, 109, 0.32);
}

.switch-control:disabled {
  opacity: 0.6;
  cursor: wait;
}

.switch-thumb {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #bacac6;
  transition: transform 0.18s ease, background 0.18s ease;
}

.switch-control.active .switch-thumb {
  transform: translateX(18px);
  background: #f4ecdc;
}
</style>
