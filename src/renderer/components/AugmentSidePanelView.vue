<template>
  <div class="augment-side-panel-view">
    <AugmentWinrateOverlay variant="side-panel" />
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import AugmentWinrateOverlay from './AugmentWinrateOverlay.vue'

const sidePanelWindowClass = 'augment-side-panel-window'

onMounted(() => {
  document.documentElement.classList.add(sidePanelWindowClass)
  document.body.classList.add(sidePanelWindowClass)
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove(sidePanelWindowClass)
  document.body.classList.remove(sidePanelWindowClass)
})
</script>

<style scoped>
.augment-side-panel-view {
  width: 100vw;
  height: 100vh;
  background: transparent;
  overflow: hidden;
}

::global(html.augment-side-panel-window),
::global(body.augment-side-panel-window),
::global(html.augment-side-panel-window #app) {
  background: transparent !important;
}

::global(body.augment-side-panel-window) {
  margin: 0;
  overflow: hidden;
}
</style>
