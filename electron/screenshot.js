import screenshot from 'screenshot-desktop'
import path from 'path'
import fs from 'fs-extra'
import os from 'os'
import { BrowserWindow } from 'electron'

// 获取临时目录
const getScreenshotDir = () => {
    const tempDir = path.join(os.homedir(), '.lol-tips-client', 'screenshots')
    fs.ensureDirSync(tempDir)
    return tempDir
}

// 尝试通过窗口标题识别 LoL 游戏窗口
const getLolGameWindowId = () => {
    try {
        // LoL 游戏窗口通常包含 "League of Legends" 或游戏进程名称
        if (process.platform === 'win32') {
            const { execSync } = require('child_process')

            try {
                // 方法1: 查找游戏进程
                const tasklist = execSync('tasklist /v', { encoding: 'utf8' })

                // 查找包含游戏相关进程的窗口
                const gameProcesses = [
                    'League of Legends.exe',
                    'LeagueClient.exe',
                    'RiotClientServices.exe',
                ]

                for (const process of gameProcesses) {
                    if (tasklist.includes(process)) {
                        return true
                    }
                }
            } catch (e) {
                // tasklist 命令失败时，尝试其他方法
            }
        }

        return false
    } catch (error) {
        return false
    }
}

// 截图当前屏幕（支持自动检测游戏窗口）
export const captureScreenshot = async (options = {}) => {
    try {
        const screenshotDir = getScreenshotDir()
        const timestamp = Date.now()
        const filename = `screenshot-${timestamp}.png`
        const filepath = path.join(screenshotDir, filename)

        // 检查是否有 LoL 游戏窗口
        const hasLolWindow = getLolGameWindowId()
        console.log(`🎮 LoL 游戏窗口检测: ${hasLolWindow ? '已检测到' : '未检测到'}`)

        // 使用 screenshot-desktop 截图
        // 注：screenshot-desktop 会自动截取所有显示器或主显示器
        const img = await screenshot()
        await fs.writeFile(filepath, img)

        console.log(`📸 Screenshot saved: ${filepath}`)
        return {
            success: true,
            filepath,
            filename,
            timestamp,
            hasLolWindow,
        }
    } catch (error) {
        console.error('❌ Screenshot capture failed:', error)
        return {
            success: false,
            error: error.message,
        }
    }
}

// 获取截图目录中的所有截图
export const getScreenshots = async () => {
    try {
        const screenshotDir = getScreenshotDir()
        const files = await fs.readdir(screenshotDir)
        return files.filter(f => f.endsWith('.png')).map(f => ({
            filename: f,
            filepath: path.join(screenshotDir, f),
        }))
    } catch (error) {
        console.error('Failed to get screenshots:', error)
        return []
    }
}

// 清理旧截图（保留最新的N张）
export const cleanupOldScreenshots = async (keepCount = 10) => {
    try {
        const screenshotDir = getScreenshotDir()
        const files = await fs.readdir(screenshotDir)
        const pngFiles = files.filter(f => f.endsWith('.png'))

        if (pngFiles.length > keepCount) {
            // 按修改时间排序
            const fileStats = await Promise.all(
                pngFiles.map(async (f) => {
                    const filepath = path.join(screenshotDir, f)
                    const stats = await fs.stat(filepath)
                    return { f, mtime: stats.mtime.getTime() }
                })
            )

            fileStats.sort((a, b) => b.mtime - a.mtime)

            // 删除超出数量的文件
            for (let i = keepCount; i < fileStats.length; i++) {
                const filepath = path.join(screenshotDir, fileStats[i].f)
                await fs.remove(filepath)
                console.log(`Deleted old screenshot: ${fileStats[i].f}`)
            }
        }
    } catch (error) {
        console.error('Failed to cleanup screenshots:', error)
    }
}
