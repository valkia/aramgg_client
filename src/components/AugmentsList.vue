<template>
  <div class="augments-list">
    <!-- Filters -->
    <el-row :gutter="20" class="filter-section">
      <el-col :xs="24" :sm="12" :md="8">
        <el-select
          v-model="selectedRarity"
          placeholder="选择稀有度"
          @change="handleRarityChange"
          clearable
        >
          <el-option label="全部" value="" />
          <el-option label="银色" value="kSilver" />
          <el-option label="黄金" value="kGold" />
          <el-option label="紫晶" value="kPrismatic" />
        </el-select>
      </el-col>

      <el-col :xs="24" :sm="12" :md="8">
        <el-select
          v-model="selectedSort"
          placeholder="排序方式"
          @change="handleSortChange"
        >
          <el-option label="胜率降序" value="winRate" />
          <el-option label="选取率降序" value="pickRate" />
          <el-option label="场次降序" value="games" />
          <el-option label="Tier升序" value="tier" />
        </el-select>
      </el-col>
    </el-row>

    <!-- Augments Table -->
    <el-table
      :data="displayedAugments"
      stripe
      class="augments-table"
      :default-sort="{ prop: 'winRate', order: 'descending' }"
      @header-click="handleTableSort"
    >
      <el-table-column prop="id" label="ID" width="60" />

      <el-table-column label="图标" width="60" align="center">
        <template #default="{ row }">
          <el-image
            :src="getAugmentIconUrl(row.iconPath)"
            :preview-src-list="[getAugmentIconUrl(row.iconPath)]"
            style="width: 40px; height: 40px"
            fit="cover"
            lazy
          />
        </template>
      </el-table-column>

      <el-table-column prop="name" label="名称" min-width="150" />

      <el-table-column label="稀有度" width="80" align="center">
        <template #default="{ row }">
          <el-tag :type="getRarityColor(row.rarity)">
            {{ getRarityLabel(row.rarity) }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="Tier" width="60" align="center">
        <template #default="{ row }">
          <span
            v-if="getAugmentStats(row.id)"
            :style="{ color: getTierColor(getAugmentStats(row.id).tier) }"
            class="tier-text"
          >
            {{ getAugmentStats(row.id).tier }}
          </span>
          <span v-else class="no-data">-</span>
        </template>
      </el-table-column>

      <el-table-column label="胜率" width="80" align="center" sortable="custom">
        <template #default="{ row }">
          <span v-if="getAugmentStats(row.id)">
            {{ (getAugmentStats(row.id).win_rate * 100).toFixed(2) }}%
          </span>
          <span v-else class="no-data">-</span>
        </template>
      </el-table-column>

      <el-table-column label="选取率" width="80" align="center" sortable="custom">
        <template #default="{ row }">
          <span v-if="getAugmentStats(row.id)">
            {{ (getAugmentStats(row.id).pick_rate * 100).toFixed(2) }}%
          </span>
          <span v-else class="no-data">-</span>
        </template>
      </el-table-column>

      <el-table-column label="场次" width="80" align="center">
        <template #default="{ row }">
          <span v-if="getAugmentStats(row.id)">
            {{ getAugmentStats(row.id).num_games }}
          </span>
          <span v-else class="no-data">-</span>
        </template>
      </el-table-column>

      <el-table-column label="胜场" width="80" align="center">
        <template #default="{ row }">
          <span v-if="getAugmentStats(row.id)">
            {{ getAugmentStats(row.id).num_win_games }}
          </span>
          <span v-else class="no-data">-</span>
        </template>
      </el-table-column>
    </el-table>

    <!-- Empty State -->
    <el-empty v-if="displayedAugments.length === 0" description="暂无数据" />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElSelect, ElOption, ElTable, ElTableColumn, ElTag, ElImage, ElEmpty, ElRow, ElCol } from 'element-plus'
import { getAugmentIconUrl } from '../src/service/cdn'

const props = defineProps({
  augments: {
    type: Array,
    required: true
  },
  stats: {
    type: Object,
    required: true
  },
  items: {
    type: Object,
    default: () => ({})
  }
})

const selectedRarity = ref('')
const selectedSort = ref('winRate')

/**
 * Filter augments by selected rarity
 */
const filteredAugments = computed(() => {
  return props.augments.filter(aug => {
    if (!selectedRarity.value) return true;
    return aug.rarity === selectedRarity.value;
  })
})

/**
 * Sort filtered augments
 */
const displayedAugments = computed(() => {
  const sorted = [...filteredAugments.value];

  sorted.sort((a, b) => {
    const statsA = getAugmentStats(a.id);
    const statsB = getAugmentStats(b.id);

    if (!statsA && statsB) return 1;
    if (statsA && !statsB) return -1;
    if (!statsA && !statsB) return 0;

    let compareValue = 0;
    switch (selectedSort.value) {
      case 'winRate':
        compareValue = parseFloat(statsB.win_rate) - parseFloat(statsA.win_rate);
        break;
      case 'pickRate':
        compareValue = parseFloat(statsB.pick_rate) - parseFloat(statsA.pick_rate);
        break;
      case 'games':
        compareValue = parseInt(statsB.num_games) - parseInt(statsA.num_games);
        break;
      case 'tier':
        compareValue = parseInt(statsA.tier) - parseInt(statsB.tier);
        break;
      default:
        compareValue = 0;
    }

    return compareValue;
  });

  return sorted;
})

/**
 * Get stats for an augment
 */
const getAugmentStats = (augmentId) => {
  return props.stats[String(augmentId)];
}

/**
 * Get color for rarity
 */
const getRarityColor = (rarity) => {
  if (rarity === 'kSilver') return 'info';
  if (rarity === 'kGold') return 'warning';
  if (rarity === 'kPrismatic') return 'success';
  return 'default';
}

/**
 * Get label for rarity
 */
const getRarityLabel = (rarity) => {
  if (rarity === 'kSilver') return '银色';
  if (rarity === 'kGold') return '黄金';
  if (rarity === 'kPrismatic') return '紫晶';
  return '未知';
}

/**
 * Get color for tier
 */
const getTierColor = (tier) => {
  const tierNum = parseInt(tier);
  if (tierNum <= 1) return '#52c41a';
  if (tierNum <= 2) return '#faad14';
  if (tierNum <= 3) return '#f5222d';
  return '#1890ff';
}

const handleRarityChange = () => {
  // Filter will update automatically due to computed property
}

const handleSortChange = () => {
  // Sort will update automatically due to computed property
}

const handleTableSort = () => {
  // Prevent default sorting, use our custom sort
}
</script>

<style scoped>
.augments-list {
  padding: 20px 0;
}

.filter-section {
  margin-bottom: 20px;
  background: #f5f7fa;
  padding: 15px;
  border-radius: 4px;
}

.augments-table {
  width: 100%;
}

.no-data {
  color: #909399;
}

.tier-text {
  font-weight: 600;
  font-size: 14px;
}

/* Responsive */
@media (max-width: 768px) {
  .augments-list {
    padding: 10px 0;
  }

  .filter-section {
    padding: 10px;
  }
}
</style>
