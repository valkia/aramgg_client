/**
 * LCU 客户端 - 渲染进程版本
 * 通过 IPC 调用主进程的 LCU 服务
 *
 * 提供与原 src/service/lcu.js 完全相同的 API 接口，保持向后兼容
 */

import type {
  GameflowPhase,
  ChampSelectSession,
  PerkPage,
} from './types.ts'
import { electronAPI } from '../../native/electron-api.js'

/**
 * LCU 客户端类（渲染进程版本）
 * 通过 IPC 代理到主进程的 LCU 服务
 */
export default class LCUService {
  public lolDir: string
  public active: boolean = false

  constructor(lolDir: string) {
    this.lolDir = lolDir
  }

  /**
   * 设置变量（兼容旧API，但在IPC模式下不需要实际设置）
   */
  setVars = (token: string | null, _port: string | null, _url: string | null) => {
    this.active = !!token
  }

  /**
   * 获取认证 token（通过IPC）
   */
  getAuthToken = async () => {
    // 在渲染进程中，我们不直接获取token
    // 而是通过IPC查询状态
    const result = await electronAPI.lcu.getStatus()
    if (result.success && result.active) {
      this.active = true
      return { token: 'proxy', port: 'proxy', url: 'proxy' }
    }
    this.active = false
    return null
  }

  /**
   * 获取 LCU 状态
   */
  getLcuStatus = async (): Promise<boolean> => {
    const result = await electronAPI.lcu.getStatus()
    this.active = result.success && result.active
    return this.active
  }

  /**
   * 获取当前选人会话
   */
  getCurrentSession = async (): Promise<ChampSelectSession | null> => {
    const result = await electronAPI.lcu.getCurrentSession()
    return result.success ? result.session : null
  }

  /**
   * 获取当前符文页
   */
  getCurPerk = async (): Promise<PerkPage | null> => {
    const result = await electronAPI.lcu.getPerkList()
    if (result.success && result.perks) {
      return result.perks.find((p: PerkPage) => p.current) || null
    }
    return null
  }

  /**
   * 获取符文页列表
   */
  getPerkList = async (): Promise<PerkPage[]> => {
    const result = await electronAPI.lcu.getPerkList()
    return result.success ? result.perks : []
  }

  /**
   * 删除符文页（通过应用新的符文页实现）
   */
  deletePerk = async (_id: number): Promise<boolean> => {
    // 在新架构中，删除操作由 applyPerk 自动处理
    console.warn('deletePerk: 该方法已弃用，请使用 applyPerk')
    return true
  }

  /**
   * 创建符文页（通过应用符文页实现）
   */
  createPerk = async (data: any): Promise<boolean> => {
    // 在新架构中，创建操作由 applyPerk 自动处理
    return this.applyPerk(data)
  }

  /**
   * 应用符文页
   */
  applyPerk = async (data: any): Promise<boolean> => {
    const result = await electronAPI.lcu.applyPerk(data)
    return result.success
  }

  /**
   * 获取当前游戏阶段
   */
  getGameflowPhase = async (): Promise<GameflowPhase | null> => {
    const result = await electronAPI.lcu.getGameflowPhase()
    return result.success ? result.phase : null
  }

  /**
   * 获取游戏会话信息
   */
  getGameflowSession = async (): Promise<any> => {
    // 这个方法在旧代码中较少使用，暂时返回null
    // 如果需要可以添加对应的IPC handler
    console.warn('getGameflowSession: 该方法在渲染进程中不可用，请使用主进程版本')
    return null
  }

  /**
   * 轮询游戏阶段（在渲染进程中不推荐使用）
   */
  pollGameflowPhase = async (
    callback: (phase: GameflowPhase) => void,
    interval: number = 1000
  ): Promise<NodeJS.Timeout> => {
    console.warn('pollGameflowPhase: 在渲染进程中不推荐使用，建议监听IPC事件')

    let lastPhase: GameflowPhase | null = null

    const timer = setInterval(async () => {
      try {
        const phase = await this.getGameflowPhase()
        if (phase && phase !== lastPhase) {
          lastPhase = phase
          callback(phase)
        }
      } catch (error) {
        console.warn('轮询游戏阶段出错:', error)
      }
    }, interval)

    return timer
  }

  /**
   * 停止轮询游戏阶段
   */
  stopPollGameflowPhase = (timerId: NodeJS.Timeout): void => {
    if (timerId) {
      clearInterval(timerId)
    }
  }
}
