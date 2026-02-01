<script setup>
import { cn } from "@/lib/utils";

const props = defineProps({
  class: { type: null, required: false },
});
</script>

<template>
  <thead :class="cn('', props.class)" style="background: rgba(255, 255, 255, 0.05);">
    <slot />
  </thead>
</template>
