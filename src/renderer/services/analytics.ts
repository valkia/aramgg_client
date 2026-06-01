import { initializeApp, getApps, type FirebaseApp, type FirebaseOptions } from 'firebase/app'
import { getAnalytics, isSupported, logEvent, type Analytics } from 'firebase/analytics'

type AnalyticsStatus = {
  enabled?: boolean
  configured?: boolean
  firebaseConfig?: FirebaseOptions
  sampleRate?: number
  pendingEvents?: QueuedAnalyticsEvent[]
}

type ElectronAnalyticsApi = {
  analytics?: {
    getStatus: () => Promise<{ success?: boolean; data?: AnalyticsStatus }>
  }
}

type AnalyticsParams = Record<string, string | number | boolean | null | undefined>
type QueuedAnalyticsEvent = {
  name: string
  params?: AnalyticsParams
}

let analyticsConfig: AnalyticsStatus | null = null
let firebaseApp: FirebaseApp | null = null
let firebaseAnalytics: Analytics | null = null
let initialized = false
const pendingClientEvents: QueuedAnalyticsEvent[] = []

function shouldSample(sampleRate?: number): boolean {
  const rate = Number(sampleRate || 1)
  return rate >= 1 || Math.random() <= rate
}

async function initFirebaseAnalytics(config: FirebaseOptions): Promise<Analytics | null> {
  if (!await isSupported()) {
    return null
  }

  firebaseApp = getApps().find((app) => app.name === 'aramgg-client') ||
    initializeApp(config, 'aramgg-client')
  firebaseAnalytics = getAnalytics(firebaseApp)
  return firebaseAnalytics
}

function getPageLocation(route = ''): string {
  return `app://aramgg${route || window.location.hash || '/'}`
}

function sanitizeEventName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40) || 'app_event'
}

function sanitizeParams(params: AnalyticsParams = {}): AnalyticsParams {
  return Object.fromEntries(
    Object.entries(params)
      .slice(0, 25)
      .map(([key, value]) => {
        if (value == null || typeof value === 'number' || typeof value === 'boolean') {
          return [key, value]
        }

        return [key, String(value).slice(0, 300)]
      })
  )
}

function flushPendingEvents(): void {
  if (!firebaseAnalytics) {
    return
  }

  while (pendingClientEvents.length) {
    const event = pendingClientEvents.shift()
    if (event) {
      logEvent(firebaseAnalytics, sanitizeEventName(event.name), sanitizeParams(event.params))
    }
  }
}

export async function initRendererAnalytics(electronAPI: ElectronAnalyticsApi): Promise<AnalyticsStatus | null> {
  if (initialized || !electronAPI?.analytics) {
    return analyticsConfig
  }

  initialized = true
  const result = await electronAPI.analytics.getStatus()
  if (!result?.success || !result.data?.enabled || !result.data?.configured || !result.data?.firebaseConfig) {
    analyticsConfig = result?.data || null
    return analyticsConfig
  }

  const firebaseConfig = result.data.firebaseConfig
  analyticsConfig = result.data
  if (!shouldSample(analyticsConfig.sampleRate)) {
    return analyticsConfig
  }

  await initFirebaseAnalytics(firebaseConfig)
  for (const event of analyticsConfig.pendingEvents || []) {
    pendingClientEvents.push(event)
  }
  trackAnalyticsEvent('app_start')
  flushPendingEvents()
  return analyticsConfig
}

export function trackPageView(routeName: unknown, routePath?: string): void {
  if (!analyticsConfig?.enabled || !firebaseAnalytics) {
    return
  }

  const pagePath = routePath || window.location.hash || '/'
  const pageTitle = String(routeName || pagePath)

  logEvent(firebaseAnalytics, 'page_view', {
    page_title: pageTitle,
    page_path: pagePath,
    page_location: getPageLocation(pagePath),
  })
}

export function trackAnalyticsEvent(name: string, params: AnalyticsParams = {}): void {
  if (!analyticsConfig) {
    pendingClientEvents.push({
      name,
      params: sanitizeParams(params),
    })
    if (pendingClientEvents.length > 30) {
      pendingClientEvents.shift()
    }
    return
  }

  if (!analyticsConfig.enabled || !firebaseAnalytics) {
    return
  }

  logEvent(firebaseAnalytics, sanitizeEventName(name), sanitizeParams(params))
}

export function trackErrorEvent(type: string, error: unknown, params: AnalyticsParams = {}): void {
  const normalized =
    error instanceof Error
      ? {
          message: error.message,
          name: error.name,
          stack: error.stack || '',
        }
      : {
          message: String(error || 'unknown'),
          name: typeof error,
          stack: '',
        }

  trackAnalyticsEvent(type, {
    ...params,
    error_name: normalized.name,
    message: normalized.message.slice(0, 300),
    stack_head: normalized.stack.slice(0, 300),
  })
}
