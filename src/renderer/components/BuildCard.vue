<template>
  <div class="build-card">
    <Alert v-if="!buildData" class="info-alert">
      <AlertTitle>暂无Build数据</AlertTitle>
      <AlertDescription>该英雄暂时没有Build数据。</AlertDescription>
    </Alert>

    <template v-else>
      <!-- Build Metadata -->
      <div class="build-meta">
        <Badge>版本 {{ buildData.patch }}</Badge>
        <Badge variant="secondary">队列 {{ buildData.queue }}</Badge>
        <span v-if="buildData.tags" class="tags">
          标签: {{ Object.values(buildData.tags).join(', ') }}
        </span>
      </div>

      <!-- Recommended Items -->
      <div class="build-section">
        <div class="build-grid">
          <div class="build-column">
            <h3 class="section-title">推荐出门装</h3>
            <div v-if="startingItems.length > 0" class="items-list">
              <div
                v-for="(itemSet, index) in startingItems.slice(0, 5)"
                :key="index"
                class="item-build"
              >
                <div class="item-icons">
                  <img
                    v-for="itemId in itemSet.items"
                    :key="itemId"
                    :src="getItemIconUrl(itemId)"
                    class="item-icon"
                    :alt="itemId"
                  />
                </div>
                <div class="item-stats">
                  <div class="stat-row">
                    <span class="stat-label">场次:</span>
                    <span class="stat-value">{{ itemSet.games }}</span>
                  </div>
                  <div class="stat-row">
                    <span class="stat-label">胜率:</span>
                    <span class="stat-value">{{ (itemSet.winRate * 100).toFixed(2) }}%</span>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="empty-state">暂无出门装数据</div>
          </div>

          <div class="build-column">
            <h3 class="section-title">推荐核心装</h3>
            <div v-if="coreItems.length > 0" class="items-list">
              <div
                v-for="(itemSet, index) in coreItems.slice(0, 5)"
                :key="index"
                class="item-build"
              >
                <div class="item-icons">
                  <img
                    v-for="itemId in itemSet.items"
                    :key="itemId"
                    :src="getItemIconUrl(itemId)"
                    class="item-icon"
                    :alt="itemId"
                  />
                </div>
                <div class="item-stats">
                  <div class="stat-row">
                    <span class="stat-label">场次:</span>
                    <span class="stat-value">{{ itemSet.games }}</span>
                  </div>
                  <div class="stat-row">
                    <span class="stat-label">胜率:</span>
                    <span class="stat-value">{{ (itemSet.winRate * 100).toFixed(2) }}%</span>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="empty-state">暂无核心装数据</div>
          </div>
        </div>
      </div>

      <!-- Synergy Items -->
      <div v-if="synergyItems.length > 0" class="synergy-section">
        <h3 class="section-title">装备搭配</h3>
        <div class="synergy-grid">
          <div
            v-for="(synergy, index) in synergyItems.slice(0, 6)"
            :key="index"
            class="synergy-card"
          >
            <div class="synergy-items">
              <img
                v-for="itemId in synergy.items"
                :key="itemId"
                :src="getItemIconUrl(itemId)"
                class="item-icon-small"
                :alt="itemId"
              />
            </div>
            <div class="synergy-info">
              <div>场次: {{ synergy.games }}</div>
              <div>胜率: {{ (synergy.winRate * 100).toFixed(2) }}%</div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { getItemIconUrl } from '../service/cdn'

const props = defineProps({
  buildData: {
    type: Object,
    default: null
  },
  items: {
    type: Object,
    default: () => ({})
  }
})

const normalizeItemIds = (itemIds) => {
  if (Array.isArray(itemIds)) {
    return itemIds.map(id => String(id).trim()).filter(Boolean)
  }

  if (typeof itemIds === 'string') {
    return itemIds.split(',').map(id => id.trim()).filter(Boolean)
  }

  return []
}

/**
 * Parse recommended items into structured format
 */
const parsedRecommended = computed(() => {
  if (!props.buildData || !props.buildData.recommended) {
    return []
  }

  return props.buildData.recommended.map(rec => {
    const itemIds = normalizeItemIds(rec.itemIds)
    return {
      items: itemIds,
      games: parseInt(rec.games) || 0,
      wins: parseInt(rec.wins) || 0,
      pickRate: parseFloat(rec.pick_rate) || 0,
      winRate: parseInt(rec.wins) / parseInt(rec.games) || 0
    }
  }).sort((a, b) => b.games - a.games)
})

/**
 * Get starting items (items with 1-2 components)
 */
const startingItems = computed(() => {
  return parsedRecommended.value.filter(item => item.items.length <= 2)
})

/**
 * Get core items (items with 3+ components)
 */
const coreItems = computed(() => {
  return parsedRecommended.value.filter(item => item.items.length >= 3)
})

/**
 * Parse item sequences for synergy display
 */
const synergyItems = computed(() => {
  if (!props.buildData || !props.buildData.itemSequences) {
    return []
  }

  const sequences = props.buildData.itemSequences
  const result = []

  // Iterate through item sequences
  for (const [coreKey, variants] of Object.entries(sequences)) {
    const coreItems = coreKey.split(',').map(id => id.trim())

    // Get all items from variants
    if (variants && typeof variants === 'object') {
      for (const items of Object.values(variants)) {
        if (Array.isArray(items)) {
          items.forEach(item => {
            if (item.itemIds && Array.isArray(item.itemIds)) {
              const allItems = [...coreItems, ...item.itemIds]
              result.push({
                items: allItems.slice(0, 4), // Limit to 4 items for display
                games: parseInt(item.games) || 0,
                wins: parseInt(item.wins) || 0,
                winRate: parseInt(item.wins) / parseInt(item.games) || 0
              })
            }
          })
        }
      }
    }
  }

  return result.sort((a, b) => b.games - a.games)
})
</script>

<style scoped>
.build-card {
  padding: 20px 0;
}

.info-alert {
  background: rgba(40, 217, 200, 0.1);
  border: 1px solid rgba(40, 217, 200, 0.22);
}

.build-meta {
  display: flex;
  gap: 15px;
  margin-bottom: 25px;
  align-items: center;
  flex-wrap: wrap;
}

.tags {
  color: var(--lol-muted);
  font-size: 14px;
}

.build-section {
  margin-bottom: 30px;
}

.build-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
}

.build-column {
  min-width: 0;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 15px 0;
  color: var(--lol-ivory);
  border-bottom: 2px solid var(--lol-gold);
  padding-bottom: 10px;
}

.items-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.item-build {
  background: rgba(7, 10, 13, 0.32);
  border: 1px solid var(--lol-border-soft);
  border-radius: 8px;
  padding: 15px;
  display: flex;
  gap: 15px;
  align-items: flex-start;
  transition: all 0.3s ease;
}

.item-build:hover {
  background: rgba(40, 217, 200, 0.07);
  border-color: rgba(40, 217, 200, 0.3);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.item-icons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 150px;
}

.item-icon {
  width: 50px;
  height: 50px;
  border-radius: 6px;
  cursor: pointer;
  transition: transform 0.2s;
  border: 1px solid var(--lol-border-soft);
  object-fit: cover;
}

.item-icon:hover {
  transform: translateY(-2px);
  border-color: rgba(40, 217, 200, 0.48);
}

.item-stats {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
}

.stat-label {
  color: var(--lol-faint);
}

.stat-value {
  font-weight: 600;
  color: var(--lol-ivory);
}

.synergy-section {
  margin-top: 30px;
  padding-top: 20px;
  border-top: 1px solid var(--lol-border-soft);
}

.synergy-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.synergy-card {
  background: rgba(7, 10, 13, 0.32);
  border: 1px solid var(--lol-border-soft);
  border-radius: 8px;
  padding: 15px;
  text-align: center;
  transition: all 0.3s ease;
}

.synergy-card:hover {
  background: rgba(40, 217, 200, 0.07);
  border-color: rgba(40, 217, 200, 0.3);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  transform: translateY(-2px);
}

.synergy-items {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-bottom: 12px;
}

.item-icon-small {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  border: 1px solid var(--lol-border-soft);
  object-fit: cover;
}

.synergy-info {
  font-size: 12px;
  color: var(--lol-muted);
  line-height: 1.6;
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--lol-muted);
  background: rgba(7, 10, 13, 0.28);
  border-radius: 8px;
  border: 1px dashed var(--lol-border);
}

/* Responsive */
@media (max-width: 768px) {
  .build-meta {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .build-grid {
    grid-template-columns: 1fr;
  }

  .synergy-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .item-build {
    flex-direction: column;
  }

  .item-icons {
    min-width: 100%;
    justify-content: flex-start;
  }

  .section-title {
    font-size: 16px;
  }
}

@media (max-width: 480px) {
  .synergy-grid {
    grid-template-columns: 1fr;
  }
}
</style>
