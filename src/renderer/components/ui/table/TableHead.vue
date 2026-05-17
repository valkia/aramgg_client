<script setup>
import { cn } from "@/lib/utils";

const props = defineProps({
  class: { type: null, required: false },
});
</script>

<template>
  <th
    :class="
      cn(
        'h-10 px-2 text-left align-middle font-medium [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-0.5',
        props.class,
      )
    "
  >
    <slot />
  </th>
</template>

<style scoped>
th {
  color: var(--lol-gold-2);
  font-weight: 800;
}
</style>
