<script setup>
import { cn } from "@/lib/utils";

const props = defineProps({
  class: { type: null, required: false },
});
</script>

<template>
  <tr
    :class="
      cn(
        'transition-colors',
        props.class,
      )
    "
    style="border-bottom: 1px solid rgba(255, 255, 255, 0.1);"
  >
    <slot />
  </tr>
</template>

<style scoped>
tr:hover {
  background: rgba(255, 255, 255, 0.05);
}
</style>
