// @ts-nocheck
/**
 * LCU 诊断工具 - 用于调试进程参数发现。
 * 使用: node src/main/lcu-debug.ts
 */

import logger from './modules/logger.ts'
import { getLcuToken } from './services/lcu/token-loader.ts'

async function debugLcuToken() {
    logger.info('\n========== LCU 进程发现诊断报告 ==========\n')
    logger.info('🔗 查找 LCU Token: 仅检查运行中的 LeagueClientUx/LeagueClient 进程参数')

    const [token, port] = await getLcuToken()
    if (token && port) {
        logger.info('   ✅ 找到 LCU Token')
        logger.info('   Token:', `${token.substring(0, 6)}...${token.substring(token.length - 4)}`)
        logger.info('   Port:', port)
    } else {
        logger.error('   ❌ 未找到 LCU Token')
        logger.info('\n   💡 可能的原因:')
        logger.info('   1. League Client 未启动或尚未完成启动')
        logger.info('   2. 当前系统权限无法读取 League Client 进程命令行')
        logger.info('   3. League Client 启动参数格式发生变化')
    }

    logger.info('\n==================\n')
}

debugLcuToken().catch((error) => {
    logger.error('LCU 诊断失败:', error.message)
})
