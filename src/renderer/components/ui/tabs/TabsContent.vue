<script setup>
import { reactiveOmit } from "@vueuse/core";
import { TabsContent } from "reka-ui";
import { cn } from "@/lib/utils";

const props = defineProps({
  value: { type: [String, Number], required: true },
  forceMount: { type: Boolean, required: false },
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
  class: { type: null, required: false },
});

const delegatedProps = reactiveOmit(props, "class");
</script>

<template>
  <TabsContent
    :class="cn('tabs-content', props.class)"
    v-bind="delegatedProps"
  >
    <slot />
  </TabsContent>
</template>

<style scoped>
.tabs-content {
  margin-top: 8px;
  outline: none;
}

.tabs-content:focus-visible {
  outline: 2px solid hsl(217 91% 60%);
  outline-offset: 2px;
}
</style>
