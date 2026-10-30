// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import AramBenchRecommendationPanel from '../../src/renderer/components/AramBenchRecommendation.vue'
import { getAramBenchRecommendation } from '../../src/main/services/aram/bench-recommendation.ts'
import { messages } from '../../src/renderer/i18n/messages.ts'
import type { AramBenchRecommendation } from '../../src/shared/ipc-contract.ts'

const { getRecommendation, lcuWrite, unsubscribe } = vi.hoisted(() => ({
  getRecommendation: vi.fn(), lcuWrite: vi.fn(), unsubscribe: vi.fn(),
}))
vi.mock('../../src/renderer/native/electron-api.ts', () => ({
  hasElectronAPI: () => true,
  electronAPI: {
    lcu: {
      getAramBenchRecommendation: getRecommendation,
      pickOrBan: lcuWrite, benchSwap: lcuWrite, action: lcuWrite, acceptTrade: lcuWrite, declineTrade: lcuWrite,
    },
    events: { on: () => unsubscribe },
  },
}))

function recommendation(overrides = {}, championStats: Record<string, Record<string, unknown>> = {
  63: { name: 'Brand', winRate: 0.5, pickRate: 0.1, numGames: 1_200, tier: 2 },
  99: { name: 'Lux', winRate: 0.6, pickRate: 0.12, numGames: 2_400, tier: 1 },
}) {
  return getAramBenchRecommendation({
    gameflowPhase: 'ChampSelect', selfChampionId: 63, localPlayerCellId: 1,
    benchChampions: [{ championId: 99 }], myTeam: [{ cellId: 1, championId: 63 }], ...overrides,
  }, championStats)
}

let wrapper: VueWrapper | undefined
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks() })
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.useRealTimers() })
function render(data: AramBenchRecommendation | null, locale = 'zh-CN') {
  wrapper = mount(AramBenchRecommendationPanel, {
    props: { compact: true, previewRecommendation: data },
    global: { plugins: [createI18n({ legacy: false, locale, messages })] },
  })
  return wrapper
}

describe('ARAM recommendation panel', () => {
  it.each([
    ['zh-CN', '席位中的 Lux 综合评分更高', '统计 2,400 场', '推荐与数据说明', '获胜概率'],
    ['en-US', 'Lux on the bench scores higher', '2,400 games', 'Recommendation details', 'chance of winning'],
    ['zh-TW', '席位中的 Lux 綜合評分更高', '統計 2,400 場', '推薦與資料說明', '獲勝機率'],
  ])('shows localized decision, samples and method without treating confidence as probability: %s', (locale, decision, samples, title, probability) => {
    const view = render(recommendation(), locale)
    expect(view.get('.decision-line').text()).toContain(decision)
    expect(view.text()).toContain(samples)
    expect(view.get('summary').text()).toBe(title)
    expect(view.get('details').attributes('open')).toBeUndefined()
    expect(view.get('.decision-line').element.closest('details')).toBe(view.get('details').element)
    expect(view.get('.evidence-method').text()).toContain(probability)
    expect(view.find('.data-warning').exists()).toBe(false)
    expect(view.text()).not.toContain('100.0%')
    expect(view.text()).not.toContain('bench.')
    expect(view.findAll('button')).toHaveLength(1)
    expect(lcuWrite).not.toHaveBeenCalled()
  })

  it('shows every candidate with read-only communication and scroll controls outside the cards', async () => {
    const view = render(recommendation({
      benchChampions: Array.from({ length: 10 }, (_, index) => ({ championId: index + 1 })),
      myTeam: [{ cellId: 1, championId: 63 }, { cellId: 2, championId: 99 }],
    }), 'en-US')
    expect(view.findAll('.candidate-row')).toHaveLength(12)
    expect(view.get('.decision-line').text()).toContain('held by a teammate')
    expect(view.findAll('.evidence-note').some((note) => note.text().includes('Discuss teammate-held champions first'))).toBe(true)
    expect(view.text()).not.toContain('综合评分')
    expect(view.get('[role="region"]').attributes('tabindex')).toBe('0')
    expect(view.findAll('button')).toHaveLength(1)
    const list = view.get('.candidate-list')
    const scrollBy = vi.fn()
    Object.defineProperties(list.element, {
      scrollWidth: { value: 1_000 }, clientWidth: { value: 300 }, scrollBy: { value: scrollBy },
    })
    await list.trigger('scroll')
    const controls = view.get('.candidate-navigation').findAll('button')
    expect(view.get('.candidate-navigation').element.parentElement).toBe(view.get('.recommendation-footer').element)
    expect(list.find('.candidate-navigation').exists()).toBe(false)
    expect(controls[0].attributes('disabled')).toBeDefined()
    expect(controls[1].attributes('disabled')).toBeUndefined()
    await controls[1].trigger('click')
    expect(scrollBy).toHaveBeenCalledWith({ left: 216, behavior: 'smooth' })
    list.element.scrollLeft = 700
    await list.trigger('scroll')
    expect(controls[0].attributes('disabled')).toBeUndefined()
    expect(controls[1].attributes('disabled')).toBeDefined()
    expect(lcuWrite).not.toHaveBeenCalled()
  })

  it('shows missing fields and real zeroes separately, with no invented sample-sufficiency claim', () => {
    const view = render(recommendation({}, {
      63: { name: 'Brand', winRate: 0.5, pickRate: 0.1, numGames: null, tier: null },
      99: { name: 'Lux', winRate: 0, pickRate: 0, numGames: 0, tier: 1 },
    }), 'en-US')
    const rows = view.findAll('.candidate-row')
    const brand = rows.find((row) => row.text().includes('Brand'))!
    const lux = rows.find((row) => row.text().includes('Lux'))!
    expect(brand.text()).not.toContain('games')
    expect(brand.text()).toContain('Tier —')
    expect(lux.text()).toContain('0 games')
    expect(lux.text()).toContain('Win 0.0%')
    expect(view.find('.candidate-warning').exists()).toBe(false)
    expect(view.get('.candidate-data-notes').text()).toContain('Brand: Missing or invalid: tier')
    expect(view.get('.candidate-data-notes').text()).toContain('Lux: No game samples')
    expect(view.get('summary').text()).toBe('Games unavailable · Details')
    expect(view.get('.evidence-method').text()).toContain('Missing counts do not mean zero games')
    expect(view.get('.data-warning').text()).toContain('incomplete statistics')
    expect(view.text()).not.toContain('NaN')
  })

  it.each(['zh-CN', 'en-US', 'zh-TW'])('uses one shared note for unavailable game counts and keeps the cards concise: %s', (locale) => {
    const view = render(recommendation({}, {
      63: { name: 'Brand', winRate: 0.5, pickRate: 0.1, numGames: null, tier: 2 },
      99: { name: 'Lux', winRate: 0.6, pickRate: 0.12, numGames: null, tier: 1 },
    }), locale)
    expect(view.findAll('details')).toHaveLength(1)
    expect(view.get('details').attributes('open')).toBeUndefined()
    expect(view.find('.candidate-data-notes').exists()).toBe(false)
    for (const row of view.findAll('.candidate-row')) {
      expect(row.findAll('.stat-line > div')).toHaveLength(3)
      expect(row.text()).not.toMatch(/暂无|暫無|No game|— games/)
    }
    expect(view.text()).not.toContain('bench.')
  })

  it('degrades all-missing statistics to a candidate list and retains the missing-current explanation', async () => {
    const view = render(recommendation({ myTeam: [{ cellId: 1, championId: 63 }, { cellId: 2, championId: 103 }] }, {}))
    expect(view.get('.decision-line').text()).toContain('暂不作强度判断')
    expect(view.findAll('.candidate-row')).toHaveLength(3)
    expect(view.find('.candidate-row.recommended').exists()).toBe(false)
    expect(view.findAll('.candidate-row.current')).toHaveLength(1)
    expect(view.findAll('.candidate-row.teammate')).toHaveLength(1)
    expect(view.get('.data-warning').text()).toContain('所有候选均缺少统计')
    await view.setProps({ previewRecommendation: recommendation({ selfChampionId: null }, {}) })
    expect(view.get('.decision-line').text()).toContain('尚未读取到当前英雄')
    expect(view.findAll('.candidate-row')).toHaveLength(1)
    expect(view.find('.candidate-row.recommended').exists()).toBe(false)
  })

  it('updates decision states as candidates disappear or the session ends', async () => {
    const view = render(recommendation({}, {
      63: { name: 'Brand', winRate: 0.5, pickRate: 0.1, numGames: 1_200, tier: 2 },
      99: { name: 'Lux', winRate: 0.51, pickRate: 0.1, numGames: 1_200, tier: 2 },
    }))
    expect(view.get('.decision-line').text()).toContain('评分差距很小')
    await view.setProps({ previewRecommendation: recommendation({ benchChampions: [] }) })
    expect(view.get('.decision-line').text()).toContain('暂无其他候选')
    await view.setProps({ previewRecommendation: recommendation({ selfChampionId: null, benchChampions: [], myTeam: [] }) })
    expect(view.get('.decision-line').text()).toContain('等待可用英雄')
    expect(view.find('.candidate-scroller').exists()).toBe(false)
    expect(view.find('details').exists()).toBe(false)
    await view.setProps({ previewRecommendation: recommendation({ gameflowPhase: 'Lobby' }) })
    expect(view.get('.empty-state').text()).toContain('等待进入选人阶段')
    expect(view.find('.recommendation-evidence').exists()).toBe(false)
  })

  it('refreshes through the existing read-only method and removes event listeners on unmount', async () => {
    getRecommendation.mockResolvedValue({ success: true, recommendation: recommendation() })
    const view = render(null, 'en-US')
    await flushPromises()
    expect(getRecommendation).toHaveBeenCalledTimes(1)
    await view.get('button.refresh-btn').trigger('click')
    await flushPromises()
    expect(getRecommendation).toHaveBeenCalledTimes(2)
    expect(lcuWrite).not.toHaveBeenCalled()
    view.unmount()
    wrapper = undefined
    expect(unsubscribe).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(getRecommendation).toHaveBeenCalledTimes(2)
  })

  it('keeps identical recommendation evidence keys in all three locales', () => {
    const keys = (object: object): string[] => Object.entries(object).flatMap(([key, value]) =>
      typeof value === 'object' ? keys(value).map((child) => `${key}.${child}`) : [key]).sort()
    expect(keys(messages['en-US'].bench)).toEqual(keys(messages['zh-CN'].bench))
    expect(keys(messages['zh-TW'].bench)).toEqual(keys(messages['zh-CN'].bench))
  })
})
