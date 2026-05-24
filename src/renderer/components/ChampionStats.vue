<template>
  <div class="stats-page">
    <!-- 页面头部导航 -->
    <nav class="stats-nav">
      <router-link to="/" class="back-link">
        <ChevronLeft class="nav-icon" />
        返回控制台
      </router-link>
      <span class="nav-title">英雄统计</span>
    </nav>

    <!-- 主内容区 -->
    <div class="stats-container">
      <!-- Loading State -->
      <div v-if="loading" class="loading-container">
        <div class="loading-card">
          <Skeleton class="skeleton-avatar" />
          <div class="skeleton-info">
            <Skeleton class="h-8 w-3/4" />
            <Skeleton class="h-6 w-1/2 mt-md" />
          </div>
        </div>
        <div class="loading-tabs">
          <Skeleton class="h-12 w-full" />
          <Skeleton class="h-64 w-full mt-lg" />
        </div>
      </div>

      <!-- Error State -->
      <Alert v-if="error" variant="destructive" class="error-alert">
        <AlertTitle>⚠️ 加载失败</AlertTitle>
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <!-- Main Content -->
      <template v-if="championData && !loading">
        <!-- Champion Header -->
        <ChampionStatsHeader
          :champion-id="championId"
          :stats="championData"
          class="champion-header-section"
        />

        <!-- Tabs for different data sections -->
        <div class="tabs-section">
          <Tabs v-model="activeTab" class="w-full">
            <TabsList class="tabs-list">
              <TabsTrigger value="augments" class="tab-trigger">
                <Crosshair class="tab-icon-svg" />
                海克斯增益
              </TabsTrigger>
              <TabsTrigger value="builds" class="tab-trigger">
                <Package class="tab-icon-svg" />
                装备出装
              </TabsTrigger>
            </TabsList>

            <TabsContent value="augments" class="tab-content">
              <AugmentsList
                :augments="augmentBase"
                :stats="augmentStats"
                :items="itemsData"
              />
            </TabsContent>

            <TabsContent value="builds" class="tab-content">
              <BuildCard
                :build-data="buildData"
                :items="itemsData"
              />
            </TabsContent>
          </Tabs>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import ChampionStatsHeader from './ChampionStatsHeader.vue'
import AugmentsList from './AugmentsList.vue'
import BuildCard from './BuildCard.vue'
import { electronAPI, hasElectronAPI } from '../native/electron-api.js'
import { ChevronLeft, Crosshair, Package } from 'lucide-vue-next'

const route = useRoute()
const championId = ref(route.params.id)
const loading = ref(true)
const error = ref(null)

const championData = ref(null)
const augmentBase = ref([])
const augmentStats = ref({})
const buildData = ref(null)
const itemsData = ref({})
const activeTab = ref('augments')

/**
 * Load all champion data via IPC
 */
const loadData = async () => {
  loading.value = true
  error.value = null

  try {
    // Check if ipcRenderer is available
    if (!hasElectronAPI()) {
      throw new Error('应用接口暂不可用，请等待应用完成加载。')
    }

    // Call IPC to load data in main process
    const result = await electronAPI.winrate.loadChampionData(championId.value)

    if (result.success) {
      const { stats, augments, augmentStats: augmentStatsData, build, items } = result.data
      championData.value = stats
      augmentBase.value = augments
      augmentStats.value = augmentStatsData
      buildData.value = build
      itemsData.value = items
    } else {
      error.value = `数据加载失败: ${result.error}`
      console.error('Failed to load champion data:', result.error)
    }
  } catch (err) {
    error.value = `数据加载失败: ${err.message}`
    console.error('Failed to load champion data:', err)
  } finally {
    loading.value = false
  }
}

// Watch for route param changes
watch(() => route.params.id, (newId) => {
  if (newId) {
    championId.value = newId
    loadData()
  }
})

onMounted(() => {
  // Wait for preload script to load
  const checkIpcReady = async () => {
    let attempts = 0
    const maxAttempts = 50 // 增加到5秒等待时间

    console.log('Checking IPC availability...')

    while (!hasElectronAPI() && attempts < maxAttempts) {
      console.log(`Attempt ${attempts + 1}: electronAPI unavailable`)
      await new Promise(resolve => setTimeout(resolve, 100))
      attempts++
    }

    if (hasElectronAPI()) {
      console.log('Electron API available, loading data...')
      loadData()
    } else {
      console.error('Electron API not available after all attempts')
      error.value = '应用未完全加载，请刷新页面重试。'
      loading.value = false
    }
  }

  checkIpcReady()
})
</script>

<style scoped>
.stats-page {
    min-height: 100vh;
    background:
        radial-gradient(circle at 85% 0%, rgba(200, 169, 106, 0.13), transparent 320px),
        linear-gradient(180deg, var(--lol-bg-2), var(--lol-bg));
    color: var(--lol-ivory);
}

.stats-nav {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 24px;
    background: rgba(7, 10, 13, 0.78);
    border-bottom: 1px solid var(--lol-border);
    backdrop-filter: blur(18px);
}

.back-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--lol-muted);
    text-decoration: none;
    font-size: 14px;
    transition: color 0.2s;
}

.back-link:hover {
    color: var(--lol-teal-2);
}

.nav-icon,
.tab-icon-svg {
    width: 16px;
    height: 16px;
}

.nav-title {
    color: var(--lol-ivory);
    font-size: 16px;
    font-weight: 800;
}

.stats-container {
    max-width: 1220px;
    margin: 0 auto;
    padding: 24px;
}

/* Loading State */
.loading-container {
    animation: fadeIn 0.3s ease-out;
}

.loading-card {
    display: flex;
    gap: 24px;
    background: var(--lol-panel);
    border: 1px solid var(--lol-border-soft);
    border-radius: 8px;
    padding: 24px;
    margin-bottom: 24px;
}

.skeleton-avatar {
    width: 120px;
    height: 160px;
    border-radius: 8px;
    flex-shrink: 0;
}

.skeleton-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
}

.loading-tabs {
    background: var(--lol-panel);
    border: 1px solid var(--lol-border-soft);
    border-radius: 8px;
    padding: 24px;
}

/* Error Alert */
.error-alert {
    background: rgba(229, 83, 75, 0.1);
    border: 1px solid rgba(229, 83, 75, 0.28);
    border-radius: 8px;
    margin-bottom: 24px;
}

/* Champion Header */
.champion-header-section {
    margin-bottom: 24px;
    animation: slideUp 0.4s ease-out;
}

/* Tabs Section */
.tabs-section {
    background: var(--lol-panel);
    border-radius: 8px;
    padding: 18px;
    border: 1px solid var(--lol-border-soft);
    box-shadow: var(--lol-shadow);
    animation: slideUp 0.5s ease-out;
}

.tabs-list {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    background: rgba(7, 10, 13, 0.45);
    padding: 4px;
    border-radius: 8px;
    border: 1px solid var(--lol-border-soft);
}

.tab-trigger {
    display: inline-flex;
    gap: 8px;
    padding: 12px 16px;
    font-size: 14px;
    font-weight: 800;
    color: var(--lol-muted);
    transition: all 0.2s;
}

.tab-trigger:hover {
    color: var(--lol-ivory);
}

.tab-content {
    margin-top: 20px;
    animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

@keyframes slideUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

/* Responsive */
@media (max-width: 768px) {
    .stats-container {
        padding: 16px;
    }

    .loading-card {
        flex-direction: column;
        align-items: center;
    }

    .skeleton-info {
        width: 100%;
    }
}
</style>
