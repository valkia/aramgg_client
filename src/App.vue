<template>
  <div id="app">
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
  font-family: "Avenir", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  height: 100%;
}

html {
  height: 100%;
  background: #ededed;
}

body {
  margin: 0px;
  height: 100%;
}

.return-btn {
  left: 0px;
  position: absolute;
  border: unset !important;
}

.return-btn:hover {
  color: #606266 !important;
}

.nav {
  padding: 5px;
  line-height: 40px;
  text-align: center;
  background: #2472b2;
  color: #fff;
}

.nav > .el-button {
  background: #2472b2;
  color: #fff;
  padding-left: 10px;
}
</style>