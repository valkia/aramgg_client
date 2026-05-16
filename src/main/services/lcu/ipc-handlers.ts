/**
 * LCU 服务相关的 IPC 处理器
 * 使用统一的 LCU 服务实现
 *
 * 迁移自 electron/modules/ipc-handlers.js
 */

import { ipcMain } from 'electron'
import Store from 'electron-store'
import logger from '../../modules/logger.js'
import { getLCUServiceInstance } from './lcu-service.ts'
import { ChampionIdResult } from './types.ts'

const store = new Store()

const getLcuServiceFromStore = async () => {
  const lolPath = store.get('lolPath') as string | undefined

  if (!lolPath) {
    return {
      service: null,
      error: '游戏路径未配置',
    }
  }

  const service = getLCUServiceInstance(lolPath)
  if (!service.isActive()) {
    await service.getAuthToken()
  }

  return {
    service,
    error: null,
  }
}

/**
 * 注册所有 LCU 相关的 IPC 处理器
 */
export function registerLCUIpcHandlers(): void {
  ipcMain.handle('lcu-get-status', async () => {
    const { service, error } = await getLcuServiceFromStore()
    if (!service) {
      return { success: false, active: false, error }
    }

    const active = service.isActive() && (await service.getLcuStatus())
    return {
      success: true,
      active,
      lolPath: service.getLolPath(),
    }
  })

  ipcMain.handle('lcu-get-current-session', async () => {
    const { service, error } = await getLcuServiceFromStore()
    if (!service) {
      return { success: false, session: null, error }
    }

    const session = await service.getCurrentSession()
    return {
      success: !!session,
      session,
      error: session ? null : '无有效的选人会话',
    }
  })

  ipcMain.handle('lcu-get-perk-list', async () => {
    const { service, error } = await getLcuServiceFromStore()
    if (!service) {
      return { success: false, perks: [], error }
    }

    const perks = await service.getPerkList()
    return {
      success: true,
      perks,
    }
  })

  ipcMain.handle('lcu-apply-perk', async (_event, data) => {
    const { service, error } = await getLcuServiceFromStore()
    if (!service) {
      return { success: false, error }
    }

    const success = await service.applyPerk(data)
    return { success }
  })

  ipcMain.handle('lcu-get-gameflow-phase', async () => {
    const { service, error } = await getLcuServiceFromStore()
    if (!service) {
      return { success: false, phase: null, error }
    }

    const phase = await service.getGameflowPhase()
    return {
      success: !!phase,
      phase,
    }
  })

  /**
   * 获取当前选择的英雄ID
   */
  ipcMain.handle('get-champion-id', async (): Promise<ChampionIdResult> => {
    try {
      // 从 store 中获取游戏路径
      const lolPath = store.get('lolPath') as string | undefined

      if (!lolPath) {
        logger.warn('[LCU] 未设置游戏路径')
        return {
          success: false,
          championId: null,
          error: '游戏路径未配置',
        }
      }

      logger.info(`[LCU] 游戏路径: ${lolPath}`)

      // 获取 LCU 服务实例
      const lcuService = getLCUServiceInstance(lolPath)

      // 首次调用或需要刷新时获取 token
      if (!lcuService.isActive()) {
        logger.info('[LCU] LCU 服务未激活，尝试获取认证令牌...')
        const authResult = await lcuService.getAuthToken()
        logger.info(`[LCU] 认证结果: ${JSON.stringify(authResult)}`)

        if (!lcuService.isActive()) {
          logger.warn('[LCU] LCU 服务激活失败')
          return {
            success: false,
            championId: null,
            error: 'LCU 未激活 - 请确保游戏客户端正在运行',
          }
        }
      }

      // 获取选人会话
      logger.info('[LCU] 正在获取选人会话...')
      const sessionData = await lcuService.getCurrentSession()

      if (!sessionData) {
        logger.warn('[LCU] 无法获取选人会话数据')
        return {
          success: false,
          championId: null,
          error: '无有效的选人会话 - 请确保处于英雄选择阶段',
        }
      }

      if (sessionData.errorCode) {
        logger.warn(`[LCU] 选人会话错误: ${sessionData.errorCode}`)
        return {
          success: false,
          championId: null,
          error: `选人会话错误: ${sessionData.errorCode}`,
        }
      }

      // 获取当前玩家的 cellId
      const localPlayerCellId = sessionData.localPlayerCellId
      logger.info(`[LCU] 当前玩家 cellId: ${localPlayerCellId}`)
      logger.debug(`[LCU] myTeam 数据: ${JSON.stringify(sessionData.myTeam || [])}`)
      logger.debug(`[LCU] actions 数据: ${JSON.stringify(sessionData.actions || [])}`)

      // 从 myTeam 中查找当前玩家选择的英雄
      if (sessionData.myTeam && Array.isArray(sessionData.myTeam)) {
        for (const member of sessionData.myTeam) {
          // 必须匹配当前玩家的 cellId
          if (
            member.cellId === localPlayerCellId &&
            member.championId &&
            member.championId !== 0
          ) {
            logger.info(
              `[LCU] ✅ 从 myTeam 获得英雄ID: ${member.championId} (cellId: ${localPlayerCellId})`
            )
            return {
              success: true,
              championId: member.championId,
            }
          }
        }
      }

      // 如果 myTeam 中没找到，尝试从 actions 中查找
      if (sessionData.actions && Array.isArray(sessionData.actions) && sessionData.actions.length > 0) {
        for (const actionGroup of sessionData.actions) {
          if (Array.isArray(actionGroup)) {
            for (const action of actionGroup) {
              if (
                action.actorCellId === localPlayerCellId &&
                action.championId &&
                action.championId !== 0
              ) {
                logger.info(
                  `[LCU] ✅ 从 actions 获得英雄ID: ${action.championId} (cellId: ${localPlayerCellId})`
                )
                return {
                  success: true,
                  championId: action.championId,
                }
              }
            }
          }
        }
      }

      logger.warn(`[LCU] ❌ 未找到当前玩家选择的英雄 (cellId: ${localPlayerCellId})`)
      logger.warn(`[LCU]    myTeam 长度: ${sessionData.myTeam?.length || 0}`)
      logger.warn(`[LCU]    actions 长度: ${sessionData.actions?.length || 0}`)

      return {
        success: false,
        championId: null,
        error: '未找到英雄选择 - 请确保已选择英雄',
      }
    } catch (error) {
      logger.error('[LCU] 获取英雄ID时发生错误:', error)
      const err = error as Error
      return {
        success: false,
        championId: null,
        error: err.message,
      }
    }
  })

  logger.info('LCU IPC 处理器已注册')
}
