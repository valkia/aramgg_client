<script setup>
import { cn } from "@/lib/utils";

const props = defineProps({
  class: { type: null, required: false },
});
</script>

<template>
  <div :class="cn('skeleton', props.class)" />
</template>

<style scoped>
.skeleton {
  border-radius: 6px;
  background: linear-gradient(90deg, rgba(244, 236, 220, 0.06), rgba(40, 217, 200, 0.12), rgba(244, 236, 220, 0.06));
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
