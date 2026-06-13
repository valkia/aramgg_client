<template>
  <transition name="overlay-fade">
    <div
      v-if="visible"
      class="augment-overlay"
      :class="{ 'side-panel-mode': isSidePanel }"
    >
      <header class="insight-titlebar">
        <h1>{{ isSidePanel ? '海克斯推荐' : '英雄详情' }}</h1>
        <div class="window-controls">
          <button class="window-control" type="button" aria-label="最小化" @click="closeOverlay">
            <Minus class="window-icon" />
          </button>
          <button class="window-control danger" type="button" aria-label="关闭" @click="closeOverlay">
            <X class="window-icon" />
          </button>
        </div>
      </header>

      <!-- 加载状态 -->
      <div v-if="loading && !contentVisible" class="loading-state">
        <div class="spinner"></div>
        <p>加载英雄数据中...</p>
      </div>

      <!-- 错误状态 -->
      <div v-else-if="error" class="error-state">
        <p>{{ error }}</p>
      </div>

      <!-- 主内容区 -->
      <div v-else-if="contentVisible" class="overlay-content">
        <transition name="item-set-toast">
          <div
            v-if="itemSetToast.message"
            class="item-set-toast"
            :class="itemSetToast.type"
          >
            <PackageCheck v-if="itemSetToast.type === 'success'" class="item-set-toast-icon" />
            {{ itemSetToast.message }}
          </div>
        </transition>

        <div class="insight-scroll">
          <section v-if="!isSidePanel" class="bench-inline">
            <AramBenchRecommendation
              compact
              :preview-recommendation="benchPreviewRecommendation"
            />
          </section>

          <section v-if="!isSidePanel" class="champion-hero">
            <img
              v-if="championId"
              :src="getChampionIconUrl(championId)"
              :alt="championName"
              class="hero-image"
              @error="handleImageError"
            />
            <div v-else class="hero-placeholder">--</div>
            <div class="hero-shade"></div>
            <div class="hero-content">
              <div class="champion-identity">
                <div v-if="championId" class="hero-avatar">
                  <img
                    :src="getChampionSquareIconUrl(championId)"
                    :alt="championName"
                    @error="handleImageError"
                  />
                </div>
                <h2 class="champion-name">{{ championName || (championId ? `英雄 ${championId}` : '等待英雄选择') }}</h2>
              </div>
              <div class="hero-badges">
                <button
                  v-if="championBlogUrl"
                  class="blog-link-badge"
                  type="button"
                  title="打开英雄攻略"
                  @click="openChampionBlog(championBlogUrl)"
                >
                  <ExternalLink class="blog-link-icon" />
                  攻略
                </button>
                <span class="tier-badge">梯队 {{ championStats?.tier || '-' }}</span>
                <span class="winrate-badge" :class="getWinRateClass(championStats?.winRate)">
                  胜率 {{ formatPercent(championStats?.winRate) }}
                </span>
              </div>
            </div>
          </section>

          <section v-if="!isSidePanel" class="stat-strip">
            <div class="stat-box">
              <span>胜率</span>
              <strong :class="getWinRateClass(championStats?.winRate)">
                {{ championDataLoading ? '读取中' : formatPercent(championStats?.winRate) }}
              </strong>
            </div>
            <div class="stat-box">
              <span>选取率</span>
              <strong>{{ championDataLoading ? '读取中' : formatPercent(championStats?.pickRate) }}</strong>
            </div>
            <div class="stat-box">
              <span>场次</span>
              <strong>{{ championDataLoading ? '读取中' : formatNumber(championStats?.numGames) }}</strong>
            </div>
          </section>

          <section v-if="!isSidePanel && championBlogs.length" class="related-blogs">
            <div class="section-title-row compact">
              <h3>相关攻略</h3>
              <span>{{ championBlogs.length }} 篇</span>
            </div>
            <button
              v-for="blog in championBlogs"
              :key="blog.url"
              class="related-blog-link"
              type="button"
              @click="openChampionBlog(blog.url)"
            >
              <span>{{ blog.title }}</span>
              <ExternalLink class="related-blog-icon" />
            </button>
          </section>

          <!-- Tab 切换 -->
          <div class="tabs-container">
            <div class="tabs-list">
              <button
                v-for="tab in tabs"
                :key="tab.key"
                class="tab-btn"
                :class="{ active: activeTab === tab.key }"
                @click="setActiveTab(tab.key)"
              >
                <span class="tab-text">{{ tab.label }}</span>
              </button>
            </div>

            <!-- Tab 内容 -->
            <div class="tab-content">
              <!-- 海克斯 Tab -->
              <div v-if="activeTab === 'augments'" class="tab-panel">
                <div class="section-title-row">
                  <h3>核心海克斯</h3>
                  <span>{{ filteredAugments.length }} 项</span>
                </div>

                <div class="filter-bar">
                <button
                  v-for="rarity in rarityOptions"
                  :key="rarity.key"
                  class="filter-chip"
                  :class="{ active: selectedRarity === rarity.key, [rarity.key]: true }"
                  @click="selectRarity(rarity.key)"
                >
                  {{ rarity.label }}
                </button>
              </div>

              <div v-if="filteredAugments.length > 0" class="augments-list">
                <div
                  v-for="(augment, index) in filteredAugments"
                  :key="augment.augmentId || augment.id || index"
                  class="augment-card"
                  :class="`rarity-${augment.rarity}`"
                >
                  <div
                    class="augment-icon-wrapper"
                    tabindex="0"
                    :aria-label="`${augment.name}说明`"
                    @mouseenter="showAugmentTooltip($event, augment)"
                    @mousemove="moveAugmentTooltip($event)"
                    @mouseleave="hideAugmentTooltip"
                    @focus="showAugmentTooltip($event, augment)"
                    @blur="hideAugmentTooltip"
                  >
                    <img
                      v-if="augment.iconPath"
                      :src="getAugmentIconUrl(augment.iconPath)"
                      :alt="augment.name"
                      class="augment-icon"
                    />
                    <span v-else>{{ index + 1 }}</span>
                  </div>
                  <div class="augment-main">
                    <div class="augment-name">{{ augment.name }}</div>
                  </div>
                  <div class="augment-rate">
                    <strong>{{ formatPercent(augment.winRate) }}</strong>
                  </div>
                </div>
              </div>
              <div v-else class="empty-state">
                <p>暂无海克斯数据</p>
              </div>
            </div>

            <!-- 出装 Tab -->
            <div v-if="activeTab === 'builds'" class="tab-panel">
              <div class="section-title-row">
                <h3>出装路线</h3>
                <span>{{ buildRoutes.length ? `${buildRoutes.length} 套` : '' }}</span>
              </div>

              <div v-if="hasBuildRecommendations" class="build-content">
                <div v-if="buildRoutes.length > 1" class="build-route-tabs">
                  <button
                    v-for="(route, idx) in buildRoutes"
                    :key="`${route.key}-tab`"
                    type="button"
                    class="build-route-tab"
                    :class="{ active: selectedBuildRoute?.key === route.key }"
                    @click="selectBuildRoute(idx)"
                  >
                    <span>{{ route.title }}</span>
                    <small>{{ formatPercent(route.winRate) }} · {{ formatNumber(route.games) }} 场</small>
                  </button>
                </div>

                <article
                  v-if="selectedBuildRoute"
                  :key="selectedBuildRoute.key"
                  class="build-route"
                >
                  <header class="build-route-header">
                    <div class="build-route-title">
                      <h4>{{ selectedBuildRoute.title }}</h4>
                      <small v-if="selectedBuildRoute.subtitle">{{ selectedBuildRoute.subtitle }}</small>
                    </div>
                    <div class="build-route-stats">
                      <strong>{{ formatPercent(selectedBuildRoute.winRate) }}</strong>
                      <small>{{ formatNumber(selectedBuildRoute.games) }} 场</small>
                    </div>
                  </header>

                  <section v-if="selectedBuildRoute.startingItems.length > 0" class="item-section starter-section">
                    <h4>出门装</h4>
                    <div class="starter-list">
                      <div
                        v-for="(build, idx) in selectedBuildRoute.startingItems.slice(0, 2)"
                        :key="`${selectedBuildRoute.key}-starter-${idx}`"
                        class="starter-row"
                      >
                        <div class="item-icons">
                          <img
                            v-for="itemId in build.items"
                            :key="itemId"
                            :src="getItemIconUrl(itemId)"
                            class="item-icon small"
                            :alt="getItemName(itemId)"
                          />
                        </div>
                        <span>{{ formatPercent(build.winRate) }}</span>
                      </div>
                    </div>
                  </section>

                  <div v-if="selectedBuildRoute.coreItems.length > 0" class="build-grid">
                    <div
                      v-for="(build, idx) in selectedBuildRoute.coreItems.slice(0, 4)"
                      :key="`${selectedBuildRoute.key}-core-${idx}`"
                      class="build-tile"
                    >
                      <div class="build-tile-label">核心 {{ idx + 1 }}</div>
                      <div class="item-icons">
                        <img
                          v-for="itemId in build.items.slice(0, 6)"
                          :key="itemId"
                          :src="getItemIconUrl(itemId)"
                          class="item-icon"
                          :alt="getItemName(itemId)"
                        />
                      </div>
                      <div class="build-stats">
                        <span>{{ formatPercent(build.winRate) }}</span>
                        <small>{{ formatNumber(build.games) }} 场</small>
                      </div>
                    </div>
                  </div>

                  <section v-if="selectedBuildRoute.itemExtensions.length > 0" class="item-section">
                    <h4>后续装备</h4>
                    <div class="situational-grid">
                      <img
                        v-for="item in selectedBuildRoute.itemExtensions.slice(0, 12)"
                        :key="`${selectedBuildRoute.key}-next-${item.itemId}`"
                        :src="getItemIconUrl(item.itemId)"
                        class="item-icon small"
                        :alt="getItemName(item.itemId)"
                      />
                    </div>
                  </section>

                  <section v-if="selectedBuildRoute.situationalItems.length > 0" class="item-section">
                    <h4>备选装备</h4>
                    <div class="situational-grid">
                      <img
                        v-for="item in selectedBuildRoute.situationalItems.slice(0, 12)"
                        :key="`${selectedBuildRoute.key}-situational-${item.itemId}`"
                        :src="getItemIconUrl(item.itemId)"
                        class="item-icon small"
                        :alt="getItemName(item.itemId)"
                      />
                    </div>
                  </section>
                </article>
              </div>
              <div v-else class="empty-state">
                <p>暂无出装数据</p>
              </div>
            </div>
          </div>
        </div>

          <div class="overlay-footer">
            <small>来源：{{ formatDataSource(dataSource) }}</small>
            <small v-if="timestamp">更新于 {{ formatTime(timestamp) }}</small>
          </div>
        </div>

        <div v-if="!isSidePanel && championId" class="item-set-actions">
          <button
            class="item-set-btn"
            type="button"
            :disabled="itemSetApplying || !hasBuildRecommendations"
            @click="configureCurrentChampionItems(false)"
          >
            <PackagePlus class="item-set-icon" />
            {{ itemSetButtonLabel }}
          </button>
        </div>

        <div
          v-if="augmentTooltipDetail"
          class="augment-tooltip"
          role="tooltip"
          :style="augmentTooltipStyle"
        >
          <div class="augment-tooltip-header">
            <img
              v-if="augmentTooltipDetail.iconUrl"
              :src="augmentTooltipDetail.iconUrl"
              :alt="augmentTooltipDetail.name"
            />
            <div>
              <strong>{{ augmentTooltipDetail.name }}</strong>
              <span v-if="augmentTooltipDetail.rarityLabel">{{ augmentTooltipDetail.rarityLabel }}</span>
            </div>
          </div>
          <p v-if="augmentTooltipDetail.description">{{ augmentTooltipDetail.description }}</p>
          <p v-else>暂无说明</p>
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
import { ExternalLink, Minus, PackageCheck, PackagePlus, X } from 'lucide-vue-next'
import { getChampionIconUrl, getChampionSquareIconUrl, getAugmentIconUrl, getItemIconUrl as getFallbackItemIconUrl } from '../service/cdn'
import { electronAPI } from '../native/electron-api.js'
import { sortAugmentsByDetectedOrder } from '../service/augment-order.js'
import AramBenchRecommendation from './AramBenchRecommendation.vue'

const props = defineProps({
  variant: {
    type: String,
    default: 'popup',
  },
})

const visible = ref(false)
const loading = ref(false)
const championDataLoading = ref(false)
const error = ref(null)
const championId = ref(null)
const championName = ref('')
const championNameData = ref(null)
const activeTab = ref('augments')
const selectedBuildRouteIndex = ref(0)
const selectedRarity = ref('all')
const dataSource = ref('local')
const timestamp = ref(null)
const champSelectMode = ref(false)

// 英雄数据
const championStats = ref(null)
const augmentBase = ref([])
const augmentStats = ref({})
const buildData = ref(null)
const itemsData = ref({})
const championLinks = ref({})
const displayAugments = ref([])
const benchPreviewRecommendation = ref(null)
const unsubscribeEvents = []
const itemSetApplying = ref(false)
const itemSetAutoEnabled = ref(true)
const hideChampionInsightOnGameStart = ref(true)
const itemSetToast = ref({ type: '', message: '' })
const augmentTooltip = ref({ visible: false, augment: null, x: 0, y: 0 })
const ITEM_SET_AUTO_KEY = 'itemSets.autoApplyAram'
const HIDE_CHAMPION_INSIGHT_ON_GAME_START_KEY = 'championInsight.hideOnGameStart'
const CHAMPION_DATA_CACHE_TTL_MS = 15000
const MAX_ITEM_SET_BUILDS = 4
let itemSetToastTimer = null
let championLoadSequence = 0
let championDataRequest = null
let championDataCache = null

const contentVisible = computed(() => champSelectMode.value || !!championId.value || !!championStats.value)
const isSidePanel = computed(() => props.variant === 'side-panel')
const itemSetButtonLabel = computed(() => {
  if (itemSetApplying.value) {
    return '配置中'
  }

  if (!hasBuildRecommendations.value) {
    return '等待出装数据'
  }

  const count = Math.min(buildRoutes.value.length, MAX_ITEM_SET_BUILDS)
  const target = count > 1 ? `${count} 套装备` : '当前英雄装备'

  return itemSetAutoEnabled.value ? `重新配置 ${target}` : `配置 ${target}`
})

const championBlogUrl = computed(() => {
  return championBlogs.value[0]?.url || null
})

const normalizeBlogRecords = (records = []) => {
  if (!Array.isArray(records)) {
    return []
  }

  const seen = new Set()
  return records
    .map(record => {
      const url = typeof record === 'string' ? record : record?.url || record?.href || record?.link
      if (!url || seen.has(url)) {
        return null
      }

      seen.add(url)
      return {
        title: String(record?.title || record?.name || record?.label || '英雄攻略').trim() || '英雄攻略',
        url,
      }
    })
    .filter(Boolean)
}

const championBlogs = computed(() => {
  return [
    ...normalizeBlogRecords(championLinks.value?.relatedBlogs),
    ...normalizeBlogRecords(championStats.value?.relatedBlogs),
    ...normalizeBlogRecords(championNameData.value?.relatedBlogs),
  ].filter((blog, index, blogs) => blogs.findIndex(item => item.url === blog.url) === index)
})

const logOverlayInfo = (message, details = {}) => {
  console.info(`[AugmentWinrateOverlay] ${message}`, details)

  try {
    electronAPI.diagnostics.logRendererInfo({
      type: 'augment-overlay',
      source: 'AugmentWinrateOverlay',
      message,
      details,
      timestamp: Date.now(),
      url: window.location.href,
    })
  } catch (err) {
    console.warn('Failed to send overlay diagnostic log:', err)
  }
}

const loadItemSetAutoPreference = async () => {
  try {
    const storedValue = await electronAPI.store.get(ITEM_SET_AUTO_KEY)
    if (storedValue == null) {
      await electronAPI.store.set(ITEM_SET_AUTO_KEY, true)
      itemSetAutoEnabled.value = true
      return
    }

    itemSetAutoEnabled.value = Boolean(storedValue)
  } catch (err) {
    console.warn('Failed to load item set preference:', err)
  }
}

const loadChampionInsightPreference = async () => {
  try {
    const storedValue = await electronAPI.store.get(HIDE_CHAMPION_INSIGHT_ON_GAME_START_KEY)
    if (storedValue == null) {
      await electronAPI.store.set(HIDE_CHAMPION_INSIGHT_ON_GAME_START_KEY, true)
      hideChampionInsightOnGameStart.value = true
      return
    }

    hideChampionInsightOnGameStart.value = Boolean(storedValue)
  } catch (err) {
    console.warn('Failed to load champion insight preference:', err)
  }
}

const loadChampionDataOnce = async (requestedChampionId) => {
  const now = Date.now()
  if (
    championDataCache?.championId === requestedChampionId &&
    now - championDataCache.loadedAt < CHAMPION_DATA_CACHE_TTL_MS
  ) {
    return {
      result: championDataCache.result,
      source: 'cache',
    }
  }

  if (championDataRequest?.championId === requestedChampionId) {
    return {
      result: await championDataRequest.promise,
      source: 'in-flight',
    }
  }

  const promise = electronAPI.winrate.loadChampionData(requestedChampionId)
    .then((result) => {
      if (result?.success) {
        championDataCache = {
          championId: requestedChampionId,
          loadedAt: Date.now(),
          result,
        }
      }

      return result
    })

  championDataRequest = {
    championId: requestedChampionId,
    promise,
  }

  try {
    return {
      result: await promise,
      source: 'ipc',
    }
  } finally {
    if (championDataRequest?.promise === promise) {
      championDataRequest = null
    }
  }
}

const showItemSetToast = (type, message) => {
  itemSetToast.value = { type, message }

  if (itemSetToastTimer) {
    clearTimeout(itemSetToastTimer)
  }

  itemSetToastTimer = setTimeout(() => {
    itemSetToast.value = { type: '', message: '' }
    itemSetToastTimer = null
  }, 2600)
}

const formatItemSetSuccessMessage = (automatic, result = {}) => {
  const count = Number(result?.writtenItemSetCount)
  if (Number.isFinite(count) && count > 0) {
    return automatic ? `已自动写入 ${count} 套游戏推荐` : `已写入 ${count} 套游戏推荐`
  }

  return automatic ? '已自动写入游戏推荐' : '已写入游戏推荐'
}

const configureCurrentChampionItems = async (automatic = false) => {
  if (!championId.value || itemSetApplying.value || !hasBuildRecommendations.value) {
    return
  }

  itemSetApplying.value = true
  showItemSetToast('loading', automatic ? '正在自动配置装备...' : '正在配置装备...')

  try {
    const result = await electronAPI.itemSets.installAramChampion({
      championId: championId.value,
      builds: buildRoutes.value.map(route => route.rawBuild).slice(0, MAX_ITEM_SET_BUILDS),
      championName: championNameData.value || { nameCN: championName.value },
    })
    if (!result?.success) {
      throw new Error(result?.error || '装备配置失败')
    }

    showItemSetToast('success', formatItemSetSuccessMessage(automatic, result))
  } catch (err) {
    showItemSetToast('error', err?.message || '装备配置失败')
  } finally {
    itemSetApplying.value = false
  }
}

// Tabs 配置
const tabs = [
  { key: 'augments', label: '海克斯', icon: '海' },
  { key: 'builds', label: '出装', icon: '装' }
]

// 稀有度选项
const rarityOptions = [
  { key: 'all', label: '全部' },
  { key: 'kSilver', label: '白银' },
  { key: 'kGold', label: '金色' },
  { key: 'kPrismatic', label: '棱彩' }
]

const setActiveTab = (key) => {
  activeTab.value = key
  hideAugmentTooltip()
}

const selectRarity = (key) => {
  selectedRarity.value = key
  hideAugmentTooltip()
}

const mapIncomingAugmentsForFallback = (augments = []) => augments.map(aug => ({
  augmentId: aug.augmentId || aug.id,
  id: aug.id || aug.augmentId,
  name: aug.name || '未知海克斯',
  rarity: aug.rarity || 'unknown',
  rarityName: aug.rarityName || null,
  rarityDisplayName: aug.rarityDisplayName || null,
  winRate: aug.winRate ?? null,
  pickRate: aug.pickRate ?? null,
  playCount: aug.playCount ?? 0,
  recommendScore: aug.recommendScore ?? null,
  iconPath: aug.iconPath || aug.iconUrl || null,
  description: aug.description || null,
  tooltip: aug.tooltip || null,
}))

const mapChampionAugmentRows = (augments = [], statsById = {}) => {
  return augments
    .map(augment => {
      const augmentId = augment.id || augment.augmentId
      const stats = statsById[String(augmentId)]
      if (!augmentId || !stats) {
        return null
      }

      const winRate = Number(stats.win_rate) || 0
      const pickRate = Number(stats.pick_rate) || 0
      const games = Number(stats.num_games) || 0

      return {
        ...augment,
        id: augmentId,
        augmentId,
        winRate,
        pickRate,
        playCount: games,
        winCount: Number(stats.num_win_games) || 0,
        recommendScore: winRate * 0.6 + pickRate * 0.2 + Math.min(games / 1000, 1) * 0.2,
        iconPath: augment.iconPath || augment.iconUrl || null,
        description: augment.description || null,
        tooltip: augment.tooltip || null,
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.recommendScore - a.recommendScore)
}

const applyFallbackChampionData = (data) => {
  championStats.value = {
    championId: String(data?.championId || championId.value || ''),
    id: data?.championId || championId.value || null,
    tier: null,
    winRate: null,
    pickRate: null,
    numGames: null
  }
  augmentBase.value = []
  augmentStats.value = {}
  buildData.value = null
  itemsData.value = {}
  championLinks.value = data?.championLinks || {
    relatedBlogs: data?.relatedBlogs || [],
  }
  displayAugments.value = mapIncomingAugmentsForFallback(data?.augments || [])
  dataSource.value = data?.dataSource || '不可用'
  timestamp.value = data?.timestamp || Date.now()
  error.value = null
}

// 过滤海克斯
const filteredAugments = computed(() => {
  if (selectedRarity.value === 'all') {
    return displayAugments.value
  }
  return displayAugments.value.filter(a => a.rarity === selectedRarity.value)
})

const toFiniteNumber = (value, fallback = 0) => {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

const normalizeRateValue = (value) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null
  }

  return numberValue > 1 ? numberValue / 100 : numberValue
}

const normalizeItemIds = (itemIds) => {
  if (Array.isArray(itemIds)) {
    return itemIds.map(id => String(id).trim()).filter(Boolean)
  }

  if (itemIds != null && itemIds !== '') {
    return [String(itemIds).trim()].filter(Boolean)
  }

  return []
}

const getRecordItemIds = (record = {}) => normalizeItemIds(
  record.itemIds ?? record.items ?? record.itemId ?? record.id
)

const normalizeBuildRecord = (record = {}) => {
  const stats = record.stats || {}
  const items = getRecordItemIds(record)
  const games = toFiniteNumber(record.games ?? record.num_games ?? stats.games ?? stats.num_games)
  const wins = toFiniteNumber(record.wins ?? record.num_win_games ?? stats.wins ?? stats.num_win_games)
  const winRate = normalizeRateValue(record.winRate ?? record.win_rate ?? stats.winRate ?? stats.win_rate)
    ?? (games > 0 ? wins / games : null)

  return {
    ...record,
    items,
    itemId: items[0] || '',
    games,
    wins,
    pickRate: normalizeRateValue(record.pickRate ?? record.pick_rate ?? stats.pickRate ?? stats.pick_rate) ?? 0,
    winRate,
    distinctiveScore: toFiniteNumber(record.distinctiveScore ?? record.distinctive_score),
  }
}

const compareBuildRecords = (left, right) => {
  const gamesDiff = toFiniteNumber(right.games) - toFiniteNumber(left.games)
  if (gamesDiff !== 0) {
    return gamesDiff
  }

  const pickDiff = toFiniteNumber(right.pickRate) - toFiniteNumber(left.pickRate)
  if (pickDiff !== 0) {
    return pickDiff
  }

  return toFiniteNumber(right.winRate) - toFiniteNumber(left.winRate)
}

const normalizeBuildRecords = (records = [], singleItem = false) => {
  if (!Array.isArray(records)) {
    return []
  }

  return records
    .map(normalizeBuildRecord)
    .filter(record => singleItem ? record.itemId : record.items.length > 0)
    .sort(compareBuildRecords)
}

const getBuildTags = (build = {}) => {
  const rawTagValues = build.tags && typeof build.tags === 'object'
    ? Object.values(build.tags)
    : []
  const values = [
    build.buildTags,
    ...rawTagValues,
  ]
  const seen = new Set()

  return values
    .flatMap(value => String(value || '').split(','))
    .map(value => value.trim())
    .filter(value => {
      if (!value) {
        return false
      }

      const key = value.toLowerCase()
      if (seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    })
}

const getBuildTitle = (build, index) => {
  const tags = getBuildTags(build)
  if (tags.length) {
    return tags.join(' / ')
  }

  return build?.tier || build?.role || `路线 ${index + 1}`
}

const collectBuildRoutes = (build) => {
  if (!build || (typeof build !== 'object' && !Array.isArray(build))) {
    return []
  }

  const builds = Array.isArray(build)
    ? build
    : Array.isArray(build.builds)
      ? build.builds
      : []
  const seen = new Set()

  return builds
    .filter(route => route && typeof route === 'object' && !Array.isArray(route))
    .filter((route) => {
      const coreKey = Array.isArray(route.coreItems)
        ? route.coreItems
          .slice(0, 3)
          .map(record => getRecordItemIds(record).join('-'))
          .join('|')
        : ''
      const key = `${getBuildTags(route).join('|')}:${coreKey}:${route.role || ''}:${route.tier || ''}`
      if (seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    })
}

const getBuildStats = (build = {}) => {
  const stats = build.stats || {}
  return {
    games: toFiniteNumber(build.games ?? stats.games ?? stats.num_games),
    winRate: normalizeRateValue(build.winRate ?? build.win_rate ?? stats.winRate ?? stats.win_rate),
    pickRate: normalizeRateValue(build.pickRate ?? build.pick_rate ?? stats.pickRate ?? stats.pick_rate),
  }
}

const buildRoutes = computed(() => collectBuildRoutes(buildData.value)
  .map((build, index) => {
    const stats = getBuildStats(build)
    const startingItems = normalizeBuildRecords(build.startingItems || [])
    const coreItems = normalizeBuildRecords(build.coreItems || build.recommended || [])
    const itemExtensions = normalizeBuildRecords(build.itemExtensions || [], true)
    const situationalItems = normalizeBuildRecords(build.situationalItems || [], true)
      .sort((left, right) => {
        const scoreDiff = toFiniteNumber(right.distinctiveScore) - toFiniteNumber(left.distinctiveScore)
        return scoreDiff !== 0 ? scoreDiff : compareBuildRecords(left, right)
      })
    const hasAnyItems = startingItems.length > 0 ||
      coreItems.length > 0 ||
      itemExtensions.length > 0 ||
      situationalItems.length > 0

    return {
      key: `${index}-${getBuildTitle(build, index)}`,
      rawBuild: build,
      title: getBuildTitle(build, index),
      subtitle: build.patch ? `版本 ${build.patch}` : '',
      winRate: stats.winRate,
      pickRate: stats.pickRate,
      games: stats.games,
      startingItems,
      coreItems,
      itemExtensions,
      situationalItems,
      hasAnyItems,
    }
  })
  .filter(route => route.hasAnyItems))

const hasBuildRecommendations = computed(() => buildRoutes.value.length > 0)

const selectedBuildRoute = computed(() => {
  if (!buildRoutes.value.length) {
    return null
  }

  const index = Math.min(
    Math.max(Number(selectedBuildRouteIndex.value) || 0, 0),
    buildRoutes.value.length - 1,
  )

  return buildRoutes.value[index] || buildRoutes.value[0] || null
})

const selectBuildRoute = (index) => {
  selectedBuildRouteIndex.value = index
  hideAugmentTooltip()
}

const getLocalizedText = (value) => {
  if (typeof value === 'string') {
    return value
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  return value.zh_CN || value.zh_cn || value.en_us || value.en_US || ''
}

const normalizeTooltipText = (value) => {
  const raw = getLocalizedText(value)
  if (!raw) {
    return ''
  }

  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

const itemNameById = computed(() => {
  const records = Array.isArray(itemsData.value)
    ? itemsData.value
    : Object.values(itemsData.value || {})
  const map = new Map()

  records.forEach(item => {
    const id = String(item?.id ?? item?.itemId ?? '')
    if (!id) {
      return
    }

    const name = getLocalizedText(item.name)
    map.set(id, name || `装备 ${id}`)
  })

  return map
})

const itemIconById = computed(() => {
  const records = Array.isArray(itemsData.value)
    ? itemsData.value
    : Object.values(itemsData.value || {})
  const map = new Map()

  records.forEach(item => {
    const id = String(item?.id ?? item?.itemId ?? '')
    const iconUrl = item?.iconUrl || item?.iconPath || item?.image?.full || ''
    if (id && /^https?:\/\//i.test(String(iconUrl))) {
      map.set(id, iconUrl)
    }
  })

  return map
})

const getItemName = (itemId) => itemNameById.value.get(String(itemId)) || `装备 ${itemId}`
const getItemIconUrl = (itemId) => itemIconById.value.get(String(itemId)) || getFallbackItemIconUrl(itemId)

const getTooltipPoint = (event) => {
  const clientX = Number(event?.clientX)
  const clientY = Number(event?.clientY)
  if (event?.type !== 'focus' && Number.isFinite(clientX) && Number.isFinite(clientY)) {
    return { x: clientX, y: clientY }
  }

  const rect = event?.currentTarget?.getBoundingClientRect?.()
  if (rect) {
    return { x: rect.right, y: rect.top }
  }

  return { x: 0, y: 0 }
}

const getAugmentTooltipText = (augment = {}) => {
  return normalizeTooltipText(augment.description) ||
    normalizeTooltipText(augment.tooltip) ||
    normalizeTooltipText(augment.shortDesc) ||
    normalizeTooltipText(augment.shortDescription)
}

const getAugmentRarityLabel = (augment = {}) => {
  return augment.rarityDisplayName ||
    augment.rarityName ||
    rarityOptions.find(option => option.key === augment.rarity)?.label ||
    ''
}

const augmentTooltipDetail = computed(() => {
  if (!augmentTooltip.value.visible || !augmentTooltip.value.augment) {
    return null
  }

  const augment = augmentTooltip.value.augment
  const iconPath = augment.iconPath || augment.iconUrl || ''

  return {
    id: augment.augmentId || augment.id || '',
    name: augment.name || '未知海克斯',
    rarityLabel: getAugmentRarityLabel(augment),
    iconUrl: iconPath ? getAugmentIconUrl(iconPath) : '',
    description: getAugmentTooltipText(augment),
  }
})

const augmentTooltipStyle = computed(() => {
  const width = 300
  const estimatedHeight = 220
  const margin = 12
  const offset = 14
  let left = augmentTooltip.value.x + offset
  let top = augmentTooltip.value.y + offset

  if (typeof window !== 'undefined') {
    if (left + width > window.innerWidth - margin) {
      left = augmentTooltip.value.x - width - offset
    }

    if (top + estimatedHeight > window.innerHeight - margin) {
      top = window.innerHeight - estimatedHeight - margin
    }
  }

  return {
    left: `${Math.max(margin, left)}px`,
    top: `${Math.max(margin, top)}px`,
  }
})

const showAugmentTooltip = (event, augment) => {
  const point = getTooltipPoint(event)
  augmentTooltip.value = {
    visible: true,
    augment,
    x: point.x,
    y: point.y,
  }
}

const moveAugmentTooltip = (event) => {
  if (!augmentTooltip.value.visible) {
    return
  }

  const point = getTooltipPoint(event)
  augmentTooltip.value = {
    ...augmentTooltip.value,
    x: point.x,
    y: point.y,
  }
}

const hideAugmentTooltip = () => {
  augmentTooltip.value = {
    ...augmentTooltip.value,
    visible: false,
  }
}

/**
 * 显示浮窗
 */
const showOverlay = async (data) => {
  const startedAt = Date.now()
  const loadSequence = ++championLoadSequence
  logOverlayInfo('showOverlay called', {
    pending: data?.pending === true,
    championId: data?.championId || null,
    augmentCount: Array.isArray(data?.augments) ? data.augments.length : 0,
    benchCandidateCount: data?.benchRecommendation?.candidates?.length || 0,
    dataSource: data?.dataSource || null,
  })

  visible.value = true
  loading.value = false
  championDataLoading.value = false
  error.value = null
  championStats.value = null
  buildData.value = null
  itemsData.value = {}
  championLinks.value = {}
  displayAugments.value = []
  selectedBuildRouteIndex.value = 0
  hideAugmentTooltip()
  benchPreviewRecommendation.value = data?.benchRecommendation || null
  championNameData.value = null
  itemSetToast.value = { type: '', message: '' }
  champSelectMode.value =
    data?.champSelect === true ||
    data?.dataSource === 'champ-select' ||
    !!data?.benchRecommendation

  if (data?.pending) {
    championId.value = null
    championName.value = ''
    dataSource.value = data.dataSource || 'pending'
    timestamp.value = data.timestamp || Date.now()
    benchPreviewRecommendation.value = null
    loading.value = true
    logOverlayInfo('pending state displayed', {
      message: data.message || '',
      durationMs: Date.now() - startedAt,
    })
    return
  }

  if (data?.error) {
    championId.value = null
    championName.value = ''
    dataSource.value = data.dataSource || 'error'
    timestamp.value = data.timestamp || Date.now()
    benchPreviewRecommendation.value = null
    error.value = data.error
    loading.value = false
    logOverlayInfo('error state displayed', {
      error: data.error,
      durationMs: Date.now() - startedAt,
    })
    return
  }

  try {
    if (!data || !data.championId) {
      championId.value = null
      championName.value = ''
      dataSource.value = data?.dataSource || 'champ-select'
      timestamp.value = data?.timestamp || Date.now()
      activeTab.value = 'augments'
      selectedBuildRouteIndex.value = 0
      selectedRarity.value = 'all'
      logOverlayInfo('champion detail shown without selected champion', {
        champSelectMode: champSelectMode.value,
        durationMs: Date.now() - startedAt,
      })
      return
    }

    championId.value = data.championId
    // 优先使用传入的英雄名称，如果没有则后面从数据加载
    championName.value = data.championName || ''
    championNameData.value = null
    dataSource.value = data.dataSource || 'local'
    timestamp.value = data.timestamp || Date.now()
    activeTab.value = 'augments'
    selectedBuildRouteIndex.value = 0
    selectedRarity.value = 'all'
    await loadItemSetAutoPreference()
    if (itemSetAutoEnabled.value) {
      showItemSetToast('loading', '自动配置已开启，检测到当前英雄后会写入游戏推荐')
    }

    // 加载完整英雄数据
    const requestedChampionId = Number(championId.value)
    logOverlayInfo('loadChampionData requested', {
      championId: requestedChampionId,
    })
    const championLoadStartedAt = Date.now()
    championDataLoading.value = true
    const { result, source: championDataSource } = await loadChampionDataOnce(requestedChampionId)

    if (loadSequence !== championLoadSequence || Number(championId.value) !== requestedChampionId) {
      const currentChampionId = Number(championId.value) || null
      if (currentChampionId !== requestedChampionId || !visible.value) {
        logOverlayInfo('stale champion data ignored', {
          requestedChampionId,
          currentChampionId,
          visible: visible.value,
          loadSequence,
          currentSequence: championLoadSequence,
          durationMs: Date.now() - championLoadStartedAt,
        })
      }
      return
    }

    if (result.success) {
      const {
        stats,
        augments,
        augmentStats: augStats,
        builds,
        items,
        championName: nameData,
        championLinks: linksData,
      } = result.data
      championStats.value = stats
      augmentBase.value = augments
      augmentStats.value = augStats
      buildData.value = { builds: Array.isArray(builds) ? builds : [] }
      itemsData.value = items
      championNameData.value = nameData || null
      championLinks.value = linksData || {}

      // 设置英雄名称（优先使用传入的，否则使用从数据加载的）
      if (!championName.value && nameData) {
        championName.value = nameData.nameCN || nameData.nameEN || `英雄 ${championId.value}`
      }

      logOverlayInfo('loadChampionData completed', {
        championId: championId.value,
        source: championDataSource,
        durationMs: Date.now() - championLoadStartedAt,
        augmentCount: augStats ? Object.keys(augStats).length : 0,
        hasBuilds: Array.isArray(builds) && builds.length > 0,
        buildCount: Array.isArray(builds) ? builds.length : 0,
      })

      const championAugmentRows = mapChampionAugmentRows(augments, augStats)
      if (championAugmentRows.length > 0) {
        displayAugments.value = championAugmentRows
      } else if (data.augments && data.augments.length > 0) {
        const hasWinrateData = data.augments.some(aug => 'winRate' in aug)

        if (hasWinrateData) {
          displayAugments.value = sortAugmentsByDetectedOrder(data.augments, data.augments)
        } else {
          // 查询胜率数据
          const augmentIds = data.augments.map(aug => aug.id).filter(id => id != null)
          const winrateStartedAt = Date.now()
          logOverlayInfo('winrate query requested', {
            championId: championId.value,
            augmentIds,
          })
          const winrateResult = await electronAPI.winrate.get({
            championId: championId.value,
            augmentIds,
            requestStartedAt: winrateStartedAt,
            requestSource: 'augment-insight',
          })
          if (loadSequence !== championLoadSequence || Number(championId.value) !== requestedChampionId) {
            return
          }
          const winrateCompletedAt = Date.now()
          const winrateTiming = winrateResult?.timing || {}
          const mainToRendererDelayMs = Number.isFinite(winrateTiming.mainCompletedAt)
            ? winrateCompletedAt - winrateTiming.mainCompletedAt
            : null
          logOverlayInfo('winrate query completed', {
            championId: championId.value,
            success: winrateResult.success,
            resultCount: winrateResult.augments?.length || 0,
            durationMs: winrateCompletedAt - winrateStartedAt,
            rendererToMainDelayMs: winrateTiming.rendererToMainDelayMs ?? null,
            mainDurationMs: winrateTiming.mainDurationMs ?? null,
            mainToRendererDelayMs,
          })

          if (winrateResult.success && winrateResult.augments.length > 0) {
            displayAugments.value = sortAugmentsByDetectedOrder(winrateResult.augments, data.augments)
          } else {
            // 查询无结果，使用原始数据并补充默认值
            displayAugments.value = mapIncomingAugmentsForFallback(data.augments)
          }
        }
      } else {
        displayAugments.value = []
      }
    } else {
      throw new Error(result.error || '数据加载失败')
    }
  } catch (err) {
    logOverlayInfo('showOverlay failed', {
      championId: data?.championId || null,
      error: err?.message || String(err),
      durationMs: Date.now() - startedAt,
    })
    if (data?.championId) {
      applyFallbackChampionData(data)
    } else {
      error.value = err.message || '加载数据失败'
    }
  } finally {
    if (loadSequence === championLoadSequence) {
      championDataLoading.value = false
      loading.value = false
    }
  }

  logOverlayInfo('showOverlay completed', {
    championId: championId.value,
    durationMs: Date.now() - startedAt,
  })
}

/**
 * 关闭浮窗
 */
const closeOverlay = () => {
  logOverlayInfo('overlay closed', {
    championId: championId.value,
  })
  championLoadSequence += 1
  visible.value = false
  championNameData.value = null
  championStats.value = null
  championDataLoading.value = false
  champSelectMode.value = false
  benchPreviewRecommendation.value = null
  augmentBase.value = []
  augmentStats.value = {}
  buildData.value = null
  itemsData.value = {}
  championLinks.value = {}
  displayAugments.value = []
  selectedBuildRouteIndex.value = 0
  hideAugmentTooltip()

  if (isSidePanel.value) {
    electronAPI.windows.hideAugmentSidePanel()
  } else {
    electronAPI.windows.hidePopup()
  }
}

const withClientUtm = (url) => {
  try {
    const parsedUrl = new URL(url)
    parsedUrl.searchParams.set('utm_source', 'aramgg_client')
    parsedUrl.searchParams.set('utm_medium', 'desktop_app')
    parsedUrl.searchParams.set('utm_campaign', 'champion_detail')

    if (championId.value) {
      parsedUrl.searchParams.set('utm_content', `champion_${championId.value}`)
    }

    return parsedUrl.toString()
  } catch {
    return url
  }
}

const openChampionBlog = async (url) => {
  if (!url) {
    return
  }

  try {
    await electronAPI.shell.openExternal(withClientUtm(url))
  } catch (err) {
    console.warn('Failed to open champion blog:', err)
  }
}

/**
 * 格式化百分比（带空值保护）
 */
const formatPercent = (value) => {
  const normalized = normalizeRateValue(value)
  if (normalized == null) return '--'
  return `${(normalized * 100).toFixed(1)}%`
}

/**
 * 获取胜率样式类
 */
const getWinRateClass = (winRate) => {
  const normalized = normalizeRateValue(winRate)
  if (!normalized) return ''
  if (normalized >= 0.55) return 'high'
  if (normalized >= 0.50) return 'medium'
  return 'low'
}

/**
 * 格式化数字
 */
const formatNumber = (num) => {
  if (!num) return '--'
  if (num >= 10000) return (num / 10000).toFixed(1) + '万'
  return String(num)
}

const formatDataSource = (source) => {
  const labels = {
    local: '本地',
    remote: '远程数据',
    pending: '加载中',
    unavailable: '不可用',
    test: '测试',
    'auto-analysis': '自动识别',
    'local-analysis': '本地识别',
    fallback: '备用数据',
  }

  return labels[source] || source || '未知'
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
  logOverlayInfo('component mounted')
  void loadChampionInsightPreference()

  unsubscribeEvents.push(electronAPI.events.on('for-popup', (data) => {
    logOverlayInfo('for-popup received', {
      pending: data?.pending === true,
      championId: data?.championId || null,
      augmentCount: Array.isArray(data?.augments) ? data.augments.length : 0,
      benchCandidateCount: data?.benchRecommendation?.candidates?.length || 0,
    })
    if (data) {
      showOverlay(data)
    }
  }))

  unsubscribeEvents.push(electronAPI.events.on('augment-detected', (data) => {
    logOverlayInfo('augment-detected received', {
      championId: data?.championId || null,
      augmentCount: Array.isArray(data?.augments) ? data.augments.length : 0,
    })
    if (data) {
      showOverlay(data)
    }
  }))

  unsubscribeEvents.push(electronAPI.events.on('augment-cleared', (data) => {
    console.log('🔧 收到 augment-cleared 事件:', data)
    closeOverlay()
  }))

  unsubscribeEvents.push(electronAPI.events.on('game-started', () => {
    if (hideChampionInsightOnGameStart.value || isSidePanel.value) {
      console.log('🎮 游戏开始，隐藏弹窗')
      closeOverlay()
      return
    }

    logOverlayInfo('game-started received; champion insight retained by preference')
  }))

  unsubscribeEvents.push(electronAPI.events.on('game-in-progress', () => {
    if (hideChampionInsightOnGameStart.value || isSidePanel.value) {
      console.log('🎮 游戏进行中，隐藏弹窗')
      closeOverlay()
      return
    }

    logOverlayInfo('game-in-progress received; champion insight retained by preference')
  }))

  unsubscribeEvents.push(electronAPI.events.on('item-set-auto-apply-completed', (data) => {
    const eventChampionId = Number(data?.championId)
    if (!eventChampionId || Number(championId.value) !== eventChampionId) {
      return
    }

    if (data?.success) {
      showItemSetToast('success', formatItemSetSuccessMessage(true, data))
      return
    }

    showItemSetToast('error', data?.error || '装备配置失败')
  }))
})

onBeforeUnmount(() => {
  championLoadSequence += 1
  unsubscribeEvents.splice(0).forEach(unsubscribe => unsubscribe())
  if (itemSetToastTimer) {
    clearTimeout(itemSetToastTimer)
    itemSetToastTimer = null
  }
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
  border-radius: 4px;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(194, 156, 109, 0.08);
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
  border-radius: 4px;
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
  border-top-color: var(--lol-primary);
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
    linear-gradient(135deg, rgba(194, 156, 109, 0.12), transparent 48%),
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
  border-radius: 4px;
  object-fit: cover;
  border: 1px solid var(--lol-border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.champion-tier {
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(135deg, var(--lol-gold-2), var(--lol-primary));
  color: var(--lol-bg);
  font-size: 11px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 4px;
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
  padding: 10px 12px;
  background: rgba(7, 10, 13, 0.38);
  border: 1px solid var(--lol-border-soft);
  border-radius: 4px;
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
  background: linear-gradient(135deg, var(--lol-primary-2), var(--lol-primary));
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
  gap: 6px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.filter-chip {
  padding: 5px 9px;
  background: rgba(244, 236, 220, 0.05);
  border: 1px solid var(--lol-border-soft);
  color: var(--lol-muted);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  transition: all 0.2s;
}

.filter-chip:hover {
  background: rgba(244, 236, 220, 0.09);
}

.filter-chip.active {
  background: rgba(194, 156, 109, 0.16);
  border-color: rgba(194, 156, 109, 0.38);
  color: var(--lol-primary-2);
}

.filter-chip.kGold.active {
  background: rgba(200, 169, 106, 0.18);
  border-color: rgba(200, 169, 106, 0.42);
  color: var(--lol-gold-2);
}

.filter-chip.kPrismatic.active {
  background: rgba(194, 156, 109, 0.16);
  border-color: rgba(194, 156, 109, 0.38);
  color: var(--lol-primary-2);
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
  gap: 6px;
}

.augment-card {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 46px;
  padding: 6px 8px;
  background:
    linear-gradient(90deg, rgba(244, 236, 220, 0.025), transparent),
    rgba(7, 10, 13, 0.34);
  border: 1px solid var(--lol-border-soft);
  border-left: 3px solid var(--lol-border);
  border-radius: 4px;
  transition: all 0.2s;
}

.augment-card:hover {
  background: rgba(194, 156, 109, 0.07);
  transform: translateX(2px);
  border-color: rgba(194, 156, 109, 0.22);
}

.augment-card.rarity-kGold {
  border-left-color: var(--lol-gold);
  background: rgba(200, 169, 106, 0.07);
}

.augment-card.rarity-kPrismatic {
  border-left-color: var(--lol-primary);
  background: rgba(194, 156, 109, 0.07);
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
  background: rgba(194, 156, 109, 0.14);
  border: 1px solid rgba(194, 156, 109, 0.26);
  border-radius: 7px;
  font-size: 12px;
  font-weight: 900;
  color: var(--lol-primary-2);
  flex-shrink: 0;
}

.augment-icon-wrapper {
  flex-shrink: 0;
}

.augment-icon {
  width: 32px;
  height: 32px;
  border-radius: 4px;
  border: 1px solid var(--lol-border-soft);
  object-fit: cover;
}

.augment-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0;
}

.augment-name {
  font-size: 13px;
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
  background: linear-gradient(90deg, var(--lol-primary), var(--lol-gold-2));
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
  border-radius: 4px;
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
  border-radius: 4px;
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
  border-radius: 4px;
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
  background: rgba(194, 156, 109, 0.5);
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

/* Stitch champion reference skin */
.augment-overlay {
  width: min(360px, calc(100vw - 24px));
  height: min(640px, calc(100vh - 48px));
  max-height: none;
  background:
    linear-gradient(180deg, rgba(42, 54, 64, 0.96), rgba(31, 43, 53, 0.98)),
    #15212a;
  border: 1px solid rgba(226, 195, 132, 0.28);
  border-radius: 4px;
  box-shadow: 0 0 40px rgba(194, 156, 109, 0.15), 0 28px 80px rgba(0, 0, 0, 0.5);
  font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
}

.augment-overlay.side-panel-mode {
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  max-height: none;
  transform: none;
  background:
    linear-gradient(180deg, rgba(42, 54, 64, 0.68), rgba(12, 20, 27, 0.74)),
    rgba(8, 21, 30, 0.42);
  border-color: rgba(226, 195, 132, 0.2);
  box-shadow: 0 20px 58px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(3px);
}

.augment-overlay.side-panel-mode.overlay-fade-enter-from,
.augment-overlay.side-panel-mode.overlay-fade-leave-to {
  opacity: 0;
  transform: translateX(16px);
}

.insight-titlebar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: rgba(42, 54, 64, 0.92);
  border-bottom: 1px solid rgba(226, 192, 143, 0.28);
  box-shadow: inset 0 0 15px rgba(194, 156, 109, 0.18);
  -webkit-app-region: drag;
}

.side-panel-mode .insight-titlebar {
  background: rgba(31, 43, 53, 0.54);
  box-shadow: inset 0 0 12px rgba(194, 156, 109, 0.1);
}

.insight-titlebar h1 {
  margin: 0;
  color: #e2c08f;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.1;
  text-shadow: 0 0 8px rgba(226, 192, 143, 0.36);
}

.window-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
}

.window-control {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #bacac6;
  cursor: pointer;
  line-height: 0;
  -webkit-app-region: no-drag;
}

.window-icon {
  width: 16px;
  height: 16px;
  stroke-width: 2;
}

.window-control:hover {
  color: #e2c08f;
  background: rgba(226, 192, 143, 0.08);
  border-color: rgba(226, 192, 143, 0.18);
}

.window-control.danger:hover {
  color: #ffb4ab;
  background: rgba(255, 180, 171, 0.1);
  border-color: rgba(255, 180, 171, 0.24);
}

.overlay-content {
  position: relative;
  flex: 1;
  min-height: 0;
  max-height: none;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(ellipse at top, rgba(194, 156, 109, 0.07), transparent 54%),
    rgba(42, 54, 64, 0.84);
}

.side-panel-mode .overlay-content {
  background:
    radial-gradient(ellipse at top, rgba(194, 156, 109, 0.06), transparent 48%),
    rgba(17, 29, 38, 0.34);
}

.bench-inline {
  flex: 0 0 auto;
  padding: 12px 18px 0;
}

.insight-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.champion-hero {
  position: relative;
  flex: 0 0 auto;
  margin: 12px 18px 0;
  overflow: hidden;
  border: 1px solid rgba(133, 148, 145, 0.32);
  border-radius: 4px;
  background: #08151e;
}

.hero-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  transform: scale(1.04);
}

.hero-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(215, 228, 241, 0.34);
  font-size: 38px;
  font-weight: 900;
  background:
    linear-gradient(135deg, rgba(226, 192, 143, 0.08), rgba(226, 195, 132, 0.08)),
    rgba(8, 21, 30, 0.92);
}

.hero-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(0deg, rgba(8, 21, 30, 0.96), rgba(8, 21, 30, 0.22));
}

.hero-content {
  position: relative;
  z-index: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
  padding: 16px;
}

.champion-identity {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.hero-avatar {
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  overflow: hidden;
  border: 1px solid rgba(226, 192, 143, 0.42);
  border-radius: 4px;
  background: rgba(8, 21, 30, 0.86);
  box-shadow: 0 0 16px rgba(194, 156, 109, 0.16);
}

.hero-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

.hero-kicker {
  display: block;
  margin-bottom: 2px;
  color: #e2c384;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0;
}

.champion-name {
  min-width: 0;
  margin: 0;
  color: #e2c08f;
  font-size: 28px;
  font-weight: 900;
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: 0 0 12px rgba(226, 192, 143, 0.5);
}

.hero-badges {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  flex: 0 0 auto;
}

.tier-badge,
.winrate-badge,
.blog-link-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 900;
  white-space: nowrap;
}

.blog-link-badge {
  gap: 4px;
  color: #f4ecdc;
  background: rgba(8, 21, 30, 0.78);
  border: 1px solid rgba(226, 192, 143, 0.46);
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}

.blog-link-badge:hover {
  color: #08151e;
  background: #e2c08f;
  border-color: rgba(226, 192, 143, 0.72);
}

.blog-link-icon {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
}

.tier-badge {
  color: #e2c384;
  background: rgba(31, 43, 53, 0.82);
  border: 1px solid rgba(226, 195, 132, 0.5);
}

.winrate-badge {
  color: #e2c08f;
  background: rgba(194, 156, 109, 0.14);
  border: 1px solid rgba(226, 192, 143, 0.5);
}

.related-blogs {
  margin: 12px 18px 0;
  padding: 12px;
  border: 1px solid rgba(133, 148, 145, 0.24);
  border-radius: 4px;
  background: rgba(8, 21, 30, 0.46);
}

.section-title-row.compact {
  margin-bottom: 8px;
}

.related-blog-link {
  width: 100%;
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #d7e4f1;
  font-size: 12px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.related-blog-link + .related-blog-link {
  margin-top: 4px;
}

.related-blog-link:hover {
  color: #e2c08f;
  background: rgba(194, 156, 109, 0.08);
  border-color: rgba(226, 192, 143, 0.2);
}

.related-blog-link span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.related-blog-icon {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
}

.item-set-actions {
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 18px;
  background:
    linear-gradient(180deg, rgba(17, 29, 38, 0.94), rgba(8, 21, 30, 0.98));
  border-top: 1px solid rgba(226, 192, 143, 0.24);
  box-shadow: 0 -10px 28px rgba(0, 0, 0, 0.26);
}

.item-set-btn {
  width: 100%;
  min-width: 150px;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px solid rgba(226, 192, 143, 0.42);
  border-radius: 4px;
  background: linear-gradient(135deg, rgba(226, 192, 143, 0.22), rgba(194, 156, 109, 0.16));
  color: #f4ecdc;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}

.item-set-btn:hover:not(:disabled) {
  border-color: rgba(226, 192, 143, 0.68);
  background: rgba(194, 156, 109, 0.28);
  color: #f4ecdc;
}

.item-set-btn:disabled {
  opacity: 0.62;
  cursor: wait;
}

.item-set-icon,
.item-set-toast-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}

.item-set-toast {
  position: absolute;
  left: 18px;
  right: 18px;
  bottom: 58px;
  z-index: 5;
  min-height: 34px;
  padding: 8px 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border-radius: 4px;
  background: rgba(8, 21, 30, 0.94);
  border: 1px solid rgba(244, 236, 220, 0.1);
  color: #bacac6;
  font-size: 11px;
  font-weight: 800;
  line-height: 1.25;
  text-align: center;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.34);
}

.item-set-toast.loading {
  color: #e2c08f;
  border-color: rgba(226, 192, 143, 0.28);
}

.item-set-toast.success {
  color: #54d884;
  border-color: rgba(84, 216, 132, 0.28);
}

.item-set-toast.error {
  color: #ffb4ab;
  border-color: rgba(255, 180, 171, 0.28);
}

.item-set-toast-enter-active,
.item-set-toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.item-set-toast-enter-from,
.item-set-toast-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.stat-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 12px 18px 0;
}

.stat-box {
  min-width: 0;
  border: 1px solid rgba(60, 74, 71, 0.42);
  border-radius: 4px;
  background: rgba(17, 29, 38, 0.58);
}

.stat-box span {
  display: block;
  margin-bottom: 4px;
  color: #bacac6;
  font-size: 10px;
}

.stat-box strong {
  color: #d7e4f1;
  font-size: 14px;
  font-weight: 900;
}

.stat-box strong.high,
.winrate-badge.high {
  color: #e2c08f;
}

.stat-box strong.medium,
.winrate-badge.medium {
  color: #e2c384;
}

.stat-box strong.low,
.winrate-badge.low {
  color: #ffb4ab;
}

.tabs-container {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  overflow: visible;
}

.tabs-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 14px 18px 0;
  background: transparent;
  border-bottom: 0;
}

.side-panel-mode .tabs-list {
  padding-top: 12px;
}

.tab-btn {
  justify-content: center;
  border: 1px solid rgba(60, 74, 71, 0.44);
  border-radius: 4px;
  background: rgba(17, 29, 38, 0.6);
  color: #bacac6;
  font-size: 12px;
  font-weight: 900;
}

.tab-btn.active {
  color: #00201d;
  background: #e2c08f;
  border-color: rgba(226, 192, 143, 0.7);
}

.tab-icon {
  border: 0;
  min-width: auto;
  padding: 0;
  color: currentColor;
  font-size: 10px;
}

.tab-content {
  flex: 0 0 auto;
  margin-top: 0;
  padding: 16px 18px 18px;
  overflow: visible;
}

.side-panel-mode .tab-content {
  padding-bottom: 16px;
}

.section-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.section-title-row h3 {
  margin: 0;
  color: #d7e4f1;
  font-size: 17px;
  font-weight: 900;
}

.section-title-row span {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #859491;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}

.section-title-row span::before {
  content: "";
  height: 1px;
  flex: 1;
  min-width: 24px;
  background: linear-gradient(90deg, rgba(226, 192, 143, 0.72), transparent);
}

.filter-bar {
  gap: 5px;
  margin-bottom: 8px;
}

.filter-chip {
  padding: 5px 8px;
  border-radius: 4px;
  background: rgba(17, 29, 38, 0.64);
  border-color: rgba(60, 74, 71, 0.48);
  color: #bacac6;
  font-size: 11px;
  font-weight: 800;
}

.filter-chip.active {
  background: rgba(194, 156, 109, 0.15);
  border-color: rgba(226, 192, 143, 0.46);
  color: #e2c08f;
}

.augments-list {
  gap: 6px;
}

.augment-card {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 46px;
  padding: 6px 8px;
  border: 1px solid rgba(60, 74, 71, 0.44);
  border-radius: 0;
  border-left: 0;
  background: rgba(17, 29, 38, 0.72);
  box-shadow: inset 0 0 10px rgba(194, 156, 109, 0.08);
}

.side-panel-mode .augment-card,
.side-panel-mode .build-tile,
.side-panel-mode .item-section,
.side-panel-mode .starter-row {
  background: rgba(17, 29, 38, 0.48);
}

.augment-card:hover {
  transform: none;
  border-color: rgba(226, 192, 143, 0.38);
  background: rgba(17, 29, 38, 0.84);
}

.augment-icon-wrapper {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(226, 192, 143, 0.38);
  border-radius: 4px;
  background: rgba(8, 21, 30, 0.84);
  color: #e2c08f;
  font-size: 14px;
  font-weight: 900;
  cursor: help;
  overflow: hidden;
}

.augment-icon-wrapper:focus-visible {
  outline: 2px solid rgba(226, 192, 143, 0.82);
  outline-offset: 2px;
}

.augment-icon {
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: inherit;
}

.augment-name {
  color: #d7e4f1;
  font-size: 13px;
  font-weight: 900;
}

.augment-main {
  justify-content: center;
}

.augment-rate {
  text-align: right;
}

.augment-rate strong {
  display: block;
  color: #e2c08f;
  font-size: 13px;
  font-weight: 900;
}

.build-content {
  gap: 14px;
}

.build-route-tabs {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.build-route-tab {
  flex: 1 0 112px;
  min-width: 112px;
  min-height: 52px;
  padding: 8px 10px;
  border: 1px solid rgba(60, 74, 71, 0.48);
  border-radius: 4px;
  background: rgba(17, 29, 38, 0.64);
  color: #bacac6;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease;
}

.build-route-tab:hover,
.build-route-tab.active {
  border-color: rgba(226, 192, 143, 0.62);
  background: rgba(226, 192, 143, 0.14);
  color: #e2c08f;
}

.build-route-tab:focus-visible {
  outline: 2px solid rgba(226, 192, 143, 0.78);
  outline-offset: 2px;
}

.build-route-tab span {
  display: block;
  overflow: hidden;
  color: inherit;
  font-size: 12px;
  font-weight: 900;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.build-route-tab small {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  color: #859491;
  font-size: 10px;
  font-weight: 800;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.build-route-tab.active small,
.build-route-tab:hover small {
  color: #d7e4f1;
}

.build-route {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.build-route + .build-route {
  padding-top: 14px;
  border-top: 1px solid rgba(226, 192, 143, 0.18);
}

.build-route-header {
  min-height: 38px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.build-route-title {
  min-width: 0;
}

.build-route-title h4 {
  margin: 0;
  color: #e2c08f;
  font-size: 14px;
  font-weight: 900;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.build-route-title small {
  display: block;
  margin-top: 2px;
  color: #859491;
  font-size: 10px;
  font-weight: 800;
}

.build-route-stats {
  flex: 0 0 auto;
  text-align: right;
}

.build-route-stats strong {
  display: block;
  color: #e2c08f;
  font-size: 13px;
  font-weight: 900;
  line-height: 1.1;
}

.build-route-stats small {
  display: block;
  margin-top: 2px;
  color: #bacac6;
  font-size: 10px;
  font-weight: 800;
}

.build-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.build-tile,
.item-section,
.starter-row {
  border: 1px solid rgba(60, 74, 71, 0.44);
  border-radius: 4px;
  background: rgba(17, 29, 38, 0.68);
}

.build-tile {
  min-height: 120px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
}

.build-tile-label {
  color: #859491;
  font-size: 10px;
  font-weight: 900;
  line-height: 1;
}

.item-icons {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.item-icon {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(226, 192, 143, 0.28);
  border-radius: 4px;
  object-fit: cover;
}

.item-icon.small {
  width: 30px;
  height: 30px;
}

.build-stats {
  margin-left: 0;
  text-align: left;
}

.build-stats span,
.starter-row > span {
  color: #e2c08f;
  font-size: 13px;
  font-weight: 900;
}

.build-stats small {
  display: block;
  margin-top: 2px;
  color: #bacac6;
  font-size: 10px;
}

.item-section {
  padding: 12px;
}

.item-section h4 {
  margin: 0 0 10px;
  color: #d7e4f1;
  font-size: 13px;
  font-weight: 900;
}

.starter-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.starter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px;
}

.augment-tooltip {
  position: fixed;
  z-index: 10000;
  width: min(300px, calc(100vw - 24px));
  max-height: min(320px, calc(100vh - 24px));
  overflow: auto;
  padding: 12px;
  border: 1px solid rgba(226, 192, 143, 0.48);
  border-radius: 6px;
  background: rgba(5, 14, 21, 0.96);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.44);
  color: #d7e4f1;
  pointer-events: none;
}

.augment-tooltip-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.augment-tooltip-header img {
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  border: 1px solid rgba(226, 192, 143, 0.34);
  border-radius: 4px;
  object-fit: cover;
}

.augment-tooltip-header strong {
  display: block;
  color: #e2c08f;
  font-size: 14px;
  font-weight: 900;
  line-height: 1.2;
}

.augment-tooltip-header span {
  display: block;
  margin-top: 2px;
  color: #859491;
  font-size: 10px;
  font-weight: 800;
}

.augment-tooltip p {
  margin: 10px 0 0;
  color: #bacac6;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-line;
}

.empty-state {
  padding: 30px 16px;
  color: #bacac6;
}

.overlay-footer {
  flex: 0 0 auto;
  padding: 10px 18px;
  background: rgba(17, 29, 38, 0.7);
  border-top: 1px solid rgba(60, 74, 71, 0.44);
  color: #859491;
}

.side-panel-mode .overlay-footer {
  background: rgba(17, 29, 38, 0.34);
}

.insight-scroll::-webkit-scrollbar {
  width: 6px;
}

.insight-scroll::-webkit-scrollbar-track {
  background: rgba(4, 15, 24, 0.52);
}

.insight-scroll::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(226, 195, 132, 0.68), rgba(226, 192, 143, 0.46));
  border-radius: 4px;
}

@media (max-width: 430px) {
  .augment-overlay {
    width: 100vw;
    height: 100vh;
    border-radius: 0;
  }

  .champion-hero,
  .bench-inline,
  .stat-strip,
  .tabs-list,
  .tab-content,
  .overlay-footer {
    margin-left: 12px;
    margin-right: 12px;
    padding-left: 0;
    padding-right: 0;
  }

  .item-set-actions {
    align-items: stretch;
    padding: 10px 12px;
  }
}
</style>
