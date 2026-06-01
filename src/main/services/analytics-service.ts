// @ts-nocheck
import crypto from 'crypto'
import store from '../modules/app-store.ts'
import logger from '../modules/logger.ts'
import { loadDataApiConfig } from '../data-loader.ts'

const INSTALLATION_ID_KEY = 'analytics.installationId'
const ENABLED_KEY = 'analytics.enabled'
const LAST_RUN_KEY = 'analytics.lastRun'
const PENDING_EVENTS_KEY = 'analytics.pendingEvents'
const CONFIG_REFRESH_MS = 5 * 60 * 1000
const MAX_PENDING_EVENTS = 30
const DEFAULT_FIREBASE_CONFIG = {
    apiKey: 'AIzaSyC_9HX7hp3dqOSiup-H57Kj4qe1I8jVmPg',
    authDomain: 'aramgg-client.firebaseapp.com',
    projectId: 'aramgg-client',
    storageBucket: 'aramgg-client.firebasestorage.app',
    messagingSenderId: '781910915674',
    appId: '1:781910915674:web:31d9721dfae44c0026b663',
    measurementId: 'G-CHG0KEV5K1',
}

let sessionId = crypto.randomUUID()
let initialized = false
let config = null
let lastConfigLoadAt = 0

function getInstallationId() {
    let installationId = store.get(INSTALLATION_ID_KEY)
    if (!installationId) {
        installationId = crypto.randomUUID()
        store.set(INSTALLATION_ID_KEY, installationId)
    }

    return installationId
}

function toBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
        return value
    }

    if (typeof value === 'string') {
        return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
    }

    return fallback
}

function getExplicitEnabledPreference() {
    const value = store.get(ENABLED_KEY)
    return typeof value === 'boolean' ? value : null
}

function sanitizeEventParams(params = {}) {
    if (!params || typeof params !== 'object') {
        return {}
    }

    return Object.fromEntries(
        Object.entries(params)
            .slice(0, 30)
            .map(([key, value]) => {
                if (value == null || typeof value === 'number' || typeof value === 'boolean') {
                    return [key, value]
                }

                return [key, String(value).slice(0, 300)]
            })
    )
}

function getPendingEvents() {
    const pendingEvents = store.get(PENDING_EVENTS_KEY)
    return Array.isArray(pendingEvents) ? pendingEvents : []
}

export function recordPendingAnalyticsEvent(name, params = {}) {
    const event = {
        name: String(name || 'app_event').slice(0, 40),
        params: {
            ...sanitizeEventParams(params),
            queued_at: Date.now(),
        },
    }
    const pendingEvents = [...getPendingEvents(), event].slice(-MAX_PENDING_EVENTS)
    store.set(PENDING_EVENTS_KEY, pendingEvents)
}

function consumePendingEvents() {
    const pendingEvents = getPendingEvents()
    store.set(PENDING_EVENTS_KEY, [])
    return pendingEvents
}

function detectPreviousUncleanExit() {
    const lastRun = store.get(LAST_RUN_KEY)
    if (lastRun?.startedAt && !lastRun?.cleanExit) {
        recordPendingAnalyticsEvent('app_unclean_exit', {
            previous_started_at: lastRun.startedAt,
            previous_version: lastRun.version || '',
        })
    }
}

export function markAnalyticsAppStarted(version = '') {
    detectPreviousUncleanExit()
    store.set(LAST_RUN_KEY, {
        startedAt: new Date().toISOString(),
        version,
        cleanExit: false,
    })
}

export function markAnalyticsAppCleanExit() {
    const lastRun = store.get(LAST_RUN_KEY) || {}
    store.set(LAST_RUN_KEY, {
        ...lastRun,
        cleanExit: true,
        exitedAt: new Date().toISOString(),
    })
}

async function loadAnalyticsConfig(force = false) {
    const now = Date.now()
    if (!force && config && now - lastConfigLoadAt < CONFIG_REFRESH_MS) {
        return config
    }

    let remoteAnalytics = {}
    try {
        const remoteConfig = await loadDataApiConfig({ force })
        remoteAnalytics = remoteConfig?.analytics || {}
    } catch (error) {
        logger.debug('[analytics] remote analytics config unavailable:', error.message)
    }

    const firebaseConfig = {
        ...DEFAULT_FIREBASE_CONFIG,
        ...(remoteAnalytics.firebaseConfig || {}),
    }
    if (process.env.ARAMGG_FIREBASE_MEASUREMENT_ID) {
        firebaseConfig.measurementId = process.env.ARAMGG_FIREBASE_MEASUREMENT_ID
    }
    const explicitEnabled = getExplicitEnabledPreference()
    const remoteEnabled = toBoolean(remoteAnalytics.enabled, Boolean(firebaseConfig.appId && firebaseConfig.measurementId))
    const enabled = explicitEnabled ?? toBoolean(process.env.ARAMGG_ANALYTICS_ENABLED, remoteEnabled)

    config = {
        enabled,
        provider: remoteAnalytics.provider || 'firebase',
        firebaseConfig,
        sampleRate: Number(remoteAnalytics.sampleRate ?? process.env.ARAMGG_ANALYTICS_SAMPLE_RATE ?? 1) || 1,
    }
    lastConfigLoadAt = now

    return config
}

export async function initAnalyticsService() {
    if (initialized) {
        return getAnalyticsStatus()
    }

    initialized = true
    markAnalyticsAppStarted()
    await loadAnalyticsConfig(true)
    return getAnalyticsStatus()
}

export async function getAnalyticsStatus() {
    const currentConfig = await loadAnalyticsConfig()
    return {
        enabled: currentConfig.enabled,
        configured: Boolean(currentConfig.firebaseConfig?.appId && currentConfig.firebaseConfig?.measurementId),
        provider: currentConfig.provider,
        firebaseConfig: currentConfig.firebaseConfig,
        sampleRate: currentConfig.sampleRate,
        installationId: getInstallationId(),
        sessionId,
        pendingEvents: consumePendingEvents(),
    }
}

export async function setAnalyticsEnabled(enabled) {
    store.set(ENABLED_KEY, Boolean(enabled))
    await loadAnalyticsConfig(true)
    return getAnalyticsStatus()
}

export async function trackAnalyticsEvent() {
    return { success: true, skipped: true }
}
