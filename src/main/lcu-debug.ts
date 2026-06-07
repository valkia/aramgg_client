// @ts-nocheck
/**
 * LCU 诊断工具 - 用于调试 LCU 连接问题
 * 使用: node electron/lcu-debug.ts "C:\Riot Games\League of Legends"
 */

import fs from 'fs'
import logger from './modules/logger.ts'
import {
    findLeagueClientLogFiles,
    getLeagueClientLogDirectories,
    inspectLeagueInstallDirectory,
} from './modules/lol-path.ts'
import { getLcuToken } from './services/lcu/token-loader.ts'

async function debugLcuToken(lolDir) {
    logger.info('\n========== LCU 诊断报告 ==========\n')
    logger.info('📁 游戏目录:', lolDir)
    const installInfo = await inspectLeagueInstallDirectory(lolDir)
    logger.info('✓ 目录存在:', installInfo.exists)
    logger.info('✓ 是文件夹:', installInfo.isDirectory)
    logger.info('✓ LoL 目录结构:', installInfo.valid ? installInfo.layout : '未识别')

    if (!installInfo.valid) {
        logger.error('❌ 未找到 LeagueClient.exe 或 LeagueClient 文件夹！')
        return
    }

    const files = fs.readdirSync(installInfo.normalizedPath)
    logger.info('\n📄 游戏目录中的文件数:', files.length)
    logger.info('   前10个文件:')
    files.slice(0, 10).forEach((f) => {
        logger.info('   -', f)
    })

    logger.info('\n🔎 查找日志文件:')
    const logDirectories = await getLeagueClientLogDirectories(installInfo.normalizedPath)
    logger.info('   搜索目录:')
    logDirectories.forEach((directoryPath) => {
        logger.info('   -', directoryPath)
    })
    const logFiles = await findLeagueClientLogFiles(installInfo.normalizedPath)
    logger.info('   找到 LeagueClientUx.log 文件:', logFiles.length)
    logFiles.forEach((f) => {
        logger.info('   -', f)
    })

    if (logFiles.length === 0) {
        logger.error('❌ 未找到 LeagueClientUx.log 文件！')
        logger.info('\n💡 可能的原因:')
        logger.info('   1. 游戏客户端未启动')
        logger.info('   2. 游戏安装路径不正确')
        logger.info('   3. 日志文件被删除或清理')
    }

    logger.info('\n🔗 查找 LCU Token:')
    const [token, port, urlWithAuth] = await getLcuToken(installInfo.normalizedPath)
    if (token && port) {
        logger.info('   ✅ 找到 LCU Token!')
        logger.info('   Token:', token.substring(0, 10) + '...' + token.substring(token.length - 4))
        logger.info('   Port:', port)
        logger.info('\n   完整 URL:', urlWithAuth)
    } else {
        logger.error('   ❌ 未找到 LCU Token!')
        logger.info('\n   💡 可能的原因:')
        logger.info('   1. 游戏客户端未完全启动')
        logger.info('   2. 还未进入游戏界面')
        logger.info('   3. 日志格式已改变（游戏版本更新）')
    }

    logger.info('\n==================\n')
}

// 从命令行参数获取游戏目录
const gameDir = process.argv[2] || 'C:\\Riot Games\\League of Legends'
debugLcuToken(gameDir).catch((error) => {
    logger.error('LCU 诊断失败:', error.message)
})
