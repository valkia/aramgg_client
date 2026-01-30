<template>
  <transition name="overlay-fade">
    <div v-if="visible" class="winrate-overlay" :style="overlayStyle">
      <!-- 关闭按钮 -->
      <button class="close-btn" @click="closeOverlay">×</button>

      <!-- 加载状态 -->
      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <p>分析截图中...</p>
      </div>

      <!-- 错误状态 -->
      <div v-else-if="error" class="error-state">
        <p>⚠️ {{ error }}</p>
      </div>

      <!-- 胜率信息展示 -->
      <div v-else-if="displayData" class="winrate-content">
        <!-- 英雄信息 -->
        <div v-if="displayData.champion" class="champion-info">
          <div class="champion-header">
            <span class="champion-name">{{ displayData.champion.name }}</span>
            <span v-if="displayData.champion.position" class="position-tag">
              {{ displayData.champion.position }}
            </span>
          </div>

          <!-- 胜率指标 -->
          <div class="stats-grid">
            <div class="stat-item">
              <span class="stat-label">胜率</span>
              <span class="stat-value" :style="{ color: displayData.champion.winrateLevel.color }">
                {{ displayData.champion.winrateLevel.emoji }}
                {{ displayData.stats.winrate }}
              </span>
              <span class="stat-level">{{ displayData.champion.winrateLevel.label }}</span>
            </div>

            <div class="stat-item">
              <span class="stat-label">选择率</span>
              <span class="stat-value">{{ displayData.stats.pickRate }}</span>
            </div>

            <div class="stat-item">
              <span class="stat-label">禁用率</span>
              <span class="stat-value">{{ displayData.stats.banRate }}</span>
            </div>

            <div v-if="displayData.stats.playCount" class="stat-item">
              <span class="stat-label">游戏次数</span>
              <span class="stat-value">{{ displayData.stats.playCount }}</span>
            </div>
          </div>

          <!-- 推荐符文 -->
          <div v-if="displayData.runes" class="runes-section">
            <h4>推荐符文</h4>
            <div class="rune-items">
              <div v-for="(rune, index) in displayData.runes" :key="index" class="rune-item">
                {{ rune }}
              </div>
            </div>
          </div>

          <!-- 推荐装备 -->
          <div v-if="displayData.items" class="items-section">
            <h4>推荐装备</h4>
            <div class="item-list">
              <span v-for="(item, index) in displayData.items" :key="index" class="item-name">
                {{ item }}
              </span>
            </div>
          </div>

          <!-- 数据源信息 -->
          <div class="meta-info">
            <small>数据来源: {{ displayData.dataSource }}</small>
            <small v-if="displayData.updateTime">更新时间: {{ formatTime(displayData.updateTime) }}</small>
          </div>
        </div>

        <!-- 多英雄信息列表 -->
        <div v-else-if="displayData.champions && displayData.champions.length" class="champions-list">
          <div v-for="champion in displayData.champions" :key="champion.id" class="champion-card">
            <div class="card-header">
              <h4>{{ champion.name }}</h4>
              <span class="winrate-badge" :style="{ backgroundColor: champion.winrateLevel.color }">
                {{ champion.stats.winrate }}
              </span>
            </div>
            <div class="card-stats">
              <span>选择率: {{ champion.stats.pickRate }}</span>
              <span>禁用率: {{ champion.stats.banRate }}</span>
            </div>
          </div>
        </div>

        <!-- 无数据状态 -->
        <div v-else class="no-data">
          <p>未能识别到英雄信息</p>
        </div>
      </div>

      <!-- 底部操作 -->
      <div class="overlay-footer">
        <button class="btn-refresh" @click="refreshData">刷新</button>
        <button class="btn-detail">详情</button>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { formatWinrateForDisplay, getWinrateLevel } from '../src/service/winrate'

const visible = ref(false)
const loading = ref(false)
const error = ref(null)
const displayData = ref(null)
const autoHideTimer = ref(null)
const positionMode = ref('top-right') // top-right, top-left, bottom-right, bottom-left

// 浮窗位置配置
const positionConfigs = {
  'top-right': { top: '20px', right: '20px' },
  'top-left': { top: '20px', left: '20px' },
  'bottom-right': { bottom: '20px', right: '20px' },
  'bottom-left': { bottom: '20px', left: '20px' },
}

const overlayStyle = computed(() => ({
  ...positionConfigs[positionMode.value],
}))

/**
 * 显示浮窗
 * @param {Object} data - 胜率数据
 */
const showOverlay = (data) => {
  visible.value = true
  loading.value = false
  error.value = null

  // 格式化数据用于展示
  if (data && data.champion) {
    const winrateLevel = getWinrateLevel(data.champion.winrate)
    displayData.value = {
      champion: {
        ...data.champion,
        winrateLevel,
      },
      stats: data.stats,
      runes: data.runes,
      items: data.items,
      dataSource: data.dataSource || 'OP.GG',
      updateTime: data.updateTime,
    }
  } else if (data && data.champions) {
    displayData.value = {
      champions: data.champions.map(c => ({
        ...c,
        winrateLevel: getWinrateLevel(c.winrate),
      })),
      dataSource: data.dataSource || 'OP.GG',
      updateTime: data.updateTime,
    }
  }

  // 自动隐藏（10秒后）
  clearTimeout(autoHideTimer.value)
  autoHideTimer.value = setTimeout(() => {
    closeOverlay()
  }, 10000)
}

/**
 * 关闭浮窗
 */
const closeOverlay = () => {
  visible.value = false
  displayData.value = null
  clearTimeout(autoHideTimer.value)
}

/**
 * 刷新数据
 */
const refreshData = async () => {
  loading.value = true
  // TODO: 重新分析截图并获取胜率
  // await analyzeAndFetch()
  loading.value = false
}

/**
 * 格式化时间
 */
const formatTime = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN')
}

/**
 * 监听来自主进程的截图事件
 */
const onScreenshotTaken = async (screenshotData) => {
  if (!screenshotData.success) {
    error.value = '截图失败'
    showOverlay({})
    return
  }

  loading.value = true
  error.value = null

  try {
    // 发送 IPC 请求分析截图
    const analysisResult = await window.ipcRenderer.invoke('analyze-screenshot', screenshotData.filepath)

    if (analysisResult.success) {
      // 根据分析结果获取胜率
      const winrateData = await window.ipcRenderer.invoke('get-winrate', {
        champions: analysisResult.analysis.champions,
        position: analysisResult.analysis.position,
      })

      showOverlay(winrateData)
    } else {
      error.value = analysisResult.error || '分析失败'
      showOverlay({})
    }
  } catch (err) {
    console.error('Error in screenshot analysis:', err)
    error.value = err.message || '处理失败'
    showOverlay({})
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  // 监听截图完成事件
  window.ipcRenderer.on('screenshot-taken', onScreenshotTaken)

  // 监听来自主进程的胜率数据
  window.ipcRenderer.on('winrate-updated', (data) => {
    showOverlay(data)
  })
})

onBeforeUnmount(() => {
  clearTimeout(autoHideTimer.value)
})

// 暴露显示方法用于手动调用
defineExpose({
  showOverlay,
  closeOverlay,
  refreshData,
})
</script>

<style scoped>
.winrate-overlay {
  position: fixed;
  z-index: 9999;
  min-width: 320px;
  max-width: 480px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  padding: 16px;
  color: white;
  font-family: 'Microsoft YaHei', Arial, sans-serif;
  font-size: 14px;
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.overlay-fade-enter-active,
.overlay-fade-leave-active {
  transition: opacity 0.3s ease;
}

.overlay-fade-enter-from,
.overlay-fade-leave-to {
  opacity: 0;
}

.close-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background: none;
  border: none;
  color: white;
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.close-btn:hover {
  background-color: rgba(255, 255, 255, 0.2);
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  text-align: center;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 10px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-state {
  padding: 16px;
  background-color: rgba(255, 0, 0, 0.2);
  border-radius: 8px;
  text-align: center;
  color: #ffcccc;
}

.winrate-content {
  max-height: 600px;
  overflow-y: auto;
}

.champion-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.champion-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  padding-bottom: 8px;
}

.champion-name {
  font-size: 18px;
  font-weight: bold;
}

.position-tag {
  background-color: rgba(255, 255, 255, 0.2);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
}

.stat-label {
  font-size: 12px;
  opacity: 0.8;
  margin-bottom: 4px;
}

.stat-value {
  font-size: 16px;
  font-weight: bold;
}

.stat-level {
  font-size: 11px;
  opacity: 0.7;
  margin-top: 2px;
}

.runes-section,
.items-section {
  padding: 8px 0;
}

.runes-section h4,
.items-section h4 {
  margin: 8px 0 4px;
  font-size: 13px;
  opacity: 0.9;
}

.rune-items {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.rune-item {
  background-color: rgba(255, 255, 255, 0.15);
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.item-list {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.item-name {
  background-color: rgba(255, 255, 255, 0.15);
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.champions-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  overflow-y: auto;
}

.champion-card {
  background-color: rgba(255, 255, 255, 0.1);
  padding: 10px;
  border-radius: 8px;
  border-left: 3px solid rgba(255, 255, 255, 0.3);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.card-header h4 {
  margin: 0;
  font-size: 14px;
}

.winrate-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: bold;
  color: white;
}

.card-stats {
  display: flex;
  gap: 12px;
  font-size: 12px;
  opacity: 0.9;
}

.no-data {
  text-align: center;
  padding: 20px;
  opacity: 0.8;
}

.meta-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  opacity: 0.7;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  padding-top: 8px;
  margin-top: 8px;
}

.overlay-footer {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}

.btn-refresh,
.btn-detail {
  flex: 1;
  padding: 8px;
  background-color: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: white;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: bold;
  transition: all 0.2s;
}

.btn-refresh:hover,
.btn-detail:hover {
  background-color: rgba(255, 255, 255, 0.3);
  transform: translateY(-2px);
}

.btn-refresh:active,
.btn-detail:active {
  transform: translateY(0);
}
</style>
