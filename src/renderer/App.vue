<template>
  <div id="app" class="h-full w-full">
    <router-view></router-view>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'

const init = async () => {
  console.log('✅ App 已挂载')
  // 版本初始化功能已移至后台处理，避免渲染进程阻塞
}

onMounted(() => {
  init()
})
</script>

<style>
#app {
  width: 100%;
  height: 100%;
  font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

html {
  height: 100%;
  background: var(--lol-bg);
}

body {
  height: 100%;
  margin: 0;
  background: var(--lol-bg);
  color: var(--lol-ivory);
}

.return-btn {
  position: absolute;
  left: 0;
  border: 0;
  color: var(--lol-ivory);
}

.nav {
  height: 40px;
  padding: 4px 8px;
  text-align: center;
  background: var(--lol-surface);
  color: var(--lol-ivory);
}
</style>
