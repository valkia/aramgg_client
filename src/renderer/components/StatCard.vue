<template>
  <div class="stat-card">
    <div v-if="icon" class="stat-icon">
      <component :is="iconComponent" class="w-6 h-6" />
    </div>
    <div class="stat-content">
      <div class="stat-label">{{ label }}</div>
      <div class="stat-value">{{ value }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import {
  BarChart3,
  FileText,
  CheckCircle,
  Award
} from 'lucide-vue-next'

const props = defineProps({
  label: {
    type: String,
    required: true
  },
  value: {
    type: [String, Number],
    required: true
  },
  icon: {
    type: String,
    default: null
  }
})

// 图标映射
const iconMap = {
  DataAnalysis: BarChart3,
  DocumentCopy: FileText,
  CircleCheck: CheckCircle,
  Medal: Award
}

const iconComponent = computed(() => {
  return iconMap[props.icon] || BarChart3
})
</script>

<style scoped>
.stat-card {
    background: rgba(7, 10, 13, 0.34);
    border: 1px solid var(--lol-border-soft);
    border-radius: 4px;
    padding: 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    transition: all 0.3s ease;
}

.stat-card:hover {
    background: rgba(194, 156, 109, 0.07);
    transform: translateY(-2px);
    border-color: rgba(194, 156, 109, 0.28);
}

.stat-icon {
    flex-shrink: 0;
    color: var(--lol-primary-2);
}

.stat-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.stat-label {
    font-size: 11px;
    color: var(--lol-faint);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0;
}

.stat-value {
    font-size: 20px;
    font-weight: 700;
    color: var(--lol-ivory);
}

@media (max-width: 768px) {
    .stat-card {
        padding: 12px;
        gap: 8px;
    }

    .stat-icon {
        font-size: 20px;
    }

    .stat-value {
        font-size: 16px;
    }

    .stat-label {
        font-size: 10px;
    }
}
</style>
