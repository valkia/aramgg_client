<template>
  <section class="config-card">
    <div class="card-header">
      <PackageCheck class="card-icon" />
      <h3 class="card-title">{{ t('itemSets.title') }}</h3>
    </div>

    <div class="card-content">
      <div class="setting-row">
        <div class="setting-copy">
          <strong>{{ t('itemSets.autoApplyTitle') }}</strong>
          <span>{{ t('itemSets.autoApplyDescription') }}</span>
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
import { electronAPI, hasElectronAPI } from '../native/electron-api.ts'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
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
