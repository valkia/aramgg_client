/**
 * LCU Token 加载器
 * 从 LeagueClient 日志文件中提取认证 token
 *
 * 合并自：
 * - electron/lcu-utils.ts
 * - src/share/file-browser-safe.js
 */

import fs from 'fs'
import path from 'path'
import logger from '../../modules/logger.ts'
import {
  findLeagueClientLogFiles,
  getLeagueClientLogDirectories,
  normalizeLolPath,
} from '../../modules/lol-path.ts'
import { TokenLoadResult } from './types.ts'

function buildUrlWithAuth(token: string, port: string, protocol = 'https'): string {
  return `${protocol}://riot:${token}@127.0.0.1:${port}`
}

function readLockfileToken(normalizedPath: string): TokenLoadResult {
  const lockfilePath = path.join(normalizedPath, 'lockfile')
  if (!fs.existsSync(lockfilePath)) {
    return [null, null, null]
  }

  try {
    const content = fs.readFileSync(lockfilePath, 'utf8').trim()
    const [, , port, token, protocol = 'https'] = content.split(':')

    if (!token || !port) {
      logger.debug('[getLcuToken] lockfile found but missing token or port')
      return [null, null, null]
    }

    const urlWithAuth = buildUrlWithAuth(token, port, protocol)
    logger.debug('[getLcuToken] token extracted from lockfile', { port })
    return [token, port, urlWithAuth]
  } catch (error) {
    const err = error as Error
    logger.debug('[getLcuToken] failed to read lockfile:', err.message)
    return [null, null, null]
  }
}

function getFileMtime(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}

function parseLogContent(content: string, logFile: string): TokenLoadResult {
  const urlMatch = content.match(/https:\/\/riot:([^@]+)@127\.0\.0\.1:(\d+)/)

  if (urlMatch) {
    const token = urlMatch[1]
    const port = urlMatch[2]
    const urlWithAuth = buildUrlWithAuth(token, port)

    logger.debug('[getLcuToken] token extracted from log', { port, logFile })
    return [token, port, urlWithAuth]
  }

  logger.debug('[getLcuToken] standard pattern not matched, trying fallback pattern')
  const altMatch = content.match(/https(.*)\/index\.html/)

  if (altMatch) {
    const url = altMatch[1]
    const tokenMatch = url.match(/riot:(.*)@/)
    const portMatch = url.match(/:(\d+)/)

    if (tokenMatch && portMatch) {
      const token = tokenMatch[1]
      const port = portMatch[1]
      const urlWithAuth = `https${url}`

      logger.debug('[getLcuToken] token extracted with fallback pattern', { port, logFile })
      return [token, port, urlWithAuth]
    }
  }

  return [null, null, null]
}

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

    const normalizedPath = normalizeLolPath(dirPath)
    logger.debug('[getLcuToken] normalized path:', normalizedPath)

    const lockfileResult = readLockfileToken(normalizedPath)
    if (lockfileResult[0] && lockfileResult[1]) {
      return lockfileResult
    }

    const logFiles = (await findLeagueClientLogFiles(normalizedPath))
      .sort((a, b) => getFileMtime(b) - getFileMtime(a) || b.localeCompare(a))

    if (!logFiles.length) {
      const searchedDirs = await getLeagueClientLogDirectories(normalizedPath)
      logger.error('[getLcuToken] ❌ 未找到 LeagueClientUx.log 文件')
      logger.debug('[getLcuToken] searched log directories:', searchedDirs)
      return [null, null, null]
    }

    for (const logFilePath of logFiles) {
      logger.debug(`[getLcuToken] reading log file: ${logFilePath}`)
      const content = fs.readFileSync(logFilePath, 'utf8')
      logger.debug(`[getLcuToken] log file size: ${content.length} bytes`)
      const tokenResult = parseLogContent(content, logFilePath)
      if (tokenResult[0] && tokenResult[1]) {
        return tokenResult
      }
    }

    logger.debug('[getLcuToken] no valid LCU URL pattern found')
    return [null, null, null]
  } catch (err) {
    const error = err as Error
    logger.error(`[getLcuToken] ❌ 错误:`, error.message)
    logger.debug('  Stack:', error.stack)
    return [null, null, null]
  }
}

export default {
  getLcuToken,
}
