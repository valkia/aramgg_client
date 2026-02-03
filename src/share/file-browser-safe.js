// Service wrapper for browser environment
// This file provides a safe way to import services in browser without fs errors

import log from '@/native/logger.js';

// Check if we're in a browser environment
const isBrowser = typeof window !== 'undefined' && !window.require

if (isBrowser) {
    // In browser environment, provide empty implementations
    log.warn('Service files should not be used in browser environment. Use IPC calls instead.')
}

// Export empty implementations for browser
export const saveToFile = async (desDir, data) => {
    if (isBrowser) {
        log.error('saveToFile cannot be used in browser environment')
        return false
    }
    const fs = window.fs.promises
    const fse = window.fse
    try {
        const file = `${desDir}/Game/Config/Champions/${data.champion}/Recommended/${data.fileName}.json`
        await fse.outputFile(file, JSON.stringify(data, null, 4))
        return true
    } catch (error) {
        return error
    }
}

export const removeFolderContent = async (dir) => {
    if (isBrowser) {
        log.error('removeFolderContent cannot be used in browser environment')
        return false
    }
    const fse = window.fse
    try {
        await fse.emptyDir(dir)
        return true
    } catch (error) {
        return error
    }
}

export const readJsonFile = async (filePath) => {
    if (isBrowser) {
        log.error('readJsonFile cannot be used in browser environment')
        return null
    }
    const fs = window.fs.promises
    try {
        const content = await fs.readFile(filePath, 'utf8')
        return JSON.parse(content)
    } catch (error) {
        log.error('Error reading JSON file:', error)
        return null
    }
}

/**
 * @deprecated getLcuToken 已废弃，请使用统一的 LCU 服务
 * LCU Token 获取现在在主进程中处理，渲染进程应通过 IPC 调用
 */
export const getLcuToken = async (dirPath) => {
    log.warn('[getLcuToken] 此函数已废弃，请使用新的 LCU 服务（通过 IPC 调用主进程）')
    return [null, null, null]
}