import type { LocalMatchHistorySummaryResult } from '../../../shared/ipc-contract.ts'
import { getLCUServiceInstance } from '../lcu/lcu-service.ts'
import logger from '../../modules/logger.ts'
import { trustedIpcMain as ipcMain } from '../../security/trusted-ipc.ts'
import { getLocalMatchHistoryService } from './local-match-history-service.ts'

function getService() {
  return getLocalMatchHistoryService(getLCUServiceInstance())
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function getSummaryFailure(error: unknown): Promise<LocalMatchHistorySummaryResult> {
  const service = getService()
  return {
    success: false,
    data: await service.getLocalSummary(),
    error: getErrorMessage(error),
  }
}

export function registerMatchHistoryIpcHandlers(): void {
  ipcMain.handle('match-history-get-local-summary', async () => {
    try {
      return {
        success: true,
        data: await getService().getLocalSummary(),
      } satisfies LocalMatchHistorySummaryResult
    } catch (error) {
      logger.warn('[match-history] failed to read local summary:', getErrorMessage(error))
      return getSummaryFailure(error)
    }
  })

  logger.info('[match-history] IPC handlers registered')
}
