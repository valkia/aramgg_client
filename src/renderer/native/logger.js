/**
 * 渲染进程日志模块
 * 提供统一的日志记录和错误上报功能
 */

/**
 * 发送错误到主进程
 * @param {Object} errorData 错误数据
 */
function sendErrorToMain(errorData) {
  try {
    if (window.ipcRenderer) {
      window.ipcRenderer.invoke('log-renderer-error', {
        ...errorData,
        userAgent: navigator.userAgent,
        url: window.location.href,
      })
    }
  } catch (e) {
    console.error('发送错误到主进程失败:', e)
  }
}

/**
 * 格式化错误对象
 * @param {Error|*} err 错误对象
 * @returns {Object} 格式化后的错误信息
 */
function formatError(err) {
  if (err instanceof Error) {
    return {
      message: err.message,
      stack: err.stack,
      name: err.name,
    }
  }
  if (typeof err === 'string') {
    return { message: err, stack: '', name: 'StringError' }
  }
  try {
    return { message: String(err), stack: '', name: 'Unknown' }
  } catch {
    return { message: '无法序列化的错误', stack: '', name: 'Unknown' }
  }
}

// 日志级别
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

// 当前日志级别（生产环境只记录 INFO 及以上）
const currentLevel = LOG_LEVELS[process.env.VUE_APP_LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO

/**
 * 日志模块
 */
const logger = {
  /**
   * 调试日志
   * @param {string} message 日志消息
   * @param {...*} args 附加参数
   */
  debug(message, ...args) {
    if (currentLevel > LOG_LEVELS.DEBUG) return

    const formattedMessage = `[DEBUG] ${message}`
    console.debug(formattedMessage, ...args)
  },

  /**
   * 信息日志
   * @param {string} message 日志消息
   * @param {...*} args 附加参数
   */
  info(message, ...args) {
    if (currentLevel > LOG_LEVELS.INFO) return

    const formattedMessage = `[INFO] ${message}`
    console.info(formattedMessage, ...args)
  },

  /**
   * 警告日志
   * @param {string} message 日志消息
   * @param {...*} args 附加参数
   */
  warn(message, ...args) {
    if (currentLevel > LOG_LEVELS.WARN) return

    const formattedMessage = `[WARN] ${message}`
    console.warn(formattedMessage, ...args)

    // 发送警告到主进程
    sendErrorToMain({
      type: 'renderer-warning',
      message: message,
      details: args,
      timestamp: Date.now(),
    })
  },

  /**
   * 错误日志
   * @param {string|Error} message 错误消息或错误对象
   * @param {...*} args 附加参数
   */
  error(message, ...args) {
    if (currentLevel > LOG_LEVELS.ERROR) return

    const formattedMessage = `[ERROR] ${message}`
    console.error(formattedMessage, ...args)

    // 格式化错误信息
    let errorInfo
    if (message instanceof Error) {
      errorInfo = formatError(message)
    } else if (typeof message === 'string' && args[0] instanceof Error) {
      errorInfo = formatError(args[0])
      errorInfo.message = `${message}: ${errorInfo.message}`
    } else {
      errorInfo = { message: String(message), stack: '', name: 'Error' }
    }

    // 发送错误到主进程
    sendErrorToMain({
      type: 'renderer-error',
      message: errorInfo.message,
      stack: errorInfo.stack,
      name: errorInfo.name,
      details: args.filter(arg => !(arg instanceof Error)),
      timestamp: Date.now(),
    })
  },

  /**
   * 捕获并记录异步函数的错误
   * @param {Function} fn 异步函数
   * @param {string} context 上下文描述
   * @returns {Function} 包装后的函数
   */
  captureAsync(fn, context = '') {
    return async (...args) => {
      try {
        return await fn(...args)
      } catch (error) {
        this.error(`${context} 异步操作失败:`, error)
        throw error
      }
    }
  },

  /**
   * 记录组件错误
   * @param {string} componentName 组件名称
   * @param {Error} error 错误对象
   * @param {string} info 附加信息
   */
  logComponentError(componentName, error, info = '') {
    const formattedError = formatError(error)
    this.error(`组件 [${componentName}] 错误:`, error)

    sendErrorToMain({
      type: 'component-error',
      component: componentName,
      message: formattedError.message,
      stack: formattedError.stack,
      info: info,
      timestamp: Date.now(),
    })
  },

  /**
   * 记录 API 请求错误
   * @param {string} apiName API 名称
   * @param {Error} error 错误对象
   * @param {Object} requestInfo 请求信息
   */
  logApiError(apiName, error, requestInfo = {}) {
    const formattedError = formatError(error)
    this.error(`API [${apiName}] 请求失败:`, error)

    sendErrorToMain({
      type: 'api-error',
      api: apiName,
      message: formattedError.message,
      stack: formattedError.stack,
      requestInfo,
      timestamp: Date.now(),
    })
  },
}

export default logger
