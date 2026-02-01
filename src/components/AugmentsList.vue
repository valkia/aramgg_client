<template>
  <div class="augments-list">
    <!-- Filters -->
    <div class="filter-section">
      <div class="filter-grid">
        <div class="filter-item">
          <Select v-model="selectedRarity">
            <SelectTrigger class="select-trigger">
              <SelectValue placeholder="选择稀有度" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">全部</SelectItem>
              <SelectItem value="kSilver">银色</SelectItem>
              <SelectItem value="kGold">黄金</SelectItem>
              <SelectItem value="kPrismatic">紫晶</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="filter-item">
          <Select v-model="selectedSort">
            <SelectTrigger class="select-trigger">
              <SelectValue placeholder="排序方式" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="winRate">胜率降序</SelectItem>
              <SelectItem value="pickRate">选取率降序</SelectItem>
              <SelectItem value="games">场次降序</SelectItem>
              <SelectItem value="tier">Tier升序</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>

    <!-- Augments Table -->
    <Table class="augments-table">
      <TableHeader>
        <TableRow>
          <TableHead class="w-16">ID</TableHead>
          <TableHead class="w-16">图标</TableHead>
          <TableHead class="min-w-[150px]">名称</TableHead>
          <TableHead class="w-20 text-center">稀有度</TableHead>
          <TableHead class="w-16 text-center">Tier</TableHead>
          <TableHead class="w-20 text-center">胜率</TableHead>
          <TableHead class="w-20 text-center">选取率</TableHead>
          <TableHead class="w-20 text-center">场次</TableHead>
          <TableHead class="w-20 text-center">胜场</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="row in displayedAugments"
          :key="row.id"
          class="table-row-hover"
        >
          <TableCell>{{ row.id }}</TableCell>
          <TableCell>
            <img
              :src="getAugmentIconUrl(row.iconPath)"
              class="augment-icon"
              :alt="row.name"
            />
          </TableCell>
          <TableCell>{{ row.name }}</TableCell>
          <TableCell class="text-center">
            <Badge :class="getRarityClass(row.rarity)">
              {{ getRarityLabel(row.rarity) }}
            </Badge>
          </TableCell>
          <TableCell class="text-center">
            <span
              v-if="getAugmentStats(row.id)"
              :style="{ color: getTierColor(getAugmentStats(row.id).tier) }"
              class="tier-text"
            >
              {{ getAugmentStats(row.id).tier }}
            </span>
            <span v-else class="no-data">-</span>
          </TableCell>
          <TableCell class="text-center">
            <span v-if="getAugmentStats(row.id)">
              {{ (getAugmentStats(row.id).win_rate * 100).toFixed(2) }}%
            </span>
            <span v-else class="no-data">-</span>
          </TableCell>
          <TableCell class="text-center">
            <span v-if="getAugmentStats(row.id)">
              {{ (getAugmentStats(row.id).pick_rate * 100).toFixed(2) }}%
            </span>
            <span v-else class="no-data">-</span>
          </TableCell>
          <TableCell class="text-center">
            <span v-if="getAugmentStats(row.id)">
              {{ getAugmentStats(row.id).num_games }}
            </span>
            <span v-else class="no-data">-</span>
          </TableCell>
          <TableCell class="text-center">
            <span v-if="getAugmentStats(row.id)">
              {{ getAugmentStats(row.id).num_win_games }}
            </span>
            <span v-else class="no-data">-</span>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <!-- Empty State -->
    <div v-if="displayedAugments.length === 0" class="empty-state">
      <p>暂无数据</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { getAugmentIconUrl } from '../service/cdn'

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
    if (!selectedRarity.value) return true
    return aug.rarity === selectedRarity.value
  })
})

/**
 * Sort filtered augments
 */
const displayedAugments = computed(() => {
  const sorted = [...filteredAugments.value]

  sorted.sort((a, b) => {
    const statsA = getAugmentStats(a.id)
    const statsB = getAugmentStats(b.id)

    if (!statsA && statsB) return 1
    if (statsA && !statsB) return -1
    if (!statsA && !statsB) return 0

    let compareValue = 0
    switch (selectedSort.value) {
      case 'winRate':
        compareValue = parseFloat(statsB.win_rate) - parseFloat(statsA.win_rate)
        break
      case 'pickRate':
        compareValue = parseFloat(statsB.pick_rate) - parseFloat(statsA.pick_rate)
        break
      case 'games':
        compareValue = parseInt(statsB.num_games) - parseInt(statsA.num_games)
        break
      case 'tier':
        compareValue = parseInt(statsA.tier) - parseInt(statsB.tier)
        break
      default:
        compareValue = 0
    }

    return compareValue
  })

  return sorted
})

/**
 * Get stats for an augment
 */
const getAugmentStats = (augmentId) => {
  return props.stats[String(augmentId)]
}

/**
 * Get class for rarity badge
 */
const getRarityClass = (rarity) => {
  if (rarity === 'kSilver') return 'rarity-silver'
  if (rarity === 'kGold') return 'rarity-gold'
  if (rarity === 'kPrismatic') return 'rarity-prismatic'
  return ''
}

/**
 * Get label for rarity
 */
const getRarityLabel = (rarity) => {
  if (rarity === 'kSilver') return '银色'
  if (rarity === 'kGold') return '黄金'
  if (rarity === 'kPrismatic') return '紫晶'
  return '未知'
}

/**
 * Get color for tier
 */
const getTierColor = (tier) => {
  const tierNum = parseInt(tier)
  if (tierNum <= 1) return '#52c41a'
  if (tierNum <= 2) return '#faad14'
  if (tierNum <= 3) return '#f5222d'
  return '#60a5fa'
}
</script>

<style scoped>
.augments-list {
  padding: 20px 0;
}

.filter-section {
  margin-bottom: 20px;
  background: rgba(255, 255, 255, 0.05);
  padding: 15px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.filter-item {
  width: 100%;
}

.select-trigger {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}

.augments-table {
  width: 100%;
}

.augment-icon {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  object-fit: cover;
}

.table-row-hover:hover {
  background: rgba(255, 255, 255, 0.08);
}

.no-data {
  color: rgba(255, 255, 255, 0.4);
}

.tier-text {
  font-weight: 600;
  font-size: 14px;
}

/* Rarity badge styles */
.rarity-silver {
  background: rgba(192, 192, 192, 0.2);
  border-color: rgba(192, 192, 192, 0.3);
  color: #c0c0c0;
}

.rarity-gold {
  background: rgba(255, 215, 0, 0.2);
  border-color: rgba(255, 215, 0, 0.3);
  color: #ffd700;
}

.rarity-prismatic {
  background: rgba(148, 0, 211, 0.2);
  border-color: rgba(148, 0, 211, 0.3);
  color: #da70d6;
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: rgba(255, 255, 255, 0.5);
}

/* Responsive */
@media (max-width: 768px) {
  .augments-list {
    padding: 10px 0;
  }

  .filter-section {
    padding: 10px;
  }

  .filter-grid {
    grid-template-columns: 1fr;
  }
}
</style>
