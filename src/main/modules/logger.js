/**
 * 日志模块 - 提供文件日志记录功能
 * 日志存储位置: ~/.aramgg_client/logs/
 */
import path from 'path'
import fs from 'fs-extra'
import os from 'os'

// 日志级别
const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
}

// 当前日志级别（可通过环境变量设置）
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO

// 日志目录
const getLogDir = () => {
    const logDir = path.join(os.homedir(), '.aramgg_client', 'logs')
    fs.ensureDirSync(logDir)
    return logDir
}

// 获取日志文件名（按日期）
const getLogFileName = () => {
    const now = new Date()
    const dateStr = now.toISOString().split('T')[0] // YYYY-MM-DD
    return `app-${dateStr}.log`
}

// 获取日志文件路径
const getLogFilePath = () => {
    return path.join(getLogDir(), getLogFileName())
}

// 格式化日志消息
const formatLogMessage = (level, message, ...args) => {
    const now = new Date()
    const timestamp = now.toISOString()
    const levelStr = level.padEnd(5)
    
    // 处理消息和参数
    let msg = message
    if (args.length > 0) {
        msg += ' ' + args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg)
                } catch {
                    return String(arg)
                }
            }
            return String(arg)
        }).join(' ')
    }
    
    return `[${timestamp}] [${levelStr}] ${msg}`
}

// 写入日志到文件
const writeToFile = async (logMessage) => {
    try {
        const logFile = getLogFilePath()
        await fs.appendFile(logFile, logMessage + '\n', { encoding: 'utf8' })
    } catch (error) {
        console.error('写入日志文件失败:', error)
    }
}

// 同时输出到控制台和文件
const logWithLevel = (level, levelValue, message, ...args) => {
    if (levelValue < currentLevel) return
    
    const formattedMessage = formatLogMessage(level, message, ...args)
    
    // 输出到控制台
    if (level === 'ERROR') {
        console.error(formattedMessage)
    } else if (level === 'WARN') {
        console.warn(formattedMessage)
    } else {
        console.log(formattedMessage)
    }
    
    // 异步写入文件（不阻塞主线程）
    writeToFile(formattedMessage)
}

// 导出日志方法
export const logger = {
    debug: (message, ...args) => logWithLevel('DEBUG', LOG_LEVELS.DEBUG, message, ...args),
    info: (message, ...args) => logWithLevel('INFO', LOG_LEVELS.INFO, message, ...args),
    warn: (message, ...args) => logWithLevel('WARN', LOG_LEVELS.WARN, message, ...args),
    error: (message, ...args) => logWithLevel('ERROR', LOG_LEVELS.ERROR, message, ...args),
    
    // 获取日志目录路径
    getLogDir,
    
    // 获取当前日志文件路径
    getCurrentLogFile: getLogFilePath,
    
    // 清理旧日志文件（保留最近N天）
    cleanupOldLogs: async (keepDays = 7) => {
        try {
            const logDir = getLogDir()
            const files = await fs.readdir(logDir)
            const now = Date.now()
            const maxAge = keepDays * 24 * 60 * 60 * 1000 // N天的毫秒数
            
            for (const file of files) {
                if (!file.endsWith('.log')) continue
                
                const filePath = path.join(logDir, file)
                const stats = await fs.stat(filePath)
                const fileAge = now - stats.mtime.getTime()
                
                if (fileAge > maxAge) {
                    await fs.remove(filePath)
                    logger.info(`已删除旧日志文件: ${file}`)
                }
            }
        } catch (error) {
            logger.error('清理旧日志失败:', error)
        }
    }
}

export default logger
