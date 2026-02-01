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
  border-radius: 8px;
  border: 1px solid;
  padding: 12px 16px;
  font-size: 14px;
}

.alert-default {
  background: rgba(96, 165, 250, 0.1);
  border-color: rgba(96, 165, 250, 0.2);
  color: rgba(255, 255, 255, 0.9);
}

.alert-destructive {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
  color: #fca5a5;
}
</style>
