// @ts-nocheck
import { app } from 'electron'
import autoScreenshotService from '../auto-screenshot-service.ts'
import { getLCUServiceInstance } from '../services/lcu/lcu-service.ts'
import { getVersionInfo } from '../version-checker.ts'
import logger from './logger.ts'
import store from './app-store.ts'
import { getAppDataDir } from './app-paths.ts'

function withTimeout(promise, timeoutMs, fallback) {
    let timeoutId
    const timeout = new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(fallback), timeoutMs)
        timeoutId.unref?.()
    })

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId))
}

function getStoreBoolean(key, fallback = null) {
    const value = store.get(key)
    return typeof value === 'boolean' ? value : fallback
}

function summarizeAugments(augments = []) {
    return augments.slice(0, 3).map((augment, index) => ({
        slot: Number.isInteger(augment?.detectedSlot) ? augment.detectedSlot : index,
        id: augment?.id ?? augment?.augmentId ?? null,
        name: augment?.name || '',
        rarity: augment?.rarity || 'unknown',
    }))
}

async function collectVersionDiagnostics() {
    const result = await withTimeout(
        getVersionInfo()
            .then((versionInfo) => ({ success: true, versionInfo }))
            .catch((error) => ({ success: false, error: error.message })),
        4000,
        { success: false, error: 'version diagnostics timed out' }
    )

    if (!result.success) {
        return {
            currentVersion: app.getVersion(),
            error: result.error,
        }
    }

    const { versionInfo } = result
    return {
        currentVersion: versionInfo.currentVersion,
        latestVersion: versionInfo.latestVersion || '',
        minimumVersion: versionInfo.minimumVersion || '',
        isNewer: versionInfo.isNewer,
        severity: versionInfo.severity,
        dataVersion: versionInfo.dataVersion || '',
        gamePatch: versionInfo.gamePatch || '',
        generatedAt: versionInfo.generatedAt || '',
        publishedAt: versionInfo.publishedAt || '',
    }
}

async function collectLcuDiagnostics(lolPath) {
    if (!lolPath) {
        return {
            configured: false,
            connected: false,
            gameflowPhase: null,
            champSelect: null,
        }
    }

    const service = getLCUServiceInstance(lolPath)
    const phase = await withTimeout(service.getGameflowPhase(), 3000, null)
    const connected = await withTimeout(service.getLcuStatus(), 1500, false)
    const snapshot = await withTimeout(
        service.getChampSelectSnapshot().catch((error) => ({ error: error.message })),
        3000,
        { error: 'champ-select snapshot timed out' }
    )

    return {
        configured: true,
        connected: Boolean(connected || phase),
        gameflowPhase: phase,
        champSelect: snapshot?.error
            ? { error: snapshot.error }
            : {
                phase: snapshot?.gameflowPhase || null,
                selfChampionId: snapshot?.selfChampionId || null,
                benchEnabled: Boolean(snapshot?.benchEnabled),
                benchCount: snapshot?.benchChampions?.length || 0,
                teamCount: snapshot?.myTeam?.length || 0,
            },
    }
}

function collectConfigDiagnostics(lolPath) {
    return {
        lolPath: lolPath || '',
        lolPathConfigured: Boolean(lolPath),
        itemSetAutoApplyAram: getStoreBoolean('itemSets.autoApplyAram', true),
        autoScreenshotGameflowControl: getStoreBoolean('autoScreenshotGameflowControl', true),
        analyticsEnabled: getStoreBoolean('analytics.enabled', null),
        lastSelectedChampionId: store.get('lastSelectedChampionId') || null,
        appDataDir: getAppDataDir(),
        logDir: logger.getLogDir(),
        currentLogFile: logger.getCurrentLogFile(),
    }
}

function collectOcrDiagnostics() {
    const config = autoScreenshotService.getConfig()
    const stats = autoScreenshotService.getPerformanceStats()
    const recent = autoScreenshotService.getRecentAugmentDiagnostic?.() || {}

    return {
        service: {
            isRunning: config.isRunning,
            interval: config.interval,
            enableAnalysis: config.enableAnalysis,
            gameflowPhase: config.gameflowPhase,
            analysisPausedByGameflow: config.analysisPausedByGameflow,
            controlOwner: config.controlOwner,
            isCapturing: config.isCapturing,
            isAnalyzing: config.isAnalyzing,
            captureTimeoutMs: config.captureTimeoutMs,
            preferScreenCapture: config.preferScreenCapture,
        },
        counters: {
            screenshotCount: stats.screenshotCount,
            analysisCount: stats.analysisCount,
            detectionCount: stats.detectionCount,
            droppedAnalysisCount: stats.droppedAnalysisCount,
            analysisBackpressureSkipCount: stats.analysisBackpressureSkipCount,
            partialOcrSaveCount: stats.partialOcrSaveCount,
        },
        lastTiming: {
            lastScreenshotTime: stats.lastScreenshotTime || null,
            lastAnalysisTime: stats.lastAnalysisTime || null,
            lastAnalysisDuration: stats.lastAnalysisDuration || config.lastAnalysisDuration || 0,
        },
        recentResult: {
            detectedAt: recent.detectedAt || null,
            ageMs: recent.ageMs ?? null,
            ids: recent.ids || [],
            augments: summarizeAugments(recent.augments || []),
            slotFingerprints: recent.slotFingerprints || [],
        },
    }
}

export async function collectDiagnosticSnapshot(reason = 'manual') {
    const lolPath = store.get('lolPath') || ''
    const [version, lcu] = await Promise.all([
        collectVersionDiagnostics(),
        collectLcuDiagnostics(lolPath),
    ])

    return {
        reason,
        collectedAt: logger.toBeijingISOString(),
        app: {
            name: app.getName(),
            version: app.getVersion(),
            packaged: app.isPackaged,
            platform: process.platform,
            arch: process.arch,
            electron: process.versions.electron,
            node: process.versions.node,
        },
        version,
        lcu,
        config: collectConfigDiagnostics(lolPath),
        ocr: collectOcrDiagnostics(),
    }
}

export async function logDiagnosticSnapshot(reason = 'manual') {
    const snapshot = await collectDiagnosticSnapshot(reason)
    logger.info('[diagnostics] app diagnostic snapshot', snapshot)
    return snapshot
}
