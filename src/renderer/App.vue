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
  @apply font-sans antialiased h-full w-full;
}

html {
  @apply h-full;
  background: var(--lol-bg);
}

body {
  @apply m-0 h-full;
  background: var(--lol-bg);
  color: var(--lol-ivory);
}

.return-btn {
  @apply absolute left-0 border-none;
  color: var(--lol-ivory);
}

.nav {
  @apply py-xs px-sm h-10 text-center;
  background: var(--lol-surface);
  color: var(--lol-ivory);
}
</style>
