import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { shouldRaiseOverlayWindow } from '../../src/main/modules/overlay-window-state.ts'

describe('augment overlay performance safeguards', () => {
  it('raises an overlay only while it is hidden', () => {
    expect(shouldRaiseOverlayWindow({ isVisible: () => false })).toBe(true)
    expect(shouldRaiseOverlayWindow({ isVisible: () => true })).toBe(false)
  })

  it('keeps overlay rendering free of persistent blur and pulse effects', async () => {
    const [floatingOverlay, sidePanelOverlay] = await Promise.all([
      readFile(
        new URL('../../src/renderer/components/AugmentFloatingOverlay.vue', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../../src/renderer/components/AugmentWinrateOverlay.vue', import.meta.url),
        'utf8',
      ),
    ])

    expect(floatingOverlay).not.toContain('backdrop-filter')
    expect(floatingOverlay).not.toContain('animation: pulse')
    expect(floatingOverlay).not.toContain('@keyframes pulse')
    expect(sidePanelOverlay).not.toContain('backdrop-filter')
  })

  it('displays rank-backed augment recommendations with tier labels', async () => {
    const [floatingOverlay, championDetailOverlay] = await Promise.all([
      readFile(
        new URL('../../src/renderer/components/AugmentFloatingOverlay.vue', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../../src/renderer/components/AugmentWinrateOverlay.vue', import.meta.url),
        'utf8',
      ),
    ])

    expect(floatingOverlay).toContain('formatPercent(augment.pickRate)')
    expect(floatingOverlay).toContain('formatAugmentTier(augment.tier)')
    expect(floatingOverlay).toContain('const hasRecommendationData =')
    expect(championDetailOverlay).toContain('formatPercent(augment.winRate)')
    expect(championDetailOverlay).toContain("t('augment.winRate')")
    expect(championDetailOverlay).toContain('class="augment-tier"')
    expect(championDetailOverlay).toContain('formatAugmentTier(augment.tier)')
    expect(championDetailOverlay).toContain('rank: toNullableNumber(stats.rank)')
    expect(championDetailOverlay).toContain('return rankAugmentRecommendations(rows)')
    expect(championDetailOverlay).not.toContain('winRate * 0.6 + pickRate * 0.2')
  })

  it('uses Electron background throttling defaults and guards every overlay raise path', async () => {
    const [windowManager, autoScreenshotService, appConfig, ipcHandlers] = await Promise.all([
      readFile(new URL('../../src/main/modules/window-manager.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/main/auto-screenshot-service.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/main/modules/app-config.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/main/modules/ipc-handlers.ts', import.meta.url), 'utf8'),
    ])

    expect(windowManager).not.toContain('backgroundThrottling')
    expect(windowManager).toContain('!shouldRaiseOverlayWindow(window)')
    expect(autoScreenshotService.match(/if \(shouldRaiseOverlayWindow\(/g)).toHaveLength(2)
    expect(appConfig.match(/if \(shouldRaiseOverlayWindow\(/g)).toHaveLength(2)
    expect(ipcHandlers.match(/if \(shouldRaiseOverlayWindow\(/g)).toHaveLength(4)
  })
})
