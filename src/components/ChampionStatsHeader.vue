<template>
  <div class="champion-header">
    <el-row :gutter="20" align="middle">
      <el-col :xs="24" :sm="6" class="avatar-section">
        <img
          :src="getChampionIconUrl(championId)"
          :alt="stats.championId"
          class="champion-avatar"
          @error="handleImageError"
        />
      </el-col>

      <el-col :xs="24" :sm="18">
        <div class="info-section">
          <div class="champion-info">
            <h2 class="champion-name">ID: {{ championId }}</h2>
            <el-tag :type="getTierColor(stats.tier)" class="tier-tag">
              Tier {{ stats.tier }}
            </el-tag>
          </div>

          <el-row :gutter="20" class="stats-grid">
            <el-col :xs="12" :sm="6">
              <StatCard
                label="胜率"
                :value="`${(stats.winRate * 100).toFixed(2)}%`"
                icon="DataAnalysis"
              />
            </el-col>
            <el-col :xs="12" :sm="6">
              <StatCard
                label="选取率"
                :value="`${(stats.pickRate * 100).toFixed(2)}%`"
                icon="DataAnalysis"
              />
            </el-col>
            <el-col :xs="12" :sm="6">
              <StatCard
                label="场次"
                :value="formatNumber(stats.numGames)"
                icon="DocumentCopy"
              />
            </el-col>
            <el-col :xs="12" :sm="6">
              <StatCard
                label="胜场"
                :value="formatNumber(stats.numWinGames)"
                icon="CircleCheck"
              />
            </el-col>
          </el-row>

          <div class="meta-info">
            <span class="version-tag">版本 {{ stats.version }}</span>
            <span class="date-tag">更新于 {{ formatDate(stats.date) }}</span>
          </div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElRow, ElCol, ElTag } from 'element-plus'
import { getChampionIconUrl } from '../src/service/cdn'
import StatCard from './StatCard.vue'

const props = defineProps({
  championId: {
    type: [String, Number],
    required: true
  },
  stats: {
    type: Object,
    required: true
  }
})

const imageError = ref(false)

/**
 * Get color for tier tag
 */
const getTierColor = (tier) => {
  const tierNum = parseInt(tier);
  if (tierNum <= 2) return 'success';
  if (tierNum <= 3) return 'warning';
  return 'info';
}

/**
 * Format large numbers
 */
const formatNumber = (num) => {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return String(num);
}

/**
 * Format date
 */
const formatDate = (dateStr) => {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN');
  } catch {
    return dateStr;
  }
}

/**
 * Handle image load error
 */
const handleImageError = () => {
  imageError.value = true;
}
</script>

<style scoped>
.champion-header {
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  border-radius: 12px;
  padding: 30px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}

.avatar-section {
  display: flex;
  justify-content: center;
}

.champion-avatar {
  width: 180px;
  height: 240px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  object-fit: cover;
  transition: transform 0.3s ease;
}

.champion-avatar:hover {
  transform: scale(1.05);
}

.info-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.champion-info {
  display: flex;
  align-items: center;
  gap: 15px;
}

.champion-name {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  color: #333;
}

.tier-tag {
  font-size: 14px;
  font-weight: 600;
  padding: 6px 12px;
}

.stats-grid {
  width: 100%;
}

.meta-info {
  display: flex;
  gap: 15px;
  padding-top: 10px;
  border-top: 1px solid rgba(0, 0, 0, 0.1);
  font-size: 12px;
  color: #666;
}

.version-tag,
.date-tag {
  display: inline-block;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 4px;
}

/* Responsive styles */
@media (max-width: 768px) {
  .champion-header {
    padding: 20px;
  }

  .champion-avatar {
    width: 120px;
    height: 160px;
  }

  .champion-name {
    font-size: 20px;
  }

  .meta-info {
    flex-direction: column;
    gap: 8px;
  }
}

@media (max-width: 480px) {
  .champion-header {
    padding: 15px;
  }

  .champion-name {
    font-size: 18px;
  }

  .stats-grid {
    gap: 10px;
  }
}
</style>
