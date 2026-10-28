// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import ChampionRankingsPanel from '../../src/renderer/components/ChampionRankingsPanel.vue'
import { messages } from '../../src/renderer/i18n/messages.ts'
import type { ChampionRankings, SupportedDataLocale } from '../../src/shared/ipc-contract.ts'

const mocks = vi.hoisted(() => ({ get: vi.fn(), open: vi.fn(), available: true }))
vi.mock('../../src/renderer/native/electron-api.ts', () => ({
  hasElectronAPI: () => mocks.available,
  electronAPI: { champions: { getRankings: mocks.get, openDetail: mocks.open } },
}))
const fixture = (locale: SupportedDataLocale = 'zh-CN'): ChampionRankings => ({
  locale, dataVersion: '16.21.5', gamePatch: '16.21', generatedAt: '2026-10-28',
  champions: [
    { championId: 103, name: '阿狸', alias: 'Ahri', title: '九尾妖狐', iconUrl: 'https://example.invalid/ahri.png', tier: 1, winRate: 0.55, pickRate: 0.1, numGames: null },
    { championId: 63, name: '布兰德', alias: 'Brand', title: '复仇焰魂', iconUrl: null, tier: null, winRate: 0, pickRate: 0, numGames: 0 },
  ].map((row) => ({ ...row, gamePatch: '16.21', statsDate: '2026-10-27', source: 'tencent', region: 'CN' })),
})
let wrapper: VueWrapper | undefined
let i18n: ReturnType<typeof createI18n>
function render(locale: SupportedDataLocale = 'zh-CN') {
  i18n = createI18n({ legacy: false, locale, messages })
  wrapper = mount(ChampionRankingsPanel, { attachTo: document.body, global: { plugins: [i18n] } })
  return wrapper
}
beforeEach(() => { mocks.available = true; mocks.get.mockReset(); mocks.open.mockReset(); mocks.get.mockResolvedValue({ success: true, data: fixture() }); mocks.open.mockResolvedValue({ success: true }) })
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

describe('champion rankings panel', () => {
  it.each([
    ['zh-CN', '海克斯英雄榜', '可离线查看', '未提供统计场次'],
    ['en-US', 'ARAM: Mayhem champion rankings', 'available offline', 'no reported game count'],
    ['zh-TW', '海克斯英雄榜', '可離線查看', '未提供統計場次'],
  ] as const)('shows localized metadata, missing samples and real zeroes in %s', async (locale, heading, offline, missing) => {
    mocks.get.mockResolvedValue({ success: true, data: fixture(locale) })
    const view = render(locale)
    await flushPromises()
    expect(view.get('h2').text()).toBe(heading)
    expect(view.text()).toContain('16.21.5')
    expect(view.text()).toContain(offline)
    expect(view.text()).toContain(missing)
    expect(view.findAll('tbody tr')[0].findAll('td').map((cell) => cell.text())).toEqual(['T1', '55.0%', '10.0%', '—'])
    expect(view.findAll('tbody tr')[1].findAll('td').map((cell) => cell.text())).toEqual(['—', '0.0%', '0.0%', '0'])
    expect(view.text()).toContain('CN')
    expect(view.text()).toContain('2026-10-27')
    expect(view.text()).not.toContain('championRankings.')
    const keys = Object.keys(messages['zh-CN'].championRankings).sort()
    expect(Object.keys(messages[locale].championRankings).sort()).toEqual(keys)
  })

  it('provides native keyboard buttons, aria sort state, local search and only an ID for detail opening', async () => {
    const view = render()
    await flushPromises()
    const th = view.findAll('thead th')[2]
    expect(th.attributes('aria-sort')).toBe('none')
    const sort = th.get('button')
    sort.element.focus()
    expect(document.activeElement).toBe(sort.element)
    await sort.trigger('click')
    expect(th.attributes('aria-sort')).toBe('descending')
    await sort.trigger('click')
    expect(th.attributes('aria-sort')).toBe('ascending')
    expect(view.findAll('tbody tr')[0].text()).toContain('布兰德')
    await view.get('input').setValue('ahri 九尾')
    expect(view.findAll('tbody tr')).toHaveLength(1)
    await view.get('tbody button').trigger('click')
    await flushPromises()
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(103)
    expect(mocks.get).toHaveBeenCalledTimes(1)
    await view.get('input').setValue('unknown')
    expect(view.text()).toContain('没有匹配的英雄')
    expect(view.text()).not.toContain('暂无英雄数据')
    await view.findAll('button').find((button) => button.text() === '清除搜索')!.trigger('click')
    expect(view.findAll('tbody tr')).toHaveLength(2)
  })

  it('uses the supplied champion icon and a generic fallback for missing or failed images', async () => {
    const view = render()
    await flushPromises()
    const [ahri, brand] = view.findAll('tbody th')
    expect(ahri.get('img').attributes('src')).toBe(fixture().champions[0].iconUrl)
    expect(ahri.find('[aria-hidden="true"]').exists()).toBe(false)
    expect(brand.find('img').exists()).toBe(false)
    expect(brand.get('[aria-hidden="true"]').text()).toBe('')
    expect(brand.get('[aria-hidden="true"] svg').exists()).toBe(true)
    await ahri.get('img').trigger('error')
    expect(ahri.find('img').exists()).toBe(false)
    expect(ahri.get('[aria-hidden="true"]').text()).toBe('')
    expect(ahri.get('[aria-hidden="true"] svg').exists()).toBe(true)
    expect(ahri.text()).toContain('阿狸')
  })

  it('distinguishes loading, load failure, empty data and keeps loaded data on retry failure', async () => {
    let finish!: (value: unknown) => void
    mocks.get.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const view = render()
    expect(view.attributes('aria-busy')).toBe('true')
    expect(view.get('[role="status"]').text()).toContain('正在读取')
    expect(view.find('table').exists()).toBe(false)
    finish({ success: false, error: 'internal raw error' })
    await flushPromises()
    expect(view.get('[role="alert"]').text()).toContain('加载失败')
    expect(view.text()).not.toContain('internal raw error')
    mocks.get.mockResolvedValueOnce({ success: true, data: { ...fixture(), champions: [] } })
    await view.get('header button').trigger('click'); await flushPromises()
    expect(view.text()).toContain('暂无英雄数据')
    await view.get('header button').trigger('click'); await flushPromises()
    await view.get('input').setValue('ahri')
    mocks.get.mockRejectedValueOnce(new Error('offline'))
    await view.get('header button').trigger('click'); await flushPromises()
    expect(view.findAll('tbody tr')).toHaveLength(1)
    expect(view.text()).toContain('可离线查看')
    expect(view.get('[role="alert"]').text()).toContain('加载失败')
  })

  it('clears old-language data immediately and discards late success, failure and mismatched responses', async () => {
    let old!: (value: unknown) => void
    mocks.get.mockReturnValueOnce(new Promise((resolve) => { old = resolve }))
    const view = render()
    mocks.get.mockResolvedValueOnce({ success: true, data: { ...fixture('en-US'), champions: [{ ...fixture().champions[0], name: 'Ahri' }] } })
    ;(i18n.global.locale as any).value = 'en-US'
    await flushPromises()
    expect(view.text()).toContain('Ahri')
    old({ success: true, data: fixture() })
    await flushPromises()
    expect(view.findAll('tbody tr')).toHaveLength(1)
    expect(view.get('tbody').text()).not.toContain('阿狸')
    mocks.get.mockResolvedValueOnce({ success: true, data: fixture() })
    ;(i18n.global.locale as any).value = 'zh-TW'
    await flushPromises()
    expect(view.find('table').exists()).toBe(false)
    expect(view.get('[role="alert"]').text()).toContain('載入失敗')
  })

  it('deduplicates detail clicks and reports a localized opening failure', async () => {
    let finish!: (value: unknown) => void
    mocks.open.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const view = render()
    await flushPromises()
    const open = view.get('tbody button')
    await open.trigger('click'); await open.trigger('click')
    expect(mocks.open).toHaveBeenCalledTimes(1)
    expect(open.attributes('disabled')).toBeDefined()
    finish({ success: false })
    await flushPromises()
    expect(view.get('[role="alert"]').text()).toContain('详情未能打开')
    expect(open.attributes('disabled')).toBeUndefined()
  })

  it('finishes an opening independently from refresh and ignores old opening completions after locale changes', async () => {
    let first!: (value: unknown) => void
    let second!: (value: unknown) => void
    mocks.open.mockReturnValueOnce(new Promise((resolve) => { first = resolve }))
    const view = render()
    await flushPromises()
    await view.get('tbody button').trigger('click')
    await view.get('header button').trigger('click'); await flushPromises()
    first({ success: true }); await flushPromises()
    expect(view.get('tbody button').attributes('disabled')).toBeUndefined()

    mocks.open.mockReturnValueOnce(new Promise((resolve) => { first = resolve }))
    await view.get('tbody button').trigger('click')
    mocks.get.mockResolvedValueOnce({ success: true, data: fixture('en-US') })
    ;(i18n.global.locale as any).value = 'en-US'
    await flushPromises()
    mocks.open.mockReturnValueOnce(new Promise((resolve) => { second = resolve }))
    await view.get('tbody button').trigger('click')
    first({ success: false }); await flushPromises()
    expect(view.find('[role="alert"]').exists()).toBe(false)
    expect(view.get('tbody button').attributes('disabled')).toBeDefined()
    second({ success: true }); await flushPromises()
    expect(view.get('tbody button').attributes('disabled')).toBeUndefined()
  })

  it('does not expose data or opening failures after unmount and localizes unavailable API errors', async () => {
    mocks.available = false
    let view = render()
    await flushPromises()
    expect(view.get('[role="alert"]').text()).toContain('本地数据服务')
    view.unmount(); wrapper = undefined
    mocks.available = true
    let finish!: (value: unknown) => void
    mocks.get.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    view = render()
    view.unmount(); wrapper = undefined
    finish({ success: true, data: fixture() }); await flushPromises()
    expect(mocks.open).not.toHaveBeenCalled()
    view = render(); await flushPromises()
    mocks.open.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    await view.get('tbody button').trigger('click')
    view.unmount(); wrapper = undefined
    finish({ success: false }); await flushPromises()
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })
})
