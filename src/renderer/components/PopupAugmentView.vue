<template>
  <div class="popup-container">
    <AugmentWinrateOverlay />
  </div>
</template>

<script setup>
import AugmentWinrateOverlay from './AugmentWinrateOverlay.vue'
</script>

<style scoped>
.popup-container {
  width: 100%;
  height: 100%;
  background: transparent;
  padding: 0;
  margin: 0;
  overflow: hidden;
}
</style>
