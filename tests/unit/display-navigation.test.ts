// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import Display from '../../src/renderer/components/Display.vue'
import MatchHistoryPanel from '../../src/renderer/components/MatchHistoryPanel.vue'
import ChampionRankingsPanel from '../../src/renderer/components/ChampionRankingsPanel.vue'
import { Select } from '../../src/renderer/components/ui/select/index.js'
import { messages } from '../../src/renderer/i18n/messages.ts'

const mocks = vi.hoisted(() => ({
  query: vi.fn(), rankings: vi.fn(), localeSet: vi.fn(), write: vi.fn(),
  listeners: new Map<string, Set<(value: any) => void>>(),
}))
const emit = (channel: string, value: unknown) => mocks.listeners.get(channel)?.forEach(listener => listener(value))
vi.mock('../../src/renderer/native/electron-api.ts', () => ({
  hasElectronAPI: () => true,
  electronAPI: {
    events: { on: (channel, listener) => {
      if (!mocks.listeners.has(channel)) mocks.listeners.set(channel, new Set())
      mocks.listeners.get(channel)!.add(listener)
      return () => mocks.listeners.get(channel)?.delete(listener)
    } },
    lcu: {
      getConnectionState: async () => ({ connection: 'disconnected', phase: null, revision: 1 }),
      getChampionMonitorState: async () => ({ phase: null, selectedChampionId: null, lastChampionId: 103, revision: 1 }),
      getManualLeaguePath: async () => ({ success: true, path: '/fixture/fallback/League', valid: true }),
    },
    champions: { getRankings: mocks.rankings }, matchHistory: { queryCurrent: mocks.query },
    locale: { get: async () => ({ locale: 'zh-CN' }), set: mocks.localeSet },
    appInfo: { getVersionInfo: async () => ({ success: true, data: { currentVersion: '0.2.17', dataVersion: 'fixture', locale: 'zh-CN' } }) },
    appUpdate: { getState: async () => ({ success: true, data: { phase: 'disabled' } }) },
    postGameShare: { getLatest: async () => ({ success: true, data: null }) },
    analytics: { track: vi.fn() }, store: { get: async () => false, set: mocks.write },
  },
}))
let wrapper: VueWrapper | undefined
let i18n: ReturnType<typeof createI18n>
beforeEach(() => {
  mocks.listeners.clear()
  mocks.query.mockImplementation(async ({ startIndex }) => ({ success: true, data: {
    playerName: 'Fixture#CN1', platformId: 'HN1', queriedAt: 1, startIndex, count: 10,
    returnedCount: 2, hasPrevious: startIndex > 0, hasMore: true, locale: 'zh-CN', snapshotId: 'fixture',
    matches: [103, 63].map((id, index) => ({
      gameId: startIndex + index + 1, championId: id, championName: `Hero${id}`, result: index ? 'loss' : 'win',
      gameCreation: 1000, gameDuration: 900, gameVersion: '16.21', kills: 1, deaths: 1, assists: 1, items: [], augments: [],
    })),
  } }))
  mocks.rankings.mockResolvedValue({ success: true, data: {
    locale: 'zh-CN', dataVersion: 'fixture', gamePatch: '16.21', generatedAt: '',
    champions: [103, 63].map((championId, index) => ({
      championId, name: `Hero${championId}`, alias: championId === 103 ? 'Ahri' : 'Brand', title: '',
      iconUrl: null, tier: index + 1, winRate: 0.6 - index / 10, pickRate: 0.1, numGames: null,
      gamePatch: '', statsDate: '', source: '', region: '',
    })),
  } })
  i18n = createI18n({ legacy: false, locale: 'zh-CN', messages })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })
function render() {
  wrapper = mount(Display, { attachTo: document.body, global: {
    plugins: [i18n], stubs: { FeedbackWidget: true, PostGameShareModal: true },
  } })
  return wrapper
}

describe('main window sections', () => {
  it('keeps the real match page, filters, champion search, sort, and scroll across section switches', async () => {
    const view = render()
    await flushPromises()
    const history = view.getComponent(MatchHistoryPanel)
    const champions = view.getComponent(ChampionRankingsPanel)
    const historyPanel = view.get('#main-panel-history').element
    const nextPage = history.findAll('button').find(button => button.text() === '下一页')!
    await nextPage.trigger('click'); await flushPromises()
    await history.findAll('select')[0].setValue('103')
    await history.findAll('select')[1].setValue('win')
    historyPanel.scrollTop = 123
    await view.get('#main-tab-champions').trigger('click')
    expect(view.get('#main-panel-history').attributes('style')).toContain('display: none')
    await champions.get('input').setValue('ahri')
    await champions.findAll('thead button')[1].trigger('click')
    const sort = champions.findAll('thead th')[2].attributes('aria-sort')
    view.get('#main-panel-champions').element.scrollTop = 80
    await view.get('#main-tab-settings').trigger('click')
    await view.get('#main-tab-history').trigger('click')
    expect(view.getComponent(MatchHistoryPanel).element).toBe(history.element)
    expect(history.text()).toContain('第 2 页')
    expect(history.findAll('article')).toHaveLength(1)
    expect(history.findAll('select').map(select => (select.element as HTMLSelectElement).value)).toEqual(['103', 'win'])
    expect(historyPanel.scrollTop).toBe(123)
    await view.get('#main-tab-champions').trigger('click')
    expect(view.getComponent(ChampionRankingsPanel).element).toBe(champions.element)
    expect((champions.get('input').element as HTMLInputElement).value).toBe('ahri')
    expect(champions.findAll('thead th')[2].attributes('aria-sort')).toBe(sort)
    expect(view.get('#main-panel-champions').element.scrollTop).toBe(80)
    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(mocks.rankings).toHaveBeenCalledOnce()
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('keeps all existing settings and offline navigation without using a fallback path or last hero as connection evidence', async () => {
    const view = render()
    await flushPromises()
    await view.get('#main-tab-settings').trigger('click')
    const settings = view.get('#main-panel-settings')
    expect(view.get('[data-connection]').attributes('data-connection')).toBe('disconnected')
    expect(settings.findAll('[role="switch"]')).toHaveLength(7)
    expect(settings.find('.header-locale-trigger').exists()).toBe(true)
    for (const text of ['赛后海报', '窗口预览', '海克斯浮窗', '英雄详情', '数据探测', '反馈建议', '更新日志', '日志目录']) {
      expect(settings.text()).toContain(text)
    }
    expect(settings.find('.manual-path-input').exists()).toBe(false)
    await settings.get('.game-directory-toggle').trigger('click'); await flushPromises()
    expect((settings.get('.manual-path-input').element as HTMLInputElement).value).toBe('/fixture/fallback/League')
    expect(view.get('[data-connection]').attributes('data-connection')).toBe('disconnected')
    for (const id of ['history', 'champions', 'settings']) {
      expect(view.get(`#main-panel-${id}`).attributes('aria-labelledby')).toBe(`main-tab-${id}`)
    }
  })

  it('waits for a committed locale before changing interface data and leaves navigation usable during preparation', async () => {
    let finish!: (value: unknown) => void
    mocks.localeSet.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const view = render()
    await flushPromises()
    await view.get('#main-tab-settings').trigger('click')
    view.getComponent(Select).vm.$emit('update:modelValue', 'en-US')
    await flushPromises()
    expect(mocks.localeSet).toHaveBeenCalledExactlyOnceWith('en-US')
    expect(i18n.global.locale.value).toBe('zh-CN')
    expect(view.get('.header-locale-trigger').attributes('disabled')).toBeDefined()
    await view.get('#main-tab-champions').trigger('click')
    expect(view.get('#main-tab-champions').attributes('aria-selected')).toBe('true')
    finish({ locale: 'en-US', dataVersion: 'fixture-en' })
    i18n.global.locale.value = 'en-US'
    emit('locale-changed', { locale: 'en-US', dataVersion: 'fixture-en' })
    await flushPromises()
    expect(view.get('#main-tab-champions').text()).toBe('Champions')
    await view.get('#main-tab-settings').trigger('click')
    expect(view.get('.header-locale-trigger').attributes('disabled')).toBeUndefined()
    expect(view.get('.header-locale-trigger').text()).toContain('English')
  })
})
