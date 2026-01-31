/**
 * LCU 诊断工具 - 用于调试 LCU 连接问题
 * 使用: node electron/lcu-debug.js "C:\Riot Games\League of Legends"
 */

import fs from 'fs'
import path from 'path'

function debugLcuToken(lolDir) {
    console.log('\n========== LCU 诊断报告 ==========\n')
    console.log('📁 游戏目录:', lolDir)
    console.log('✓ 目录存在:', fs.existsSync(lolDir))

    const leagueClientDir = path.join(lolDir, 'LeagueClient')
    console.log('\n🔍 检查 LeagueClient 目录:')
    console.log('   路径:', leagueClientDir)
    console.log('   存在:', fs.existsSync(leagueClientDir))

    if (!fs.existsSync(leagueClientDir)) {
        console.error('❌ LeagueClient 目录不存在！')
        return
    }

    // 列出所有文件
    const files = fs.readdirSync(leagueClientDir)
    console.log('\n📄 目录中的文件数:', files.length)
    console.log('   前10个文件:')
    files.slice(0, 10).forEach((f) => {
        console.log('   -', f)
    })

    // 查找日志文件
    console.log('\n🔎 查找日志文件:')
    const logFiles = files.filter((f) => f.includes('LeagueClientUx.log') && !f.includes('-tracing'))
    console.log('   找到 LeagueClientUx.log 文件:', logFiles.length)
    logFiles.forEach((f) => {
        console.log('   -', f)
    })

    if (logFiles.length === 0) {
        console.error('❌ 未找到 LeagueClientUx.log 文件！')
        console.log('\n💡 可能的原因:')
        console.log('   1. 游戏客户端未启动')
        console.log('   2. 游戏安装路径不正确')
        console.log('   3. 日志文件被删除或清理')
        return
    }

    // 读取最新的日志文件
    const latest = logFiles.sort((a, b) => a.localeCompare(b)).pop()
    const logPath = path.join(leagueClientDir, latest)

    console.log('\n📖 读取最新日志文件:')
    console.log('   文件:', latest)
    console.log('   完整路径:', logPath)

    try {
        const content = fs.readFileSync(logPath, 'utf8')
        console.log('   文件大小:', content.length, 'bytes')

        // 查找 LCU URL
        console.log('\n🔗 查找 LCU URL:')
        const urlMatch = content.match(/https:\/\/riot:([^@]+)@127\.0\.0\.1:(\d+)/)

        if (urlMatch) {
            const token = urlMatch[1]
            const port = urlMatch[2]
            console.log('   ✅ 找到 LCU URL!')
            console.log('   Token:', token.substring(0, 10) + '...' + token.substring(token.length - 4))
            console.log('   Port:', port)
            console.log('\n   完整 URL: https://riot:' + token + '@127.0.0.1:' + port)
        } else {
            console.error('   ❌ 未找到 LCU URL!')
            console.log('\n   📝 日志片段（最后500字符）:')
            console.log('   ' + content.substring(content.length - 500))

            console.log('\n   💡 可能的原因:')
            console.log('   1. 游戏客户端未完全启动')
            console.log('   2. 还未进入游戏界面')
            console.log('   3. 日志格式已改变（游戏版本更新）')
        }
    } catch (error) {
        console.error('❌ 读取日志文件失败:', error.message)
    }

    console.log('\n==================\n')
}

// 从命令行参数获取游戏目录
const gameDir = process.argv[2] || 'C:\\Riot Games\\League of Legends'
debugLcuToken(gameDir)
