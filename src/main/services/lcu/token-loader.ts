/**
 * LCU Token 加载器
 * 优先从运行中的 League Client 进程启动参数提取 LCU 认证信息。
 */

import logger from '../../modules/logger.ts'
import { discoverLcuAuthFromProcess } from './process-auth-discovery.ts'
import { TokenLoadResult } from './types.ts'

/**
 * 从 LeagueClientUx/LeagueClient 进程参数中提取 LCU Token。
 * 如果 Windows 不暴露进程命令行，则从进程路径旁的 lockfile 或 LeagueClientUx 日志兜底读取。
 */
export async function getLcuToken(_dirPath?: string | null): Promise<TokenLoadResult> {
  try {
    const processResult = await discoverLcuAuthFromProcess()
    if (processResult[0] && processResult[1]) {
      return processResult
    }

    logger.warn('[getLcuToken] 未从运行中的 League Client 进程发现 LCU 凭据')
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
