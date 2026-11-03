import type {
  HextechAramMatchHistoryQuery,
  HextechAramMatchHistoryQueryResult,
  LocalMatchHistorySummaryResult,
  MatchDetailSnapshotResult,
} from '../../../shared/ipc-contract.ts'
import { getLCUServiceInstance } from '../lcu/lcu-service.ts'
import logger from '../../modules/logger.ts'
import { trustedIpcMain as ipcMain } from '../../security/trusted-ipc.ts'
import { getHextechAramQueryService } from './hextech-aram-query-service.ts'
import { getLocalMatchHistoryService } from './local-match-history-service.ts'
import { getDataLocale } from '../../data-loader.ts'
import { closeMatchDetailWindows, getMainWindow, getOwnedMatchDetailSnapshot, openMatchDetailWindow } from '../../modules/window-manager.ts'
import { MatchDetailSnapshotExpiredError, matchDetailSnapshots, type MatchDetailContext } from './match-detail-snapshots.ts'
import type { WebContents } from 'electron'

function assertMainWindow(contents: WebContents): void {
  if (getMainWindow()?.webContents !== contents) throw new Error('Only the main window can select match history')
}

function synchronizeContext(context: MatchDetailContext): void {
  if (context.locale !== getDataLocale()) throw new MatchDetailSnapshotExpiredError()
  if (!matchDetailSnapshots.matchesContext(context)) {
    closeMatchDetailWindows()
    matchDetailSnapshots.clear()
  }
}

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

  ipcMain.handle('match-history-query-current', async (event, query?: HextechAramMatchHistoryQuery) => {
    assertMainWindow(event.sender)
    try {
      const service = getHextechAramQueryService(getLCUServiceInstance())
      synchronizeContext(await service.getCurrentContext())
      const revision = matchDetailSnapshots.revision
      const { page, context } = await service.queryCurrentWithContext(query)
      if (context.locale !== getDataLocale()) throw new MatchDetailSnapshotExpiredError()
      return {
        success: true,
        data: matchDetailSnapshots.capture(page, context, revision),
      } satisfies HextechAramMatchHistoryQueryResult
    } catch (error) {
      logger.warn('[match-history] current player query failed:', {
        error: getErrorMessage(error),
        sensitiveValuesLogged: false,
      })
      return {
        success: false,
        error: getErrorMessage(error),
        ...(error instanceof MatchDetailSnapshotExpiredError ? { errorCode: 'snapshot-invalid' } : {}),
      } satisfies HextechAramMatchHistoryQueryResult
    }
  })

  ipcMain.handle('match-history-open-detail', async (event, selection: unknown) => {
    assertMainWindow(event.sender)
    try {
      const context = await getHextechAramQueryService(getLCUServiceInstance()).getCurrentContext()
      synchronizeContext(context)
      await openMatchDetailWindow(matchDetailSnapshots.select(selection, context))
      return { success: true }
    } catch {
      return { success: false, error: 'Match details unavailable; refresh the match list or close another detail window' }
    }
  })

  ipcMain.handle('match-history-get-detail-snapshot', async (event): Promise<MatchDetailSnapshotResult> => {
    // The renderer supplies neither a window ID nor a game ID. Ownership uses the actual WebContents object.
    const snapshot = getOwnedMatchDetailSnapshot(event.sender)
    if (!snapshot) throw new Error('This window does not own a match detail snapshot')
    try {
      const context = await getHextechAramQueryService(getLCUServiceInstance()).getCurrentContext()
      synchronizeContext(context)
      if (getOwnedMatchDetailSnapshot(event.sender) !== snapshot ||
          snapshot.accountKey !== context.accountKey || snapshot.data.platformId !== context.platformId || snapshot.data.locale !== context.locale) {
        throw new Error('Match detail snapshot expired')
      }
      return { success: true, data: structuredClone(snapshot.data) }
    } catch {
      return { success: false, error: 'Match detail snapshot expired; refresh the match list' }
    }
  })

  logger.info('[match-history] IPC handlers registered')
}
