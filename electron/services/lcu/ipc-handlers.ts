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

/**
 * 注册所有 LCU 相关的 IPC 处理器
 */
export function registerLCUIpcHandlers(): void {
  /**
   * 获取当前选择的英雄ID
   */
  ipcMain.handle('get-champion-id', async (): Promise<ChampionIdResult> => {
    try {
      // 从 store 中获取游戏路径
      const lolPath = store.get('lolPath') as string | undefined

      if (!lolPath) {
        logger.warn('未设置游戏路径')
        return {
          success: false,
          championId: null,
          error: '游戏路径未配置',
        }
      }

      // 获取 LCU 服务实例
      const lcuService = getLCUServiceInstance(lolPath)

      // 首次调用或需要刷新时获取 token
      if (!lcuService.isActive()) {
        const authResult = await lcuService.getAuthToken()
        if (!lcuService.isActive()) {
          logger.warn('LCU 未激活')
          return {
            success: false,
            championId: null,
            error: 'LCU 未激活',
          }
        }
      }

      // 获取选人会话
      const sessionData = await lcuService.getCurrentSession()
      if (!sessionData || sessionData.errorCode) {
        // 这是正常情况（未在选人阶段），不需要记录 info 日志
        return {
          success: false,
          championId: null,
          error: '无有效的选人会话',
        }
      }

      // 获取当前玩家的 cellId
      const localPlayerCellId = sessionData.localPlayerCellId

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
              '从 myTeam 获得英雄ID:',
              member.championId,
              '(cellId:',
              localPlayerCellId,
              ')'
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
                  '从 actions 获得英雄ID:',
                  action.championId,
                  '(cellId:',
                  localPlayerCellId,
                  ')'
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

      // 没有找到任何英雄选择
      return {
        success: false,
        championId: null,
        error: '未检测到英雄选择',
      }
    } catch (error) {
      const err = error as Error
      logger.error('获取英雄ID出错:', err.message)
      return {
        success: false,
        championId: null,
        error: err.message,
      }
    }
  })

  /**
   * 获取 LCU 状态
   */
  ipcMain.handle('lcu-get-status', async () => {
    try {
      const lolPath = store.get('lolPath') as string | undefined
      if (!lolPath) {
        return { success: false, active: false, error: '游戏路径未配置' }
      }

      const lcuService = getLCUServiceInstance(lolPath)
      const status = await lcuService.getLcuStatus()

      return {
        success: true,
        active: status,
      }
    } catch (error) {
      const err = error as Error
      return {
        success: false,
        active: false,
        error: err.message,
      }
    }
  })

  /**
   * 获取当前选人会话
   */
  ipcMain.handle('lcu-get-current-session', async () => {
    try {
      const lolPath = store.get('lolPath') as string | undefined
      if (!lolPath) {
        return { success: false, session: null, error: '游戏路径未配置' }
      }

      const lcuService = getLCUServiceInstance(lolPath)

      if (!lcuService.isActive()) {
        await lcuService.getAuthToken()
      }

      const session = await lcuService.getCurrentSession()

      return {
        success: true,
        session,
      }
    } catch (error) {
      const err = error as Error
      return {
        success: false,
        session: null,
        error: err.message,
      }
    }
  })

  /**
   * 获取游戏流程阶段
   */
  ipcMain.handle('lcu-get-gameflow-phase', async () => {
    try {
      const lolPath = store.get('lolPath') as string | undefined
      if (!lolPath) {
        return { success: false, phase: null, error: '游戏路径未配置' }
      }

      const lcuService = getLCUServiceInstance(lolPath)
      const phase = await lcuService.getGameflowPhase()

      return {
        success: true,
        phase,
      }
    } catch (error) {
      const err = error as Error
      return {
        success: false,
        phase: null,
        error: err.message,
      }
    }
  })

  /**
   * 获取符文页列表
   */
  ipcMain.handle('lcu-get-perk-list', async () => {
    try {
      const lolPath = store.get('lolPath') as string | undefined
      if (!lolPath) {
        return { success: false, perks: [], error: '游戏路径未配置' }
      }

      const lcuService = getLCUServiceInstance(lolPath)

      if (!lcuService.isActive()) {
        await lcuService.getAuthToken()
      }

      const perks = await lcuService.getPerkList()

      return {
        success: true,
        perks,
      }
    } catch (error) {
      const err = error as Error
      return {
        success: false,
        perks: [],
        error: err.message,
      }
    }
  })

  /**
   * 应用符文页
   */
  ipcMain.handle('lcu-apply-perk', async (event, perkData) => {
    try {
      const lolPath = store.get('lolPath') as string | undefined
      if (!lolPath) {
        return { success: false, error: '游戏路径未配置' }
      }

      const lcuService = getLCUServiceInstance(lolPath)

      if (!lcuService.isActive()) {
        await lcuService.getAuthToken()
      }

      const success = await lcuService.applyPerk(perkData)

      return {
        success,
      }
    } catch (error) {
      const err = error as Error
      return {
        success: false,
        error: err.message,
      }
    }
  })

  logger.info('LCU IPC 处理器已注册')
}
