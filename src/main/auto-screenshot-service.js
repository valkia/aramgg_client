/**
 * 定时截图服务
 * 功能：定期自动截图、分析和识别海克斯卡片
 *
 * 【重要说明】
 * 浮窗位置已调整到屏幕顶部(top: 2%)，与OCR识别区域(从25%开始)完全不重叠
 * 因此截图时无需隐藏浮窗，避免了闪烁问题
 */

import { captureScreenshot } from './screenshot.js'
import { analyzeScreenshot, warmupImageAnalyzer } from './image-analyzer.js'
import { BrowserWindow } from 'electron'
import Store from 'electron-store'
import fs from 'fs-extra'
import path from 'path'
import logger from './modules/logger.js'
import { applyFloatingWindowLayout } from './modules/window-manager.js'
import { getConfigDir, getPartialOcrScreenshotDir } from './modules/app-paths.js'
import { getAugmentIds, mergePartialAugments } from './augment-partial-merge.js'

const store = new Store({ cwd: getConfigDir() })
const AUTO_SCREENSHOT_SUMMARY_INTERVAL_MS = 10000
const ANALYSIS_MISS_LOG_INTERVAL_MS = 10000
const PARTIAL_OCR_SAVE_INTERVAL_MS = 10000
const PARTIAL_OCR_MAX_FILES = 60
const AUGMENT_WINRATE_INLINE_WAIT_MS = 80
const VISIBLE_AUGMENT_NO_MATCH_GRACE_MS = 900
const VISIBLE_AUGMENT_PARTIAL_GRACE_MS = 2500
const VISIBLE_AUGMENT_NO_MATCH_MISSES_BEFORE_CLEAR = 1
const VISIBLE_AUGMENT_PARTIAL_MISSES_BEFORE_CLEAR = 3

function getSafeTimestampForFile() {
    return logger.toBeijingISOString().replace(/[:.]/g, '-').replace('+08-00', '+0800')
}

function getAugmentSummary(augments = []) {
    return augments.map((aug, index) => {
        if (aug?.missing) {
            return `empty-slot-${aug.detectedSlot ?? index}`
        }

        return `${aug?.name || 'unknown'}(${aug?.id || 'no-id'})`
    }).join(', ') || 'none'
}

function getSlotFingerprints(slotDiagnostics = []) {
    const fingerprints = []
    for (const diagnostic of slotDiagnostics || []) {
        const slot = diagnostic?.slot
        if (Number.isInteger(slot) && slot >= 0 && slot < 3 && diagnostic.titleFingerprint) {
            fingerprints[slot] = diagnostic.titleFingerprint
        }
    }
    return fingerprints
}

function wait(ms) {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, ms)
        if (typeof timer.unref === 'function') {
            timer.unref()
        }
    })
}

function getPayloadAugmentIds(augments = []) {
    return augments
        .slice(0, 3)
        .map(augment => Number(augment?.id ?? augment?.augmentId))
        .filter(id => Number.isFinite(id))
}

class AutoScreenshotService {
    constructor() {
        this.isRunning = false
        this.intervalId = null
        this.interval = 5000 // 默认5秒
        this.minInterval = 250
        this.maxScreenshots = 50 // 保留字段但已不再使用（截图直接使用内存 Buffer）
        this.screenshotCount = 0
        this.lastScreenshotTime = null
        this.enableAnalysis = true // 是否启用自动分析
        this.gameflowPhase = null
        this.controlOwner = null
        this.analysisCount = 0 // 分析次数
        this.detectionCount = 0 // 成功检测次数
        this.isCapturing = false
        this.isAnalyzing = false
        this.runId = 0
        this.pendingAnalysisBuffer = null
        this.droppedAnalysisCount = 0
        this.analysisBackpressureSkipCount = 0
        this.lastAnalysisTime = null
        this.lastAnalysisDuration = 0
        this.captureTimeoutMs = 2500
        this.preferScreenCapture = true
        this.lastSummaryLogAt = 0
        this.lastAnalysisMissLogAt = 0
        this.lastAnalysisMissKey = ''
        this.analysisMissRepeatCount = 0
        this.lastPartialOcrSaveAt = 0
        this.partialOcrSaveInFlight = false
        this.partialOcrSaveCount = 0
        this.lastDetectedAugmentAt = 0
        this.visibleAugmentMissCount = 0
        this.startedAt = 0
        this.firstCaptureLogged = false
        this.firstDetectionLogged = false
        this.performanceMetrics = {
            captureTime: [], // 截图耗时数组
            memoryUsage: [],  // 内存使用量
        }
        // 上一次检测到的海克斯ID列表（用于判断是否需要更新显示）
        this.lastDetectedAugmentIds = []
        this.lastDetectedAugments = []
        this.lastDetectedAugmentSlotFingerprints = []
    }

    /**
     * 启动定时截图
     * @param {number} intervalMs - 截图间隔（毫秒）
     * @returns {boolean} 是否成功启动
     */
    async start(intervalMs = 5000, owner = 'manual') {
        if (this.isRunning) {
            if (owner === 'manual') {
                this.controlOwner = 'manual'
            }
            logger.info('Auto screenshot already running')
            return false
        }

        this.interval = Math.max(intervalMs, this.minInterval)
        this.runId++
        this.isRunning = true
        this.controlOwner = owner
        this.screenshotCount = 0
        this.analysisCount = 0
        this.detectionCount = 0
        this.isCapturing = false
        this.isAnalyzing = false
        this.pendingAnalysisBuffer = null
        this.droppedAnalysisCount = 0
        this.analysisBackpressureSkipCount = 0
        this.lastScreenshotTime = null
        this.lastAnalysisTime = null
        this.lastAnalysisDuration = 0
        this.lastSummaryLogAt = 0
        this.lastAnalysisMissLogAt = 0
        this.lastAnalysisMissKey = ''
        this.analysisMissRepeatCount = 0
        this.lastPartialOcrSaveAt = 0
        this.partialOcrSaveInFlight = false
        this.partialOcrSaveCount = 0
        this.lastDetectedAugmentAt = 0
        this.visibleAugmentMissCount = 0
        this.lastDetectedAugmentIds = []
        this.lastDetectedAugments = []
        this.lastDetectedAugmentSlotFingerprints = []
        this.startedAt = Date.now()
        this.firstCaptureLogged = false
        this.firstDetectionLogged = false
        this.performanceMetrics = {
            captureTime: [],
            memoryUsage: [],
        }

        logger.info(`Auto screenshot service started with interval: ${this.interval}ms, owner=${owner}`)
        void warmupImageAnalyzer()

        this._scheduleNextCapture(0, this.runId)

        return true
    }

    /**
     * 停止定时截图
     * @returns {boolean} 是否成功停止
     */
    stop(owner = 'manual') {
        if (!this.isRunning) {
            logger.info('Auto screenshot not running')
            return false
        }

        if (owner === 'gameflow' && this.controlOwner === 'manual') {
            logger.info('Auto screenshot is manually controlled; gameflow stop ignored')
            return false
        }

        clearTimeout(this.intervalId)
        this.isRunning = false
        this.runId++
        this.intervalId = null
        this.pendingAnalysisBuffer = null
        this.controlOwner = null
        this.isCapturing = false
        this.isAnalyzing = false

        const runDurationMs = this.startedAt ? Date.now() - this.startedAt : 0
        logger.info(`Auto screenshot service stopped by ${owner}. screenshots=${this.screenshotCount}, analyses=${this.analysisCount}, detections=${this.detectionCount}, replacedPendingAnalyses=${this.droppedAnalysisCount}, backpressureSkippedCaptures=${this.analysisBackpressureSkipCount}, duration=${runDurationMs}ms`)
        return true
    }

    /**
     * 同步 LCU gameflow 阶段。实际对局的 InProgress 允许 OCR；None 保留游戏窗口兜底。
     */
    setGameflowPhase(phase) {
        this.gameflowPhase = phase || null

        if (phase && phase !== 'InProgress' && phase !== 'None') {
            this.pendingAnalysisBuffer = null
            if (this.lastDetectedAugmentIds.length > 0) {
                this.clearAugmentState(`gameflow-${phase}`)
            }
        }
    }

    isAnalysisAllowedByGameflow() {
        return !this.gameflowPhase || this.gameflowPhase === 'InProgress' || this.gameflowPhase === 'None'
    }

    clearAugmentState(reason = 'gameflow-cleared') {
        const previousIds = this.lastDetectedAugmentIds
        const ageMs = this.lastDetectedAugmentAt ? Date.now() - this.lastDetectedAugmentAt : null
        this.lastDetectedAugmentIds = []
        this.lastDetectedAugments = []
        this.lastDetectedAugmentSlotFingerprints = []
        this.lastDetectedAugmentAt = 0
        this.visibleAugmentMissCount = 0
        this.pendingAnalysisBuffer = null
        logger.info('Augment state cleared', {
            reason,
            previousIds,
            ageMs,
        })
        this._notifyAugmentCleared(reason)
    }

    /**
     * 安排下一次截图。使用 setTimeout 串行调度，避免截图任务堆积。
     * @private
     */
    _scheduleNextCapture(delayMs = this.interval, runId = this.runId) {
        if (!this.isRunning || this.intervalId) {
            return
        }

        this.intervalId = setTimeout(async () => {
            this.intervalId = null
            if (!this.isRunning || runId !== this.runId) {
                return
            }

            const cycleStart = performance.now()

            await this._captureScreenshot(runId)

            const elapsed = performance.now() - cycleStart
            const nextDelay = Math.max(0, this.interval - elapsed)
            this._scheduleNextCapture(nextDelay, runId)
        }, delayMs)
    }

    /**
     * 内部方法：执行单次截图
     * 【注意】浮窗已调整到屏幕顶部，与OCR区域不重叠，无需隐藏
     * @private
     */
    async _captureScreenshot(runId = this.runId) {
        if (this.isCapturing) {
            logger.debug('Auto screenshot capture skipped because previous capture is still running')
            return {
                success: false,
                error: 'capture-in-progress',
            }
        }

        if (this.enableAnalysis && this.isAnalysisAllowedByGameflow() && this.isAnalyzing) {
            this.analysisBackpressureSkipCount++
            logger.debug('Auto screenshot capture skipped because OCR analysis is still running')
            return {
                success: false,
                error: 'analysis-backpressure',
            }
        }

        const startTime = performance.now()
        this.isCapturing = true

        try {
            const result = await captureScreenshot({
                preferScreen: this.preferScreenCapture,
                timeoutMs: this.captureTimeoutMs,
            })

            if (!this.isRunning || runId !== this.runId) {
                return {
                    success: false,
                    error: 'capture-stopped',
                }
            }

            const endTime = performance.now()
            const captureTimeMs = endTime - startTime

            if (result.success) {
                this.screenshotCount++
                this.lastScreenshotTime = Date.now()

                // 记录性能数据
                this._recordPerformance(captureTimeMs)

                logger.debug(`[Auto Screenshot ${this.screenshotCount}] captured in ${captureTimeMs.toFixed(2)}ms`)
                if (!this.firstCaptureLogged) {
                    this.firstCaptureLogged = true
                    logger.info('Auto screenshot first capture completed', {
                        captureTimeMs: Number(captureTimeMs.toFixed(1)),
                        sinceStartMs: this.startedAt ? Date.now() - this.startedAt : 0,
                        preferScreenCapture: this.preferScreenCapture,
                    })
                } else if (captureTimeMs > 1000) {
                    logger.warn('Auto screenshot slow capture', {
                        captureTimeMs: Number(captureTimeMs.toFixed(1)),
                        screenshotCount: this.screenshotCount,
                        preferScreenCapture: this.preferScreenCapture,
                    })
                }
                this._logPerformanceSummary()

                if (this.enableAnalysis) {
                    this._queueAnalysis(result.buffer)
                }

                return result
            } else {
                logger.error('Auto screenshot failed:', result.error)
                return result
            }
        } catch (error) {
            logger.error('Auto screenshot error:', error)
            return {
                success: false,
                error: error.message,
            }
        } finally {
            if (runId === this.runId) {
                this.isCapturing = false
            }
        }
    }

    /**
     * OCR 只保留一个正在运行的任务；忙碌时用最新截图替换待分析截图。
     * @private
     */
    _queueAnalysis(imageBuffer) {
        if (!this.isRunning || !this.enableAnalysis || !imageBuffer || !this.isAnalysisAllowedByGameflow()) {
            return
        }

        if (this.isAnalyzing) {
            this.pendingAnalysisBuffer = imageBuffer
            this.droppedAnalysisCount++
            logger.debug('OCR analysis busy; replaced pending analysis buffer with latest screenshot')
            return
        }

        void this._drainAnalysisQueue(imageBuffer, this.runId)
    }

    /**
     * 串行消费 OCR 队列，队列最多保留最新一帧。
     * @private
     */
    async _drainAnalysisQueue(initialBuffer, runId = this.runId) {
        this.isAnalyzing = true
        let currentBuffer = initialBuffer

        try {
            while (
                currentBuffer &&
                this.isRunning &&
                runId === this.runId &&
                this.enableAnalysis &&
                this.isAnalysisAllowedByGameflow()
            ) {
                const startTime = performance.now()
                await this._analyzeScreenshot(currentBuffer)
                if (!this.isRunning || runId !== this.runId) {
                    break
                }
                this.lastAnalysisDuration = performance.now() - startTime
                this.lastAnalysisTime = Date.now()

                currentBuffer = this.pendingAnalysisBuffer
                this.pendingAnalysisBuffer = null
            }
        } finally {
            if (runId === this.runId) {
                this.isAnalyzing = false

                if (this.pendingAnalysisBuffer && this.isRunning && this.enableAnalysis) {
                    const latestBuffer = this.pendingAnalysisBuffer
                    this.pendingAnalysisBuffer = null
                    void this._drainAnalysisQueue(latestBuffer, runId)
                }
            }
        }
    }

    /**
     * 内部方法：分析截图
     * @private
     */
    async _analyzeScreenshot(imageBuffer) {
        try {
            this.analysisCount++
            const analysisStart = performance.now()
            const analysisResult = await analyzeScreenshot(imageBuffer)
            const analysisDuration = performance.now() - analysisStart

            if (!analysisResult.success) {
                this._logAnalysisMiss('analysis-failed', {
                    error: analysisResult.error || 'unknown',
                    durationMs: analysisDuration,
                })
                return  // 分析失败，不继续处理
            }

            const { cardCount, confidence, isAugmentPhase, augments } = analysisResult.analysis
            if (cardCount > 0 && cardCount < 3) {
                this._savePartialOcrScreenshot(imageBuffer, analysisResult, analysisDuration)
            }

            // ✅ 严格的通知条件：
            // 1. 必须检测到 3 张卡片
            // 2. 必须通过间距验证（isAugmentPhase = true）
            // 3. 置信度必须 > 90%（更严格）
            if (cardCount === 3 && isAugmentPhase && confidence > 0.9) {
                const normalizedAugments = augments.slice(0, 3)
                // 检查是否与上次检测到的海克斯相同（避免重复通知）
                const currentIds = getAugmentIds(normalizedAugments)
                const currentIdList = currentIds.join(',')
                const lastIds = this.lastDetectedAugmentIds.join(',')

                if (currentIdList !== lastIds) {
                    // 新的海克斯组合，更新显示
                    this.detectionCount++
                    this.lastDetectedAugmentIds = currentIds
                    this.lastDetectedAugments = normalizedAugments
                    this.lastDetectedAugmentSlotFingerprints = getSlotFingerprints(analysisResult.analysis.slotDiagnostics)
                    this.lastDetectedAugmentAt = Date.now()
                    this.visibleAugmentMissCount = 0

                    logger.info(`Augment detected: count=${cardCount}, confidence=${(confidence * 100).toFixed(1)}%, duration=${analysisDuration.toFixed(1)}ms, augments=${getAugmentSummary(normalizedAugments)}`)
                    this._logFirstDetectionLatency('full', analysisDuration)
                    this._notifyAugmentDetected({
                        ...analysisResult,
                        analysis: {
                            ...analysisResult.analysis,
                            augments: normalizedAugments,
                        },
                    })
                } else {
                    // 与上次相同，跳过通知
                    this.lastDetectedAugmentAt = Date.now()
                    this.visibleAugmentMissCount = 0
                    logger.debug(`[自动分析 ${this.analysisCount}] 海克斯未变化，跳过通知`)
                }
            } else {
                // 检测结果不满足通知条件
                if (cardCount < 3) {
                    this._logAnalysisMiss('insufficient-augments', {
                        cardCount,
                        confidence,
                        isAugmentPhase,
                        durationMs: analysisDuration,
                        augments,
                    })
                    // 切换/刷新海克斯时会有短暂动画帧，OCR 可能只读到 0-2 张。
                    // 保留上一轮已显示结果，只有连续 miss 超过宽限才清空。
                    const hadVisibleAugmentOverlay = this.lastDetectedAugmentIds.length > 0
                    const partialMerge = this._mergePartialAugments(
                        augments,
                        analysisResult.analysis.slotDiagnostics || []
                    )
                    if (partialMerge) {
                        const mergedAugments = partialMerge.augments
                        this.detectionCount++
                        this.lastDetectedAugments = mergedAugments
                        this.lastDetectedAugmentIds = getAugmentIds(mergedAugments)
                        this.lastDetectedAugmentSlotFingerprints = getSlotFingerprints(analysisResult.analysis.slotDiagnostics)
                        this.lastDetectedAugmentAt = Date.now()
                        this.visibleAugmentMissCount = 0
                        logger.info(`Augment partial update accepted: count=${cardCount}, confidence=${(confidence * 100).toFixed(1)}%, duration=${analysisDuration.toFixed(1)}ms, reason=${partialMerge.reason}, clearedSlots=${partialMerge.changedUnmatchedSlots.join(',') || 'none'}, augments=${getAugmentSummary(mergedAugments)}`)
                        this._logFirstDetectionLatency('partial', analysisDuration)
                        this._notifyAugmentDetected({
                            ...analysisResult,
                            analysis: {
                                ...analysisResult.analysis,
                                augments: mergedAugments,
                                cardCount: mergedAugments.length,
                                partialUpdate: true,
                            },
                        })
                        return
                    }

                    const shouldClearVisibleAugments = this._shouldClearVisibleAugmentsAfterMiss({
                        cardCount,
                        augments,
                    })

                    if (hadVisibleAugmentOverlay && shouldClearVisibleAugments) {
                        const clearReason = cardCount === 0
                            ? 'no-augments-detected'
                            : `partial-augments-detected-count-${cardCount}`
                        const ageMs = this.lastDetectedAugmentAt ? Date.now() - this.lastDetectedAugmentAt : null
                        logger.info('Augment overlay cleared after OCR miss', {
                            reason: clearReason,
                            previousIds: this.lastDetectedAugmentIds,
                            ageMs,
                            cardCount,
                        })
                        this.lastDetectedAugmentIds = []
                        this.lastDetectedAugments = []
                        this.lastDetectedAugmentSlotFingerprints = []
                        this.lastDetectedAugmentAt = 0
                        this.visibleAugmentMissCount = 0
                        this._notifyAugmentCleared(clearReason)
                    }
                } else if (!isAugmentPhase) {
                    this._logAnalysisMiss('phase-validation-failed', {
                        cardCount,
                        confidence,
                        isAugmentPhase,
                        durationMs: analysisDuration,
                        augments,
                    })
                } else if (confidence <= 0.9) {
                    this._logAnalysisMiss('low-confidence', {
                        cardCount,
                        confidence,
                        isAugmentPhase,
                        durationMs: analysisDuration,
                        augments,
                    })
                }
            }
        } catch (error) {
            logger.error('Auto screenshot analysis error:', error)
        }
    }

    _logPerformanceSummary(force = false) {
        const now = Date.now()
        if (!force && now - this.lastSummaryLogAt < AUTO_SCREENSHOT_SUMMARY_INTERVAL_MS) {
            return
        }

        this.lastSummaryLogAt = now
        const stats = this.getPerformanceStats()
        logger.info(`Auto screenshot summary: screenshots=${stats.screenshotCount}, analyses=${stats.analysisCount}, detections=${stats.detectionCount}, replacedPendingAnalyses=${stats.droppedAnalysisCount}, backpressureSkippedCaptures=${stats.analysisBackpressureSkipCount}, avgCapture=${stats.averageCaptureTime}ms, lastAnalysis=${stats.lastAnalysisDuration || 0}ms`)
    }

    _shouldClearVisibleAugmentsAfterMiss({ cardCount, augments = [] }) {
        if (this.lastDetectedAugmentIds.length === 0) {
            this.visibleAugmentMissCount = 0
            return false
        }

        this.visibleAugmentMissCount++

        const elapsedSinceLastDetection = Date.now() - this.lastDetectedAugmentAt
        const detectedIds = new Set(getAugmentIds(augments))
        const hasPreviousId = this.lastDetectedAugmentIds.some(id => detectedIds.has(id))

        if (cardCount > 0 && hasPreviousId) {
            logger.debug(`Retaining augment overlay during partial OCR frame: count=${cardCount}, misses=${this.visibleAugmentMissCount}, elapsed=${elapsedSinceLastDetection}ms`)
            return false
        }

        const graceMs = cardCount === 0
            ? VISIBLE_AUGMENT_NO_MATCH_GRACE_MS
            : VISIBLE_AUGMENT_PARTIAL_GRACE_MS
        const missThreshold = cardCount === 0
            ? VISIBLE_AUGMENT_NO_MATCH_MISSES_BEFORE_CLEAR
            : VISIBLE_AUGMENT_PARTIAL_MISSES_BEFORE_CLEAR

        if (elapsedSinceLastDetection < graceMs || this.visibleAugmentMissCount < missThreshold) {
            logger.debug(`Retaining augment overlay after transient OCR miss: count=${cardCount}, misses=${this.visibleAugmentMissCount}/${missThreshold}, elapsed=${elapsedSinceLastDetection}/${graceMs}ms`)
            return false
        }

        return true
    }

    _mergePartialAugments(augments = [], slotDiagnostics = []) {
        return mergePartialAugments({
            augments,
            slotDiagnostics,
            lastDetectedAugmentIds: this.lastDetectedAugmentIds,
            lastDetectedAugments: this.lastDetectedAugments,
            lastDetectedSlotFingerprints: this.lastDetectedAugmentSlotFingerprints,
        })
    }

    _logFirstDetectionLatency(kind, analysisDuration) {
        if (this.firstDetectionLogged) {
            return
        }

        this.firstDetectionLogged = true
        logger.info('Auto screenshot first augment detection latency', {
            kind,
            sinceStartMs: this.startedAt ? Date.now() - this.startedAt : 0,
            screenshots: this.screenshotCount,
            analyses: this.analysisCount,
            analysisDurationMs: Number(analysisDuration.toFixed(1)),
        })
    }

    _logAnalysisMiss(reason, details = {}) {
        const now = Date.now()
        const cardCount = details.cardCount ?? 'n/a'
        const confidence = Number(details.confidence || 0)
        const key = `${reason}:${cardCount}:${Math.round(confidence * 100)}`

        if (key === this.lastAnalysisMissKey) {
            this.analysisMissRepeatCount++
        } else {
            this.lastAnalysisMissKey = key
            this.analysisMissRepeatCount = 1
        }

        if (now - this.lastAnalysisMissLogAt < ANALYSIS_MISS_LOG_INTERVAL_MS && this.analysisMissRepeatCount > 1) {
            return
        }

        this.lastAnalysisMissLogAt = now
        logger.info(`Augment analysis not accepted: reason=${reason}, count=${cardCount}, confidence=${(confidence * 100).toFixed(1)}%, duration=${Number(details.durationMs || 0).toFixed(1)}ms, repeats=${this.analysisMissRepeatCount}, augments=${getAugmentSummary(details.augments)}`)
    }

    _savePartialOcrScreenshot(imageBuffer, analysisResult, analysisDuration) {
        const now = Date.now()
        if (this.partialOcrSaveInFlight || now - this.lastPartialOcrSaveAt < PARTIAL_OCR_SAVE_INTERVAL_MS) {
            return
        }

        this.partialOcrSaveInFlight = true
        this.lastPartialOcrSaveAt = now

        const { cardCount, confidence, augments } = analysisResult.analysis
        const filename = `partial-ocr-${getSafeTimestampForFile()}-count${cardCount}-analysis${this.analysisCount}.png`
        const dir = getPartialOcrScreenshotDir()
        const filePath = path.join(dir, filename)

        void (async () => {
            try {
                await fs.ensureDir(dir)
                await fs.writeFile(filePath, imageBuffer)
                this.partialOcrSaveCount++
                logger.info(`Saved partial OCR screenshot: count=${cardCount}, confidence=${(confidence * 100).toFixed(1)}%, duration=${analysisDuration.toFixed(1)}ms, path=${filePath}, augments=${getAugmentSummary(augments)}`)
                await this._cleanupPartialOcrScreenshots(dir)
            } catch (error) {
                logger.warn('Failed to save partial OCR screenshot:', error.message)
            } finally {
                this.partialOcrSaveInFlight = false
            }
        })()
    }

    async _cleanupPartialOcrScreenshots(dir) {
        try {
            const files = await fs.readdir(dir)
            const screenshotFiles = []

            for (const file of files) {
                if (!file.startsWith('partial-ocr-') || !file.endsWith('.png')) {
                    continue
                }

                const filePath = path.join(dir, file)
                const stats = await fs.stat(filePath)
                screenshotFiles.push({ filePath, mtimeMs: stats.mtimeMs })
            }

            screenshotFiles.sort((a, b) => b.mtimeMs - a.mtimeMs)
            const staleFiles = screenshotFiles.slice(PARTIAL_OCR_MAX_FILES)

            await Promise.all(staleFiles.map(file => fs.remove(file.filePath)))
        } catch (error) {
            logger.debug('Failed to clean partial OCR screenshots:', error.message)
        }
    }

    _isCurrentAugmentPayload(winrateData) {
        const payloadIds = getPayloadAugmentIds(winrateData?.augments).map(String)
        return payloadIds.join(',') === this.lastDetectedAugmentIds.join(',')
    }

    async _loadAugmentWinratePayload(winrateData) {
        const championId = winrateData.championId
        const augmentIds = getPayloadAugmentIds(winrateData.augments)
        if (!championId || augmentIds.length === 0) {
            return null
        }

        const startedAt = Date.now()
        try {
            const { getChampionAugmentStats } = await import('./data-loader.ts')
            const augmentStats = await getChampionAugmentStats(championId)
            const augmentIdSet = new Set(augmentIds)
            const statById = new Map(
                augmentStats
                    .filter(augment => augmentIdSet.has(Number(augment.augmentId ?? augment.id)))
                    .map(augment => [Number(augment.augmentId ?? augment.id), augment])
            )
            const enrichedAugments = winrateData.augments.map(augment => {
                const augmentId = Number(augment?.id ?? augment?.augmentId)
                const stat = statById.get(augmentId)
                if (!stat || augment?.missing) {
                    return augment
                }

                return {
                    ...augment,
                    ...stat,
                    id: stat.id || stat.augmentId || augment.id,
                    augmentId: stat.augmentId || stat.id || augment.id,
                    detectedSlot: augment.detectedSlot,
                    missing: false,
                }
            })

            logger.info('Augment winrate enriched in main', {
                championId,
                augmentIds,
                resultCount: statById.size,
                durationMs: Date.now() - startedAt,
            })

            return {
                ...winrateData,
                augments: enrichedAugments,
                winrateInMain: true,
                winratePending: false,
                winrateResultCount: statById.size,
            }
        } catch (error) {
            logger.warn('Failed to enrich augment winrate in main:', error.message)
            return {
                ...winrateData,
                winrateInMain: true,
                winratePending: false,
                winrateError: error.message,
            }
        }
    }

    _sendAugmentDetectedPayload(winrateData, notifyMode = 'detected') {
        try {
            const windows = BrowserWindow.getAllWindows()
            // 查找浮动窗口并显示
            const floatingWindow = windows.find(win => {
                const url = win.webContents.getURL()
                return url.includes('floating-overlay')
            })

            if (floatingWindow && !floatingWindow.isDestroyed()) {
                applyFloatingWindowLayout()
                // 显示浮动窗口
                if (!floatingWindow.isVisible()) {
                    floatingWindow.show()
                    logger.info('✨ 显示海克斯浮动窗口')
                }
                // 发送数据到浮动窗口
                floatingWindow.webContents.send('augment-detected', winrateData)
            } else {
                logger.warn('⚠️ 未找到浮动窗口，将数据发送给所有窗口')
                // 如果找不到浮动窗口，发送给所有窗口
                windows.forEach(window => {
                    if (!window.isDestroyed()) {
                        window.webContents.send('augment-detected', winrateData)
                    }
                })
            }

            logger.info('Augment detection notification sent', {
                championId: winrateData.championId || null,
                augmentIds: winrateData.augments.map(augment => augment.id),
                partialUpdate: winrateData.partialUpdate,
                analysisConfidence: winrateData.analysisConfidence,
                notifyMode,
                winrateInMain: winrateData.winrateInMain === true,
                winratePending: winrateData.winratePending === true,
                winrateResultCount: winrateData.winrateResultCount ?? null,
                floatingWindowFound: !!floatingWindow && !floatingWindow.isDestroyed(),
                sinceStartMs: this.startedAt ? Date.now() - this.startedAt : 0,
                sinceLastCaptureMs: this.lastScreenshotTime ? Date.now() - this.lastScreenshotTime : 0,
            })
        } catch (error) {
            logger.error('Failed to notify windows:', error)
        }
    }

    /**
     * 通知所有窗口有新的海克斯检测
     * @private
     */
    async _notifyAugmentDetected(analysisResult) {
        try {
            // 从store中获取缓存的英雄ID
            const championId = store.get('lastSelectedChampionId')

            if (!championId) {
                logger.warn('⚠️ 未找到缓存的英雄ID，海克斯推荐可能无法显示胜率数据')
            } else {
                logger.info(`📌 使用缓存的英雄ID: ${championId}`)
            }

            const baseWinrateData = {
                success: true,
                gamePhase: 'augment-select',
                championId: championId || null, // 添加英雄ID
                augments: analysisResult.analysis.augments.slice(0, 3).map((aug, index) => ({
                    id: aug.id ?? null,
                    name: aug.name || '',
                    rarity: aug.rarity || 'unknown',
                    confidence: aug.confidence ?? null,
                    detectedSlot: Number.isInteger(aug.detectedSlot) ? aug.detectedSlot : index,
                    missing: aug.missing === true,
                })),
                analysisConfidence: analysisResult.analysis.confidence,
                partialUpdate: analysisResult.analysis.partialUpdate === true,
                timestamp: analysisResult.timestamp,
                dataSource: 'auto-analysis',
                winrateInMain: false,
                winratePending: false,
            }

            const shouldEnrichWinrate = !!championId && getPayloadAugmentIds(baseWinrateData.augments).length > 0
            if (!shouldEnrichWinrate) {
                this._sendAugmentDetectedPayload(baseWinrateData)
                return
            }

            const timeoutToken = Symbol('augment-winrate-timeout')
            const enrichPromise = this._loadAugmentWinratePayload(baseWinrateData)
            const quickPayload = await Promise.race([
                enrichPromise,
                wait(AUGMENT_WINRATE_INLINE_WAIT_MS).then(() => timeoutToken),
            ])

            if (quickPayload && quickPayload !== timeoutToken) {
                this._sendAugmentDetectedPayload(quickPayload, 'main-winrate-inline')
                return
            }

            this._sendAugmentDetectedPayload({
                ...baseWinrateData,
                winratePending: true,
            }, 'main-winrate-pending')

            enrichPromise.then((enrichedPayload) => {
                if (!enrichedPayload || !this._isCurrentAugmentPayload(enrichedPayload)) {
                    return
                }

                this._sendAugmentDetectedPayload(enrichedPayload, 'main-winrate-late')
            }).catch(error => {
                logger.warn('Late augment winrate enrichment failed:', error.message)
            })
        } catch (error) {
            logger.error('Failed to notify windows:', error)
        }
    }

    /**
     * Notify renderers that the augment selection has disappeared.
     * @private
     */
    _notifyAugmentCleared(reason = 'unknown') {
        try {
            const windows = BrowserWindow.getAllWindows()
            const payload = {
                success: true,
                gamePhase: 'augment-cleared',
                reason,
                timestamp: Date.now(),
                dataSource: 'auto-analysis',
            }

            windows.forEach(window => {
                if (!window.isDestroyed()) {
                    window.webContents.send('augment-cleared', payload)
                }
            })

            const floatingWindow = windows.find(win => {
                const url = win.webContents.getURL()
                return url.includes('floating-overlay')
            })
            const wasFloatingWindowVisible = !!floatingWindow && !floatingWindow.isDestroyed() && floatingWindow.isVisible()
            if (wasFloatingWindowVisible) {
                floatingWindow.hide()
                logger.info('Hidden augment floating window after selection disappeared')
            }

            const popupWindow = windows.find(win => {
                const url = win.webContents.getURL()
                return url.includes('augment-overlay')
            })
            const wasPopupWindowVisible = !!popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()
            if (wasPopupWindowVisible) {
                popupWindow.hide()
                logger.info('Hidden augment popup window after selection disappeared')
            }

            logger.info('Augment clear notification sent', {
                reason,
                windowCount: windows.length,
                floatingWindowWasVisible: wasFloatingWindowVisible,
                popupWindowWasVisible: wasPopupWindowVisible,
            })
        } catch (error) {
            logger.error('Failed to notify augment cleared:', error)
        }
    }

    /**
     * 记录性能指标
     * @private
     */
    _recordPerformance(captureTimeMs) {
        this.performanceMetrics.captureTime.push(captureTimeMs)

        // 只保留最近100条记录
        if (this.performanceMetrics.captureTime.length > 100) {
            this.performanceMetrics.captureTime.shift()
        }

        // 获取内存使用情况
        if (process.memoryUsage) {
            const memUsage = process.memoryUsage()
            this.performanceMetrics.memoryUsage.push(memUsage.heapUsed / 1024 / 1024) // MB

            if (this.performanceMetrics.memoryUsage.length > 100) {
                this.performanceMetrics.memoryUsage.shift()
            }
        }
    }

    /**
     * 获取性能统计
     * @returns {Object} 性能指标
     */
    getPerformanceStats() {
        const captureTimes = this.performanceMetrics.captureTime
        const memoryUsages = this.performanceMetrics.memoryUsage

        if (captureTimes.length === 0) {
            return {
                isRunning: this.isRunning,
                screenshotCount: this.screenshotCount,
                analysisCount: this.analysisCount,
                detectionCount: this.detectionCount,
                droppedAnalysisCount: this.droppedAnalysisCount,
                analysisBackpressureSkipCount: this.analysisBackpressureSkipCount,
                partialOcrSaveCount: this.partialOcrSaveCount,
                gameflowPhase: this.gameflowPhase,
                analysisPausedByGameflow: !this.isAnalysisAllowedByGameflow(),
                controlOwner: this.controlOwner,
                isCapturing: this.isCapturing,
                isAnalyzing: this.isAnalyzing,
                captureTimeoutMs: this.captureTimeoutMs,
                preferScreenCapture: this.preferScreenCapture,
                averageCaptureTime: 0,
                maxCaptureTime: 0,
                minCaptureTime: 0,
                averageMemory: 0,
                maxMemory: 0,
                performanceLevel: this._assessPerformanceLevel(0, 0),
            }
        }

        const avgCapture = captureTimes.reduce((a, b) => a + b, 0) / captureTimes.length
        const maxCapture = Math.max(...captureTimes)
        const minCapture = Math.min(...captureTimes)

        const avgMemory =
            memoryUsages.length > 0
                ? memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length
                : 0
        const maxMemory = memoryUsages.length > 0 ? Math.max(...memoryUsages) : 0

        return {
            isRunning: this.isRunning,
            screenshotCount: this.screenshotCount,
            analysisCount: this.analysisCount,
            detectionCount: this.detectionCount,
            droppedAnalysisCount: this.droppedAnalysisCount,
            analysisBackpressureSkipCount: this.analysisBackpressureSkipCount,
            partialOcrSaveCount: this.partialOcrSaveCount,
            gameflowPhase: this.gameflowPhase,
            analysisPausedByGameflow: !this.isAnalysisAllowedByGameflow(),
            controlOwner: this.controlOwner,
            isCapturing: this.isCapturing,
            isAnalyzing: this.isAnalyzing,
            captureTimeoutMs: this.captureTimeoutMs,
            preferScreenCapture: this.preferScreenCapture,
            lastAnalysisTime: this.lastAnalysisTime,
            lastAnalysisDuration: parseFloat(this.lastAnalysisDuration.toFixed(2)),
            detectionRate: this.analysisCount > 0 ? (this.detectionCount / this.analysisCount * 100).toFixed(1) : 0,
            interval: this.interval,
            lastScreenshotTime: this.lastScreenshotTime,
            averageCaptureTime: parseFloat(avgCapture.toFixed(2)),
            maxCaptureTime: parseFloat(maxCapture.toFixed(2)),
            minCaptureTime: parseFloat(minCapture.toFixed(2)),
            averageMemory: parseFloat(avgMemory.toFixed(2)),
            maxMemory: parseFloat(maxMemory.toFixed(2)),
            performanceLevel: this._assessPerformanceLevel(avgCapture, avgMemory),
        }
    }

    /**
     * 评估性能等级
     * @private
     */
    _assessPerformanceLevel(captureTimeMs, memoryMB) {
        if (captureTimeMs < 100 && memoryMB < 200) {
            return {
                level: 'excellent',
                score: 95,
                label: '优秀 - 对游戏基本无影响',
                color: '#27ae60',
            }
        } else if (captureTimeMs < 200 && memoryMB < 300) {
            return {
                level: 'good',
                score: 85,
                label: '良好 - 对游戏影响很小',
                color: '#f39c12',
            }
        } else if (captureTimeMs < 500 && memoryMB < 500) {
            return {
                level: 'fair',
                score: 70,
                label: '一般 - 可能有轻微影响',
                color: '#e67e22',
            }
        } else {
            return {
                level: 'poor',
                score: 50,
                label: '较差 - 可能影响游戏性能',
                color: '#e74c3c',
            }
        }
    }

    /**
     * 设置配置
     * @param {Object} config - 配置对象
     */
    setConfig(config) {
        if (config.interval !== undefined && config.interval > 0) {
            this.interval = Math.max(config.interval, this.minInterval)
        }
        if (config.maxScreenshots !== undefined && config.maxScreenshots > 0) {
            this.maxScreenshots = config.maxScreenshots
        }
        if (config.enableAnalysis !== undefined) {
            this.enableAnalysis = config.enableAnalysis
        }
        if (config.captureTimeoutMs !== undefined && config.captureTimeoutMs > 0) {
            this.captureTimeoutMs = config.captureTimeoutMs
        }
        if (config.preferScreenCapture !== undefined) {
            this.preferScreenCapture = config.preferScreenCapture !== false
        }
    }

    /**
     * 获取当前配置
     */
    getConfig() {
        return {
            isRunning: this.isRunning,
            interval: this.interval,
            maxScreenshots: this.maxScreenshots,
            enableAnalysis: this.enableAnalysis,
            screenshotCount: this.screenshotCount,
            analysisCount: this.analysisCount,
            detectionCount: this.detectionCount,
            droppedAnalysisCount: this.droppedAnalysisCount,
            analysisBackpressureSkipCount: this.analysisBackpressureSkipCount,
            partialOcrSaveCount: this.partialOcrSaveCount,
            gameflowPhase: this.gameflowPhase,
            analysisPausedByGameflow: !this.isAnalysisAllowedByGameflow(),
            controlOwner: this.controlOwner,
            isCapturing: this.isCapturing,
            isAnalyzing: this.isAnalyzing,
            captureTimeoutMs: this.captureTimeoutMs,
            preferScreenCapture: this.preferScreenCapture,
            lastAnalysisDuration: parseFloat(this.lastAnalysisDuration.toFixed(2)),
        }
    }

    /**
     * 重置服务
     */
    reset() {
        this.stop()
        this.screenshotCount = 0
        this.analysisCount = 0
        this.detectionCount = 0
        this.droppedAnalysisCount = 0
        this.analysisBackpressureSkipCount = 0
        this.lastScreenshotTime = null
        this.lastAnalysisTime = null
        this.lastAnalysisDuration = 0
        this.lastSummaryLogAt = 0
        this.lastAnalysisMissLogAt = 0
        this.lastAnalysisMissKey = ''
        this.analysisMissRepeatCount = 0
        this.lastPartialOcrSaveAt = 0
        this.partialOcrSaveInFlight = false
        this.partialOcrSaveCount = 0
        this.pendingAnalysisBuffer = null
        this.gameflowPhase = null
        this.controlOwner = null
        this.isCapturing = false
        this.isAnalyzing = false
        this.lastDetectedAugmentIds = []
        this.lastDetectedAugments = []
        this.lastDetectedAugmentSlotFingerprints = []
        this.lastDetectedAugmentAt = 0
        this.visibleAugmentMissCount = 0
        this.startedAt = 0
        this.firstCaptureLogged = false
        this.firstDetectionLogged = false
        this.runId++
        this.performanceMetrics = {
            captureTime: [],
            memoryUsage: [],
        }
    }
}

// 导出单例
export default new AutoScreenshotService()
