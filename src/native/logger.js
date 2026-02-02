// Use require for Node.js modules in Electron renderer
let log = { functions: {} };
let isDev = true;

try {
  if (window.require) {
    log = window.require('electron-log');
  }
} catch (error) {
  // electron-log 未安装，使用降级方案
  console.debug('electron-log not available, using console fallback');
}

try {
  if (window.require) {
    isDev = window.require('electron-is-dev');
  }
} catch (error) {
  // electron-is-dev 未安装，默认为 true
  isDev = true;
}

if (!isDev && log.functions) {
  Object.assign(console, log.functions);
}

// 导出兼容接口，使 logger 可以在渲染进程中使用
const logger = {
  debug: (...args) => log.debug ? log.debug(...args) : console.debug(...args),
  info: (...args) => log.info ? log.info(...args) : console.info(...args),
  warn: (...args) => log.warn ? log.warn(...args) : console.warn(...args),
  error: (...args) => log.error ? log.error(...args) : console.error(...args),
};

export default logger;
