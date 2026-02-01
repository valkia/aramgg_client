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
  font-weight: 500;
  transition: all 0.2s;
  outline: none;
  color: rgba(255, 255, 255, 0.7);
  background: transparent;
  border: none;
  cursor: pointer;
}

.tabs-trigger:hover {
  color: rgba(255, 255, 255, 0.9);
}

.tabs-trigger:focus-visible {
  outline: 2px solid hsl(217 91% 60%);
  outline-offset: 2px;
}

.tabs-trigger:disabled {
  pointer-events: none;
  opacity: 0.5;
}

.tabs-trigger[data-state="active"] {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}
</style>
