<template>
  <div class="champion-header">
    <div class="header-grid">
      <div class="avatar-section">
        <img
          :src="getChampionIconUrl(championId)"
          :alt="stats.championId"
          class="champion-avatar"
          @error="handleImageError"
        />
      </div>

      <div class="info-section">
        <div class="champion-info">
          <h2 class="champion-name">ID: {{ championId }}</h2>
          <Badge :variant="getTierVariant(stats.tier)" class="tier-badge">
            Tier {{ stats.tier }}
          </Badge>
        </div>

        <div class="stats-grid">
          <StatCard
            label="胜率"
            :value="`${(stats.winRate * 100).toFixed(2)}%`"
            icon="DataAnalysis"
          />
          <StatCard
            label="选取率"
            :value="`${(stats.pickRate * 100).toFixed(2)}%`"
            icon="DataAnalysis"
          />
          <StatCard
            label="场次"
            :value="formatNumber(stats.numGames)"
            icon="DocumentCopy"
          />
          <StatCard
            label="胜场"
            :value="formatNumber(stats.numWinGames)"
            icon="CircleCheck"
          />
        </div>

        <div class="meta-info">
          <span class="version-tag">版本 {{ stats.version }}</span>
          <span class="date-tag">更新于 {{ formatDate(stats.date) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { Badge } from '@/components/ui/badge'
import { getChampionIconUrl } from '../service/cdn'
import StatCard from './StatCard.vue'

defineProps({
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
 * Get variant for tier badge
 */
const getTierVariant = (tier) => {
  const tierNum = parseInt(tier)
  if (tierNum <= 2) return 'default'
  if (tierNum <= 3) return 'secondary'
  return 'outline'
}

/**
 * Format large numbers
 */
const formatNumber = (num) => {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return String(num)
}

/**
 * Format date
 */
const formatDate = (dateStr) => {
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('zh-CN')
  } catch {
    return dateStr
  }
}

/**
 * Handle image load error
 */
const handleImageError = () => {
  imageError.value = true
}
</script>

<style scoped>
.champion-header {
    background:
        linear-gradient(135deg, rgba(40, 217, 200, 0.08), transparent 42%),
        var(--lol-panel-raised);
    border: 1px solid var(--lol-border-soft);
    border-radius: 8px;
    padding: 26px;
    box-shadow: var(--lol-shadow);
}

.header-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 24px;
    align-items: center;
}

.avatar-section {
    display: flex;
    justify-content: center;
}

.champion-avatar {
    width: 180px;
    height: 240px;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    object-fit: cover;
    transition: transform 0.3s ease;
    border: 1px solid var(--lol-border);
}

.champion-avatar:hover {
    transform: translateY(-2px);
    border-color: rgba(40, 217, 200, 0.5);
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
    font-weight: 700;
    color: var(--lol-ivory);
}

.tier-badge {
    font-size: 14px;
    font-weight: 600;
    padding: 6px 14px;
    border-color: var(--lol-border);
    background: rgba(200, 169, 106, 0.14);
    color: var(--lol-gold-2);
}

.stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
}

.meta-info {
    display: flex;
    gap: 15px;
    padding-top: 16px;
    border-top: 1px solid var(--lol-border-soft);
    font-size: 12px;
    color: var(--lol-muted);
}

.version-tag,
.date-tag {
    display: inline-block;
    padding: 6px 12px;
    background: rgba(7, 10, 13, 0.35);
    border: 1px solid var(--lol-border-soft);
    border-radius: 6px;
    color: var(--lol-muted);
}

/* Responsive styles */
@media (max-width: 768px) {
    .champion-header {
        padding: 20px;
    }

    .header-grid {
        grid-template-columns: 1fr;
        justify-items: center;
    }

    .champion-avatar {
        width: 120px;
        height: 160px;
    }

    .champion-name {
        font-size: 20px;
    }

    .stats-grid {
        grid-template-columns: repeat(2, 1fr);
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
