<script setup>
import { cn } from "@/lib/utils";

const props = defineProps({
  class: { type: null, required: false },
});
</script>

<template>
  <div class="relative w-full overflow-auto">
    <table :class="cn('w-full caption-bottom text-sm', props.class)" style="color: rgba(255, 255, 255, 0.9);">
      <slot />
    </table>
  </div>
</template>
