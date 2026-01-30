/**
 * 定时截图服务
 * 功能：定期自动截图，并支持在UI中配置
 */

import { captureScreenshot, cleanupOldScreenshots } from './screenshot.js'

class AutoScreenshotService {
    constructor() {
        this.isRunning = false
        this.intervalId = null
        this.interval = 5000 // 默认5秒
        this.maxScreenshots = 50 // 最多保留50张
        this.screenshotCount = 0
        this.lastScreenshotTime = null
        this.performanceMetrics = {
            captureTime: [], // 截图耗时数组
            memoryUsage: [],  // 内存使用量
        }
    }

    /**
     * 启动定时截图
     * @param {number} intervalMs - 截图间隔（毫秒）
     * @returns {boolean} 是否成功启动
     */
    async start(intervalMs = 5000) {
        if (this.isRunning) {
            console.log('Auto screenshot already running')
            return false
        }

        this.interval = Math.max(intervalMs, 1000) // 最小间隔1秒
        this.isRunning = true
        this.screenshotCount = 0

        console.log(`Auto screenshot service started with interval: ${this.interval}ms`)

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
            console.log('Auto screenshot not running')
            return false
        }

        clearInterval(this.intervalId)
        this.isRunning = false
        this.intervalId = null

        console.log(`Auto screenshot service stopped. Total screenshots: ${this.screenshotCount}`)
        return true
    }

    /**
     * 内部方法：执行单次截图
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

                // 清理旧截图
                if (this.screenshotCount % 5 === 0) {
                    await cleanupOldScreenshots(this.maxScreenshots)
                }

                console.log(
                    `[Auto Screenshot ${this.screenshotCount}] Captured in ${captureTimeMs.toFixed(2)}ms`
                )

                return result
            } else {
                console.error('Auto screenshot failed:', result.error)
                return result
            }
        } catch (error) {
            console.error('Auto screenshot error:', error)
            return {
                success: false,
                error: error.message,
            }
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
        // 性能评估标准
        // 截图耗时 < 100ms，内存 < 200MB → 优秀
        // 截图耗时 < 200ms，内存 < 300MB → 良好
        // 截图耗时 < 500ms，内存 < 500MB → 一般
        // 否则 → 较差

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
    }

    /**
     * 获取当前配置
     */
    getConfig() {
        return {
            isRunning: this.isRunning,
            interval: this.interval,
            maxScreenshots: this.maxScreenshots,
            screenshotCount: this.screenshotCount,
        }
    }

    /**
     * 重置服务
     */
    reset() {
        this.stop()
        this.screenshotCount = 0
        this.lastScreenshotTime = null
        this.performanceMetrics = {
            captureTime: [],
            memoryUsage: [],
        }
    }
}

// 导出单例
export default new AutoScreenshotService()
