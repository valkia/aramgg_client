import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AramBenchRecommendation } from '../../src/shared/ipc-contract.ts'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<any>>(),
  getLocale: vi.fn(), loadRankings: vi.fn(), loadRoster: vi.fn(), send: vi.fn(),
  snapshot: vi.fn(), lcuWrite: vi.fn(),
}))
vi.mock('electron', () => ({ BrowserWindow: {}, clipboard: {}, dialog: {}, nativeImage: {} }))
vi.mock('../../src/main/security/trusted-ipc.ts', () => ({ trustedIpcMain: {
  handle: (channel: string, listener: any) => mocks.handlers.set(channel, listener), on: vi.fn(),
} }))
vi.mock('../../src/main/data-loader.ts', () => ({
  getDataLocale: mocks.getLocale, loadChampionRankings: mocks.loadRankings, loadChampionRoster: mocks.loadRoster,
}))
vi.mock('../../src/main/screenshot.ts', () => ({ captureScreenshot: vi.fn() }))
vi.mock('../../src/main/image-analyzer.ts', () => ({ analyzeScreenshot: vi.fn() }))
vi.mock('../../src/main/auto-screenshot-service.ts', () => ({ default: {} }))
vi.mock('../../src/main/services/post-game-share.ts', () => ({
  createMockPostGameSharePosterData: vi.fn(), getLatestPostGameSharePosterData: vi.fn(), preparePostGameSharePosterData: vi.fn(),
}))
vi.mock('../../src/main/modules/window-manager.ts', () => ({
  applyAugmentSidePanelWindowLayout: vi.fn(), applyFloatingWindowLayout: vi.fn(), applyPopupWindowLayout: vi.fn(),
  getAugmentSidePanelWindow: vi.fn(), ensureAugmentOverlayWindows: vi.fn(), getFloatingWindow: vi.fn(),
  getMainWindow: vi.fn(), getPopupWindow: vi.fn(), raiseOverlayWindow: vi.fn(),
  ensurePopupWindow: async () => ({ isDestroyed: () => false, isVisible: () => false, show: vi.fn(), webContents: { send: mocks.send } }),
}))
vi.mock('../../src/main/modules/logger.ts', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../src/main/modules/renderer-ready.ts', () => ({ markRendererReady: vi.fn() }))
vi.mock('../../src/main/modules/app-store.ts', () => ({ default: {} }))
vi.mock('../../src/main/modules/app-paths.ts', () => ({ getAppDataDir: vi.fn() }))
vi.mock('../../src/main/modules/user-preferences.ts', () => ({
  shouldShowChampionDetails: () => true, shouldShowAugmentSidePanel: () => false, shouldShowAugmentTopOverlay: () => false,
}))
vi.mock('../../src/main/ipc/preferences-handlers.ts', () => ({ registerPreferencesIpcHandlers: vi.fn() }))
vi.mock('../../src/main/ipc/system-handlers.ts', () => ({ registerSystemIpcHandlers: vi.fn() }))
vi.mock('../../src/main/ipc/feedback-handlers.ts', () => ({ registerFeedbackIpcHandlers: vi.fn() }))
vi.mock('../../src/main/ipc/champion-rankings-handlers.ts', () => ({ registerChampionRankingsIpcHandlers: vi.fn() }))
vi.mock('../../src/main/services/match-history/ipc-handlers.ts', () => ({ registerMatchHistoryIpcHandlers: vi.fn() }))
vi.mock('../../src/main/modules/champion-monitor-state.ts', () => ({ getChampionMonitorState: vi.fn(), rememberChampionId: vi.fn() }))
vi.mock('../../src/main/modules/lcu-connection-state.ts', () => ({ getLcuConnectionState: vi.fn() }))
vi.mock('../../src/main/services/lcu/lcu-service.ts', () => ({ getLCUServiceInstance: () => ({
  isActive: () => true, getChampSelectSnapshot: mocks.snapshot,
  pickOrBan: mocks.lcuWrite, benchSwap: mocks.lcuWrite, action: mocks.lcuWrite,
  acceptTrade: mocks.lcuWrite, declineTrade: mocks.lcuWrite,
}) }))

import { registerIpcHandlers } from '../../src/main/modules/ipc-handlers.ts'
import { mapChampionRankings } from '../../src/main/services/champion-rankings.ts'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.getLocale.mockReturnValue('en-US')
  // The legacy roster deliberately contains zero-filled statistics. Neither path may score those values.
  mocks.loadRoster.mockResolvedValue([
    { championId: 63, name: 'Legacy Brand', numGames: 0 }, { championId: 99, name: 'Legacy Lux', numGames: 0 },
  ])
  mocks.loadRankings.mockResolvedValue(mapChampionRankings({ data: [
    { id: 63, name: 'Brand', stats: { winRate: 0.5, pickRate: 0.1, games: null, tier: 2 } },
    { id: 99, name: 'Lux', stats: { winRate: 0, pickRate: 0, games: 0, tier: 1 } },
  ] }, { locale: 'en-US', dataVersion: 'fixture' }))
  mocks.snapshot.mockResolvedValue({
    gameflowPhase: 'ChampSelect', selfChampionId: 63, localPlayerCellId: 1,
    benchChampions: [{ championId: 99 }], myTeam: [{ cellId: 1, championId: 63 }],
  })
  registerIpcHandlers(false)
})

describe('ARAM recommendation IPC data paths', () => {
  it.each(['lcu-get-aram-bench-recommendation', 'test-show-bench-recommendation'])(
    'preserves source null and true zero through the real %s handler', async (channel) => {
      const result = await mocks.handlers.get(channel)!({})
      expect(result).toMatchObject({ success: true })
      const recommendation: AramBenchRecommendation = result.recommendation
      expect(recommendation.candidates).toHaveLength(2)
      expect(recommendation.candidates.find((candidate) => candidate.championId === 63)).toMatchObject({ name: 'Brand', games: null, winRate: 0.5, tier: 2 })
      expect(recommendation.candidates.find((candidate) => candidate.championId === 99)).toMatchObject({ name: 'Lux', games: 0, winRate: 0, pickRate: 0, tier: 1 })
      expect(mocks.loadRankings).toHaveBeenCalledExactlyOnceWith('en-US')
      expect(recommendation.readOnly).toBe(true)
      expect(mocks.lcuWrite).not.toHaveBeenCalled()
      if (channel === 'test-show-bench-recommendation') {
        expect(mocks.send).toHaveBeenCalledWith('bench-recommendation-preview', recommendation)
        expect(mocks.snapshot).not.toHaveBeenCalled()
      } else {
        expect(mocks.loadRoster).not.toHaveBeenCalled()
      }
    },
  )
})
