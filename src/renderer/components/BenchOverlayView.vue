<template>
  <div class="bench-page">
    <section class="bench-window">
      <header class="bench-titlebar">
        <div class="brand-lockup">
          <Swords class="brand-icon" />
          <h1>选人席位推荐</h1>
        </div>
        <button class="window-control" type="button" title="隐藏" @click="hideWindow">
          <X class="window-icon" />
        </button>
      </header>

      <main class="bench-content">
        <AramBenchRecommendation />
      </main>
    </section>
  </div>
</template>

<script setup>
import { Swords, X } from 'lucide-vue-next'
import AramBenchRecommendation from './AramBenchRecommendation.vue'
import { electronAPI, hasElectronAPI } from '../native/electron-api.js'

const hideWindow = () => {
  if (hasElectronAPI()) {
    electronAPI.windows.hideBench()
  }
}
</script>

<style scoped>
.bench-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  background: #08151e;
  color: #d7e4f1;
}

.bench-window {
  width: 100%;
  height: calc(100vh - 24px);
  max-height: 636px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(226, 195, 132, 0.24);
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(17, 29, 38, 0.96), rgba(4, 15, 24, 0.98)),
    #08151e;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.42);
}

.bench-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(71, 228, 213, 0.28);
  background: rgba(42, 54, 64, 0.84);
  -webkit-app-region: drag;
}

.brand-lockup {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-icon {
  width: 18px;
  height: 18px;
  color: #e2c384;
  flex: 0 0 auto;
}

h1 {
  margin: 0;
  overflow: hidden;
  color: #d7e4f1;
  font-size: 16px;
  font-weight: 900;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.window-control {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #bacac6;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.window-control:hover {
  color: #ffb4ab;
  background: rgba(255, 180, 171, 0.1);
  border-color: rgba(255, 180, 171, 0.24);
}

.window-icon {
  width: 16px;
  height: 16px;
}

.bench-content {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.bench-content::-webkit-scrollbar {
  width: 8px;
}

.bench-content::-webkit-scrollbar-track {
  background: rgba(4, 15, 24, 0.36);
}

.bench-content::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(71, 228, 213, 0.32);
}
</style>
