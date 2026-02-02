<template>
  <transition name="overlay-fade">
    <div v-if="visible" class="augment-overlay">
      <!-- 关闭按钮 -->
      <button class="close-btn" @click="closeOverlay">×</button>

      <!-- 加载状态 -->
      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <p>加载海克斯数据中...</p>
      </div>

      <!-- 错误状态 -->
      <div v-else-if="error" class="error-state">
        <p>⚠️ {{ error }}</p>
      </div>

      <!-- 海克斯列表展示 -->
      <div v-else-if="displayAugments && displayAugments.length > 0" class="augment-content">
        <!-- 英雄头部信息 -->
        <div class="header-info">
          <h3 class="champion-title">英雄 ID: {{ championId }}</h3>
          <div class="rarity-filter">
            <button
              v-for="rarity in ['all', 'gold', 'purple', 'blue']"
              :key="rarity"
              class="filter-btn"
              :class="{ active: selectedRarity === rarity }"
              @click="filterByRarity(rarity)"
            >
              {{ rarityLabels[rarity] }}
            </button>
          </div>
        </div>

        <!-- 海克斯列表 -->
        <div class="augments-list">
          <div
            v-for="(augment, index) in filteredAugments"
            :key="augment.augmentId"
            class="augment-card"
            :class="`rarity-${augment.rarity}`"
          >
            <div class="augment-rank">{{ index + 1 }}</div>

            <!-- 海克斯基础信息 -->
            <div class="augment-main">
              <div class="augment-name">{{ augment.name }}</div>
              <div class="augment-stats">
                <span class="stat-item">
                  <span class="stat-label">胜率</span>
                  <span class="stat-value">{{ (augment.winRate * 100).toFixed(1) }}%</span>
                </span>
                <span class="stat-item">
                  <span class="stat-label">选择率</span>
                  <span class="stat-value">{{ (augment.pickRate * 100).toFixed(1) }}%</span>
                </span>
                <span class="stat-item">
                  <span class="stat-label">推荐度</span>
                  <span class="stat-value">{{ (augment.recommendScore * 100).toFixed(0) }}</span>
                </span>
              </div>
            </div>

            <!-- 推荐指示 -->
            <div class="recommend-indicator">
              <div class="score-bar">
                <div class="score-fill" :style="{ width: (augment.recommendScore * 100) + '%' }"></div>
              </div>
              <span class="score-text">{{ getRecommendLabel(augment.recommendScore) }}</span>
            </div>
          </div>
        </div>

        <!-- 数据源信息 -->
        <div class="meta-info">
          <small>数据来源: {{ dataSource }}</small>
          <small v-if="timestamp">更新时间: {{ formatTime(timestamp) }}</small>
        </div>
      </div>

      <!-- 无数据状态 -->
      <div v-else class="no-data">
        <p>未能加载海克斯数据</p>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const visible = ref(false)
const loading = ref(false)
const error = ref(null)
const championId = ref(null)
const displayAugments = ref([])
const dataSource = ref('local')
const timestamp = ref(null)
const autoHideTimer = ref(null)
const selectedRarity = ref('all')

const rarityLabels = {
  all: '全部',
  gold: '金色',
  purple: '紫色',
  blue: '蓝色'
}

// 按稀有度过滤海克斯
const filteredAugments = computed(() => {
  if (selectedRarity.value === 'all') {
    return displayAugments.value
  }
  return displayAugments.value.filter(a => a.rarity === selectedRarity.value)
})

/**
 * 显示浮窗
 */
const showOverlay = async (data) => {
  console.log('🔧 showOverlay 被调用，数据:', data)

  visible.value = true
  loading.value = false
  error.value = null

  if (data && data.augments && data.augments.length > 0) {
    console.log('✅ 数据验证通过，开始处理', data.augments.length, '个海克斯')

    championId.value = data.championId
    dataSource.value = data.dataSource || 'local'
    timestamp.value = data.timestamp
    selectedRarity.value = 'all'

    // 检查 augments 是否已经包含胜率数据
    const hasWinrateData = data.augments.some(aug => 'winRate' in aug)
    console.log('🔍 检查胜率数据:', hasWinrateData ? '已包含' : '需要查询')

    if (hasWinrateData) {
      // 数据已经完整，直接显示
      displayAugments.value = data.augments
      console.log('✅ 直接显示完整数据')
    } else {
      // 需要查询胜率数据
      console.log('🔍 海克斯数据缺少胜率信息，正在查询...')
      loading.value = true

      try {
        // 获取当前英雄ID（如果没有提供）
        if (!championId.value) {
          console.log('🔍 championId 不存在，正在查询...')
          const championResult = await window.ipcRenderer.invoke('get-champion-id')
          console.log('🔍 get-champion-id 结果:', championResult)

          if (championResult.success) {
            championId.value = championResult.championId
            console.log('✅ 获取到英雄ID:', championId.value)
          } else {
            throw new Error('无法获取当前英雄ID: ' + championResult.error)
          }
        }

        // 查询胜率数据
        const augmentIds = data.augments.map(aug => aug.id).filter(id => id != null)
        console.log('🔍 查询胜率，英雄ID:', championId.value, '海克斯IDs:', augmentIds)

        const winrateResult = await window.ipcRenderer.invoke('get-winrate', {
          championId: championId.value,
          augmentIds: augmentIds
        })
        console.log('🔍 get-winrate 结果:', winrateResult)

        if (winrateResult.success && winrateResult.augments.length > 0) {
          displayAugments.value = winrateResult.augments
          console.log('✅ 胜率数据查询成功:', winrateResult.augments.length, '个海克斯')
        } else {
          // 胜率查询失败，使用原始数据（但会缺少胜率信息）
          displayAugments.value = data.augments
          console.warn('⚠️ 胜率数据查询失败，显示基础信息')
        }
      } catch (err) {
        console.error('❌ 查询胜率数据失败:', err)
        displayAugments.value = data.augments
      } finally {
        loading.value = false
      }
    }
  } else {
    console.error('❌ 数据验证失败，无可用海克斯数据')
    error.value = '无可用海克斯数据'
  }

  console.log('🔧 showOverlay 完成，visible:', visible.value, 'displayAugments:', displayAugments.value.length)
}

/**
 * 关闭浮窗
 */
const closeOverlay = () => {
  visible.value = false
  displayAugments.value = []
  clearTimeout(autoHideTimer.value)

  // 同时隐藏 popup 窗口本身
  if (window.ipcRenderer) {
    window.ipcRenderer.send('hide-popup')
  }
}

/**
 * 按稀有度过滤
 */
const filterByRarity = (rarity) => {
  selectedRarity.value = rarity
}

/**
 * 获取推荐标签
 */
const getRecommendLabel = (score) => {
  if (score >= 0.6) return '必选 🔥'
  if (score >= 0.5) return '强烈推荐 📈'
  if (score >= 0.4) return '推荐 👍'
  if (score >= 0.3) return '可选 ✓'
  return '冷门 ❄️'
}

/**
 * 格式化时间
 */
const formatTime = (ts) => {
  if (!ts) return ''
  const date = new Date(ts)
  return date.toLocaleTimeString('zh-CN')
}

/**
 * 监听来自主进程的数据
 */
onMounted(() => {
  console.log('🔧 AugmentWinrateOverlay 组件已挂载，开始监听事件...')

  // 监听"for-popup"事件，用于英雄监控触发的海克斯数据
  window.ipcRenderer.on('for-popup', (data) => {
    console.log('📊 收到 for-popup 事件:', data)
    if (data && data.augments) {
      console.log('✅ 有效的海克斯数据，调用 showOverlay')
      showOverlay(data)
    } else {
      console.warn('⚠️ for-popup 数据格式不正确或缺少 augments')
    }
  })

  // 监听"augment-detected"事件，用于自动截图检测到的海克斯
  window.ipcRenderer.on('augment-detected', (data) => {
    console.log('📊 收到 augment-detected 事件:', data)
    if (data && data.augments) {
      console.log('✅ 有效的海克斯检测数据，调用 showOverlay')
      showOverlay(data)
    } else {
      console.warn('⚠️ augment-detected 数据格式不正确或缺少 augments')
    }
  })

  // 监听胜率更新事件
  window.ipcRenderer.on('winrate-updated', (data) => {
    console.log('📊 收到 winrate-updated 事件:', data)
    if (data && data.augments) {
      console.log('✅ 有效的胜率数据，调用 showOverlay')
      showOverlay(data)
    } else {
      console.warn('⚠️ winrate-updated 数据格式不正确或缺少 augments')
    }
  })

  // 监听游戏开始事件，自动隐藏弹窗
  window.ipcRenderer.on('game-started', () => {
    console.log('🎮 游戏开始，隐藏海克斯弹窗')
    closeOverlay()
  })

  window.ipcRenderer.on('game-in-progress', () => {
    console.log('🎮 游戏进行中，隐藏海克斯弹窗')
    closeOverlay()
  })

  window.ipcRenderer.on('game-phase-changed', (data) => {
    console.log('🎮 游戏阶段变化事件:', data)
    if (data && (data.phase === 'GameStart' || data.phase === 'InProgress')) {
      console.log('🎮 检测到游戏开始/进行中，隐藏海克斯弹窗')
      closeOverlay()
    }
  })

  console.log('✅ 所有事件监听器已注册')
})

onBeforeUnmount(() => {
  clearTimeout(autoHideTimer.value)
})

// 暴露方法供外部调用
defineExpose({
  showOverlay,
  closeOverlay
})
</script>

<style scoped>
.augment-overlay {
  position: fixed;
  z-index: 9999;
  top: 50px;
  right: 20px;
  width: 420px;
  max-height: 80vh;
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
  padding: 16px;
  color: white;
  font-family: 'Microsoft YaHei', Arial, sans-serif;
  font-size: 13px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
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
  padding: 40px 20px;
  text-align: center;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(59, 130, 246, 0.3);
  border-top-color: #3b82f6;
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
  background-color: rgba(239, 68, 68, 0.15);
  border-radius: 8px;
  text-align: center;
  color: #fca5a5;
}

.no-data {
  text-align: center;
  padding: 40px 20px;
  opacity: 0.6;
}

.augment-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  overflow: hidden;
}

.header-info {
  flex-shrink: 0;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.champion-title {
  margin: 0 0 8px 0;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
}

.rarity-filter {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.filter-btn {
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.7);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.filter-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.25);
}

.filter-btn.active {
  background: rgba(59, 130, 246, 0.3);
  border-color: rgba(59, 130, 246, 0.5);
  color: #60a5fa;
}

.augments-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 稀有度样式 */
.augment-card {
  display: flex;
  gap: 10px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.05);
  border-left: 3px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  transition: all 0.2s;
  cursor: pointer;
}

.augment-card:hover {
  background: rgba(255, 255, 255, 0.08);
  border-left-color: rgba(59, 130, 246, 0.6);
}

.augment-card.rarity-gold {
  border-left-color: #fbbf24;
  background: rgba(251, 191, 36, 0.05);
}

.augment-card.rarity-purple {
  border-left-color: #c084fc;
  background: rgba(192, 132, 252, 0.05);
}

.augment-card.rarity-blue {
  border-left-color: #60a5fa;
  background: rgba(96, 165, 250, 0.05);
}

.augment-rank {
  min-width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  font-size: 12px;
  font-weight: 600;
  color: #60a5fa;
  flex-shrink: 0;
}

.augment-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.augment-name {
  font-size: 13px;
  font-weight: 500;
  color: #fff;
}

.augment-stats {
  display: flex;
  gap: 8px;
  font-size: 11px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.stat-label {
  opacity: 0.6;
  color: rgba(255, 255, 255, 0.7);
}

.stat-value {
  font-weight: 600;
  color: #93c5fd;
}

.recommend-indicator {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-end;
}

.score-bar {
  width: 60px;
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
}

.score-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #60a5fa);
  transition: width 0.3s ease;
}

.score-text {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.6);
  white-space: nowrap;
}

.meta-info {
  flex-shrink: 0;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  opacity: 0.6;
}

/* 滚动条美化 */
.augments-list::-webkit-scrollbar {
  width: 6px;
}

.augments-list::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
}

.augments-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.augments-list::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

@media (max-width: 768px) {
  .augment-overlay {
    width: 90vw;
    max-width: 400px;
    right: 10px;
  }
}
</style>
