<template>
  <div class="champion-stats">
    <!-- Loading State -->
    <el-skeleton v-if="loading" :rows="10" animated />

    <!-- Error State -->
    <el-alert v-if="error" type="error" :title="error" show-icon />

    <!-- Main Content -->
    <template v-if="championData">
      <!-- Champion Header -->
      <ChampionStatsHeader
        :champion-id="championId"
        :stats="championData"
      />

      <!-- Tabs for different data sections -->
      <el-tabs v-model="activeTab" class="stats-tabs">
        <el-tab-pane label="海克斯增益" name="augments">
          <AugmentsList
            :augments="augmentBase"
            :stats="augmentStats"
            :items="itemsData"
          />
        </el-tab-pane>

        <el-tab-pane label="装备Build" name="builds">
          <BuildCard
            :build-data="buildData"
            :items="itemsData"
          />
        </el-tab-pane>
      </el-tabs>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElSkeleton, ElAlert, ElTabs, ElTabPane } from 'element-plus'
import {
  loadChampionStats,
  loadAugmentBase,
  loadChampionAugments,
  loadChampionBuild,
  loadItems
} from '../src/service/champion-stats'
import ChampionStatsHeader from './ChampionStatsHeader.vue'
import AugmentsList from './AugmentsList.vue'
import BuildCard from './BuildCard.vue'

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
 * Load all champion data
 */
const loadData = async () => {
  loading.value = true
  error.value = null

  try {
    // Load all data in parallel
    const [stats, augments, augmentStatsData, build, items] = await Promise.all([
      Promise.resolve(loadChampionStats(championId.value)),
      Promise.resolve(loadAugmentBase()),
      Promise.resolve(loadChampionAugments(championId.value)),
      Promise.resolve(loadChampionBuild(championId.value)),
      Promise.resolve(loadItems())
    ])

    championData.value = stats
    augmentBase.value = augments
    augmentStats.value = augmentStatsData
    buildData.value = build
    itemsData.value = items
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
  loadData()
})
</script>

<style scoped>
.champion-stats {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

.stats-tabs {
  margin-top: 20px;
}

/* Responsive design */
@media (max-width: 768px) {
  .champion-stats {
    padding: 10px;
  }
}
</style>
