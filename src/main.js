import { createApp } from 'vue'
import App from './App.vue'
import api from './request/api/api'
import 'element-plus/dist/index.css'
import { createRouter, createWebHashHistory } from 'vue-router'

import Display from './components/Display.vue'
import ShowDetail from './components/ShowDetail.vue'
import ChampionStats from './components/ChampionStats.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'Display', component: Display },
    { path: '/display', name: 'Display', component: Display },
    { path: '/showDetail', name: 'ShowDetail', component: ShowDetail },
    { path: '/champion-stats/:id', name: 'ChampionStats', component: ChampionStats },
  ],
})

const app = createApp(App)

app.config.globalProperties.$api = api

app.use(router)
app.mount('#app')
