/**
 * LCU 服务兼容层
 * 重新导出 src/services/lcu 以保持向后兼容
 *
 * 旧路径: src/service/lcu.js
 * 新路径: src/services/lcu/lcu-client.ts
 */

import LCUService from '../services/lcu/lcu-client.ts'

export default LCUService
export { LCUService }
