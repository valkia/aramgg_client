/**
 * LCU 工具函数 - 主进程版本
 * 专门为主进程中的游戏流程监控服务
 */

import fs from 'fs'
import path from 'path'
import axios from 'axios'

/**
 * 从 LeagueClient 日志中提取 LCU Token
 * @param {string} dirPath - 英雄联盟安装目录
 * @returns {Promise<{port, password} | null>}
 */
export async function getLcuToken(dirPath) {
    try {
        if (!dirPath) {
            console.warn('❌ 英雄联盟目录路径为空')
            return null
        }

        const logDir = path.join(dirPath, 'LeagueClient')

        // 检查目录是否存在
        if (!fs.existsSync(logDir)) {
            console.warn(`❌ LeagueClient 目录不存在: ${logDir}`)
            return null
        }

        // 读取目录中的所有文件
        const files = fs.readdirSync(logDir)

        // 查找 LeagueClientUx.log 文件（不是 renderer.log）
        const logFiles = files
            .filter((f) => f.includes('LeagueClientUx.log') && !f.includes('-tracing'))
            .sort((a, b) => {
                // 按文件名（包含时间戳）排序，最新的在最后
                return a.localeCompare(b)
            })

        const latest = logFiles.pop() // 获取最新的日志文件

        if (!latest) {
            console.warn(`❌ LeagueClient.log 文件未找到`)
            return null
        }

        // 读取日志文件内容
        const filePath = path.join(logDir, latest)
        const content = fs.readFileSync(filePath, 'utf8')

        // 查找 LCU 连接信息
        // 格式: https://riot:TOKEN@127.0.0.1:PORT/
        const urlMatch = content.match(/https:\/\/riot:([^@]+)@127\.0\.0\.1:(\d+)/)

        if (!urlMatch) {
            console.warn(`❌ LCU URL 匹配失败`)
            return null
        }

        const password = urlMatch[1]
        const port = urlMatch[2]

        console.log(`✅ LCU Token 提取成功 (端口: ${port})`)
        return { port, password }
    } catch (error) {
        console.error(`❌ 提取 LCU Token 失败:`, error.message)
        return null
    }
}

export default {
    getLcuToken,
}
