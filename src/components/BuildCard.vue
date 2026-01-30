<template>
  <div class="build-card">
    <el-alert
      v-if="!buildData"
      title="暂无Build数据"
      type="info"
      show-icon
      :closable="false"
    />

    <template v-else>
      <!-- Build Metadata -->
      <div class="build-meta">
        <el-tag>版本 {{ buildData.patch }}</el-tag>
        <el-tag type="info">队列 {{ buildData.queue }}</el-tag>
        <span v-if="buildData.tags" class="tags">
          标签: {{ Object.values(buildData.tags).join(', ') }}
        </span>
      </div>

      <!-- Recommended Items -->
      <el-row :gutter="20" class="build-section">
        <el-col :xs="24" :md="12">
          <h3 class="section-title">推荐出门装</h3>
          <div v-if="startingItems.length > 0" class="items-list">
            <div
              v-for="(itemSet, index) in startingItems.slice(0, 5)"
              :key="index"
              class="item-build"
            >
              <div class="item-icons">
                <el-image
                  v-for="itemId in itemSet.items"
                  :key="itemId"
                  :src="getItemIconUrl(itemId)"
                  :preview-src-list="[getItemIconUrl(itemId)]"
                  class="item-icon"
                  fit="cover"
                  lazy
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
          <el-empty v-else description="暂无出门装数据" />
        </el-col>

        <el-col :xs="24" :md="12">
          <h3 class="section-title">推荐核心装</h3>
          <div v-if="coreItems.length > 0" class="items-list">
            <div
              v-for="(itemSet, index) in coreItems.slice(0, 5)"
              :key="index"
              class="item-build"
            >
              <div class="item-icons">
                <el-image
                  v-for="itemId in itemSet.items"
                  :key="itemId"
                  :src="getItemIconUrl(itemId)"
                  :preview-src-list="[getItemIconUrl(itemId)]"
                  class="item-icon"
                  fit="cover"
                  lazy
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
          <el-empty v-else description="暂无核心装数据" />
        </el-col>
      </el-row>

      <!-- Synergy Items -->
      <div v-if="synergyItems.length > 0" class="synergy-section">
        <h3 class="section-title">装备搭配</h3>
        <el-row :gutter="20">
          <el-col
            v-for="(synergy, index) in synergyItems.slice(0, 6)"
            :key="index"
            :xs="24"
            :sm="12"
            :md="8"
          >
            <div class="synergy-card">
              <div class="synergy-items">
                <el-image
                  v-for="itemId in synergy.items"
                  :key="itemId"
                  :src="getItemIconUrl(itemId)"
                  :preview-src-list="[getItemIconUrl(itemId)]"
                  class="item-icon-small"
                  fit="cover"
                  lazy
                />
              </div>
              <div class="synergy-info">
                <div>场次: {{ synergy.games }}</div>
                <div>胜率: {{ (synergy.winRate * 100).toFixed(2) }}%</div>
              </div>
            </div>
          </el-col>
        </el-row>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ElAlert, ElTag, ElRow, ElCol, ElImage, ElEmpty } from 'element-plus'
import { getItemIconUrl } from '../src/service/cdn'

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

/**
 * Parse recommended items into structured format
 */
const parsedRecommended = computed(() => {
  if (!props.buildData || !props.buildData.recommended) {
    return [];
  }

  return props.buildData.recommended.map(rec => {
    const itemIds = rec.itemIds.split(',').map(id => id.trim());
    return {
      items: itemIds,
      games: parseInt(rec.games) || 0,
      wins: parseInt(rec.wins) || 0,
      pickRate: parseFloat(rec.pick_rate) || 0,
      winRate: parseInt(rec.wins) / parseInt(rec.games) || 0
    };
  }).sort((a, b) => b.games - a.games);
})

/**
 * Get starting items (items with 1-2 components)
 */
const startingItems = computed(() => {
  return parsedRecommended.value.filter(item => item.items.length <= 2);
})

/**
 * Get core items (items with 3+ components)
 */
const coreItems = computed(() => {
  return parsedRecommended.value.filter(item => item.items.length >= 3);
})

/**
 * Parse item sequences for synergy display
 */
const synergyItems = computed(() => {
  if (!props.buildData || !props.buildData.itemSequences) {
    return [];
  }

  const sequences = props.buildData.itemSequences;
  const result = [];

  // Iterate through item sequences
  for (const [coreKey, variants] of Object.entries(sequences)) {
    const coreItems = coreKey.split(',').map(id => id.trim());

    // Get all items from variants
    if (variants && typeof variants === 'object') {
      for (const [tier, items] of Object.entries(variants)) {
        if (Array.isArray(items)) {
          items.forEach(item => {
            if (item.itemIds && Array.isArray(item.itemIds)) {
              const allItems = [...coreItems, ...item.itemIds];
              result.push({
                items: allItems.slice(0, 4), // Limit to 4 items for display
                games: parseInt(item.games) || 0,
                wins: parseInt(item.wins) || 0,
                winRate: parseInt(item.wins) / parseInt(item.games) || 0
              });
            }
          });
        }
      }
    }
  }

  return result.sort((a, b) => b.games - a.games);
})
</script>

<style scoped>
.build-card {
  padding: 20px 0;
}

.build-meta {
  display: flex;
  gap: 15px;
  margin-bottom: 25px;
  align-items: center;
  flex-wrap: wrap;
}

.tags {
  color: #606266;
  font-size: 14px;
}

.build-section {
  margin-bottom: 30px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 15px 0;
  color: #333;
  border-bottom: 2px solid #409eff;
  padding-bottom: 10px;
}

.items-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.item-build {
  background: white;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 15px;
  display: flex;
  gap: 15px;
  align-items: flex-start;
  transition: all 0.3s ease;
}

.item-build:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
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
  border-radius: 4px;
  cursor: pointer;
  transition: transform 0.2s;
}

.item-icon:hover {
  transform: scale(1.1);
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
  color: #909399;
}

.stat-value {
  font-weight: 600;
  color: #333;
}

.synergy-section {
  margin-top: 30px;
  padding-top: 20px;
  border-top: 1px solid #ebeef5;
}

.synergy-card {
  background: white;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 15px;
  text-align: center;
  transition: all 0.3s ease;
}

.synergy-card:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
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
  border-radius: 4px;
}

.synergy-info {
  font-size: 12px;
  color: #606266;
  line-height: 1.6;
}

/* Responsive */
@media (max-width: 768px) {
  .build-meta {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
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
</style>
