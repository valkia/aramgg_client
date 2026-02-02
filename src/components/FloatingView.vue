<template>
  <div class="floating-view">
    <AugmentFloatingOverlay />
  </div>
</template>

<script setup>
import AugmentFloatingOverlay from './AugmentFloatingOverlay.vue'
</script>

<style scoped>
.floating-view {
  width: 100vw;
  height: 100vh;
  background: transparent;
  overflow: hidden;
  pointer-events: none;
}

/* 让子元素可以接收鼠标事件 */
.floating-view >>> .floating-overlay {
  pointer-events: auto;
}
</style>
