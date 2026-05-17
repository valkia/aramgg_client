<template>
  <transition name="float-fade">
    <div v-if="visible" class="floating-overlay">
      <div class="floating-header">
        <div class="floating-title">
          <span class="title-mark"></span>
          <span>海克斯推荐</span>
          <small>实时浮窗</small>
        </div>
        <button class="close-btn" @click="closeOverlay" title="关闭">×</button>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="loading">
        <div class="spinner"></div>
        <span>加载中...</span>
      </div>

      <!-- 海克斯推荐列表 -->
      <div v-else-if="displayAugments && displayAugments.length > 0" class="augments-grid">
        <div
          v-for="(augment, index) in displayAugments.slice(0, 3)"
          :key="augment.augmentId"
          class="augment-item"
          :class="`rarity-${augment.rarity}`"
        >
          <div class="card-top">
            <div class="rank">{{ String(index + 1).padStart(2, '0') }}</div>
            <div class="badge" :class="getBadgeClass(augment.recommendScore)">
              {{ getRecommendText(augment.recommendScore) }}
            </div>
          </div>

          <div class="content">
            <div class="name">{{ augment.name }}</div>
            <div class="stats">
              <span class="stat">
                <small>胜率</small>
                <strong>{{ formatPercent(augment.winRate) }}</strong>
              </span>
              <span class="stat">
                <small>推荐</small>
                <strong>{{ formatScore(augment.recommendScore) }}</strong>
              </span>
            </div>
          </div>

          <div class="score-track">
            <div class="score-fill" :style="{ width: getScoreWidth(augment.recommendScore) }"></div>
          </div>
        </div>
      </div>

      <!-- 错误状态 -->
      <div v-else-if="error" class="error">
        {{ error }}
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { electronAPI } from '../native/electron-api.js'
import { sortAugmentsByDetectedOrder } from '../service/augment-order.js'

const visible = ref(false)
const loading = ref(false)
const error = ref(null)
const displayAugments = ref([])
const championId = ref(null)
const unsubscribeEvents = []

/**
 * 格式化百分比
 */
const formatPercent = (value) => {
  if (value == null || isNaN(value)) return '--'
  return `${(value * 100).toFixed(1)}%`
}

/**
 * 格式化分数
 */
const formatScore = (value) => {
  if (value == null || isNaN(value)) return '--'
  return Math.round(value * 100)
}

const getScoreWidth = (value) => {
  if (value == null || isNaN(value)) return '0%'
  return `${Math.min(Math.max(value * 100, 0), 100)}%`
}

/**
 * 获取推荐文本
 */
const getRecommendText = (score) => {
  if (score == null || isNaN(score)) return '未知'
  if (score >= 0.6) return '必选'
  if (score >= 0.5) return '强推'
  if (score >= 0.4) return '推荐'
  if (score >= 0.3) return '可选'
  return '冷门'
}

/**
 * 获取徽章样式
 */
const getBadgeClass = (score) => {
  if (score == null || isNaN(score)) return 'unknown'
  if (score >= 0.6) return 'must'
  if (score >= 0.5) return 'strong'
  if (score >= 0.4) return 'good'
  if (score >= 0.3) return 'ok'
  return 'cold'
}

/**
 * 显示浮窗
 */
const showOverlay = async (data) => {
  console.log('🔧 [FloatingOverlay] showOverlay 被调用:', data)

  visible.value = true
  loading.value = false
  error.value = null

  if (data && data.augments && data.augments.length > 0) {
    championId.value = data.championId

    // 检查是否有完整的胜率数据
    const hasWinrateData = data.augments.some(aug => aug.winRate != null)
    console.log('🔍 [FloatingOverlay] 检查胜率数据:', hasWinrateData)

    if (hasWinrateData) {
      displayAugments.value = sortAugmentsByDetectedOrder(data.augments, data.augments)
      console.log('✅ [FloatingOverlay] 直接显示完整数据')
    } else {
      // 需要查询胜率数据
      console.log('🔍 [FloatingOverlay] 正在查询胜率数据...')
      loading.value = true

      try {
        // 获取当前英雄ID
        if (!championId.value) {
          // 首先尝试从store中读取缓存的英雄ID
          console.log('🔍 [FloatingOverlay] 尝试从store读取缓存的英雄ID...')
          try {
            const cachedChampionId = await electronAPI.store.get('lastSelectedChampionId')
            if (cachedChampionId) {
              championId.value = cachedChampionId
              console.log('✅ [FloatingOverlay] 从store获取到英雄ID:', cachedChampionId)
            } else {
              console.log('⚠️ [FloatingOverlay] store中没有缓存的英雄ID')
            }
          } catch (storeErr) {
            console.warn('⚠️ [FloatingOverlay] 从store读取英雄ID失败:', storeErr)
          }

          // 如果store中也没有，再尝试通过LCU API获取
          if (!championId.value) {
            console.log('🔍 [FloatingOverlay] 尝试通过LCU API获取英雄ID...')
            const championResult = await electronAPI.lcu.getChampionId()
            if (championResult.success) {
              championId.value = championResult.championId
              console.log('✅ [FloatingOverlay] 通过LCU获取到英雄ID:', championResult.championId)
            } else {
              console.warn('❌ [FloatingOverlay] LCU获取英雄ID失败:', championResult.error)
              throw new Error('无法获取当前英雄ID - store和LCU均失败')
            }
          }
        }

        // 查询胜率数据
        const augmentIds = data.augments.map(aug => aug.id).filter(id => id != null)
        const winrateResult = await electronAPI.winrate.get({
          championId: championId.value,
          augmentIds: augmentIds
        })

        if (winrateResult.success && winrateResult.augments.length > 0) {
          // 找到了胜率数据，按游戏内从左到右的识别顺序展示。
          displayAugments.value = sortAugmentsByDetectedOrder(winrateResult.augments, data.augments)
          console.log('✅ [FloatingOverlay] 胜率数据查询成功:', winrateResult.augments)
        } else if (winrateResult.success && winrateResult.augments.length === 0) {
          // 查询成功但没有这些海克斯的数据，显示基本信息
          console.warn('⚠️ [FloatingOverlay] 没有找到这些海克斯的胜率数据，显示基本信息')
          displayAugments.value = data.augments.map(aug => ({
            augmentId: aug.id,
            name: aug.name,
            rarity: aug.rarity,
            winRate: null,
            pickRate: null,
            playCount: 0,
            recommendScore: 0.5 // 默认推荐分数
          }))
        } else {
          throw new Error(winrateResult.error || '胜率查询失败')
        }
      } catch (err) {
        console.error('❌ [FloatingOverlay] 查询失败:', err)
        error.value = '数据加载失败'
      } finally {
        loading.value = false
      }
    }
  } else {
    error.value = '无可用数据'
  }
}

/**
 * 关闭浮窗
 */
const closeOverlay = () => {
  console.log('🔧 [FloatingOverlay] 关闭浮窗')
  visible.value = false
  displayAugments.value = []
  error.value = null

  // 隐藏浮动窗口本身
  electronAPI.windows.hideFloating()
}

/**
 * 监听事件
 */
onMounted(() => {
  console.log('🔧 [FloatingOverlay] 组件已挂载')

  unsubscribeEvents.push(electronAPI.events.on('augment-detected', (data) => {
    console.log('📊 [FloatingOverlay] 收到 augment-detected:', data)
    showOverlay(data)
  }))

  unsubscribeEvents.push(electronAPI.events.on('augment-cleared', (data) => {
    console.log('🔧 [FloatingOverlay] 收到 augment-cleared:', data)
    closeOverlay()
  }))

  unsubscribeEvents.push(electronAPI.events.on('game-started', () => {
    console.log('🎮 [FloatingOverlay] 游戏开始，关闭浮窗')
    closeOverlay()
  }))

  unsubscribeEvents.push(electronAPI.events.on('game-in-progress', () => {
    console.log('🎮 [FloatingOverlay] 游戏进行中，关闭浮窗')
    closeOverlay()
  }))

  unsubscribeEvents.push(electronAPI.events.on('game-phase-changed', (data) => {
    if (data && (data.phase === 'GameStart' || data.phase === 'InProgress')) {
      console.log('🎮 [FloatingOverlay] 游戏阶段变化，关闭浮窗')
      closeOverlay()
    }
  }))
})

onBeforeUnmount(() => {
  unsubscribeEvents.splice(0).forEach(unsubscribe => unsubscribe())
  closeOverlay()
})
</script>

<style scoped>
.floating-overlay {
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: min(842px, calc(100vw - 8px));
  max-height: 100vh;
  background:
    linear-gradient(145deg, rgba(18, 27, 38, 0.9), rgba(6, 9, 12, 0.92)),
    rgba(7, 10, 13, 0.92);
  backdrop-filter: blur(18px);
  border: 1px solid rgba(200, 169, 106, 0.2);
  border-radius: 8px;
  padding: 8px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.66), 0 0 0 1px rgba(40, 217, 200, 0.08);
  box-sizing: border-box;
  font-family: 'Microsoft YaHei', Arial, sans-serif;
  color: var(--lol-ivory);
  z-index: 9999;
  overflow: hidden;
}

.floating-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 24px;
  margin-bottom: 6px;
  padding: 0 2px;
}

.floating-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--lol-ivory);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0;
}

.floating-title small {
  padding-left: 8px;
  color: var(--lol-faint);
  font-size: 10px;
  font-weight: 700;
}

.title-mark {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--lol-teal);
  box-shadow: 0 0 12px rgba(40, 217, 200, 0.75);
}

.float-fade-enter-active,
.float-fade-leave-active {
  transition: all 0.3s ease;
}

.float-fade-enter-from,
.float-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-20px);
}

.close-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(244, 236, 220, 0.04);
  border: 1px solid var(--lol-border-soft);
  border-radius: 6px;
  color: var(--lol-muted);
  font-size: 18px;
  cursor: pointer;
  transition: all 0.2s;
  z-index: 10;
  pointer-events: auto;
}

.close-btn:hover {
  background: rgba(229, 83, 75, 0.18);
  border-color: rgba(229, 83, 75, 0.45);
  color: #ffb0aa;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
  font-size: 14px;
  color: var(--lol-muted);
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(244, 236, 220, 0.16);
  border-top-color: var(--lol-teal);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error {
  padding: 20px;
  text-align: center;
  color: #ff9c96;
  font-size: 14px;
}

.augments-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.augment-item {
  display: flex;
  flex-direction: column;
  gap: 7px;
  height: 152px;
  padding: 9px;
  background:
    linear-gradient(180deg, rgba(244, 236, 220, 0.035), transparent),
    rgba(12, 18, 25, 0.76);
  border: 1px solid rgba(244, 236, 220, 0.09);
  border-radius: 8px;
  transition: all 0.2s;
  position: relative;
  min-width: 0;
}

.augment-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(40, 217, 200, 0.16);
  border-color: rgba(40, 217, 200, 0.34);
}

.augment-item.rarity-gold,
.augment-item.rarity-kGold {
  border-color: rgba(200, 169, 106, 0.42);
  background:
    linear-gradient(135deg, rgba(200, 169, 106, 0.16), transparent 48%),
    rgba(12, 18, 25, 0.82);
}

.augment-item.rarity-silver,
.augment-item.rarity-kSilver {
  border-color: rgba(166, 177, 184, 0.32);
  background:
    linear-gradient(135deg, rgba(166, 177, 184, 0.12), transparent 48%),
    rgba(12, 18, 25, 0.82);
}

.augment-item.rarity-prismatic,
.augment-item.rarity-kPrismatic {
  border-color: rgba(40, 217, 200, 0.4);
  background:
    linear-gradient(135deg, rgba(40, 217, 200, 0.14), transparent 48%),
    rgba(12, 18, 25, 0.82);
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.rank {
  width: 32px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(7, 10, 13, 0.42);
  color: var(--lol-gold-2);
  font-size: 12px;
  font-weight: 900;
  border-radius: 6px;
  border: 1px solid var(--lol-border-soft);
}

.content {
  display: flex;
  flex-direction: column;
  gap: 7px;
  flex: 1;
  min-height: 0;
}

.name {
  font-size: 14px;
  font-weight: 900;
  color: var(--lol-ivory);
  text-align: left;
  line-height: 1.25;
  min-height: 36px;
  display: -webkit-box;
  overflow: hidden;
  padding-left: 0;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.stat {
  padding: 5px 7px;
  background: rgba(7, 10, 13, 0.34);
  border: 1px solid var(--lol-border-soft);
  border-radius: 6px;
  white-space: nowrap;
}

.stat small {
  display: block;
  margin-bottom: 1px;
  color: var(--lol-faint);
  font-size: 10px;
  font-weight: 700;
}

.stat strong {
  color: var(--lol-ivory);
  font-size: 12px;
  font-weight: 900;
}

.score-track {
  height: 5px;
  overflow: hidden;
  background: rgba(244, 236, 220, 0.08);
  border-radius: 999px;
}

.score-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--lol-teal), var(--lol-gold-2));
  border-radius: inherit;
}

.badge {
  min-width: 50px;
  padding: 4px 8px;
  text-align: center;
  font-size: 11px;
  font-weight: 900;
  border-radius: 6px;
  letter-spacing: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.badge.must {
  background: rgba(229, 83, 75, 0.2);
  color: #ffb0aa;
  border: 1px solid rgba(229, 83, 75, 0.34);
  animation: pulse 2s ease-in-out infinite;
}

.badge.strong {
  background: rgba(200, 169, 106, 0.18);
  color: var(--lol-gold-2);
  border: 1px solid rgba(200, 169, 106, 0.34);
}

.badge.good {
  background: rgba(40, 217, 200, 0.16);
  color: var(--lol-teal-2);
  border: 1px solid rgba(40, 217, 200, 0.32);
}

.badge.ok {
  background: rgba(84, 216, 132, 0.14);
  color: var(--lol-success);
  border: 1px solid rgba(84, 216, 132, 0.28);
}

.badge.cold {
  background: rgba(111, 122, 130, 0.18);
  color: var(--lol-muted);
  border: 1px solid rgba(111, 122, 130, 0.28);
}

.badge.unknown {
  background: rgba(244, 236, 220, 0.06);
  color: var(--lol-faint);
  border: 1px solid var(--lol-border-soft);
}

@keyframes pulse {
  0%, 100% {
    transform: scale(1);
    box-shadow: 0 2px 8px rgba(229, 83, 75, 0.32);
  }
  50% {
    transform: scale(1.02);
    box-shadow: 0 4px 16px rgba(229, 83, 75, 0.44);
  }
}

@media (max-width: 760px) {
  .augments-grid {
    grid-template-columns: 1fr;
  }
}
</style>
