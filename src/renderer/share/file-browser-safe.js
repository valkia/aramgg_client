import log from '@/native/logger.js'

const unavailable = (operation) => {
    log.warn(`${operation} 已移出渲染进程，请通过主进程业务 API 执行文件操作。`)
}

export const saveToFile = async () => {
    unavailable('saveToFile')
    return false
}

export const removeFolderContent = async () => {
    unavailable('removeFolderContent')
    return false
}

export const readJsonFile = async () => {
    unavailable('readJsonFile')
    return null
}

/**
 * @deprecated getLcuToken 已废弃，请使用统一的 LCU 服务
 */
export const getLcuToken = async () => {
    unavailable('getLcuToken')
    return [null, null, null]
}
