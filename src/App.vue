<template>
  <div id="app" class="h-full w-full">
    <router-view></router-view>
  </div>
</template>

<script setup>
import config from "./src/native/config"
import { getLolVer } from "./src/service/data-source/lol-qq"
import { onMounted } from 'vue'

const init = async () => {
  console.log(`app`)

  const shell = window.electron?.shell

  const getVerAndItems = async () => {
    try {
      const v = await getLolVer()
      config.set(`lolVer`, v)
    } catch (error) {
      console.error('Error getting LoL version:', error)
    }
  }

  await getVerAndItems()
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