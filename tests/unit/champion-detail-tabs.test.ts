// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import AugmentWinrateOverlay from '../../src/renderer/components/AugmentWinrateOverlay.vue'
import PatchTrendsPanel from '../../src/renderer/components/PatchTrendsPanel.vue'
import { messages } from '../../src/renderer/i18n/messages.ts'
import { buildChampionPatchEvidence } from '../../src/main/services/patch-evidence.ts'
import type { SupportedDataLocale } from '../../src/shared/ipc-contract.ts'

const { loadChampionData, handlers, getLocale } = vi.hoisted(() => ({
  loadChampionData: vi.fn(),
  getLocale: vi.fn(),
  handlers: new Map<string, (data: unknown) => void>(),
}))
vi.mock('../../src/renderer/native/electron-api.ts', () => ({
  hasElectronAPI: () => true,
  electronAPI: {
    locale: { get: getLocale },
    store: { get: async () => false },
    diagnostics: { logRendererInfo: vi.fn() },
    events: { on: (name: string, handler: (data: unknown) => void) => {
      handlers.set(name, handler)
      return () => handlers.delete(name)
    } },
    winrate: { loadChampionData },
  },
}))

function detail(championId = 103, locale: SupportedDataLocale = 'zh-CN') {
  const stats = { championId, name: `Champion ${championId}`, alias: championId === 103 ? 'Ahri' : 'Brand', title: '', iconUrl: null, tier: 3, winRate: championId === 103 ? 0.5272 : 0.5, pickRate: 0.0524, numGames: null, gamePatch: '16.15', statsDate: '2026-07-30', source: 'tencent', region: 'CN' }
  return { success: true, locale, data: {
    stats,
    patchEvidence: buildChampionPatchEvidence(stats, { locale, dataVersion: '16.15.2' }),
    championName: { nameCN: stats.name, nameEN: stats.name },
    augments: [{ id: 1002, name: `${locale} augment`, rarity: 'kGold' }],
    augmentStats: { 1002: { win_rate: 0.55, tier: 2 } },
    builds: [{ coreItems: [{ itemIds: [3084, 3111, 2502], games: 100, winRate: 0.55 }] }],
    items: {},
  } }
}

let wrapper: VueWrapper | undefined
beforeEach(() => {
  handlers.clear()
  getLocale.mockResolvedValue({ locale: 'zh-CN' })
  loadChampionData.mockImplementation(async (id: number) => detail(id))
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

async function render(locale: SupportedDataLocale = 'zh-CN', variant = 'popup') {
  getLocale.mockResolvedValue({ locale })
  loadChampionData.mockImplementation(async (id: number) => detail(id, locale))
  const i18n = createI18n({ legacy: false, locale, messages })
  wrapper = mount(AugmentWinrateOverlay, {
    props: { variant },
    global: { plugins: [i18n], stubs: { AramBenchRecommendation: true } },
  })
  await flushPromises()
  await show(103)
  return { view: wrapper, i18n }
}

async function show(championId: number) {
  await (wrapper!.vm as unknown as { showOverlay: (data: unknown) => Promise<void> }).showOverlay({ championId })
  await flushPromises()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

describe('champion detail tabs', () => {
  it.each([
    ['zh-CN', ['海克斯', '出装', '版本改动']],
    ['en-US', ['Augments', 'Builds', 'Patch changes']],
    ['zh-TW', ['增幅裝置', '出裝', '版本改動']],
  ] as const)('keeps augments as the default and mounts the whole patch panel only inside the third tab in %s', async (locale, labels) => {
    const { view } = await render(locale)
    const tabs = view.findAll('.tabs-list .tab-btn')
    expect(tabs.map((tab) => tab.text())).toEqual(labels)
    expect(view.get('.tab-btn.active').text()).toBe(labels[0])
    expect(view.find('.augment-card').exists()).toBe(true)
    expect(view.findComponent(PatchTrendsPanel).exists()).toBe(false)
    expect(view.findAll('.stat-strip .stat-box')).toHaveLength(2)
    expect(view.get('.stat-strip').text()).toContain('52.7%')
    expect(view.get('.stat-strip').text()).toContain('5.2%')
    expect(view.get('.stat-strip').text()).not.toMatch(/场次|場次|Games/)

    await tabs[1].trigger('click')
    expect(view.find('.build-route').exists()).toBe(true)
    expect(view.findComponent(PatchTrendsPanel).exists()).toBe(false)
    expect(view.get('.build-route').text()).toContain(locale === 'en-US' ? '100 games' : locale === 'zh-CN' ? '100 场' : '100 場')

    await tabs[2].trigger('click')
    const patch = view.getComponent(PatchTrendsPanel)
    expect(view.get('.tab-btn.active').text()).toBe(labels[2])
    expect(patch.element.parentElement).toBe(view.get('.tab-content > .tab-panel').element)
    expect(patch.find('[data-testid="patch-notes"]').exists()).toBe(true)
    expect(patch.find('[data-testid="patch-history"]').exists()).toBe(true)
    expect(patch.get('[data-testid="trend-delta"]').text()).toContain('+0.53')
    expect(view.find('.augment-card').exists()).toBe(false)
    expect(view.find('.build-route').exists()).toBe(false)
    expect(loadChampionData).toHaveBeenCalledTimes(1)

    await tabs[0].trigger('click')
    expect(view.findComponent(PatchTrendsPanel).exists()).toBe(false)
    expect(view.find('.augment-card').exists()).toBe(true)
  })

  it('keeps the side panel limited to its original two tabs even when patch evidence is available', async () => {
    const { view } = await render('zh-CN', 'side-panel')
    expect(view.findAll('.tab-btn').map((tab) => tab.text())).toEqual(['海克斯', '出装'])
    await view.findAll('.tab-btn')[1].trigger('click')
    expect(view.find('.build-route').exists()).toBe(true)
    expect(view.findComponent(PatchTrendsPanel).exists()).toBe(false)
    await show(103)
    expect(view.get('.tab-btn.active').text()).toBe('出装')
    expect(view.findComponent(PatchTrendsPanel).exists()).toBe(false)
  })

  it('resets to augments and clears the old patch evidence while a new hero loads', async () => {
    const { view } = await render()
    await view.findAll('.tab-btn')[2].trigger('click')
    expect(view.getComponent(PatchTrendsPanel).props('evidence').championId).toBe(103)
    const next = deferred<ReturnType<typeof detail>>()
    loadChampionData.mockReturnValueOnce(next.promise)
    const loading = show(63)
    await flushPromises()
    expect(view.get('.tab-btn.active').text()).toBe('海克斯')
    await view.findAll('.tab-btn')[2].trigger('click')
    expect(view.findComponent(PatchTrendsPanel).exists()).toBe(false)
    expect(view.get('.tab-panel [role="status"]').text()).toBe('读取中')

    next.resolve(detail(63))
    await loading
    expect(view.getComponent(PatchTrendsPanel).props('championId')).toBe(63)
    expect(view.getComponent(PatchTrendsPanel).props('evidence').championId).toBe(63)
    expect(view.getComponent(PatchTrendsPanel).find('section').exists()).toBe(true)
    expect(view.getComponent(PatchTrendsPanel).get('tbody tr:last-child td').text()).toBe('50.00%')
  })

  it('clears evidence on locale commit and rejects an old hero response after localized data arrives', async () => {
    const { view, i18n } = await render()
    await view.findAll('.tab-btn')[2].trigger('click')
    const oldLocale = deferred<ReturnType<typeof detail>>()
    const newLocale = deferred<ReturnType<typeof detail>>()
    loadChampionData.mockReturnValueOnce(oldLocale.promise).mockReturnValueOnce(newLocale.promise)
    const oldLoading = show(63)
    await flushPromises()
    i18n.global.locale.value = 'en-US'
    handlers.get('locale-changed')!({ locale: 'en-US' })
    await flushPromises()
    expect(view.get('.tab-btn.active').text()).toBe('Augments')
    await view.findAll('.tab-btn')[2].trigger('click')
    expect(view.findComponent(PatchTrendsPanel).exists()).toBe(false)
    expect(view.get('.tab-panel [role="status"]').text()).toBe('Loading')

    newLocale.resolve(detail(63, 'en-US'))
    await flushPromises()
    expect(view.getComponent(PatchTrendsPanel).props('evidence').locale).toBe('en-US')
    expect(view.getComponent(PatchTrendsPanel).find('section').exists()).toBe(true)
    oldLocale.resolve(detail(63, 'zh-CN'))
    await oldLoading
    expect(view.getComponent(PatchTrendsPanel).props('evidence').locale).toBe('en-US')
    expect(view.get('.tab-btn.active').text()).toBe('Patch changes')
  })

  it.each(['missing', 'failed'])('shows the existing no-data state when evidence is %s', async (state) => {
    const { view } = await render()
    if (state === 'failed') loadChampionData.mockRejectedValueOnce(new Error('fixture unavailable'))
    else {
      const result = detail(63)
      result.data.patchEvidence = null
      loadChampionData.mockResolvedValueOnce(result)
    }
    await show(63)
    await view.findAll('.tab-btn')[2].trigger('click')
    expect(view.findComponent(PatchTrendsPanel).exists()).toBe(false)
    expect(view.get('.tab-panel [role="status"]').text()).toBe('无可用数据')
  })
})
