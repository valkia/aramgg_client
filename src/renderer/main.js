import { createApp } from 'vue'
import App from './App.vue'
import api from './request/api/api'
import './styles/index.css'
import { createRouter, createWebHashHistory } from 'vue-router'

import Display from './components/Display.vue'
import ShowDetail from './components/ShowDetail.vue'
import ChampionStats from './components/ChampionStats.vue'
import PopupAugmentView from './components/PopupAugmentView.vue'
import FloatingView from './components/FloatingView.vue'
import { electronAPI, hasElectronAPI } from './native/electron-api.js'

/**
 * 发送错误到主进程
 * @param {Object} errorData 错误数据
 */
function sendErrorToMain(errorData) {
  try {
    if (hasElectronAPI()) {
      electronAPI.diagnostics.logRendererError({
        ...errorData,
        userAgent: navigator.userAgent,
      })
    }
  } catch (e) {
    console.error('发送错误到主进程失败:', e)
  }
}

/**
 * 设置全局错误监听
 */
function setupGlobalErrorHandling(app) {
  // Vue 错误处理器
  app.config.errorHandler = (err, vm, info) => {
    console.error('Vue Error:', err, info)
    sendErrorToMain({
      type: 'vue-error',
      message: err.message || 'Unknown Vue error',
      stack: err.stack || 'No stack trace',
      source: 'Vue',
      info: info || '',
      timestamp: Date.now(),
      url: window.location.href,
    })
  }

  // Vue 警告处理器
  app.config.warnHandler = (msg, vm, trace) => {
    console.warn('Vue Warning:', msg, trace)
    sendErrorToMain({
      type: 'vue-warning',
      message: msg,
      stack: trace || 'No trace',
      source: 'Vue',
      timestamp: Date.now(),
      url: window.location.href,
    })
  }

  // 全局 JavaScript 错误
  window.addEventListener('error', (event) => {
    console.error('Global Error:', event.error)
    sendErrorToMain({
      type: 'javascript-error',
      message: event.error?.message || event.message || 'Unknown error',
      stack: event.error?.stack || 'No stack trace',
      source: event.filename || 'unknown',
      line: event.lineno,
      column: event.colno,
      timestamp: Date.now(),
      url: window.location.href,
    })
  })

  // 未处理的 Promise 拒绝
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled Promise Rejection:', event.reason)
    const reason = event.reason
    sendErrorToMain({
      type: 'unhandledrejection',
      message: reason?.message || String(reason) || 'Unhandled promise rejection',
      stack: reason?.stack || 'No stack trace',
      source: 'Promise',
      timestamp: Date.now(),
      url: window.location.href,
    })
  })

  console.log('渲染进程错误监听已设置')
}

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'Display', component: Display },
    { path: '/display', name: 'Display', component: Display },
    { path: '/showDetail', name: 'ShowDetail', component: ShowDetail },
    { path: '/augment-overlay', name: 'AugmentOverlay', component: PopupAugmentView },
    { path: '/floating-overlay', name: 'FloatingOverlay', component: FloatingView },
    { path: '/champion-stats/:id', name: 'ChampionStats', component: ChampionStats },
  ],
})

const app = createApp(App)

// 设置全局错误监听
setupGlobalErrorHandling(app)

app.config.globalProperties.$api = api

app.use(router)
app.mount('#app')
