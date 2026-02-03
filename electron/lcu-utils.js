/**
 * LCU Utils 兼容层
 * 重新导出新的 token-loader 以保持向后兼容
 *
 * @deprecated 请直接使用 electron/services/lcu/token-loader.ts
 */

export { getLcuToken } from './services/lcu/token-loader.js'
export { default } from './services/lcu/token-loader.js'
