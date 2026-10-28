// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import MatchHistoryOverview from '../../src/renderer/components/MatchHistoryOverview.vue'
import type { HextechAramMatchHistoryMatch } from '../../src/shared/ipc-contract.ts'
import { messages } from '../../src/renderer/i18n/messages.ts'

function match(gameId: number): HextechAramMatchHistoryMatch {
  return {
    gameId, gameCreation: gameId * 1_000, gameDuration: 900, gameVersion: '16.21', championId: 103,
    result: 'win', kills: 2, deaths: 1, assists: 4, items: [], augments: [],
    participants: Array.from({ length: 5 }, (_, index) => ({
      participantId: index + 1, teamId: 100, playerName: '', isCurrentPlayer: index === 0,
      championId: 103, result: 'win', kills: 2, deaths: 1, assists: 4, participationStats: { kills: 2, assists: 4 },
      damageToChampions: 12_000, damageTaken: null, goldEarned: 1_000, minionsKilled: null,
      tripleKills: null, quadraKills: null, pentaKills: null, items: [], augments: [],
    })),
  }
}

describe('page performance presentation', () => {
  it.each([
    { locale: 'zh-CN', labels: ['场均对英雄伤害', '场均参团率', '场均金币', '场均队内经济占比'], samples: ['有效 2 场', '有效 1 场'], method: '统计口径', hint: '各有效对局的百分比取平均' },
    { locale: 'en-US', labels: ['Avg. champion damage', 'Avg. kill participation', 'Avg. gold earned', 'Avg. team gold share'], samples: ['Valid matches: 2', 'Valid matches: 1'], method: 'How stats are calculated', hint: 'Both percentages are averaged across valid matches' },
    { locale: 'zh-TW', labels: ['場均對英雄傷害', '場均參團率', '場均金幣', '場均隊內經濟佔比'], samples: ['有效 2 場', '有效 1 場'], method: '統計口徑', hint: '各有效對局的百分比取平均' },
  ])('renders independent valid samples and calculation definitions in $locale', ({ locale, labels, samples, method, hint }) => {
    const first = match(1)
    const incomplete = match(2)
    incomplete.participants = incomplete.participants!.slice(0, 1)
    Object.assign(incomplete.participants[0], { damageToChampions: 24_000, goldEarned: 3_000 })
    const wrapper = mount(MatchHistoryOverview, {
      props: { matches: [first, incomplete, first, { ...match(3), result: 'remake' }] },
      global: { plugins: [createI18n({ legacy: false, locale, messages })] },
    })
    const metrics = wrapper.findAll('dl > div')
    expect(metrics.map((metric) => metric.get('dt').text())).toEqual(labels)
    expect(metrics.map((metric) => metric.get('dd').findAll('span').map((span) => span.text()))).toEqual([
      ['18,000', samples[0]], ['60%', samples[1]], ['2,000', samples[0]], ['20%', samples[1]],
    ])
    expect(wrapper.get('summary').text()).toBe(method)
    expect(wrapper.get('details').text()).toContain(hint)
    expect(wrapper.text()).not.toContain('NaN')
    wrapper.unmount()
  })

  it('displays missing performance as unavailable with zero samples, and hides metrics without completed games', async () => {
    const first = { ...match(1), participants: [] }
    const wrapper = mount(MatchHistoryOverview, {
      props: { matches: [first] },
      global: { plugins: [createI18n({ legacy: false, locale: 'en-US', messages })] },
    })
    expect(wrapper.findAll('dd').map((metric) => metric.findAll('span').map((span) => span.text()))).toEqual(Array(4).fill(['—', 'Valid matches: 0']))
    await wrapper.setProps({ matches: [{ ...first, result: 'remake' }] })
    expect(wrapper.find('dl').exists()).toBe(false)
    expect(wrapper.text()).toContain('No completed matches on this page')
    expect(wrapper.text()).not.toContain('0%')
    wrapper.unmount()
  })
})
