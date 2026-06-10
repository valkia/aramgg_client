import { createApp } from 'vue'
import App from './App.vue'
import api from './request/api/api'
import './styles/index.css'
import { createRouter, createWebHashHistory } from 'vue-router'

import Display from './components/Display.vue'
import PopupAugmentView from './components/PopupAugmentView.vue'
import FloatingView from './components/FloatingView.vue'
import AugmentSidePanelView from './components/AugmentSidePanelView.vue'
import { electronAPI, hasElectronAPI } from './native/electron-api.js'
import { initRendererAnalytics, trackErrorEvent, trackPageView, trackAnalyticsEvent } from './services/analytics.ts'

let appMounted = false

/**
 * 发送错误到主进程
 * @param {Object} errorData 错误数据
 */
function sendErrorToMain(errorData) {
  try {
    if (hasElectronAPI()) {
      Promise.resolve(electronAPI.diagnostics.logRendererError({
        ...errorData,
        userAgent: navigator.userAgent,
      })).catch((err) => {
        console.error('发送错误到主进程失败:', err)
      })
    }
  } catch (e) {
    console.error('发送错误到主进程失败:', e)
  }
}

function normalizeError(error) {
  if (error instanceof Error) {
    return {
      message: error.message || 'Unknown error',
      stack: error.stack || 'No stack trace',
      name: error.name || 'Error',
    }
  }

  return {
    message: String(error || 'Unknown error'),
    stack: 'No stack trace',
    name: typeof error,
  }
}

function getVueComponentName(instance) {
  const type = instance?.type || instance?.$?.type
  return type?.name || type?.__name || instance?.$options?.name || 'anonymous'
}

function getRouteSnapshot() {
  return {
    href: window.location.href,
    hash: window.location.hash,
    pathname: window.location.pathname,
  }
}

function shouldInitializeAnalyticsForCurrentWindow() {
  const hash = window.location.hash || ''
  return !hash || hash === '#' || hash === '#/' || hash.startsWith('#/display')
}

const analyticsEnabledForWindow = shouldInitializeAnalyticsForCurrentWindow()

/**
 * 设置全局错误监听
 */
function setupGlobalErrorHandling(app) {
  // Vue 错误处理器
  app.config.errorHandler = (err, instance, info) => {
    const normalizedError = normalizeError(err)
    console.error('Vue Error:', err, info)
    if (analyticsEnabledForWindow) {
      trackErrorEvent('vue_error', err, {
        component: getVueComponentName(instance),
        info: info || '',
        route: window.location.hash || '/',
      })
    }
    sendErrorToMain({
      type: 'vue-error',
      message: normalizedError.message,
      stack: normalizedError.stack,
      errorName: normalizedError.name,
      source: 'Vue',
      info: info || '',
      componentName: getVueComponentName(instance),
      route: getRouteSnapshot(),
      timestamp: Date.now(),
      url: window.location.href,
    })
  }

  // Vue 警告处理器
  app.config.warnHandler = (msg, vm, trace) => {
    console.warn('Vue Warning:', msg, trace)
    if (analyticsEnabledForWindow) {
      trackAnalyticsEvent('vue_warning', {
        message: String(msg || '').slice(0, 300),
        route: window.location.hash || '/',
      })
    }
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
    const normalizedError = normalizeError(event.error || event.message)
    console.error('Global Error:', event.error)
    if (analyticsEnabledForWindow) {
      trackErrorEvent('javascript_error', event.error || event.message, {
        source: event.filename || 'unknown',
        line: event.lineno || 0,
        column: event.colno || 0,
        route: window.location.hash || '/',
      })
    }
    sendErrorToMain({
      type: 'javascript-error',
      message: normalizedError.message || event.message || 'Unknown error',
      stack: normalizedError.stack,
      errorName: normalizedError.name,
      source: event.filename || 'unknown',
      line: event.lineno,
      column: event.colno,
      route: getRouteSnapshot(),
      timestamp: Date.now(),
      url: window.location.href,
    })
  })

  // 未处理的 Promise 拒绝
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled Promise Rejection:', event.reason)
    const reason = normalizeError(event.reason)
    if (analyticsEnabledForWindow) {
      trackErrorEvent('unhandled_rejection', event.reason, {
        route: window.location.hash || '/',
      })
    }
    sendErrorToMain({
      type: 'unhandledrejection',
      message: reason.message || 'Unhandled promise rejection',
      stack: reason.stack,
      errorName: reason.name,
      source: 'Promise',
      route: getRouteSnapshot(),
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
    { path: '/augment-overlay', name: 'AugmentOverlay', component: PopupAugmentView },
    { path: '/floating-overlay', name: 'FloatingOverlay', component: FloatingView },
    { path: '/augment-side-panel', name: 'AugmentSidePanel', component: AugmentSidePanelView },
  ],
})

router.afterEach((to) => {
  if (analyticsEnabledForWindow) {
    trackPageView(to.name, to.fullPath || to.path)
  }
})

const app = createApp(App)

// 设置全局错误监听
setupGlobalErrorHandling(app)

app.config.globalProperties.$api = api

app.use(router)
app.mount('#app')
appMounted = true

setTimeout(() => {
  const root = document.getElementById('app')
  const looksBlank = !appMounted || !root || root.childElementCount === 0 || (root.textContent || '').trim().length < 3
  if (analyticsEnabledForWindow && looksBlank) {
    trackAnalyticsEvent('white_screen_detected', {
      route: window.location.hash || '/',
      child_count: root?.childElementCount || 0,
      text_length: (root?.textContent || '').trim().length,
    })
  }
}, 5000)

if (hasElectronAPI() && analyticsEnabledForWindow) {
  initRendererAnalytics(electronAPI)
    .then(() => {
      const route = router.currentRoute.value
      trackPageView(route.name, route.fullPath || route.path)
    })
    .catch((error) => {
      console.warn('Failed to initialize analytics:', error)
    })
}
