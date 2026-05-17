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
        <p>{{ error }}</p>
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
                    情境装备
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
import { electronAPI } from '../native/electron-api.js'

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
const unsubscribeEvents = []

// Tabs 配置
const tabs = [
  { key: 'augments', label: '海克斯', icon: 'HX' },
  { key: 'builds', label: '出装', icon: 'BD' }
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
    const result = await electronAPI.winrate.loadChampionData(championId.value)

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
          const winrateResult = await electronAPI.winrate.get({
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

  electronAPI.windows.hidePopup()
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

  unsubscribeEvents.push(electronAPI.events.on('for-popup', (data) => {
    console.log('📊 收到 for-popup 事件:', data)
    if (data) {
      showOverlay(data)
    }
  }))

  unsubscribeEvents.push(electronAPI.events.on('augment-detected', (data) => {
    console.log('📊 收到 augment-detected 事件:', data)
    if (data) {
      showOverlay(data)
    }
  }))

  unsubscribeEvents.push(electronAPI.events.on('augment-cleared', (data) => {
    console.log('🔧 收到 augment-cleared 事件:', data)
    closeOverlay()
  }))

  unsubscribeEvents.push(electronAPI.events.on('game-started', () => {
    console.log('🎮 游戏开始，隐藏弹窗')
    closeOverlay()
  }))

  unsubscribeEvents.push(electronAPI.events.on('game-in-progress', () => {
    console.log('🎮 游戏进行中，隐藏弹窗')
    closeOverlay()
  }))
})

onBeforeUnmount(() => {
  unsubscribeEvents.splice(0).forEach(unsubscribe => unsubscribe())
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
  width: min(640px, calc(100vw - 32px));
  max-height: 85vh;
  background:
    linear-gradient(145deg, rgba(22, 34, 48, 0.98), rgba(7, 10, 13, 0.98)),
    var(--lol-panel-raised);
  border: 1px solid rgba(200, 169, 106, 0.2);
  border-radius: 8px;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(40, 217, 200, 0.08);
  padding: 0;
  color: var(--lol-ivory);
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
  background: rgba(244, 236, 220, 0.06);
  border: 1px solid var(--lol-border-soft);
  color: var(--lol-muted);
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
  background: rgba(229, 83, 75, 0.18);
  color: #ffb0aa;
  border-color: rgba(229, 83, 75, 0.42);
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
  border: 3px solid rgba(244, 236, 220, 0.14);
  border-top-color: var(--lol-teal);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state {
  padding: 40px 20px;
  background: rgba(229, 83, 75, 0.1);
  text-align: center;
  color: #ffb0aa;
}

.no-data {
  text-align: center;
  padding: 60px 20px;
  color: var(--lol-muted);
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
  background:
    linear-gradient(135deg, rgba(40, 217, 200, 0.12), transparent 48%),
    radial-gradient(circle at 84% 0%, rgba(200, 169, 106, 0.12), transparent 260px),
    rgba(7, 10, 13, 0.3);
  padding: 24px;
  border-bottom: 1px solid var(--lol-border-soft);
}

.header-main {
  display: flex;
  gap: 18px;
  align-items: center;
}

.champion-avatar-wrapper {
  position: relative;
  flex-shrink: 0;
}

.champion-avatar {
  width: 92px;
  height: 122px;
  border-radius: 8px;
  object-fit: cover;
  border: 1px solid var(--lol-border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.champion-tier {
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(135deg, var(--lol-gold-2), var(--lol-teal));
  color: var(--lol-bg);
  font-size: 11px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
  box-shadow: 0 2px 8px rgba(200, 169, 106, 0.32);
}

.champion-info {
  flex: 1;
  min-width: 0;
}

.champion-name {
  margin: 0 0 14px 0;
  font-size: 26px;
  font-weight: 900;
  color: var(--lol-ivory);
}

.champion-stats-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.stat-box {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: rgba(7, 10, 13, 0.38);
  border: 1px solid var(--lol-border-soft);
  border-radius: 8px;
  min-width: 78px;
}

.stat-box .stat-label {
  font-size: 11px;
  color: var(--lol-faint);
}

.stat-box .stat-value {
  font-size: 15px;
  font-weight: 700;
  color: var(--lol-ivory);
}

.stat-box .stat-value.high { color: var(--lol-success); }
.stat-box .stat-value.medium { color: var(--lol-gold-2); }
.stat-box .stat-value.low { color: #ff9c96; }

/* Tabs */
.tabs-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tabs-list {
  display: flex;
  gap: 6px;
  padding: 12px 16px;
  background: rgba(7, 10, 13, 0.38);
  border-bottom: 1px solid var(--lol-border-soft);
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  background: transparent;
  border: none;
  color: var(--lol-muted);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  border-radius: 7px;
  transition: all 0.2s;
  position: relative;
}

.tab-btn:hover {
  color: var(--lol-ivory);
  background: rgba(244, 236, 220, 0.05);
}

.tab-btn.active {
  color: var(--lol-bg);
  background: linear-gradient(135deg, var(--lol-teal-2), var(--lol-teal));
}

.tab-btn.active::after {
  display: none;
}

.tab-btn.active .tab-icon {
  color: var(--lol-bg);
  border-color: rgba(7, 10, 13, 0.22);
}

.tab-icon {
  min-width: 22px;
  padding: 2px 4px;
  border: 1px solid var(--lol-border-soft);
  border-radius: 4px;
  color: var(--lol-gold-2);
  font-size: 10px;
  font-weight: 900;
  text-align: center;
}

/* Tab 内容 */
.tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
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
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.filter-chip {
  padding: 7px 12px;
  background: rgba(244, 236, 220, 0.05);
  border: 1px solid var(--lol-border-soft);
  color: var(--lol-muted);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.filter-chip:hover {
  background: rgba(244, 236, 220, 0.09);
}

.filter-chip.active {
  background: rgba(40, 217, 200, 0.16);
  border-color: rgba(40, 217, 200, 0.38);
  color: var(--lol-teal-2);
}

.filter-chip.kGold.active {
  background: rgba(200, 169, 106, 0.18);
  border-color: rgba(200, 169, 106, 0.42);
  color: var(--lol-gold-2);
}

.filter-chip.kPrismatic.active {
  background: rgba(40, 217, 200, 0.16);
  border-color: rgba(40, 217, 200, 0.38);
  color: var(--lol-teal-2);
}

.filter-chip.kSilver.active {
  background: rgba(166, 177, 184, 0.18);
  border-color: rgba(166, 177, 184, 0.38);
  color: #d4dde2;
}

/* 海克斯列表 */
.augments-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.augment-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background:
    linear-gradient(90deg, rgba(244, 236, 220, 0.025), transparent),
    rgba(7, 10, 13, 0.34);
  border: 1px solid var(--lol-border-soft);
  border-left: 3px solid var(--lol-border);
  border-radius: 8px;
  transition: all 0.2s;
}

.augment-card:hover {
  background: rgba(40, 217, 200, 0.07);
  transform: translateX(2px);
  border-color: rgba(40, 217, 200, 0.22);
}

.augment-card.rarity-kGold {
  border-left-color: var(--lol-gold);
  background: rgba(200, 169, 106, 0.07);
}

.augment-card.rarity-kPrismatic {
  border-left-color: var(--lol-teal);
  background: rgba(40, 217, 200, 0.07);
}

.augment-card.rarity-kSilver {
  border-left-color: #a6b1b8;
  background: rgba(166, 177, 184, 0.06);
}

.augment-rank {
  min-width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(40, 217, 200, 0.14);
  border: 1px solid rgba(40, 217, 200, 0.26);
  border-radius: 7px;
  font-size: 12px;
  font-weight: 900;
  color: var(--lol-teal-2);
  flex-shrink: 0;
}

.augment-icon-wrapper {
  flex-shrink: 0;
}

.augment-icon {
  width: 42px;
  height: 42px;
  border-radius: 6px;
  border: 1px solid var(--lol-border-soft);
  object-fit: cover;
}

.augment-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.augment-name {
  font-size: 14px;
  font-weight: 900;
  color: var(--lol-ivory);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.augment-stats {
  display: flex;
  gap: 14px;
  font-size: 11px;
}

.stat-item {
  display: flex;
  gap: 4px;
}

.stat-item .stat-label {
  color: var(--lol-faint);
}

.stat-item .stat-value {
  font-weight: 600;
  color: var(--lol-gold-2);
}

.stat-item .stat-value.winrate {
  color: var(--lol-success);
}

.recommend-indicator {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: flex-end;
  min-width: 86px;
}

.score-bar {
  width: 82px;
  height: 5px;
  background: rgba(244, 236, 220, 0.08);
  border-radius: 3px;
  overflow: hidden;
}

.score-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--lol-teal), var(--lol-gold-2));
  border-radius: 3px;
  transition: width 0.3s ease;
}

.score-text {
  font-size: 10px;
  color: var(--lol-muted);
  font-weight: 800;
}

/* 出装样式 */
.build-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.build-section {
  background: rgba(7, 10, 13, 0.32);
  border: 1px solid var(--lol-border-soft);
  border-radius: 8px;
  padding: 12px;
}

.section-title {
  font-size: 14px;
  font-weight: 900;
  color: var(--lol-ivory);
  margin: 0 0 10px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--lol-border-soft);
}

.situational-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.title-hint {
  font-size: 11px;
  font-weight: 400;
  color: var(--lol-faint);
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
  background: rgba(17, 25, 35, 0.62);
  border: 1px solid var(--lol-border-soft);
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
  border: 1px solid var(--lol-border-soft);
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
  color: var(--lol-faint);
}

.build-stat .value {
  font-weight: 600;
  color: var(--lol-success);
  min-width: 45px;
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--lol-muted);
}

/* 底部信息 */
.overlay-footer {
  padding: 10px 16px;
  background: rgba(7, 10, 13, 0.34);
  border-top: 1px solid var(--lol-border-soft);
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--lol-faint);
}

/* 滚动条美化 */
.tab-content::-webkit-scrollbar {
  width: 6px;
}

.tab-content::-webkit-scrollbar-track {
  background: transparent;
}

.tab-content::-webkit-scrollbar-thumb {
  background: rgba(200, 169, 106, 0.5);
  border-radius: 3px;
}

.tab-content::-webkit-scrollbar-thumb:hover {
  background: rgba(40, 217, 200, 0.5);
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
