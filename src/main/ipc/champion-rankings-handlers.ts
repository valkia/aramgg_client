import { getDataLocale, loadChampionRankings } from '../data-loader.ts'
import { ensurePopupWindow, getMainWindow, showPopupWindowManually } from '../modules/window-manager.ts'
import logger from '../modules/logger.ts'
import { trustedIpcMain } from '../security/trusted-ipc.ts'

export function registerChampionRankingsIpcHandlers(): void {
  trustedIpcMain.handle('champions-get-rankings', async () => {
    const locale = getDataLocale()
    try {
      return { success: true, data: await loadChampionRankings(locale) }
    } catch (error) {
      logger.warn('[champion-rankings] index load failed:', error)
      return { success: false }
    }
  })

  trustedIpcMain.handle('champions-open-detail', async (event, championId: unknown) => {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents !== event.sender) {
      return { success: false }
    }
    if (typeof championId !== 'number' || !Number.isSafeInteger(championId) || championId <= 0) {
      return { success: false }
    }
    const locale = getDataLocale()
    try {
      const rankings = await loadChampionRankings(locale)
      const champion = rankings.champions.find((entry) => entry.championId === championId)
      if (!champion || locale !== getDataLocale()) return { success: false }
      const popup = await ensurePopupWindow()
      if (!popup || popup.isDestroyed() || mainWindow.isDestroyed() || locale !== getDataLocale()) return { success: false }
      // A deliberate main-window click is independent from the automatic popup preference.
      showPopupWindowManually()
      popup.webContents.send('for-popup', {
        championId,
        championName: champion.name || champion.alias,
        dataSource: 'champion-rankings',
      })
      return { success: true }
    } catch (error) {
      logger.warn('[champion-rankings] detail open failed:', error)
      return { success: false }
    }
  })
}
