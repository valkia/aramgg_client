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
  border-radius: 4px;
  border: 1px solid transparent;
  padding: 2px 10px;
  font-size: 12px;
  font-weight: 600;
  transition: colors 0.2s;
  white-space: nowrap;
}

.badge-default {
  background: var(--lol-primary);
  color: var(--lol-bg);
  border-color: rgba(226, 192, 143, 0.32);
}

.badge-default:hover {
  background: var(--lol-primary-2);
}

.badge-secondary {
  background: rgba(200, 169, 106, 0.14);
  color: var(--lol-gold-2);
  border-color: rgba(200, 169, 106, 0.28);
}

.badge-secondary:hover {
  background: rgba(200, 169, 106, 0.2);
}

.badge-destructive {
  background: rgba(229, 83, 75, 0.18);
  color: #ffb0aa;
  border-color: rgba(229, 83, 75, 0.34);
}

.badge-destructive:hover {
  background: rgba(229, 83, 75, 0.26);
}

.badge-outline {
  background: transparent;
  color: var(--lol-ivory);
  border-color: var(--lol-border);
}
</style>
