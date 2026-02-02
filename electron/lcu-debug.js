/**
 * LCU 诊断工具 - 用于调试 LCU 连接问题
 * 使用: node electron/lcu-debug.js "C:\Riot Games\League of Legends"
 */

import fs from 'fs'
import path from 'path'
import logger from './modules/logger.js'

function debugLcuToken(lolDir) {
    logger.info('\n========== LCU 诊断报告 ==========\n')
    logger.info('📁 游戏目录:', lolDir)
    logger.info('✓ 目录存在:', fs.existsSync(lolDir))

    const leagueClientDir = path.join(lolDir, 'LeagueClient')
    logger.info('\n🔍 检查 LeagueClient 目录:')
    logger.info('   路径:', leagueClientDir)
    logger.info('   存在:', fs.existsSync(leagueClientDir))

    if (!fs.existsSync(leagueClientDir)) {
        logger.error('❌ LeagueClient 目录不存在！')
        return
    }

    // 列出所有文件
    const files = fs.readdirSync(leagueClientDir)
    logger.info('\n📄 目录中的文件数:', files.length)
    logger.info('   前10个文件:')
    files.slice(0, 10).forEach((f) => {
        logger.info('   -', f)
    })

    // 查找日志文件
    logger.info('\n🔎 查找日志文件:')
    const logFiles = files.filter((f) => f.includes('LeagueClientUx.log') && !f.includes('-tracing'))
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
        return
    }

    // 读取最新的日志文件
    const latest = logFiles.sort((a, b) => a.localeCompare(b)).pop()
    const logPath = path.join(leagueClientDir, latest)

    logger.info('\n📖 读取最新日志文件:')
    logger.info('   文件:', latest)
    logger.info('   完整路径:', logPath)

    try {
        const content = fs.readFileSync(logPath, 'utf8')
        logger.info('   文件大小:', content.length, 'bytes')

        // 查找 LCU URL
        logger.info('\n🔗 查找 LCU URL:')
        const urlMatch = content.match(/https:\/\/riot:([^@]+)@127\.0\.0\.1:(\d+)/)

        if (urlMatch) {
            const token = urlMatch[1]
            const port = urlMatch[2]
            logger.info('   ✅ 找到 LCU URL!')
            logger.info('   Token:', token.substring(0, 10) + '...' + token.substring(token.length - 4))
            logger.info('   Port:', port)
            logger.info('\n   完整 URL: https://riot:' + token + '@127.0.0.1:' + port)
        } else {
            logger.error('   ❌ 未找到 LCU URL!')
            logger.info('\n   📝 日志片段（最后500字符）:')
            logger.info('   ' + content.substring(content.length - 500))

            logger.info('\n   💡 可能的原因:')
            logger.info('   1. 游戏客户端未完全启动')
            logger.info('   2. 还未进入游戏界面')
            logger.info('   3. 日志格式已改变（游戏版本更新）')
        }
    } catch (error) {
        logger.error('❌ 读取日志文件失败:', error.message)
    }

    logger.info('\n==================\n')
}

// 从命令行参数获取游戏目录
const gameDir = process.argv[2] || 'C:\\Riot Games\\League of Legends'
debugLcuToken(gameDir)
