import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('champion insight lifecycle', () => {
  it('starts hidden and becomes a persistent always-on-top window after champ select', async () => {
    const [windowManager, appConfig] = await Promise.all([
      readFile(new URL('../../src/main/modules/window-manager.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/main/modules/app-config.ts', import.meta.url), 'utf8'),
    ])
    const popupWindowBlock = windowManager.slice(
      windowManager.indexOf('export const createPopupWindow'),
      windowManager.indexOf('export const createAugmentSidePanelWindow'),
    )
    const inProgressRecoveryBlock = appConfig.slice(
      appConfig.indexOf('async function recoverChampionInsightForInProgress'),
      appConfig.indexOf('async function initGameFlowMonitor'),
    )

    expect(popupWindowBlock).toContain('show: false')
    expect(popupWindowBlock).toContain('closable: false')
    expect(popupWindowBlock).toContain('alwaysOnTop: true')
    expect(appConfig).toContain("setPopupWindowAlwaysOnTop(true)")
    expect(appConfig).toContain("popupWindow.show()")
    expect(inProgressRecoveryBlock).toContain('popupWindow.isVisible()')
    expect(inProgressRecoveryBlock).toContain('if (!canRefreshVisiblePopup)')
    expect(inProgressRecoveryBlock).not.toContain('popupWindow.show()')
    expect(appConfig).not.toContain('shouldHideChampionInsightOnGameStart')
  })

  it('keeps popup content visible while preserving side-panel dismissal', async () => {
    const [overlay, screenshotService, preferences] = await Promise.all([
      readFile(
        new URL('../../src/renderer/components/AugmentWinrateOverlay.vue', import.meta.url),
        'utf8',
      ),
      readFile(new URL('../../src/main/auto-screenshot-service.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/renderer/components/OverlayPreferences.vue', import.meta.url), 'utf8'),
    ])
    const augmentClearedBlock = screenshotService.slice(
      screenshotService.indexOf('_notifyAugmentCleared'),
      screenshotService.indexOf('_recordPerformance'),
    )

    expect(overlay).toContain('<div v-if="isSidePanel" class="window-controls">')
    expect(overlay).toContain("if (isSidePanel.value) {\n      closeOverlay('augment-cleared')")
    expect(overlay).toContain("game-started received; champion insight remains visible")
    expect(overlay).toContain("game-in-progress received; champion insight remains visible")
    expect(augmentClearedBlock).not.toContain("url.includes('augment-overlay')")
    expect(augmentClearedBlock).not.toContain('popupWindow.hide()')
    expect(preferences).not.toContain('championInsight.hideOnGameStart')
  })

  it('gates all Champion Details show paths after preserving champion state updates', async () => {
    const [appConfig, ipcHandlers, preferenceHandlers, preferenceSource] = await Promise.all([
      readFile(new URL('../../src/main/modules/app-config.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/main/modules/ipc-handlers.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/main/ipc/preferences-handlers.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/main/modules/user-preferences.ts', import.meta.url), 'utf8'),
    ])
    const champSelectShowBlock = appConfig.slice(
      appConfig.indexOf('async function showChampionInsightSnapshot'),
      appConfig.indexOf('async function pollChampSelectSnapshot'),
    )
    const inProgressRecoveryBlock = appConfig.slice(
      appConfig.indexOf('async function recoverChampionInsightForInProgress'),
      appConfig.indexOf('async function autoApplyAramItemSetForChampion'),
    )

    expect(preferenceSource).toContain("showChampionDetails: 'championInsight.showDetails'")
    expect(preferenceSource).toContain('shouldShowChampionDetails(): boolean')
    expect(preferenceHandlers).toContain("'championInsight.showDetails'")
    expect(champSelectShowBlock.indexOf("store.set('lastSelectedChampionId', championId)"))
      .toBeLessThan(champSelectShowBlock.indexOf('if (!shouldShowChampionDetails())'))
    expect(inProgressRecoveryBlock.indexOf("store.set('lastSelectedChampionId', championId)"))
      .toBeLessThan(inProgressRecoveryBlock.indexOf('if (!canRefreshVisiblePopup)'))
    expect(inProgressRecoveryBlock.indexOf('lastInProgressInsightChampionId = championId'))
      .toBeLessThan(inProgressRecoveryBlock.indexOf('if (!canRefreshVisiblePopup)'))
    expect(ipcHandlers.match(/if \(!shouldShowChampionDetails\(\)\)/g)).toHaveLength(6)
    expect(appConfig).toContain("keepChampionInsightOnTop('LCU phase ChampSelect')")
  })
})
