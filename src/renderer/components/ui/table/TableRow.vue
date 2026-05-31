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
  >
    <slot />
  </tr>
</template>

<style scoped>
tr {
  border-bottom: 1px solid var(--lol-border-soft);
}

tr:hover {
  background: rgba(194, 156, 109, 0.06);
}
</style>
