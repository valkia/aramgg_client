<template>
  <transition name="float-fade">
    <div v-if="visible" class="floating-overlay">
      <!-- 关闭按钮 -->
      <button class="close-btn" @click="closeOverlay" title="关闭">×</button>

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
          <div class="rank">{{ index + 1 }}</div>
          <div class="content">
            <div class="name">{{ augment.name }}</div>
            <div class="stats">
              <span class="stat">胜率 {{ formatPercent(augment.winRate) }}</span>
              <span class="stat">推荐 {{ formatScore(augment.recommendScore) }}</span>
            </div>
          </div>
          <div class="badge" :class="getBadgeClass(augment.recommendScore)">
            {{ getRecommendText(augment.recommendScore) }}
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

const visible = ref(false)
const loading = ref(false)
const error = ref(null)
const displayAugments = ref([])
const championId = ref(null)

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
      displayAugments.value = data.augments
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
            const cachedChampionId = await window.ipcRenderer.invoke('store-get', 'lastSelectedChampionId')
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
            const championResult = await window.ipcRenderer.invoke('get-champion-id')
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
        const winrateResult = await window.ipcRenderer.invoke('get-winrate', {
          championId: championId.value,
          augmentIds: augmentIds
        })

        if (winrateResult.success && winrateResult.augments.length > 0) {
          // 找到了胜率数据，直接使用
          displayAugments.value = winrateResult.augments
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
  if (window.ipcRenderer) {
    window.ipcRenderer.send('hide-floating')
  }
}

/**
 * 监听事件
 */
onMounted(() => {
  console.log('🔧 [FloatingOverlay] 组件已挂载')

  window.ipcRenderer.on('augment-detected', (data) => {
    console.log('📊 [FloatingOverlay] 收到 augment-detected:', data)
    showOverlay(data)
  })

  window.ipcRenderer.on('augment-cleared', (data) => {
    console.log('🔧 [FloatingOverlay] 收到 augment-cleared:', data)
    closeOverlay()
  })

  window.ipcRenderer.on('game-started', () => {
    console.log('🎮 [FloatingOverlay] 游戏开始，关闭浮窗')
    closeOverlay()
  })

  window.ipcRenderer.on('game-in-progress', () => {
    console.log('🎮 [FloatingOverlay] 游戏进行中，关闭浮窗')
    closeOverlay()
  })

  window.ipcRenderer.on('game-phase-changed', (data) => {
    if (data && (data.phase === 'GameStart' || data.phase === 'InProgress')) {
      console.log('🎮 [FloatingOverlay] 游戏阶段变化，关闭浮窗')
      closeOverlay()
    }
  })
})

onBeforeUnmount(() => {
  closeOverlay()
})
</script>

<style scoped>
.floating-overlay {
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 800px;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(10px);
  border: 2px solid rgba(255, 215, 0, 0.3);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
  font-family: 'Microsoft YaHei', Arial, sans-serif;
  color: white;
  z-index: 9999;
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
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 18px;
  cursor: pointer;
  transition: all 0.2s;
  z-index: 10;
  pointer-events: auto;
}

.close-btn:hover {
  background: rgba(239, 68, 68, 0.8);
  border-color: rgba(239, 68, 68, 0.9);
  color: white;
  transform: scale(1.1);
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #ffd700;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error {
  padding: 20px;
  text-align: center;
  color: #ff6b6b;
  font-size: 14px;
}

.augments-grid {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.augment-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: linear-gradient(135deg, rgba(30, 30, 50, 0.95) 0%, rgba(20, 20, 40, 0.95) 100%);
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  transition: all 0.2s;
  position: relative;
}

.augment-item:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  border-color: rgba(255, 215, 0, 0.4);
}

.augment-item.rarity-gold,
.augment-item.rarity-kGold {
  border-color: rgba(255, 215, 0, 0.6);
  background: linear-gradient(135deg, rgba(60, 50, 20, 0.95) 0%, rgba(40, 30, 10, 0.95) 100%);
}

.augment-item.rarity-silver,
.augment-item.rarity-kSilver {
  border-color: rgba(192, 192, 192, 0.6);
  background: linear-gradient(135deg, rgba(40, 40, 50, 0.95) 0%, rgba(30, 30, 40, 0.95) 100%);
}

.augment-item.rarity-prismatic,
.augment-item.rarity-kPrismatic {
  border-color: rgba(147, 51, 234, 0.6);
  background: linear-gradient(135deg, rgba(50, 30, 60, 0.95) 0%, rgba(30, 20, 40, 0.95) 100%);
}

.rank {
  position: absolute;
  top: -8px;
  left: -8px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #ffd700 0%, #ffed4e 100%);
  color: #1a1a1a;
  font-size: 14px;
  font-weight: bold;
  border-radius: 50%;
  border: 2px solid rgba(0, 0, 0, 0.3);
  box-shadow: 0 2px 8px rgba(255, 215, 0, 0.5);
}

.content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.name {
  font-size: 15px;
  font-weight: 600;
  color: #ffffff;
  text-align: center;
  line-height: 1.3;
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stats {
  display: flex;
  gap: 8px;
  justify-content: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

.stat {
  padding: 3px 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  white-space: nowrap;
}

.badge {
  padding: 6px 12px;
  text-align: center;
  font-size: 13px;
  font-weight: bold;
  border-radius: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.badge.must {
  background: linear-gradient(135deg, #ff4757 0%, #ff6b81 100%);
  color: white;
  animation: pulse 2s ease-in-out infinite;
}

.badge.strong {
  background: linear-gradient(135deg, #ffa502 0%, #ffb700 100%);
  color: white;
}

.badge.good {
  background: linear-gradient(135deg, #5f27cd 0%, #a55eea 100%);
  color: white;
}

.badge.ok {
  background: linear-gradient(135deg, #0984e3 0%, #74b9ff 100%);
  color: white;
}

.badge.cold {
  background: rgba(100, 100, 120, 0.8);
  color: rgba(255, 255, 255, 0.8);
}

.badge.unknown {
  background: rgba(60, 60, 60, 0.8);
  color: rgba(255, 255, 255, 0.6);
}

@keyframes pulse {
  0%, 100% {
    transform: scale(1);
    box-shadow: 0 2px 8px rgba(255, 71, 87, 0.5);
  }
  50% {
    transform: scale(1.05);
    box-shadow: 0 4px 16px rgba(255, 71, 87, 0.8);
  }
}
</style>
