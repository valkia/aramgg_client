<script setup>
import { cn } from "@/lib/utils";

const props = defineProps({
  class: { type: null, required: false },
});
</script>

<template>
  <h5 :class="cn('alert-title', props.class)">
    <slot />
  </h5>
</template>

<style scoped>
.alert-title {
  margin-bottom: 4px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: -0.025em;
  color: inherit;
}
</style>
