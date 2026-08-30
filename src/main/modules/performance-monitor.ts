import { app, BrowserWindow, type ProcessMetric } from 'electron'
import {
    monitorEventLoopDelay,
    performance,
    type EventLoopUtilization,
    type IntervalHistogram,
} from 'node:perf_hooks'
import autoScreenshotService from '../auto-screenshot-service.ts'
import { getLcuProcessDiscoveryStats } from '../services/lcu/process-auth-discovery.ts'
import logger from './logger.ts'
import { resolvePerformanceSampleInterval } from './performance-monitor-utils.ts'

const DEFAULT_SAMPLE_INTERVAL_MS = 10000
const SUSTAINED_HIGH_CPU_PERCENT = 25
const SUSTAINED_HIGH_CPU_SAMPLE_COUNT = 3
const HIGH_CPU_WARNING_INTERVAL_MS = 60000
const LCU_DISCOVERY_CHURN_MIN_QUERIES = 3
const LCU_DISCOVERY_WARNING_INTERVAL_MS = 60000

type WindowPerformanceState = {
    id: number
    route: string
    rendererPid: number
    visible: boolean
    minimized: boolean
    focused: boolean
    devToolsOpen: boolean
    devToolsPid: number | null
}

type ProcessPerformanceState = {
    pid: number
    type: ProcessMetric['type']
    name: string
    labels: string[]
    cpuPercent: number
    cumulativeCpuSeconds: number | null
    workingSetMB: number
    privateMemoryMB: number | null
}

let sampleTimer: NodeJS.Timeout | null = null
let eventLoopDelay: IntervalHistogram | null = null
let previousEventLoopUtilization: EventLoopUtilization | null = null
let sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS
let startedAt = 0
let lastSampleAt = 0
let sampleCount = 0
let totalCpuPercentSum = 0
let peakCpuPercent = 0
let peakWorkingSetMB = 0
let sustainedHighCpuSamples = 0
let lastHighCpuWarningAt = 0
let lastLcuDiscoveryWarningAt = 0
let sampleInProgress = false
let previousLcuDiscoveryQueryCount = 0
let previousLcuDiscoveryAttemptCount = 0

function round(value: number, digits: number = 1): number {
    if (!Number.isFinite(value)) {
        return 0
    }

    const factor = 10 ** digits
    return Math.round(value * factor) / factor
}

function getWindowRoute(url: string): string {
    try {
        const hash = new URL(url).hash.replace(/^#/, '')
        return hash || '/'
    } catch {
        return 'unavailable'
    }
}

function addProcessLabel(labelsByPid: Map<number, string[]>, pid: number, label: string): void {
    if (!Number.isInteger(pid) || pid <= 0) {
        return
    }

    const labels = labelsByPid.get(pid) || []
    if (!labels.includes(label)) {
        labels.push(label)
    }
    labelsByPid.set(pid, labels)
}

function collectWindowPerformanceState(): {
    windows: WindowPerformanceState[]
    labelsByPid: Map<number, string[]>
} {
    const labelsByPid = new Map<number, string[]>()
    const windows = BrowserWindow.getAllWindows()
        .filter(window => !window.isDestroyed())
        .map((window): WindowPerformanceState => {
            const { webContents } = window
            const route = getWindowRoute(webContents.getURL())
            const rendererPid = webContents.getOSProcessId()
            const devToolsContents = webContents.devToolsWebContents
            const devToolsPid = devToolsContents && !devToolsContents.isDestroyed()
                ? devToolsContents.getOSProcessId()
                : null

            addProcessLabel(labelsByPid, rendererPid, `renderer:${route}`)
            if (devToolsPid) {
                addProcessLabel(labelsByPid, devToolsPid, `devtools:${route}`)
            }

            return {
                id: window.id,
                route,
                rendererPid,
                visible: window.isVisible(),
                minimized: window.isMinimized(),
                focused: window.isFocused(),
                devToolsOpen: webContents.isDevToolsOpened(),
                devToolsPid,
            }
        })

    return { windows, labelsByPid }
}

function collectProcessPerformanceState(
    labelsByPid: Map<number, string[]>
): ProcessPerformanceState[] {
    return app.getAppMetrics()
        .map((metric): ProcessPerformanceState => ({
            pid: metric.pid,
            type: metric.type,
            name: metric.name || metric.serviceName || '',
            labels: labelsByPid.get(metric.pid) || [],
            cpuPercent: round(metric.cpu.percentCPUUsage, 1),
            cumulativeCpuSeconds: metric.cpu.cumulativeCPUUsage == null
                ? null
                : round(metric.cpu.cumulativeCPUUsage, 2),
            workingSetMB: round(metric.memory.workingSetSize / 1024, 1),
            privateMemoryMB: metric.memory.privateBytes == null
                ? null
                : round(metric.memory.privateBytes / 1024, 1),
        }))
        .sort((left, right) => right.cpuPercent - left.cpuPercent)
}

function collectOcrState() {
    try {
        const config = autoScreenshotService.getConfig()
        const stats = autoScreenshotService.getPerformanceStats()
        return {
            running: Boolean(config.isRunning),
            gameflowPhase: config.gameflowPhase || null,
            intervalMs: config.interval || null,
            capturing: Boolean(config.isCapturing),
            analyzing: Boolean(config.isAnalyzing),
            screenshotCount: stats.screenshotCount || 0,
            analysisCount: stats.analysisCount || 0,
            lastAnalysisDurationMs: round(stats.lastAnalysisDuration || 0, 1),
        }
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : String(error),
        }
    }
}

function collectLcuDiscoveryState() {
    const stats = getLcuProcessDiscoveryStats()
    const state = {
        ...stats,
        queriesSinceLastSample: Math.max(
            0,
            stats.queryCount - previousLcuDiscoveryQueryCount
        ),
        powershellAttemptsSinceLastSample: Math.max(
            0,
            stats.powershellAttemptCount - previousLcuDiscoveryAttemptCount
        ),
    }
    previousLcuDiscoveryQueryCount = stats.queryCount
    previousLcuDiscoveryAttemptCount = stats.powershellAttemptCount
    return state
}

function readEventLoopState() {
    const currentUtilization = performance.eventLoopUtilization()
    const delta = previousEventLoopUtilization
        ? performance.eventLoopUtilization(currentUtilization, previousEventLoopUtilization)
        : currentUtilization
    previousEventLoopUtilization = currentUtilization

    const histogram = eventLoopDelay
    const delay = histogram
        ? {
            meanMs: round(histogram.mean / 1e6, 2),
            p95Ms: round(histogram.percentile(95) / 1e6, 2),
            p99Ms: round(histogram.percentile(99) / 1e6, 2),
            maxMs: round(histogram.max / 1e6, 2),
        }
        : null
    histogram?.reset()

    return {
        utilizationPercent: round(delta.utilization * 100, 1),
        delay,
    }
}

function takePerformanceSample(): void {
    if (sampleInProgress) {
        return
    }

    sampleInProgress = true
    try {
        const sampledAt = Date.now()
        const elapsedMs = lastSampleAt ? sampledAt - lastSampleAt : sampleIntervalMs
        lastSampleAt = sampledAt

        const { windows, labelsByPid } = collectWindowPerformanceState()
        const processes = collectProcessPerformanceState(labelsByPid)
        const totalCpuPercent = round(
            processes.reduce((total, metric) => total + metric.cpuPercent, 0),
            1
        )
        const totalWorkingSetMB = round(
            processes.reduce((total, metric) => total + metric.workingSetMB, 0),
            1
        )
        const mainMemory = process.memoryUsage()
        const eventLoop = readEventLoopState()
        const lcuDiscovery = collectLcuDiscoveryState()

        sampleCount += 1
        totalCpuPercentSum += totalCpuPercent
        peakCpuPercent = Math.max(peakCpuPercent, totalCpuPercent)
        peakWorkingSetMB = Math.max(peakWorkingSetMB, totalWorkingSetMB)
        sustainedHighCpuSamples = totalCpuPercent >= SUSTAINED_HIGH_CPU_PERCENT
            ? sustainedHighCpuSamples + 1
            : 0

        const payload = {
            sample: sampleCount,
            elapsedMs,
            timerDriftMs: Math.max(0, elapsedMs - sampleIntervalMs),
            totalCpuPercent,
            totalWorkingSetMB,
            mainHeapUsedMB: round(mainMemory.heapUsed / 1024 / 1024, 1),
            eventLoop,
            windows,
            ocr: collectOcrState(),
            lcuDiscovery,
            processes,
        }
        logger.debug('[performance] resource sample', payload)

        if (
            sustainedHighCpuSamples >= SUSTAINED_HIGH_CPU_SAMPLE_COUNT &&
            sampledAt - lastHighCpuWarningAt >= HIGH_CPU_WARNING_INTERVAL_MS
        ) {
            lastHighCpuWarningAt = sampledAt
            logger.warn('[performance] sustained Electron CPU usage detected', {
                totalCpuPercent,
                consecutiveSamples: sustainedHighCpuSamples,
                hottestProcesses: processes.slice(0, 5),
                visibleRoutes: windows.filter(window => window.visible).map(window => window.route),
                openDevTools: windows.filter(window => window.devToolsOpen).map(window => window.route),
                ocr: payload.ocr,
                lcuDiscovery: payload.lcuDiscovery,
            })
        }

        if (
            lcuDiscovery.queriesSinceLastSample >= LCU_DISCOVERY_CHURN_MIN_QUERIES &&
            sampledAt - lastLcuDiscoveryWarningAt >= LCU_DISCOVERY_WARNING_INTERVAL_MS
        ) {
            lastLcuDiscoveryWarningAt = sampledAt
            logger.warn('[performance] repeated LCU process discovery detected', {
                queriesSinceLastSample: lcuDiscovery.queriesSinceLastSample,
                powershellAttemptsSinceLastSample:
                    lcuDiscovery.powershellAttemptsSinceLastSample,
                estimatedQueriesPerMinute: round(
                    lcuDiscovery.queriesSinceLastSample * 60000 / Math.max(elapsedMs, 1),
                    0
                ),
                lastQueryDurationMs: lcuDiscovery.lastQueryDurationMs,
                lastAttemptDurationsMs: lcuDiscovery.lastAttemptDurationsMs,
                diagnosticHint:
                    'Check whether inactive LCU polling is bypassing the auth failure cooldown.',
            })
        }
    } catch (error) {
        logger.warn(
            '[performance] resource sample failed:',
            error instanceof Error ? error.message : String(error)
        )
    } finally {
        sampleInProgress = false
    }
}

async function logGpuDiagnostics(): Promise<void> {
    try {
        const [featureStatus, gpuInfo] = await Promise.all([
            Promise.resolve(app.getGPUFeatureStatus()),
            app.getGPUInfo('basic'),
        ])
        const info = gpuInfo as Record<string, unknown>
        logger.debug('[performance] GPU diagnostics', {
            featureStatus,
            gpuDevice: info.gpuDevice || [],
            auxAttributes: info.auxAttributes || {},
        })
    } catch (error) {
        logger.warn(
            '[performance] GPU diagnostics failed:',
            error instanceof Error ? error.message : String(error)
        )
    }
}

export function startPerformanceMonitor(): void {
    if (sampleTimer || process.env.ARAMGG_PERFORMANCE_LOGGING === '0') {
        return
    }

    sampleIntervalMs = resolvePerformanceSampleInterval(
        process.env.ARAMGG_PERFORMANCE_LOG_INTERVAL_MS
    )
    startedAt = Date.now()
    lastSampleAt = startedAt
    sampleCount = 0
    totalCpuPercentSum = 0
    peakCpuPercent = 0
    peakWorkingSetMB = 0
    sustainedHighCpuSamples = 0
    lastHighCpuWarningAt = 0
    lastLcuDiscoveryWarningAt = 0
    const lcuDiscoveryStats = getLcuProcessDiscoveryStats()
    previousLcuDiscoveryQueryCount = lcuDiscoveryStats.queryCount
    previousLcuDiscoveryAttemptCount = lcuDiscoveryStats.powershellAttemptCount
    previousEventLoopUtilization = performance.eventLoopUtilization()
    eventLoopDelay = monitorEventLoopDelay({ resolution: 50 })
    eventLoopDelay.enable()

    const { windows } = collectWindowPerformanceState()
    app.getAppMetrics()
    logger.info('[performance] resource monitor started', {
        intervalMs: sampleIntervalMs,
        highCpuThresholdPercent: SUSTAINED_HIGH_CPU_PERCENT,
        windows,
    })
    void logGpuDiagnostics()

    sampleTimer = setInterval(takePerformanceSample, sampleIntervalMs)
    sampleTimer.unref?.()
}

export function stopPerformanceMonitor(reason: string = 'app quit'): void {
    if (!sampleTimer && !eventLoopDelay) {
        return
    }

    if (sampleTimer) {
        clearInterval(sampleTimer)
        sampleTimer = null
    }
    eventLoopDelay?.disable()
    eventLoopDelay = null
    previousEventLoopUtilization = null

    logger.info('[performance] resource monitor stopped', {
        reason,
        durationMs: startedAt ? Date.now() - startedAt : 0,
        sampleCount,
        averageCpuPercent: sampleCount ? round(totalCpuPercentSum / sampleCount, 1) : 0,
        peakCpuPercent: round(peakCpuPercent, 1),
        peakWorkingSetMB: round(peakWorkingSetMB, 1),
    })
}
