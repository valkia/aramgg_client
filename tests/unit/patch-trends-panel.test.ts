// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import PatchTrendsPanel from '../../src/renderer/components/PatchTrendsPanel.vue'
import { messages } from '../../src/renderer/i18n/messages.ts'
import { buildChampionPatchEvidence } from '../../src/main/services/patch-evidence.ts'
import type { SupportedDataLocale } from '../../src/shared/ipc-contract.ts'

const open = vi.hoisted(() => vi.fn())
vi.mock('../../src/renderer/native/electron-api.ts', () => ({ hasElectronAPI: () => true, electronAPI: { shell: { openExternal: open } } }))
const evidence = (locale: SupportedDataLocale = 'en-US') => buildChampionPatchEvidence({ championId: 103, name: 'Ahri', alias: 'Ahri', title: '', iconUrl: null, tier: 3, winRate: 0.5272, pickRate: 0.0524, numGames: null, gamePatch: '16.15', statsDate: '2026-07-30', source: 'tencent', region: 'CN' }, { locale, dataVersion: '16.15.2' })
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; open.mockReset() })

describe('patch and trend detail surface', () => {
  it.each(['zh-CN', 'en-US', 'zh-TW'] as const)('renders two separate native expandable sections with real evidence in %s', (locale) => {
    const i18n = createI18n({ legacy: false, locale, messages })
    wrapper = mount(PatchTrendsPanel, { props: { evidence: evidence(locale), championId: 103 }, global: { plugins: [i18n] } })
    expect(wrapper.findAll('section > details')).toHaveLength(2)
    expect(wrapper.text()).toContain('26.15')
    expect(wrapper.text()).toContain('16.15')
    expect(wrapper.text()).toContain('CN')
    expect(wrapper.text()).toContain('2026-07-30')
    expect(wrapper.get('[data-testid="trend-delta"]').text()).toContain('+0.53')
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.findAll('tbody tr').map((row) => row.findAll('td').at(-1)?.text())).toEqual(['—', '—'])
    expect(wrapper.text()).not.toContain('patchEvidence.')
    expect(Object.keys(messages[locale].patchEvidence).sort()).toEqual(Object.keys(messages['en-US'].patchEvidence).sort())
  })

  it('rejects stale hero and locale evidence immediately', async () => {
    const i18n = createI18n({ legacy: false, locale: 'en-US', messages })
    wrapper = mount(PatchTrendsPanel, { props: { evidence: evidence(), championId: 103 }, global: { plugins: [i18n] } })
    await wrapper.setProps({ championId: 63 })
    expect(wrapper.find('section').exists()).toBe(false)
    await wrapper.setProps({ championId: 103 })
    i18n.global.locale.value = 'zh-CN'
    await flushPromises()
    expect(wrapper.find('section').exists()).toBe(false)
  })

  it('shows unmatched/insufficient and unknown notes without a fabricated delta, preserving zeroes', async () => {
    const data = evidence()
    data.history.status = 'unmatched'; data.history.points = [data.current]; data.notes = null
    data.current.winRate = 0; data.current.pickRate = null; data.current.numGames = 0
    wrapper = mount(PatchTrendsPanel, { props: { evidence: data, championId: 103 }, global: { plugins: [createI18n({ legacy: false, locale: 'en-US', messages })] } })
    expect(wrapper.find('[data-testid="trend-delta"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('does not match')
    expect(wrapper.text()).toContain('No verified change archive')
    expect(wrapper.findAll('tbody td').map((cell) => cell.text())).toEqual(['0.00%', '—', 'T3', '0'])
    await wrapper.setProps({ evidence: { ...data, history: { ...data.history, status: 'insufficient' } } })
    expect(wrapper.text()).toContain('Only one matching patch')
  })

  it('renders source text as plaintext and opens links only through the existing controlled bridge', async () => {
    const data = evidence()
    data.notes!.records[0].lines = ['<img src=x onerror=alert(1)>']
    wrapper = mount(PatchTrendsPanel, { attachTo: document.body, props: { evidence: data, championId: 103, augmentNames: { 2031: '<b>Fixture name</b>' } }, global: { plugins: [createI18n({ legacy: false, locale: 'en-US', messages })] } })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
    const button = wrapper.findAll('button')[0]
    button.element.focus()
    expect(document.activeElement).toBe(button.element)
    open.mockResolvedValue({ success: true })
    await button.trigger('click'); await flushPromises()
    expect(open).toHaveBeenCalledExactlyOnceWith(data.notes!.sourceUrl)
    open.mockRejectedValueOnce(new Error('fixture'))
    await button.trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not open')
  })
})
