// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('../../src/renderer/service/cdn', () => ({ getChampionSquareIconUrl: () => '', getAugmentIconUrl: () => '' }))
import InGameGuide from '../../src/renderer/components/InGameGuide.vue'

describe('in-game quick guide', () => {
  it('keeps a complete core combination and limits each rarity to two ranked picks', () => {
    const wrapper = mount(InGameGuide, { props: {
      championId: 89, championName: 'Leona', itemName: (id: string) => `Item ${id}`, itemIcon: () => '',
      route: { coreItems: [{ items: ['1', '2', '3'] }, { items: ['7', '8', '9'] }],
        itemExtensions: [{ itemId: '2' }, { itemId: '4' }, { itemId: '5' }], skillOrders: [{ skillOrder: [1, 2, 3, 2, 2, 4] }] },
      augments: ['kSilver', 'kGold', 'kPrismatic'].flatMap(rarity => [1, 2, 3, 4].map(id => ({ rarity, id: `${rarity}${id}`, name: `${rarity} pick ${id}` }))),
    } })
    const content = wrapper.text()
    for (const id of ['1', '2', '3', '4', '5']) expect(content).toContain(`Item ${id}`)
    expect(content).not.toContain('Item 7')
    expect(content.match(/Item 2/g)).toHaveLength(1)
    for (const rarity of ['kSilver', 'kGold', 'kPrismatic']) {
      expect(content).toContain(`${rarity} pick 1`)
      expect(content).toContain(`${rarity} pick 2`)
      expect(content).not.toContain(`${rarity} pick 3`)
    }
    expect(content).toContain('augment.rarities.prismatic')
    expect(wrapper.findAll('button, a')).toHaveLength(0)
    wrapper.unmount()
  })
  it('shows no-data feedback without fabricating a build', () => {
    const wrapper = mount(InGameGuide, { props: { championId: 89, itemName: () => '', itemIcon: () => '' } })
    expect(wrapper.text()).toContain('augment.noBuilds')
    expect(wrapper.text()).not.toContain('augment.skillOrder')
    wrapper.unmount()
  })
})
