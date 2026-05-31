<template>
  <div class="floating-view">
    <AugmentFloatingOverlay />
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import AugmentFloatingOverlay from './AugmentFloatingOverlay.vue'

const overlayWindowClass = 'floating-overlay-window'

onMounted(() => {
  document.documentElement.classList.add(overlayWindowClass)
  document.body.classList.add(overlayWindowClass)
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove(overlayWindowClass)
  document.body.classList.remove(overlayWindowClass)
})
</script>

<style scoped>
.floating-view {
  width: 100vw;
  height: 100vh;
  background: transparent;
  overflow: hidden;
  border-radius: 4px;
  clip-path: inset(0 round 12px);
  pointer-events: none;
}

/* 让子元素可以接收鼠标事件 */
.floating-view :deep(.floating-overlay) {
  pointer-events: auto;
}

:global(html.floating-overlay-window),
:global(body.floating-overlay-window),
:global(html.floating-overlay-window #app) {
  background: transparent !important;
}

:global(body.floating-overlay-window) {
  margin: 0;
  overflow: hidden;
}
</style>
