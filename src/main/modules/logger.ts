/**
 * 日志模块 - 提供文件日志记录功能
 * 日志存储位置: 应用数据目录/logs/
 */
import path from 'path'
import fs from 'fs-extra'
import { getLogDir as resolveLogDir } from './app-paths.ts'
import {
    DEFAULT_LOG_FILES_PER_DAY,
    getRotatedLogFilePath,
    isBrokenPipeError,
    shouldRotateLogFile,
} from './logger-utils.ts'

// 日志级别
const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
} as const
type LogLevel = keyof typeof LOG_LEVELS

// 当前日志级别（可通过环境变量设置）
const requestedLogLevel = process.env.LOG_LEVEL?.toUpperCase()
const currentLevel = requestedLogLevel && requestedLogLevel in LOG_LEVELS
    ? LOG_LEVELS[requestedLogLevel as LogLevel]
    : LOG_LEVELS.INFO
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const FILE_WRITE_ERROR_LOG_INTERVAL_MS = 30000
let lastFileWriteErrorAt = 0
let lastFileWriteErrorKey = ''
let fileWriteQueue: Promise<void> = Promise.resolve()
let consoleSinkAvailable = true
let lastAutomaticCleanupDate = ''

const handleConsoleStreamError = (error: unknown): void => {
    if (isBrokenPipeError(error)) {
        consoleSinkAvailable = false
        return
    }

    // A logger must never turn a broken diagnostic stream into an app crash.
    consoleSinkAvailable = false
}

process.stdout?.on('error', handleConsoleStreamError)
process.stderr?.on('error', handleConsoleStreamError)

const toBeijingISOString = (date: Date = new Date()): string => {
    const beijingDate = new Date(date.getTime() + BEIJING_OFFSET_MS)
    return beijingDate.toISOString().replace('Z', '+08:00')
}

// 日志目录
const getLogDir = (): string => {
    const logDir = resolveLogDir()
    fs.ensureDirSync(logDir)
    return logDir
}

// 获取日志文件名（按日期）
const getLogFileName = (): string => {
    const dateStr = toBeijingISOString().split('T')[0] // YYYY-MM-DD
    return `app-${dateStr}.log`
}

// 获取日志文件路径
const getLogFilePath = (): string => {
    return path.join(getLogDir(), getLogFileName())
}

const removeOldLogFiles = async (keepDays: number): Promise<string[]> => {
    const logDir = getLogDir()
    const files = await fs.readdir(logDir)
    const now = Date.now()
    const maxAge = keepDays * 24 * 60 * 60 * 1000
    const removedFiles: string[] = []

    for (const file of files) {
        if (!file.endsWith('.log')) continue

        const filePath = path.join(logDir, file)
        const stats = await fs.stat(filePath)
        if (now - stats.mtime.getTime() <= maxAge) continue

        await fs.remove(filePath)
        removedFiles.push(file)
    }

    return removedFiles
}

const runAutomaticCleanupIfNeeded = async (logFilePath: string): Promise<void> => {
    const dateKey = path.basename(logFilePath).match(/^app-(\d{4}-\d{2}-\d{2})/)?.[1] || ''
    if (!dateKey || dateKey === lastAutomaticCleanupDate) {
        return
    }

    lastAutomaticCleanupDate = dateKey
    try {
        await removeOldLogFiles(7)
    } catch {
        // Retention cleanup must not prevent the current log entry from being written.
    }
}

const rotateLogFileIfNeeded = async (
    logFilePath: string,
    incomingSize: number
): Promise<void> => {
    let currentSize = 0
    try {
        currentSize = (await fs.stat(logFilePath)).size
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error
        }
    }

    if (!shouldRotateLogFile(currentSize, incomingSize)) {
        return
    }

    for (let index = DEFAULT_LOG_FILES_PER_DAY - 1; index >= 1; index -= 1) {
        const sourcePath = index === 1
            ? logFilePath
            : getRotatedLogFilePath(logFilePath, index - 1)
        if (!await fs.pathExists(sourcePath)) continue

        await fs.move(sourcePath, getRotatedLogFilePath(logFilePath, index), {
            overwrite: true,
        })
    }
}

const formatArg = (arg: unknown): string => {
    if (arg instanceof Error) {
        const errorWithCode = arg as Error & { code?: unknown }
        return JSON.stringify({
            name: arg.name,
            message: arg.message,
            stack: arg.stack,
            code: errorWithCode.code,
        })
    }

    if (typeof arg === 'object' && arg !== null) {
        try {
            return JSON.stringify(arg)
        } catch {
            return String(arg)
        }
    }

    return String(arg)
}

// 格式化日志消息
const formatLogMessage = (level: LogLevel, message: unknown, ...args: unknown[]): string => {
    const timestamp = toBeijingISOString()
    const levelStr = level.padEnd(5)
    
    // 处理消息和参数
    let msg = String(message)
    if (args.length > 0) {
        msg += ' ' + args.map(formatArg).join(' ')
    }
    
    return `[${timestamp}] [${levelStr}] ${msg}`
}

// 写入日志到文件
const writeToFile = async (
    logMessage: string,
    resolveFilePath: () => string = getLogFilePath
): Promise<void> => {
    const writeOperation = async (): Promise<void> => {
        try {
            const logFile = resolveFilePath()
            const serializedMessage = logMessage + '\n'
            await runAutomaticCleanupIfNeeded(logFile)
            await rotateLogFileIfNeeded(logFile, Buffer.byteLength(serializedMessage, 'utf8'))
            await fs.appendFile(logFile, serializedMessage, { encoding: 'utf8' })
        } catch (error) {
            const now = Date.now()
            const normalizedError = (
                error instanceof Error ? error : new Error(String(error))
            ) as Error & { code?: unknown }
            const errorKey = `${resolveFilePath.name}:${normalizedError.code || normalizedError.name}:${normalizedError.message}`
            if (errorKey !== lastFileWriteErrorKey || now - lastFileWriteErrorAt > FILE_WRITE_ERROR_LOG_INTERVAL_MS) {
                lastFileWriteErrorAt = now
                lastFileWriteErrorKey = errorKey
                if (consoleSinkAvailable) {
                    try {
                        console.error('写入日志文件失败:', error)
                    } catch (consoleError) {
                        handleConsoleStreamError(consoleError)
                    }
                }
            }
        }
    }

    fileWriteQueue = fileWriteQueue.then(writeOperation, writeOperation)
    return fileWriteQueue
}

const writeToConsole = (level: LogLevel, formattedMessage: string): void => {
    if (!consoleSinkAvailable) {
        return
    }

    try {
        if (level === 'ERROR') {
            console.error(formattedMessage)
        } else if (level === 'WARN') {
            console.warn(formattedMessage)
        } else {
            console.log(formattedMessage)
        }
    } catch (error) {
        handleConsoleStreamError(error)
    }
}

// 同时输出到控制台和文件
const logWithLevel = (
    level: LogLevel,
    levelValue: number,
    message: unknown,
    ...args: unknown[]
): void => {
    if (levelValue < currentLevel) return
    
    const formattedMessage = formatLogMessage(level, message, ...args)
    
    // 输出到控制台。stdout/stderr 关闭后会永久停用该 sink，避免 EPIPE 递归。
    writeToConsole(level, formattedMessage)
    
    // 异步写入文件（不阻塞主线程）
    writeToFile(formattedMessage)
}

// 导出日志方法
export const logger = {
    debug: (message: unknown, ...args: unknown[]) => logWithLevel('DEBUG', LOG_LEVELS.DEBUG, message, ...args),
    info: (message: unknown, ...args: unknown[]) => logWithLevel('INFO', LOG_LEVELS.INFO, message, ...args),
    warn: (message: unknown, ...args: unknown[]) => logWithLevel('WARN', LOG_LEVELS.WARN, message, ...args),
    error: (message: unknown, ...args: unknown[]) => logWithLevel('ERROR', LOG_LEVELS.ERROR, message, ...args),
    
    // 获取日志目录路径
    getLogDir,
    
    // 获取当前日志文件路径
    getCurrentLogFile: getLogFilePath,

    // 获取北京时区 ISO 时间戳
    toBeijingISOString,
    
    // 清理旧日志文件（保留最近N天）
    cleanupOldLogs: async (keepDays: number = 7): Promise<void> => {
        try {
            await fileWriteQueue
            const removedFiles = await removeOldLogFiles(keepDays)
            for (const file of removedFiles) {
                logger.info(`已删除旧日志文件: ${file}`)
            }
        } catch (error) {
            logger.error('清理旧日志失败:', error)
        }
    }
}

export default logger
