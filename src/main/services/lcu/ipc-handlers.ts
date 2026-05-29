/**
 * LCU 服务相关的 IPC 处理器
 * 使用统一的 LCU 服务实现
 *
 * 迁移自 electron/modules/ipc-handlers.js
 */

import { ipcMain } from 'electron'
import Store from 'electron-store'
import logger from '../../modules/logger.js'
import { getConfigDir } from '../../modules/app-paths.js'
import { getLCUServiceInstance } from './lcu-service.ts'
import { ChampionIdResult, ChampSelectSnapshot } from './types.ts'
import {
  collectAramCandidateChampionIds,
  createEmptyAramBenchRecommendation,
  getAramBenchRecommendation,
} from '../aram/bench-recommendation.js'

const store = new Store({ cwd: getConfigDir() })
const LCU_READ_TIMEOUT_MS = 8 * 1000

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timeout: NodeJS.Timeout | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

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

const loadChampionStatsForRecommendation = async (
  championIds: number[]
): Promise<Record<string, any>> => {
  if (!championIds.length) {
    return {}
  }

  const { loadChampionStats, loadChampionName } = await import('../../data-loader.ts')
  const entries = await Promise.all(
    championIds.map(async (championId) => {
      try {
        const [stats, championName] = await Promise.all([
          loadChampionStats(championId),
          loadChampionName(championId),
        ])

        return [
          String(championId),
          {
            ...stats,
            ...championName,
            championId,
          },
        ] as const
      } catch (error) {
        const err = error as Error
        logger.warn(`[LCU] Failed to load ARAM stats for champion ${championId}:`, err.message)
        return [
          String(championId),
          {
            championId,
            nameCN: `英雄 ${championId}`,
          },
        ] as const
      }
    })
  )

  return Object.fromEntries(entries)
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

  ipcMain.handle('lcu-get-champ-select-snapshot', async () => {
    const { service, error } = await getLcuServiceFromStore()
    if (!service) {
      return {
        success: true,
        snapshot: {
          connected: false,
          gameflowPhase: null,
          isInChampSelect: false,
          champSelectSession: null,
          localPlayerCellId: null,
          selfChampionId: null,
          benchEnabled: false,
          benchChampions: [],
          myTeam: [],
          actions: [],
          timer: null,
          status: 'unavailable',
          reason: error || 'lcu-unavailable',
          updatedAt: Date.now(),
        } satisfies ChampSelectSnapshot,
        error,
      }
    }

    const snapshot = await service.getChampSelectSnapshot()
    return {
      success: true,
      snapshot,
      error: snapshot.status === 'ready' ? null : snapshot.reason,
    }
  })

  ipcMain.handle('lcu-get-aram-bench-recommendation', async () => {
    const startedAt = Date.now()
    logger.debug('[LCU] ARAM bench recommendation requested')

    const { service, error } = await getLcuServiceFromStore()
    if (!service) {
      return {
        success: true,
        recommendation: createEmptyAramBenchRecommendation(error || 'lcu-unavailable'),
        error,
      }
    }

    try {
      const snapshot = await withTimeout(
        service.getChampSelectSnapshot(),
        LCU_READ_TIMEOUT_MS,
        `LCU 选人快照读取超过 ${LCU_READ_TIMEOUT_MS / 1000} 秒`
      )
      const championIds = collectAramCandidateChampionIds(snapshot)
      const championStatsById = await loadChampionStatsForRecommendation(championIds)
      const recommendation = getAramBenchRecommendation(snapshot, championStatsById)

      if (snapshot.selfChampionId) {
        store.set('lastSelectedChampionId', snapshot.selfChampionId)
      }

      const summary = {
        status: recommendation.status,
        candidateCount: recommendation.candidates?.length || 0,
        durationMs: Date.now() - startedAt,
      }

      if (recommendation.status === 'inactive') {
        logger.debug('[LCU] ARAM bench recommendation completed', summary)
      } else {
        logger.info('[LCU] ARAM bench recommendation completed', summary)
      }

      return {
        success: true,
        snapshot,
        recommendation,
        error: recommendation.status === 'ready' || recommendation.status === 'no-bench'
          ? null
          : recommendation.reason,
      }
    } catch (error) {
      const err = error as Error
      logger.warn('[LCU] ARAM bench recommendation failed:', {
        error: err.message,
        durationMs: Date.now() - startedAt,
      })

      return {
        success: true,
        recommendation: createEmptyAramBenchRecommendation(err.message),
        error: err.message,
      }
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

      logger.debug('[LCU] game path configured')

      // 获取 LCU 服务实例
      const lcuService = getLCUServiceInstance(lolPath)

      // 首次调用或需要刷新时获取 token
      if (!lcuService.isActive()) {
        logger.debug('[LCU] service inactive, refreshing auth token')
        const authResult = await lcuService.getAuthToken()
        logger.debug('[LCU] auth refresh result', {
          active: lcuService.isActive(),
          port: authResult?.port || null,
        })

        if (!lcuService.isActive()) {
          logger.debug('[LCU] service activation failed')
          return {
            success: false,
            championId: null,
            error: 'LCU 未激活 - 请确保游戏客户端正在运行',
          }
        }
      }

      logger.debug('[LCU] reading readonly champ-select snapshot')
      const snapshot = await lcuService.getChampSelectSnapshot()

      logger.debug(
        `[LCU] 选人快照: status=${snapshot.status}, phase=${snapshot.gameflowPhase || 'unknown'}, self=${snapshot.selfChampionId || 'none'}, bench=${snapshot.benchChampions.length}`
      )

      if (snapshot.selfChampionId) {
        store.set('lastSelectedChampionId', snapshot.selfChampionId)
        return {
          success: true,
          championId: snapshot.selfChampionId,
        }
      }

      logger.debug(`[LCU] current player champion not found (snapshot status: ${snapshot.status})`)

      return {
        success: false,
        championId: null,
        error: snapshot.reason || '未找到英雄选择 - 请确保已选择英雄',
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
