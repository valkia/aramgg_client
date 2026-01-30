<template>
  <div class="max-w-7xl mx-auto p-lg md:p-xl">
    <!-- Loading State -->
    <div v-if="loading" class="space-y-md">
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-8 w-3/4" />
      <Skeleton class="h-8 w-1/2" />
      <Skeleton class="h-64 w-full" />
    </div>

    <!-- Error State -->
    <Alert v-if="error" variant="destructive" class="mb-lg">
      <AlertTitle>错误</AlertTitle>
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <!-- Main Content -->
    <template v-if="championData && !loading">
      <!-- Champion Header -->
      <ChampionStatsHeader
        :champion-id="championId"
        :stats="championData"
        class="mb-xl"
      />

      <!-- Tabs for different data sections -->
      <Tabs v-model="activeTab" class="w-full">
        <TabsList class="grid w-full grid-cols-2">
          <TabsTrigger value="augments">海克斯增益</TabsTrigger>
          <TabsTrigger value="builds">装备Build</TabsTrigger>
        </TabsList>

        <TabsContent value="augments" class="mt-lg">
          <AugmentsList
            :augments="augmentBase"
            :stats="augmentStats"
            :items="itemsData"
          />
        </TabsContent>

        <TabsContent value="builds" class="mt-lg">
          <BuildCard
            :build-data="buildData"
            :items="itemsData"
          />
        </TabsContent>
      </Tabs>
    </template>
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
    // Call IPC to load data in main process
    const result = await window.ipcRenderer.invoke('load-champion-data', championId.value)

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
  loadData()
})
</script>

<style scoped>
/* Responsive design */
@media (max-width: 768px) {
  .max-w-7xl {
    @apply p-md;
  }
}
</style>
