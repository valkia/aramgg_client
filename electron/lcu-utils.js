/**
 * LCU 工具函数 - 主进程版本（基于 file-browser-safe.js）
 * 专门为主进程中的游戏流程监控服务
 */

import fs from 'fs'
import path from 'path'

/**
 * 从 LeagueClient 日志中提取 LCU Token
 * 返回格式：[token, port, urlWithAuth] 或 [null, null, null]
 * @param {string} dirPath - 英雄联盟安装目录
 * @returns {Promise<[string|null, string|null, string|null]>}
 */
export async function getLcuToken(dirPath) {
    try {
        if (!dirPath) {
            console.warn('[getLcuToken] ❌ 英雄联盟目录路径为空')
            return [null, null, null]
        }

        const dir = path.join(dirPath, 'LeagueClient')

        // 检查目录是否存在
        if (!fs.existsSync(dir)) {
            console.warn(`[getLcuToken] ❌ LeagueClient 目录不存在: ${dir}`)
            return [null, null, null]
        }

        // 读取目录中的所有文件
        console.log(`[getLcuToken] 读取目录: ${dir}`)
        const files = fs.readdirSync(dir)

        // 查找 LeagueClient.log 文件（不是 renderer.log）
        const logFiles = files
            .filter((f) => f.includes('LeagueClientUx.log') && !f.includes('-tracing'))
            .sort((a, b) => {
                // 按文件名（包含时间戳）排序，最新的在最后
                return a.localeCompare(b)
            })

        const latest = logFiles.pop() // 获取最新的日志文件

        if (!latest) {
            console.error(`[getLcuToken] ❌ No LeagueClient.log found`)
            console.log(`[getLcuToken] 可用文件:`, files.slice(0, 5))
            return [null, null, null]
        }

        // 读取日志文件内容
        console.log(`[getLcuToken] 读取文件: ${latest}`)
        const filePath = path.join(dir, latest)
        const content = fs.readFileSync(filePath, 'utf8')
        console.log(`[getLcuToken] 文件大小: ${content.length} bytes`)

        // 查找 LCU 连接信息
        // 格式: https://riot:TOKEN@127.0.0.1:PORT/
        const urlMatch = content.match(/https:\/\/riot:([^@]+)@127\.0\.0\.1:(\d+)/)

        if (!urlMatch) {
            console.error(`[getLcuToken] ❌ LCU URL 匹配失败`)
            console.log(`[getLcuToken] 尝试备用模式...`)

            // 尝试旧格式（备用方案）
            const altMatch = content.match(/https(.*)\/index\.html/)
            if (altMatch) {
                const url = altMatch[1]
                const tokenMatch = url.match(/riot:(.*)@/)
                const portMatch = url.match(/:(\d+)/)

                if (tokenMatch && portMatch) {
                    const token = tokenMatch[1]
                    const port = portMatch[1]
                    const urlWithAuth = `https${url}`

                    console.log(`[getLcuToken] ✅ 成功提取（备用模式）:`)
                    console.log(`  Token: ${token.substring(0, 10)}...`)
                    console.log(`  Port: ${port}`)
                    console.log(`  URL: ${urlWithAuth}`)

                    return [token, port, urlWithAuth]
                }
            }

            console.error(`[getLcuToken] ❌ 未找到有效的 URL 模式`)
            return [null, null, null]
        }

        const token = urlMatch[1]
        const port = urlMatch[2]
        const urlWithAuth = `https://riot:${token}@127.0.0.1:${port}`

        console.log(`[getLcuToken] ✅ 成功提取:`)
        console.log(`  Token: ${token.substring(0, 10)}...`)
        console.log(`  Port: ${port}`)
        console.log(`  URL: ${urlWithAuth}`)

        return [token, port, urlWithAuth]
    } catch (err) {
        console.error(`[getLcuToken] ❌ 错误:`, err.message)
        console.error(`  Stack:`, err.stack)
        return [null, null, null]
    }
}

export default {
    getLcuToken,
}
