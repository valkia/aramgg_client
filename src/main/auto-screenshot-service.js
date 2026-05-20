/**
 * 定时截图服务
 * 功能：定期自动截图、分析和识别海克斯卡片
 *
 * 【重要说明】
 * 浮窗位置已调整到屏幕顶部(top: 2%)，与OCR识别区域(从25%开始)完全不重叠
 * 因此截图时无需隐藏浮窗，避免了闪烁问题
 */

import { captureScreenshot } from './screenshot.js'
import { analyzeScreenshot } from './image-analyzer.js'
import { BrowserWindow } from 'electron'
import Store from 'electron-store'
import logger from './modules/logger.js'
import { applyFloatingWindowLayout } from './modules/window-manager.js'

const store = new Store()

class AutoScreenshotService {
    constructor() {
        this.isRunning = false
        this.intervalId = null
        this.interval = 5000 // 默认5秒
        this.maxScreenshots = 50 // 保留字段但已不再使用（截图直接使用内存 Buffer）
        this.screenshotCount = 0
        this.lastScreenshotTime = null
        this.enableAnalysis = true // 是否启用自动分析
        this.analysisCount = 0 // 分析次数
        this.detectionCount = 0 // 成功检测次数
        this.performanceMetrics = {
            captureTime: [], // 截图耗时数组
            memoryUsage: [],  // 内存使用量
        }
        // 上一次检测到的海克斯ID列表（用于判断是否需要更新显示）
        this.lastDetectedAugmentIds = []
    }

    /**
     * 启动定时截图
     * @param {number} intervalMs - 截图间隔（毫秒）
     * @returns {boolean} 是否成功启动
     */
    async start(intervalMs = 5000) {
        if (this.isRunning) {
            logger.info('Auto screenshot already running')
            return false
        }

        this.interval = Math.max(intervalMs, 1000) // 最小间隔1秒
        this.isRunning = true
        this.screenshotCount = 0

        logger.info(`Auto screenshot service started with interval: ${this.interval}ms`)

        // 启动定时器
        this.intervalId = setInterval(async () => {
            await this._captureScreenshot()
        }, this.interval)

        return true
    }

    /**
     * 停止定时截图
     * @returns {boolean} 是否成功停止
     */
    stop() {
        if (!this.isRunning) {
            logger.info('Auto screenshot not running')
            return false
        }

        clearInterval(this.intervalId)
        this.isRunning = false
        this.intervalId = null

        logger.info(`Auto screenshot service stopped. Total screenshots: ${this.screenshotCount}`)
        return true
    }

    /**
     * 内部方法：执行单次截图
     * 【注意】浮窗已调整到屏幕顶部，与OCR区域不重叠，无需隐藏
     * @private
     */
    async _captureScreenshot() {
        const startTime = performance.now()

        try {
            const result = await captureScreenshot()

            const endTime = performance.now()
            const captureTimeMs = endTime - startTime

            if (result.success) {
                this.screenshotCount++
                this.lastScreenshotTime = Date.now()

                // 记录性能数据
                this._recordPerformance(captureTimeMs)

                logger.info(
                    `[Auto Screenshot ${this.screenshotCount}] Captured in ${captureTimeMs.toFixed(2)}ms`
                )

                // 异步分析截图（不阻塞截图流程）
                if (this.enableAnalysis) {
                    setImmediate(async () => {
                        await this._analyzeScreenshot(result.buffer)
                    })
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
        }
    }

    /**
     * 内部方法：分析截图
     * @private
     */
    async _analyzeScreenshot(imageBuffer) {
        try {
            this.analysisCount++
            const analysisResult = await analyzeScreenshot(imageBuffer)

            if (!analysisResult.success) {
                return  // 分析失败，不继续处理
            }

            const { cardCount, confidence, isAugmentPhase, augments } = analysisResult.analysis

            // ✅ 严格的通知条件：
            // 1. 必须检测到 3 张卡片
            // 2. 必须通过间距验证（isAugmentPhase = true）
            // 3. 置信度必须 > 90%（更严格）
            if (cardCount === 3 && isAugmentPhase && confidence > 0.9) {
                // 检查是否与上次检测到的海克斯相同（避免重复通知）
                const currentIds = augments.map(a => a.id).sort().join(',')
                const lastIds = this.lastDetectedAugmentIds.sort().join(',')

                if (currentIds !== lastIds) {
                    // 新的海克斯组合，更新显示
                    this.detectionCount++
                    this.lastDetectedAugmentIds = augments.map(a => a.id)

                    logger.info(`✨ [自动分析 ${this.analysisCount}] ✅ 检测到新海克斯: ${cardCount} 个，置信度 ${(confidence * 100).toFixed(1)}%`)
                    logger.info(`   通知 UI 显示推荐`)
                    this._notifyAugmentDetected(analysisResult)
                } else {
                    // 与上次相同，跳过通知
                    logger.debug(`[自动分析 ${this.analysisCount}] 海克斯未变化，跳过通知`)
                }
            } else {
                // 检测结果不满足通知条件
                if (cardCount < 3) {
                    logger.info(`[自动分析 ${this.analysisCount}] ⚠️ 卡片数量不足: ${cardCount} < 3`)
                    // 如果检测不到3张卡片，可能海克斯选择已结束，清空上次记录
                    if (cardCount === 0) {
                        const hadVisibleAugmentOverlay = this.lastDetectedAugmentIds.length > 0
                        this.lastDetectedAugmentIds = []
                        if (hadVisibleAugmentOverlay) {
                            this._notifyAugmentCleared('no-augments-detected')
                        }
                    }
                } else if (!isAugmentPhase) {
                    logger.info(`[自动分析 ${this.analysisCount}] ⚠️ 验证失败：卡片间距或位置不符`)
                } else if (confidence <= 0.9) {
                    logger.info(`[自动分析 ${this.analysisCount}] ⚠️ 置信度过低: ${(confidence * 100).toFixed(1)}% <= 90%`)
                }
            }
        } catch (error) {
            logger.error('Auto screenshot analysis error:', error)
        }
    }

    /**
     * 通知所有窗口有新的海克斯检测
     * @private
     */
    _notifyAugmentDetected(analysisResult) {
        try {
            // 从store中获取缓存的英雄ID
            const championId = store.get('lastSelectedChampionId')

            if (!championId) {
                logger.warn('⚠️ 未找到缓存的英雄ID，海克斯推荐可能无法显示胜率数据')
            } else {
                logger.info(`📌 使用缓存的英雄ID: ${championId}`)
            }

            const windows = BrowserWindow.getAllWindows()
            const winrateData = {
                success: true,
                gamePhase: 'augment-select',
                championId: championId || null, // 添加英雄ID
                augments: analysisResult.analysis.augments.slice(0, 3).map(aug => ({
                    id: aug.id,
                    name: aug.name,
                    rarity: aug.rarity,
                    confidence: aug.confidence,
                })),
                analysisConfidence: analysisResult.analysis.confidence,
                timestamp: analysisResult.timestamp,
                dataSource: 'auto-analysis',
            }

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

            logger.info('📢 已通知UI窗口有新的海克斯检测')
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
            if (floatingWindow && !floatingWindow.isDestroyed() && floatingWindow.isVisible()) {
                floatingWindow.hide()
                logger.info('Hidden augment floating window after selection disappeared')
            }

            const popupWindow = windows.find(win => {
                const url = win.webContents.getURL()
                return url.includes('augment-overlay')
            })
            if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) {
                popupWindow.hide()
                logger.info('Hidden augment popup window after selection disappeared')
            }

            logger.info(`Notified UI that augment selection cleared: ${reason}`)
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
            this.interval = config.interval
        }
        if (config.maxScreenshots !== undefined && config.maxScreenshots > 0) {
            this.maxScreenshots = config.maxScreenshots
        }
        if (config.enableAnalysis !== undefined) {
            this.enableAnalysis = config.enableAnalysis
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
        this.lastScreenshotTime = null
        this.lastDetectedAugmentIds = []
        this.performanceMetrics = {
            captureTime: [],
            memoryUsage: [],
        }
    }
}

// 导出单例
export default new AutoScreenshotService()
