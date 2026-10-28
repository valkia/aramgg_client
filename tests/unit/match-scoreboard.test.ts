// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import MatchScoreboard from '../../src/renderer/components/MatchScoreboard.vue'
import MatchAssetTooltip from '../../src/renderer/components/MatchAssetTooltip.vue'
import { messages } from '../../src/renderer/i18n/messages.ts'
import type { HextechAramMatchHistoryMatch } from '../../src/shared/ipc-contract.ts'

function match(): HextechAramMatchHistoryMatch {
  return {
    gameId: 1, gameCreation: 1_000, gameDuration: 600, gameVersion: '16.21', championId: 103,
    result: 'win', kills: 2, deaths: 1, assists: 4, items: [], augments: [],
    participants: Array.from({ length: 10 }, (_, index) => ({
      participantId: index + 1, teamId: index < 5 ? 100 : 200, playerName: `Player ${index + 1}`,
      isCurrentPlayer: index === 0, championId: 103, result: index < 5 ? 'win' : 'loss',
      kills: 2, deaths: 1, assists: 4, participationStats: { kills: 2, assists: 4 },
      damageToChampions: 1_000, damageTaken: 500, totalHeal: 200, damageToTurrets: 750,
      goldEarned: 5_000, minionsKilled: 35, spell1Id: 4, spell2Id: 32,
      tripleKills: 0, quadraKills: 0, pentaKills: 0, items: [], augments: [],
    })),
  }
}

async function render(game = match(), locale = 'zh-CN') {
  const wrapper = mount(MatchScoreboard, { props: { match: game }, global: { plugins: [createI18n({ legacy: false, locale, messages })] } })
  ;(wrapper.get('details').element as HTMLDetailsElement).open = true
  await wrapper.get('details').trigger('toggle')
  return wrapper
}

describe('match scoreboard disclosure', () => {
  it('opens on demand, renders both teams and falls back safely for missing metrics and names', async () => {
    const game = match()
    game.participants!.forEach((player, index) => Object.assign(player, {
      playerName: '', damageToChampions: null, damageTaken: null, totalHeal: null, damageToTurrets: null,
      goldEarned: null, minionsKilled: null, spell1Id: null, spell2Id: null,
      pentaKills: index === 0 ? 1 : 0, items: [{ id: 1001 }], augments: [{ id: 18 }],
    }))
    const wrapper = mount(MatchScoreboard, { props: { match: game }, global: { plugins: [createI18n({ legacy: false, locale: 'en-US', messages })] } })
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

describe('match scoreboard presentation', () => {
  it.each([
    { locale: 'zh-CN', heal: '总治疗（含自身）· 队内占比', turret: '对防御塔伤害', gold: '分均金币 500', cs: '分均补兵 3.5', spells: '召唤师技能', flash: '闪现', mark: '标记', hint: '总治疗包含自身治疗' },
    { locale: 'en-US', heal: 'Total healing (incl. self) · team share', turret: 'Damage to turrets', gold: 'Gold/min 500', cs: 'CS/min 3.5', spells: 'Summoner spells', flash: 'Flash', mark: 'Mark', hint: 'Total healing includes self-healing' },
    { locale: 'zh-TW', heal: '總治療（含自身）· 隊內佔比', turret: '對防禦塔傷害', gold: '每分鐘金幣 500', cs: '每分鐘補兵 3.5', spells: '召喚師技能', flash: '閃現', mark: '標記', hint: '總治療包含自身治療' },
  ])('shows localized metric definitions, rates and ordered spell names in $locale', async (expected) => {
    const wrapper = await render(match(), expected.locale)
    const player = wrapper.findAll('ol > li')[0]
    expect(player.get('[data-metric="totalHeal"] dt').text()).toBe(expected.heal)
    expect(player.get('[data-metric="totalHeal"] dd').text()).toBe('200 20%')
    expect(player.get('[data-metric="damageToTurrets"] dt').text()).toBe(expected.turret)
    expect(player.get('[data-metric="damageToTurrets"] dd').text()).toBe('750')
    expect(player.get('[data-metric="goldEarned"] dd').text()).toContain(expected.gold)
    expect(player.get('[data-metric="minionsKilled"] dd').text()).toContain(expected.cs)
    expect(player.findAll('dl [aria-hidden="true"] > div').map((bar) => bar.attributes('style'))).toEqual(Array(3).fill('width: 20%;'))
    const spells = player.get(`ul[aria-label="${expected.spells}"]`)
    expect(spells.findAll('li').map((slot) => slot.text())).toEqual([expected.flash, expected.mark])
    expect(spells.findAll('img').map((image) => image.attributes('src'))).toEqual([
      'https://cdn.dtodo.cn/hextech/summoner-spell-icons/4.png', 'https://cdn.dtodo.cn/hextech/summoner-spell-icons/32.png',
    ])
    expect(wrapper.text()).toContain(expected.hint)
    expect(wrapper.text()).not.toMatch(/matchAnalysis\.|NaN|Infinity/)
    wrapper.unmount()
  })

  it('keeps absent spell slots and unknown IDs identifiable even if an icon fails', async () => {
    const game = match()
    game.participants![0].spell1Id = null
    game.participants![0].spell2Id = 9999
    const wrapper = await render(game, 'en-US')
    const spells = wrapper.findAll('ol > li')[0].get('ul[aria-label="Summoner spells"]')
    expect(spells.findAll('li').map((slot) => slot.text())).toEqual(['—', 'Spell #9999'])
    expect(spells.findAll('img')).toHaveLength(1)
    await spells.get('img').trigger('error')
    expect((spells.get('img').element as HTMLImageElement).hidden).toBe(true)
    expect(spells.text()).toContain('Spell #9999')
    wrapper.unmount()
  })

  it('uses dashes for missing stats and invalid duration, retains measured zero and omits unavailable bars', async () => {
    const game = match()
    game.gameDuration = 0
    game.participants = game.participants!.slice(0, 1)
    Object.assign(game.participants[0], { damageTaken: null, totalHeal: 0, damageToTurrets: null, minionsKilled: null })
    const wrapper = await render(game, 'en-US')
    const player = wrapper.get('ol > li')
    expect(player.get('[data-metric="damageTaken"] dd').text()).toBe('— —')
    expect(player.get('[data-metric="totalHeal"] dd').text()).toBe('0 —')
    expect(player.get('[data-metric="damageToTurrets"] dd').text()).toBe('—')
    expect(player.get('[data-metric="goldEarned"] dd').text()).toContain('Gold/min —')
    expect(player.get('[data-metric="minionsKilled"] dd').text()).toContain('CS/min —')
    expect(player.findAll('dl [aria-hidden="true"]')).toHaveLength(0)
    expect(wrapper.text()).not.toMatch(/NaN|Infinity|100%/)
    wrapper.unmount()
  })
})
