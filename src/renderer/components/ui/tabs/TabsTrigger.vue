<script setup>
import { reactiveOmit } from "@vueuse/core";
import { TabsTrigger, useForwardProps } from "reka-ui";
import { cn } from "@/lib/utils";

const props = defineProps({
  value: { type: [String, Number], required: true },
  disabled: { type: Boolean, required: false },
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
  class: { type: null, required: false },
});

const delegatedProps = reactiveOmit(props, "class");

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <TabsTrigger
    v-bind="forwardedProps"
    :class="cn('tabs-trigger', props.class)"
  >
    <span class="truncate">
      <slot />
    </span>
  </TabsTrigger>
</template>

<style scoped>
.tabs-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 14px;
  font-weight: 700;
  transition: all 0.2s;
  outline: none;
  color: var(--lol-muted);
  background: transparent;
  border: none;
  cursor: pointer;
}

.tabs-trigger:hover {
  color: var(--lol-ivory);
}

.tabs-trigger:focus-visible {
  outline: 2px solid var(--lol-teal);
  outline-offset: 2px;
}

.tabs-trigger:disabled {
  pointer-events: none;
  opacity: 0.5;
}

.tabs-trigger[data-state="active"] {
  background: linear-gradient(135deg, rgba(40, 217, 200, 0.18), rgba(200, 169, 106, 0.16));
  color: var(--lol-ivory);
  box-shadow: inset 0 0 0 1px rgba(40, 217, 200, 0.24);
}
</style>
