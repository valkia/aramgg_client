<script setup>
import { cn } from "@/lib/utils";

const props = defineProps({
  variant: { type: String, required: false, default: 'default' },
  class: { type: null, required: false },
});

const variantClasses = {
  default: 'badge-default',
  secondary: 'badge-secondary',
  destructive: 'badge-destructive',
  outline: 'badge-outline',
};
</script>

<template>
  <div :class="cn('badge-base', variantClasses[variant] || variantClasses.default, props.class)">
    <slot />
  </div>
</template>

<style scoped>
.badge-base {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  border-radius: 6px;
  border: 1px solid transparent;
  padding: 2px 10px;
  font-size: 12px;
  font-weight: 600;
  transition: colors 0.2s;
  white-space: nowrap;
}

.badge-default {
  background: hsl(217 91% 60%);
  color: hsl(222 47% 11%);
  border-color: transparent;
}

.badge-default:hover {
  background: hsl(217 91% 50%);
}

.badge-secondary {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
  border-color: rgba(255, 255, 255, 0.15);
}

.badge-secondary:hover {
  background: rgba(255, 255, 255, 0.15);
}

.badge-destructive {
  background: hsl(0 63% 31%);
  color: rgba(255, 255, 255, 0.9);
  border-color: transparent;
}

.badge-destructive:hover {
  background: hsl(0 63% 25%);
}

.badge-outline {
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
  border-color: rgba(255, 255, 255, 0.2);
}
</style>
