<script setup>
import { cn } from "@/lib/utils";

const props = defineProps({
  class: { type: null, required: false },
});
</script>

<template>
  <div :class="cn('alert-description', props.class)">
    <slot />
  </div>
</template>

<style scoped>
.alert-description {
  font-size: 14px;
  line-height: 1.5;
  color: inherit;
  opacity: 0.9;
}

.alert-description :deep(p) {
  line-height: 1.5;
}
</style>
