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

// 获取LOL客户端窗口信息
const getLolClientWindow = () => {
    const allWindows = BrowserWindow.getAllWindows()
    // 过滤掉我们自己的应用窗口，找外部的LOL客户端
    // 这里暂时返回所有窗口，实际可以通过窗口标题识别
    return allWindows
}

// 截图当前屏幕
export const captureScreenshot = async () => {
    try {
        const screenshotDir = getScreenshotDir()
        const timestamp = Date.now()
        const filename = `screenshot-${timestamp}.png`
        const filepath = path.join(screenshotDir, filename)

        // 使用 screenshot-desktop 截图
        const img = await screenshot()
        await fs.writeFile(filepath, img)

        console.log(`Screenshot saved: ${filepath}`)
        return {
            success: true,
            filepath,
            filename,
            timestamp,
        }
    } catch (error) {
        console.error('Screenshot capture failed:', error)
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
