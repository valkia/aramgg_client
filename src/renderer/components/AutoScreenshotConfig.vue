<template>
  <div class="auto-screenshot-config">
    <h3>⚙️ 定时截图配置</h3>

    <!-- 启用/禁用按钮 -->
    <div class="control-section">
      <button
        :class="['toggle-btn', { active: isRunning }]"
        @click="toggleAutoScreenshot"
        :disabled="isLoading"
      >
        {{ isRunning ? '◼ 停止定时截图' : '▶ 启动定时截图' }}
      </button>
    </div>

    <!-- 配置参数 -->
    <div class="config-section" v-if="!isRunning">
      <div class="config-item">
        <label>截图间隔 (毫秒)</label>
        <div class="input-group">
          <input
            v-model.number="config.interval"
            type="number"
            min="1000"
            max="60000"
            step="500"
            placeholder="输入间隔时间"
          />
          <span class="unit">ms ({{ (config.interval / 1000).toFixed(1) }}s)</span>
        </div>
        <small>推荐值: 3000-5000ms (3-5秒)</small>
      </div>

      <div class="config-item">
        <label>最多保留截图数量</label>
        <div class="input-group">
          <input
            v-model.number="config.maxScreenshots"
            type="number"
            min="10"
            max="200"
            step="10"
            placeholder="输入最大数量"
          />
          <span class="unit">张</span>
        </div>
        <small>超过此数量会自动删除旧截图</small>
      </div>

      <button class="btn-apply" @click="applyConfig" :disabled="isLoading">
        应用配置
      </button>
    </div>

    <!-- 实时统计信息 -->
    <div class="stats-section" v-if="isRunning || stats">
      <div class="stats-header">
        <h4>📊 性能监测</h4>
        <button class="btn-refresh-stats" @click="refreshStats" :disabled="isLoading">
          🔄 刷新
        </button>
      </div>

      <div class="stats-grid" v-if="stats && stats.performanceLevel">
        <!-- 基本信息 -->
        <div class="stat-card">
          <div class="stat-label">状态</div>
          <div class="stat-value">
            <span v-if="stats.isRunning" class="status-badge running">运行中</span>
            <span v-else class="status-badge stopped">已停止</span>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-label">已截图数量</div>
          <div class="stat-value">{{ stats.screenshotCount }}</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">当前间隔</div>
          <div class="stat-value">{{ (stats.interval / 1000).toFixed(1) }}s</div>
        </div>

        <!-- 性能指标 -->
        <div class="stat-card">
          <div class="stat-label">平均截图耗时</div>
          <div class="stat-value">{{ stats.averageCaptureTime.toFixed(2) }}ms</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">最快/最慢</div>
          <div class="stat-value">
            <span class="good">{{ stats.minCaptureTime.toFixed(2) }}</span>
            <span class="divider">/</span>
            <span class="bad">{{ stats.maxCaptureTime.toFixed(2) }}</span>
            <span class="unit">ms</span>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-label">平均内存占用</div>
          <div class="stat-value">{{ stats.averageMemory.toFixed(1) }}MB</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">峰值内存占用</div>
          <div class="stat-value">{{ stats.maxMemory.toFixed(1) }}MB</div>
        </div>

        <!-- 性能评级 -->
        <div class="stat-card performance-card" v-if="stats.performanceLevel">
          <div class="stat-label">性能评级</div>
          <div
            class="performance-badge"
            :style="{ backgroundColor: stats.performanceLevel.color }"
          >
            <div class="performance-level">{{ stats.performanceLevel.label }}</div>
            <div class="performance-score">得分: {{ stats.performanceLevel.score }}/100</div>
          </div>
        </div>
      </div>

      <!-- 性能分析 -->
      <div class="performance-analysis" v-if="stats && stats.performanceLevel">
        <h4>💡 性能分析</h4>
        <div :class="['analysis-text', stats.performanceLevel.level]">
          {{ performanceAnalysis }}
        </div>
      </div>
    </div>

    <!-- 最后截图时间 -->
    <div class="last-screenshot-info" v-if="stats && stats.lastScreenshotTime">
      <small>最后截图: {{ formatTime(stats.lastScreenshotTime) }}</small>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { electronAPI } from '../native/electron-api.js'

const isRunning = ref(false)
const isLoading = ref(false)
const config = ref({
  interval: 5000,
  maxScreenshots: 50,
})
const stats = ref(null)
const refreshInterval = ref(null)

// 性能分析文本
const performanceAnalysis = computed(() => {
  if (!stats.value) return ''

  const level = stats.value.performanceLevel.level
  const avgTime = stats.value.averageCaptureTime
  const memory = stats.value.averageMemory

  const analyses = {
    excellent: `✅ 定时截图运行非常流畅，截图耗时${avgTime.toFixed(2)}ms，内存占用${memory.toFixed(1)}MB。\n对游戏性能基本没有影响，可以安心使用。`,
    good: `👍 定时截图运行良好，截图耗时${avgTime.toFixed(2)}ms，内存占用${memory.toFixed(1)}MB。\n对游戏性能的影响很小，正常游戏不会受到影响。`,
    fair: `⚠️ 定时截图运行一般，截图耗时${avgTime.toFixed(2)}ms，内存占用${memory.toFixed(1)}MB。\n可能在高负载情况下对游戏有轻微影响，建议调整间隔时间。`,
    poor: `❌ 定时截图运行较差，截图耗时${avgTime.toFixed(2)}ms，内存占用${memory.toFixed(1)}MB。\n建议关闭此功能或增加截图间隔，以避免影响游戏性能。`,
  }

  return analyses[level] || ''
})

/**
 * 格式化时间
 */
const formatTime = (timestamp) => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN')
}

/**
 * 切换定时截图
 */
const toggleAutoScreenshot = async () => {
  isLoading.value = true
  try {
    let result

    if (isRunning.value) {
      // 停止
      result = await electronAPI.autoScreenshot.stop()
    } else {
      // 启动
      result = await electronAPI.autoScreenshot.start({
        interval: config.value.interval,
      })
    }

    if (result.success) {
      isRunning.value = !isRunning.value
      console.log('Auto screenshot toggled:', result.config)

      // 如果启动了，开始定期刷新统计
      if (isRunning.value) {
        await refreshStats()
        startAutoRefresh()
      } else {
        stopAutoRefresh()
      }
    } else {
      console.error('Failed to toggle auto screenshot')
    }
  } catch (error) {
    console.error('Error toggling auto screenshot:', error)
  } finally {
    isLoading.value = false
  }
}

/**
 * 应用配置
 */
const applyConfig = async () => {
  isLoading.value = true
  try {
    const result = await electronAPI.autoScreenshot.setConfig(config.value)
    console.log('Config applied:', result)
  } catch (error) {
    console.error('Error applying config:', error)
  } finally {
    isLoading.value = false
  }
}

/**
 * 刷新统计信息
 */
const refreshStats = async () => {
  try {
    const result = await electronAPI.autoScreenshot.getStats()

    // 确保返回的结果有完整的结构
    if (result && typeof result === 'object') {
      // 如果没有 performanceLevel，添加默认值
      if (!result.performanceLevel) {
        result.performanceLevel = {
          level: 'unknown',
          score: 0,
          label: '计算中...',
          color: '#999'
        }
      }
      stats.value = result
    } else {
      console.warn('Invalid stats result:', result)
      stats.value = null
    }
  } catch (error) {
    console.error('Error fetching stats:', error)
    stats.value = null
  }
}

/**
 * 启动自动刷新
 */
const startAutoRefresh = () => {
  refreshInterval.value = setInterval(() => {
    refreshStats()
  }, 1000) // 每秒刷新一次
}

/**
 * 停止自动刷新
 */
const stopAutoRefresh = () => {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value)
    refreshInterval.value = null
  }
}

/**
 * 组件挂载
 */
onMounted(async () => {
  try {
    // 获取当前配置
    const currentConfig = await electronAPI.autoScreenshot.getConfig()
    isRunning.value = currentConfig.isRunning
    config.value.interval = currentConfig.interval
    config.value.maxScreenshots = currentConfig.maxScreenshots

    // 获取当前统计
    await refreshStats()

    // 如果已经运行，启动自动刷新
    if (isRunning.value) {
      startAutoRefresh()
    }
  } catch (error) {
    console.error('Error initializing auto screenshot config:', error)
  }
})

/**
 * 组件卸载
 */
onBeforeUnmount(() => {
  stopAutoRefresh()
})

// 暴露方法
defineExpose({
  toggleAutoScreenshot,
  refreshStats,
})
</script>

<style scoped>
.auto-screenshot-config {
  padding: 16px;
  background-color: #f5f5f5;
  border-radius: 4px;
  margin-top: 16px;
}

h3 {
  margin: 0 0 16px;
  color: #333;
  font-size: 16px;
  font-weight: bold;
}

h4 {
  margin: 12px 0 8px;
  color: #555;
  font-size: 14px;
  font-weight: bold;
}

.control-section {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.toggle-btn {
  padding: 10px 16px;
  background-color: #999;
  border: none;
  border-radius: 4px;
  color: white;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
  flex: 1;
}

.toggle-btn:hover:not(:disabled) {
  background-color: #777;
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.toggle-btn.active {
  background-color: #27ae60;
}

.toggle-btn.active:hover {
  background-color: #229954;
}

.toggle-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.config-section {
  background-color: white;
  padding: 12px;
  border-radius: 4px;
  margin-bottom: 16px;
}

.config-item {
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.config-item label {
  font-weight: bold;
  font-size: 13px;
  color: #333;
}

.input-group {
  display: flex;
  gap: 8px;
  align-items: center;
}

.config-item input {
  padding: 6px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  flex: 1;
}

.config-item input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 4px rgba(102, 126, 234, 0.2);
}

.unit {
  color: #999;
  font-size: 12px;
  white-space: nowrap;
}

.config-item small {
  color: #999;
  font-size: 11px;
}

.btn-apply {
  padding: 8px 16px;
  background-color: #667eea;
  border: none;
  border-radius: 4px;
  color: white;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
  width: 100%;
}

.btn-apply:hover:not(:disabled) {
  background-color: #5568d3;
}

.btn-apply:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.stats-section {
  background-color: white;
  padding: 12px;
  border-radius: 4px;
  margin-bottom: 16px;
}

.stats-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.btn-refresh-stats {
  padding: 4px 8px;
  background-color: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.btn-refresh-stats:hover:not(:disabled) {
  background-color: #e0e0e0;
  transform: rotate(180deg);
}

.btn-refresh-stats:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}

.stat-card {
  background-color: #f9f9f9;
  border: 1px solid #eee;
  border-radius: 4px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 11px;
  color: #999;
  font-weight: bold;
  text-transform: uppercase;
}

.stat-value {
  font-size: 14px;
  font-weight: bold;
  color: #333;
  display: flex;
  align-items: center;
  gap: 4px;
}

.status-badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: bold;
  color: white;
}

.status-badge.running {
  background-color: #27ae60;
}

.status-badge.stopped {
  background-color: #95a5a6;
}

.good {
  color: #27ae60;
}

.bad {
  color: #e74c3c;
}

.divider {
  color: #ccc;
}

.performance-card {
  grid-column: span 2;
}

.performance-badge {
  padding: 8px;
  border-radius: 4px;
  color: white;
  font-weight: bold;
  text-align: center;
}

.performance-level {
  font-size: 13px;
}

.performance-score {
  font-size: 11px;
  opacity: 0.8;
}

.performance-analysis {
  background-color: #f9f9f9;
  border-left: 3px solid #667eea;
  padding: 8px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: #555;
  white-space: pre-wrap;
  word-break: break-word;
}

.analysis-text.excellent {
  color: #27ae60;
  border-left-color: #27ae60;
}

.analysis-text.good {
  color: #f39c12;
  border-left-color: #f39c12;
}

.analysis-text.fair {
  color: #e67e22;
  border-left-color: #e67e22;
}

.analysis-text.poor {
  color: #e74c3c;
  border-left-color: #e74c3c;
}

.last-screenshot-info {
  text-align: center;
  color: #999;
  font-size: 11px;
  padding-top: 8px;
  border-top: 1px solid #eee;
}
</style>
