/**
 * LCU Token 加载器
 * 从 LeagueClient 日志文件中提取认证 token
 *
 * 合并自：
 * - electron/lcu-utils.js
 * - src/share/file-browser-safe.js
 */

import fs from 'fs'
import path from 'path'
import logger from '../../modules/logger.js'
import { TokenLoadResult } from './types.ts'

/**
 * 从 LeagueClient 日志中提取 LCU Token
 * @param dirPath - 英雄联盟安装目录路径
 * @returns [token, port, urlWithAuth] 或 [null, null, null]
 */
export async function getLcuToken(dirPath: string | null | undefined): Promise<TokenLoadResult> {
  try {
    if (!dirPath) {
      logger.warn('[getLcuToken] ❌ 英雄联盟目录路径为空')
      return [null, null, null]
    }

    // 规范化路径（处理混合的正斜杠和反斜杠）
    const normalizedPath = dirPath.replace(/\//g, '\\')
    logger.info('[getLcuToken] 规范化后的路径:', normalizedPath)

    const dir = path.join(normalizedPath, 'LeagueClient')

    // 检查目录是否存在
    if (!fs.existsSync(dir)) {
      logger.warn(`[getLcuToken] ❌ LeagueClient 目录不存在: ${dir}`)
      return [null, null, null]
    }

    // 读取目录中的所有文件
    logger.info(`[getLcuToken] 读取目录: ${dir}`)
    const files = fs.readdirSync(dir)

    // 查找 LeagueClientUx.log 文件（不包含 -tracing 后缀）
    const logFiles = files
      .filter((f) => f.includes('LeagueClientUx.log') && !f.includes('-tracing'))
      .sort((a, b) => {
        // 按文件名（包含时间戳）排序，最新的在最后
        return a.localeCompare(b)
      })

    const latest = logFiles.pop() // 获取最新的日志文件

    if (!latest) {
      logger.error(`[getLcuToken] ❌ 未找到 LeagueClientUx.log 文件`)
      logger.info(`[getLcuToken] 可用文件:`, files.slice(0, 5))
      return [null, null, null]
    }

    // 读取日志文件内容
    logger.info(`[getLcuToken] 读取文件: ${latest}`)
    const filePath = path.join(dir, latest)
    const content = fs.readFileSync(filePath, 'utf8')
    logger.info(`[getLcuToken] 文件大小: ${content.length} bytes`)

    // 查找 LCU 连接信息
    // 标准格式: https://riot:TOKEN@127.0.0.1:PORT/
    const urlMatch = content.match(/https:\/\/riot:([^@]+)@127\.0\.0\.1:(\d+)/)

    if (urlMatch) {
      const token = urlMatch[1]
      const port = urlMatch[2]
      const urlWithAuth = `https://riot:${token}@127.0.0.1:${port}`

      logger.info(`[getLcuToken] ✅ 成功提取:`)
      logger.info(`  Token: ${token.substring(0, 10)}...`)
      logger.info(`  Port: ${port}`)

      return [token, port, urlWithAuth]
    }

    // 尝试备用格式（兼容旧版本）
    logger.info(`[getLcuToken] 标准格式未匹配，尝试备用模式...`)
    const altMatch = content.match(/https(.*)\/index\.html/)

    if (altMatch) {
      const url = altMatch[1]
      const tokenMatch = url.match(/riot:(.*)@/)
      const portMatch = url.match(/:(\d+)/)

      if (tokenMatch && portMatch) {
        const token = tokenMatch[1]
        const port = portMatch[1]
        const urlWithAuth = `https${url}`

        logger.info(`[getLcuToken] ✅ 成功提取（备用模式）:`)
        logger.info(`  Token: ${token.substring(0, 10)}...`)
        logger.info(`  Port: ${port}`)

        return [token, port, urlWithAuth]
      }
    }

    logger.error(`[getLcuToken] ❌ 未找到有效的 URL 模式`)
    return [null, null, null]
  } catch (err) {
    const error = err as Error
    logger.error(`[getLcuToken] ❌ 错误:`, error.message)
    logger.error(`  Stack:`, error.stack)
    return [null, null, null]
  }
}

export default {
  getLcuToken,
}
