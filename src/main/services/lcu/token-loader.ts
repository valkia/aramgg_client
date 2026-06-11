/**
 * LCU Token 加载器
 * 优先从运行中的 League Client 进程启动参数提取 LCU 认证信息。
 */

import logger from '../../modules/logger.ts'
import store from '../../modules/app-store.ts'
import { discoverLcuAuthFromManualDirectory } from './manual-directory-auth.ts'
import { discoverLcuAuthFromProcess } from './process-auth-discovery.ts'
import { TokenLoadResult } from './types.ts'

const MANUAL_LEAGUE_PATH_KEY = 'lolPath'

function getManualLeaguePath(explicitDirPath?: string | null): string | null {
  const explicitPath = String(explicitDirPath || '').trim()
  if (explicitPath) {
    return explicitPath
  }

  try {
    const configuredPath = store.get(MANUAL_LEAGUE_PATH_KEY)
    return typeof configuredPath === 'string' && configuredPath.trim()
      ? configuredPath.trim()
      : null
  } catch (error) {
    const err = error as Error
    logger.debug('[getLcuToken] 读取手动 LCU 目录配置失败:', err.message)
    return null
  }
}

/**
 * 从 LeagueClientUx/LeagueClient 进程参数中提取 LCU Token。
 * 如果 Windows 不暴露进程命令行，则从进程路径旁的 lockfile 或 LeagueClientUx 日志兜底读取。
 */
export async function getLcuToken(dirPath?: string | null): Promise<TokenLoadResult> {
  try {
    const processResult = await discoverLcuAuthFromProcess()
    if (processResult[0] && processResult[1]) {
      return processResult
    }

    const manualLeaguePath = getManualLeaguePath(dirPath)
    if (manualLeaguePath) {
      const manualResult = await discoverLcuAuthFromManualDirectory(manualLeaguePath)
      if (manualResult[0] && manualResult[1]) {
        logger.info('[getLcuToken] 已通过手动目录兜底发现 LCU 凭据')
        return manualResult
      }

      logger.warn('[getLcuToken] 手动目录兜底未发现 LCU 凭据')
      return [null, null, null]
    }

    logger.warn('[getLcuToken] 未从运行中的 League Client 进程发现 LCU 凭据，且未配置手动目录兜底')
    return [null, null, null]
  } catch (err) {
    const error = err as Error
    logger.error('[getLcuToken] LCU 进程发现失败:', error.message)
    logger.debug('  Stack:', error.stack)
    return [null, null, null]
  }
}

export default {
  getLcuToken,
}
