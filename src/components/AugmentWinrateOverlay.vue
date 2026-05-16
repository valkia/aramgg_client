<template>
  <transition name="overlay-fade">
    <div v-if="visible" class="augment-overlay">
      <!-- 关闭按钮 -->
      <button class="close-btn" @click="closeOverlay">×</button>

      <!-- 加载状态 -->
      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <p>加载英雄数据中...</p>
      </div>

      <!-- 错误状态 -->
      <div v-else-if="error" class="error-state">
        <p>⚠️ {{ error }}</p>
      </div>

      <!-- 主内容区 -->
      <div v-else-if="championStats" class="overlay-content">
        <!-- 英雄头部信息 -->
        <div class="champion-header">
          <div class="header-main">
            <div class="champion-avatar-wrapper">
              <img
                :src="getChampionIconUrl(championId)"
                :alt="championName"
                class="champion-avatar"
                @error="handleImageError"
              />
              <div class="champion-tier" v-if="championStats?.tier">
                Tier {{ championStats.tier }}
              </div>
            </div>
            <div class="champion-info">
              <h2 class="champion-name">{{ championName }}</h2>
              <div class="champion-stats-row">
                <div class="stat-box">
                  <span class="stat-label">胜率</span>
                  <span class="stat-value" :class="getWinRateClass(championStats?.winRate)">
                    {{ formatPercent(championStats?.winRate) }}
                  </span>
                </div>
                <div class="stat-box">
                  <span class="stat-label">选取率</span>
                  <span class="stat-value">
                    {{ formatPercent(championStats?.pickRate) }}
                  </span>
                </div>
                <div class="stat-box">
                  <span class="stat-label">场次</span>
                  <span class="stat-value">{{ formatNumber(championStats?.numGames) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Tab 切换 -->
        <div class="tabs-container">
          <div class="tabs-list">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              class="tab-btn"
              :class="{ active: activeTab === tab.key }"
              @click="activeTab = tab.key"
            >
              <span class="tab-icon">{{ tab.icon }}</span>
              <span class="tab-text">{{ tab.label }}</span>
            </button>
          </div>

          <!-- Tab 内容 -->
          <div class="tab-content">
            <!-- 海克斯 Tab -->
            <div v-if="activeTab === 'augments'" class="tab-panel">
              <!-- 稀有度过滤 -->
              <div class="filter-bar">
                <button
                  v-for="rarity in rarityOptions"
                  :key="rarity.key"
                  class="filter-chip"
                  :class="{ active: selectedRarity === rarity.key, [rarity.key]: true }"
                  @click="selectedRarity = rarity.key"
                >
                  {{ rarity.label }}
                </button>
              </div>

              <!-- 海克斯列表 -->
              <div v-if="filteredAugments.length > 0" class="augments-list">
                <div
                  v-for="(augment, index) in filteredAugments"
                  :key="augment.augmentId"
                  class="augment-card"
                  :class="`rarity-${augment.rarity}`"
                >
                  <div class="augment-rank">{{ index + 1 }}</div>
                  <div class="augment-icon-wrapper" v-if="augment.iconPath">
                    <img
                      :src="getAugmentIconUrl(augment.iconPath)"
                      :alt="augment.name"
                      class="augment-icon"
                    />
                  </div>
                  <div class="augment-main">
                    <div class="augment-name">{{ augment.name }}</div>
                    <div class="augment-stats">
                      <span class="stat-item">
                        <span class="stat-label">胜率</span>
                        <span class="stat-value winrate">{{ formatPercent(augment.winRate) }}</span>
                      </span>
                      <span class="stat-item">
                        <span class="stat-label">选取率</span>
                        <span class="stat-value">{{ formatPercent(augment.pickRate) }}</span>
                      </span>
                    </div>
                  </div>
                  <div class="recommend-indicator">
                    <div class="score-bar">
                      <div class="score-fill" :style="{ width: ((augment.recommendScore || 0) * 100) + '%' }"></div>
                    </div>
                    <span class="score-text">{{ getRecommendLabel(augment.recommendScore) }}</span>
                  </div>
                </div>
              </div>
              <div v-else class="empty-state">
                <p>暂无海克斯数据</p>
              </div>
            </div>

            <!-- 出装 Tab -->
            <div v-if="activeTab === 'builds'" class="tab-panel">
              <div v-if="buildData && (coreItems.length > 0 || situationalItems.length > 0)" class="build-content">
                <!-- 核心出装 -->
                <div v-if="coreItems.length > 0" class="build-section">
                  <h4 class="section-title">核心出装</h4>
                  <div class="build-list">
                    <div
                      v-for="(build, idx) in coreItems.slice(0, 3)"
                      :key="idx"
                      class="build-item"
                    >
                      <div class="item-icons">
                        <img
                          v-for="itemId in build.items.slice(0, 6)"
                          :key="itemId"
                          :src="getItemIconUrl(itemId)"
                          class="item-icon"
                          :alt="itemId"
                        />
                      </div>
                      <div class="build-stats">
                        <div class="build-stat">
                          <span class="label">胜率</span>
                          <span class="value">{{ formatPercent(build.winRate) }}</span>
                        </div>
                        <div class="build-stat">
                          <span class="label">场次</span>
                          <span class="value">{{ build.games.toLocaleString() }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 情境装备 -->
                <div v-if="situationalItems.length > 0" class="build-section">
                  <h4 class="section-title situational-title">
                    ✨ 情境装备
                    <span class="title-hint">（前12个）</span>
                  </h4>
                  <div class="situational-grid">
                    <img
                      v-for="(item, idx) in situationalItems"
                      :key="idx"
                      :src="getItemIconUrl(item.itemId)"
                      class="item-icon small"
                      :alt="'item-' + item.itemId"
                    />
                  </div>
                </div>

                <!-- 出门装 -->
                <div v-if="startingItems.length > 0" class="build-section">
                  <h4 class="section-title">出门装</h4>
                  <div class="build-list">
                    <div
                      v-for="(build, idx) in startingItems.slice(0, 3)"
                      :key="idx"
                      class="build-item small"
                    >
                      <div class="item-icons">
                        <img
                          v-for="itemId in build.items"
                          :key="itemId"
                          :src="getItemIconUrl(itemId)"
                          class="item-icon small"
                          :alt="itemId"
                        />
                      </div>
                      <div class="build-stats">
                        <span class="value">{{ formatPercent(build.winRate) }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="empty-state">
                <p>暂无出装数据</p>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部信息 -->
        <div class="overlay-footer">
          <small>数据来源: {{ dataSource }}</small>
          <small v-if="timestamp">更新于: {{ formatTime(timestamp) }}</small>
        </div>
      </div>

      <!-- 无数据状态 -->
      <div v-else class="no-data">
        <p>未能加载数据</p>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { getChampionIconUrl, getAugmentIconUrl, getItemIconUrl } from '../service/cdn'

const visible = ref(false)
const loading = ref(false)
const error = ref(null)
const championId = ref(null)
const championName = ref('')
const activeTab = ref('augments')
const selectedRarity = ref('all')
const dataSource = ref('local')
const timestamp = ref(null)

// 英雄数据
const championStats = ref(null)
const augmentBase = ref([])
const augmentStats = ref({})
const buildData = ref(null)
const itemsData = ref({})
const displayAugments = ref([])

// Tabs 配置
const tabs = [
  { key: 'augments', label: '海克斯', icon: '🎯' },
  { key: 'builds', label: '出装', icon: '⚔️' }
]

// 稀有度选项
const rarityOptions = [
  { key: 'all', label: '全部' },
  { key: 'kSilver', label: '白银' },
  { key: 'kGold', label: '金色' },
  { key: 'kPrismatic', label: '棱彩' }
]

// 过滤海克斯
const filteredAugments = computed(() => {
  if (selectedRarity.value === 'all') {
    return displayAugments.value
  }
  return displayAugments.value.filter(a => a.rarity === selectedRarity.value)
})

// 解析核心出装
const coreItems = computed(() => {
  if (!buildData.value || !buildData.value.coreItems) {
    // 兼容旧数据：从 recommended 中提取
    if (!buildData.value || !buildData.value.recommended) return []
    return buildData.value.recommended.map(rec => {
      const itemIds = rec.itemIds.split(',').map(id => id.trim())
      return {
        items: itemIds,
        games: parseInt(rec.games) || 0,
        wins: parseInt(rec.wins) || 0,
        pickRate: parseFloat(rec.pick_rate) || 0,
        winRate: (parseInt(rec.wins) / parseInt(rec.games)) || 0
      }
    }).filter(item => item.items.length >= 3).sort((a, b) => b.games - a.games)
  }
  return buildData.value.coreItems.map(rec => {
    const itemIds = rec.itemIds.split(',').map(id => id.trim())
    return {
      items: itemIds,
      games: parseInt(rec.games) || 0,
      wins: parseInt(rec.wins) || 0,
      pickRate: parseFloat(rec.pick_rate) || 0,
      winRate: (parseInt(rec.wins) / parseInt(rec.games)) || 0
    }
  }).sort((a, b) => b.games - a.games)
})

// 情境装备
const situationalItems = computed(() => {
  if (!buildData.value || !buildData.value.situationalItems) return []
  return buildData.value.situationalItems
    .slice()
    .sort((a, b) => parseFloat(b.distinctive_score || 0) - parseFloat(a.distinctive_score || 0))
    .slice(0, 12)
})

// 出门装
const startingItems = computed(() => {
  if (!buildData.value || !buildData.value.startingItems) {
    // 兼容旧数据
    if (!buildData.value || !buildData.value.recommended) return []
    return buildData.value.recommended.map(rec => {
      const itemIds = rec.itemIds.split(',').map(id => id.trim())
      return {
        items: itemIds,
        games: parseInt(rec.games) || 0,
        wins: parseInt(rec.wins) || 0,
        winRate: (parseInt(rec.wins) / parseInt(rec.games)) || 0
      }
    }).filter(item => item.items.length <= 2).sort((a, b) => b.games - a.games)
  }
  return buildData.value.startingItems.map(rec => ({
    items: (rec.itemIds || []).map(id => String(id).trim()),
    games: parseInt(rec.games) || 0,
    wins: parseInt(rec.wins) || 0,
    pickRate: parseFloat(rec.pick_rate) || 0,
    winRate: (parseInt(rec.wins) / parseInt(rec.games)) || 0
  })).sort((a, b) => b.games - a.games)
})

/**
 * 显示浮窗
 */
const showOverlay = async (data) => {
  console.log('🔧 showOverlay 被调用，数据:', data)

  visible.value = true
  loading.value = true
  error.value = null

  try {
    if (!data || !data.championId) {
      throw new Error('缺少英雄ID')
    }

    championId.value = data.championId
    // 优先使用传入的英雄名称，如果没有则后面从数据加载
    championName.value = data.championName || ''
    dataSource.value = data.dataSource || 'local'
    timestamp.value = data.timestamp || Date.now()
    activeTab.value = 'augments'
    selectedRarity.value = 'all'

    // 加载完整英雄数据
    console.log('🔍 正在加载英雄数据...')
    const result = await window.ipcRenderer.invoke('load-champion-data', championId.value)

    if (result.success) {
      const { stats, augments, augmentStats: augStats, build, items, championName: nameData } = result.data
      championStats.value = stats
      augmentBase.value = augments
      augmentStats.value = augStats
      buildData.value = build
      itemsData.value = items

      // 设置英雄名称（优先使用传入的，否则使用从数据加载的）
      if (!championName.value && nameData) {
        championName.value = nameData.nameCN || nameData.nameEN || `英雄 ${championId.value}`
      }

      console.log('✅ 英雄数据加载成功')

      // 处理海克斯数据
      if (data.augments && data.augments.length > 0) {
        const hasWinrateData = data.augments.some(aug => 'winRate' in aug)

        if (hasWinrateData) {
          displayAugments.value = data.augments
        } else {
          // 查询胜率数据
          const augmentIds = data.augments.map(aug => aug.id).filter(id => id != null)
          const winrateResult = await window.ipcRenderer.invoke('get-winrate', {
            championId: championId.value,
            augmentIds: augmentIds
          })

          if (winrateResult.success && winrateResult.augments.length > 0) {
            displayAugments.value = winrateResult.augments
          } else {
            // 查询无结果，使用原始数据并补充默认值
            displayAugments.value = data.augments.map(aug => ({
              augmentId: aug.id,
              name: aug.name,
              rarity: aug.rarity,
              winRate: aug.winRate ?? null,
              pickRate: aug.pickRate ?? null,
              playCount: aug.playCount ?? 0,
              recommendScore: aug.recommendScore ?? null
            }))
          }
        }
      } else {
        displayAugments.value = []
      }
    } else {
      throw new Error(result.error || '数据加载失败')
    }
  } catch (err) {
    console.error('❌ 加载数据失败:', err)
    error.value = err.message || '加载数据失败'
  } finally {
    loading.value = false
  }

  console.log('🔧 showOverlay 完成')
}

/**
 * 关闭浮窗
 */
const closeOverlay = () => {
  visible.value = false
  championStats.value = null
  augmentBase.value = []
  augmentStats.value = {}
  buildData.value = null
  itemsData.value = {}
  displayAugments.value = []

  if (window.ipcRenderer) {
    window.ipcRenderer.send('hide-popup')
  }
}

/**
 * 格式化百分比（带空值保护）
 */
const formatPercent = (value) => {
  if (value == null || isNaN(value)) return '--'
  return `${(value * 100).toFixed(1)}%`
}

/**
 * 获取推荐标签
 */
const getRecommendLabel = (score) => {
  if (score == null || isNaN(score)) return '--'
  if (score >= 0.6) return '必选 🔥'
  if (score >= 0.5) return '推荐 📈'
  if (score >= 0.4) return '可选 👍'
  if (score >= 0.3) return '一般 ✓'
  return '冷门 ❄️'
}

/**
 * 获取胜率样式类
 */
const getWinRateClass = (winRate) => {
  if (!winRate) return ''
  if (winRate >= 0.55) return 'high'
  if (winRate >= 0.50) return 'medium'
  return 'low'
}

/**
 * 格式化数字
 */
const formatNumber = (num) => {
  if (!num) return '--'
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return String(num)
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
 * 处理图片加载错误
 */
const handleImageError = (e) => {
  e.target.style.display = 'none'
}

/**
 * 监听来自主进程的数据
 */
onMounted(() => {
  console.log('🔧 AugmentWinrateOverlay 组件已挂载')

  window.ipcRenderer.on('for-popup', (data) => {
    console.log('📊 收到 for-popup 事件:', data)
    if (data) {
      showOverlay(data)
    }
  })

  window.ipcRenderer.on('augment-detected', (data) => {
    console.log('📊 收到 augment-detected 事件:', data)
    if (data) {
      showOverlay(data)
    }
  })

  window.ipcRenderer.on('game-started', () => {
    console.log('🎮 游戏开始，隐藏弹窗')
    closeOverlay()
  })

  window.ipcRenderer.on('game-in-progress', () => {
    console.log('🎮 游戏进行中，隐藏弹窗')
    closeOverlay()
  })
})

onBeforeUnmount(() => {
  // 清理事件监听
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
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 500px;
  max-height: 85vh;
  background: linear-gradient(145deg, #1a1d29 0%, #0f1218 100%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05);
  padding: 0;
  color: white;
  font-family: 'Microsoft YaHei', Arial, sans-serif;
  font-size: 13px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.overlay-fade-enter-active,
.overlay-fade-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.overlay-fade-enter-from,
.overlay-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.95);
}

.close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: rgba(255, 255, 255, 0.7);
  font-size: 20px;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: all 0.2s;
  z-index: 10;
}

.close-btn:hover {
  background: rgba(239, 68, 68, 0.3);
  color: white;
}

/* 加载状态 */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(59, 130, 246, 0.2);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state {
  padding: 40px 20px;
  background: rgba(239, 68, 68, 0.1);
  text-align: center;
  color: #fca5a5;
}

.no-data {
  text-align: center;
  padding: 60px 20px;
  color: rgba(255, 255, 255, 0.5);
}

/* 主内容区 */
.overlay-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: 85vh;
}

/* 英雄头部 */
.champion-header {
  background: linear-gradient(135deg, rgba(30, 64, 175, 0.4) 0%, rgba(124, 58, 237, 0.3) 100%);
  padding: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.header-main {
  display: flex;
  gap: 16px;
  align-items: center;
}

.champion-avatar-wrapper {
  position: relative;
  flex-shrink: 0;
}

.champion-avatar {
  width: 80px;
  height: 107px;
  border-radius: 10px;
  object-fit: cover;
  border: 2px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.champion-tier {
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
  color: #1a1a1a;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 20px;
  box-shadow: 0 2px 8px rgba(251, 191, 36, 0.4);
}

.champion-info {
  flex: 1;
  min-width: 0;
}

.champion-name {
  margin: 0 0 12px 0;
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.champion-stats-row {
  display: flex;
  gap: 12px;
}

.stat-box {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  min-width: 60px;
}

.stat-box .stat-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
}

.stat-box .stat-value {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
}

.stat-box .stat-value.high { color: #4ade80; }
.stat-box .stat-value.medium { color: #fbbf24; }
.stat-box .stat-value.low { color: #f87171; }

/* Tabs */
.tabs-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tabs-list {
  display: flex;
  gap: 8px;
  padding: 12px 16px 0;
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 8px 8px 0 0;
  transition: all 0.2s;
  position: relative;
}

.tab-btn:hover {
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.05);
}

.tab-btn.active {
  color: #60a5fa;
  background: rgba(30, 64, 175, 0.2);
}

.tab-btn.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: #60a5fa;
  border-radius: 2px 2px 0 0;
}

.tab-icon {
  font-size: 14px;
}

/* Tab 内容 */
.tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.tab-panel {
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 过滤栏 */
.filter-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.filter-chip {
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
  border-radius: 20px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.filter-chip:hover {
  background: rgba(255, 255, 255, 0.1);
}

.filter-chip.active {
  background: rgba(59, 130, 246, 0.25);
  border-color: rgba(59, 130, 246, 0.5);
  color: #60a5fa;
}

.filter-chip.kGold.active {
  background: rgba(251, 191, 36, 0.25);
  border-color: rgba(251, 191, 36, 0.5);
  color: #fbbf24;
}

.filter-chip.kPrismatic.active {
  background: rgba(192, 132, 252, 0.25);
  border-color: rgba(192, 132, 252, 0.5);
  color: #c084fc;
}

.filter-chip.kSilver.active {
  background: rgba(156, 163, 175, 0.25);
  border-color: rgba(156, 163, 175, 0.5);
  color: #9ca3af;
}

/* 海克斯列表 */
.augments-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.augment-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-left: 3px solid rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  transition: all 0.2s;
}

.augment-card:hover {
  background: rgba(255, 255, 255, 0.08);
  transform: translateX(2px);
}

.augment-card.rarity-kGold {
  border-left-color: #fbbf24;
  background: rgba(251, 191, 36, 0.06);
}

.augment-card.rarity-kPrismatic {
  border-left-color: #c084fc;
  background: rgba(192, 132, 252, 0.06);
}

.augment-card.rarity-kSilver {
  border-left-color: #9ca3af;
  background: rgba(156, 163, 175, 0.06);
}

.augment-rank {
  min-width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
  color: #60a5fa;
  flex-shrink: 0;
}

.augment-icon-wrapper {
  flex-shrink: 0;
}

.augment-icon {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  object-fit: cover;
}

.augment-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.augment-name {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.augment-stats {
  display: flex;
  gap: 12px;
  font-size: 11px;
}

.stat-item {
  display: flex;
  gap: 4px;
}

.stat-item .stat-label {
  color: rgba(255, 255, 255, 0.5);
}

.stat-item .stat-value {
  font-weight: 600;
  color: #93c5fd;
}

.stat-item .stat-value.winrate {
  color: #4ade80;
}

.recommend-indicator {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: flex-end;
  min-width: 70px;
}

.score-bar {
  width: 60px;
  height: 5px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
}

.score-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #60a5fa);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.score-text {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
}

/* 出装样式 */
.build-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.build-section {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  padding: 12px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  margin: 0 0 10px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.situational-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.title-hint {
  font-size: 11px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.4);
}

.situational-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.build-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.build-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
}

.build-item.small {
  padding: 8px;
}

.item-icons {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.item-icon {
  width: 38px;
  height: 38px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  object-fit: cover;
}

.item-icon.small {
  width: 32px;
  height: 32px;
}

.build-stats {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-left: auto;
  text-align: right;
}

.build-stat {
  display: flex;
  gap: 6px;
  font-size: 11px;
}

.build-stat .label {
  color: rgba(255, 255, 255, 0.5);
}

.build-stat .value {
  font-weight: 600;
  color: #4ade80;
  min-width: 45px;
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: rgba(255, 255, 255, 0.4);
}

/* 底部信息 */
.overlay-footer {
  padding: 10px 16px;
  background: rgba(0, 0, 0, 0.2);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

/* 滚动条美化 */
.tab-content::-webkit-scrollbar {
  width: 6px;
}

.tab-content::-webkit-scrollbar-track {
  background: transparent;
}

.tab-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

.tab-content::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.25);
}

/* 响应式 */
@media (max-width: 600px) {
  .augment-overlay {
    width: 95vw;
    max-height: 90vh;
  }

  .champion-avatar {
    width: 60px;
    height: 80px;
  }

  .champion-name {
    font-size: 18px;
  }

  .champion-stats-row {
    gap: 8px;
  }

  .stat-box {
    padding: 6px 8px;
    min-width: 50px;
  }

  .tab-btn {
    padding: 8px 12px;
    font-size: 12px;
  }
}
</style>
