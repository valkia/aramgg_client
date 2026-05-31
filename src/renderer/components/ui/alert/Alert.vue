<script setup>
import { cn } from "@/lib/utils";

const props = defineProps({
  class: { type: null, required: false },
  variant: { type: String, required: false, default: 'default' },
});

const variantClasses = {
  default: 'alert-default',
  destructive: 'alert-destructive',
};
</script>

<template>
  <div :class="cn('alert-base', variantClasses[variant] || variantClasses.default, props.class)" role="alert">
    <slot />
  </div>
</template>

<style scoped>
.alert-base {
  position: relative;
  width: 100%;
  border-radius: 4px;
  border: 1px solid;
  padding: 12px 16px;
  font-size: 14px;
}

.alert-default {
  background: rgba(194, 156, 109, 0.1);
  border-color: rgba(194, 156, 109, 0.22);
  color: var(--lol-ivory);
}

.alert-destructive {
  background: rgba(229, 83, 75, 0.1);
  border-color: rgba(229, 83, 75, 0.3);
  color: #ffb0aa;
}
</style>
