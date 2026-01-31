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
  @apply h-full bg-neutral-100;
}

body {
  @apply m-0 h-full;
}

.return-btn {
  @apply absolute left-0 text-white hover:text-neutral-400 border-none;
}

.nav {
  @apply py-xs px-sm h-10 text-center bg-secondary-500 text-white;
}
</style>