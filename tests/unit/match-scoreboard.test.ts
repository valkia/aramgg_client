// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import MatchScoreboard from '../../src/renderer/components/MatchScoreboard.vue'
import MatchAssetTooltip from '../../src/renderer/components/MatchAssetTooltip.vue'
import { messages } from '../../src/renderer/i18n/messages.ts'
import type { HextechAramMatchHistoryMatch } from '../../src/shared/ipc-contract.ts'

describe('match scoreboard disclosure', () => {
  it('opens on demand, renders both teams and falls back safely for missing metrics and names', async () => {
    const match: HextechAramMatchHistoryMatch = {
      gameId: 1, gameCreation: 1_000, gameDuration: 900, gameVersion: '16.21', championId: 103,
      result: 'win', kills: 10, deaths: 2, assists: 8, items: [], augments: [],
      participants: Array.from({ length: 10 }, (_, index) => ({
        participantId: index + 1, teamId: index < 5 ? 100 : 200, playerName: '', isCurrentPlayer: index === 0,
        championId: 103, result: index < 5 ? 'win' : 'loss', kills: 10, deaths: 2, assists: 8,
        damageToChampions: null, damageTaken: null, goldEarned: null, minionsKilled: null,
        tripleKills: 0, quadraKills: 0, pentaKills: index === 0 ? 1 : 0, items: [{ id: 1001 }], augments: [{ id: 18 }],
      })),
    }
    const wrapper = mount(MatchScoreboard, { props: { match }, global: { plugins: [createI18n({ legacy: false, locale: 'en-US', messages })] } })
    expect(wrapper.find('section').exists()).toBe(false)
    const disclosure = wrapper.get('details')
    ;(disclosure.element as HTMLDetailsElement).open = true
    await disclosure.trigger('toggle')
    expect(wrapper.findAll('section')).toHaveLength(2)
    expect(wrapper.findAll('ol > li')).toHaveLength(10)
    expect(wrapper.text()).toContain('Your team')
    expect(wrapper.text()).toContain('Opponents')
    expect(wrapper.text()).toContain('Player 1')
    expect(wrapper.text()).toContain('Pentakill ×1')
    expect(wrapper.text()).toContain('Gold —')
    expect(wrapper.text()).not.toContain('Top team damage')
    expect(wrapper.text()).not.toContain('NaN')
    expect(wrapper.text()).toContain('Item #1001')
    expect(wrapper.findAllComponents(MatchAssetTooltip)).toHaveLength(20)
    await wrapper.getComponent(MatchAssetTooltip).get('[tabindex]').trigger('focus')
    await flushPromises()
    expect(document.querySelector('.match-asset-tooltip')).not.toBeNull()
    ;(disclosure.element as HTMLDetailsElement).open = false
    await disclosure.trigger('toggle')
    await flushPromises()
    expect(document.querySelector('.match-asset-tooltip')).toBeNull()
    wrapper.unmount()
  })
})
