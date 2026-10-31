// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import MatchHistoryPanel from '../../src/renderer/components/MatchHistoryPanel.vue'
import MatchEncounters from '../../src/renderer/components/MatchEncounters.vue'
import MatchAssetTooltip from '../../src/renderer/components/MatchAssetTooltip.vue'
import MatchHistoryOverview from '../../src/renderer/components/MatchHistoryOverview.vue'
import { messages } from '../../src/renderer/i18n/messages.ts'
import type { GamePhaseChangedPayload, HextechAramMatchHistoryPage } from '../../src/shared/ipc-contract.ts'

const { queryCurrent, openDetail, onEvent } = vi.hoisted(() => ({ queryCurrent: vi.fn(), openDetail: vi.fn(), onEvent: vi.fn(() => vi.fn()) }))
vi.mock('../../src/renderer/native/electron-api.ts', () => ({
  hasElectronAPI: () => true,
  electronAPI: { matchHistory: { queryCurrent, openDetail }, events: { on: onEvent } },
}))

const page: HextechAramMatchHistoryPage = {
  playerName: 'Test#CN1', platformId: 'HN1', queriedAt: 1_000, startIndex: 0, count: 10, snapshotId: 'page-one', locale: 'zh-CN',
  returnedCount: 3, hasPrevious: false, hasMore: true,
  matches: [
    { gameId: 3, championId: 103, championName: '阿狸', result: 'win' },
    { gameId: 2, championId: 103, championName: '阿狸', result: 'loss' },
    { gameId: 1, championId: 266, championName: '亚托克斯', result: 'remake' },
  ].map((match) => ({ ...match, result: match.result as 'win' | 'loss' | 'remake', gameCreation: match.gameId * 1_000, gameDuration: 900, gameVersion: '16.21', kills: 8, deaths: 2, assists: 12, items: [], augments: [] })),
}
let wrapper: VueWrapper
beforeEach(() => { queryCurrent.mockReset(); queryCurrent.mockResolvedValue({ success: true, data: page }); openDetail.mockReset(); openDetail.mockResolvedValue({ success: true }); onEvent.mockClear() })
afterEach(() => { wrapper?.unmount(); vi.useRealTimers() })
function render(locale = 'zh-CN') {
  wrapper = mount(MatchHistoryPanel, { global: { plugins: [createI18n({ legacy: false, locale, messages })] } })
  return wrapper
}
function button(text: string) { return wrapper.findAll('button').find((candidate) => candidate.text() === text)! }
function emit(channel: string, payload: unknown) {
  const callback = (onEvent.mock.calls as any[]).find(([name]) => name === channel)?.[1]
  expect(callback).toBeTypeOf('function')
  callback(payload)
}
function phase(phase: GamePhaseChangedPayload['phase'], prevPhase: GamePhaseChangedPayload['prevPhase'] = null) {
  emit('game-phase-changed', { phase, prevPhase })
}

describe('match history filters', () => {
  it('opens a separate detail with only the page capability and game ID and deduplicates pending clicks', async () => {
    let finish!: (value: unknown) => void
    openDetail.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    render('en-US')
    await flushPromises()
    const opener = wrapper.get('article').findAll('button').find((candidate) => candidate.text() === 'Open in separate window')!
    await opener.trigger('click')
    expect(openDetail).toHaveBeenCalledWith({ snapshotId: 'page-one', gameId: 3 })
    expect(opener.attributes('disabled')).toBeDefined()
    await opener.trigger('click')
    expect(openDetail).toHaveBeenCalledTimes(1)
    finish({ success: false, error: 'untranslated internal error' })
    await flushPromises()
    expect(wrapper.text()).toContain('up to 4 detail windows')
    expect(wrapper.text()).not.toContain('untranslated internal error')
    expect(wrapper.get('details').exists()).toBe(true)
  })

  it('discards a slow old-language page and queries the new language after it finishes', async () => {
    let finish!: (value: unknown) => void
    queryCurrent.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    render()
    await flushPromises()
    emit('locale-changed', { locale: 'en-US' })
    finish({ success: true, data: page })
    await flushPromises()
    expect(queryCurrent).toHaveBeenCalledTimes(2)
    expect(queryCurrent).toHaveBeenLastCalledWith({ startIndex: 0, count: 10 })
    expect(wrapper.findAll('article')).toHaveLength(3)
    const localeIndex = (onEvent.mock.calls as any[]).findIndex(([channel]) => channel === 'locale-changed')
    const unsubscribe = onEvent.mock.results[localeIndex]!.value
    wrapper.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('keeps page performance on the original page when filters hide some or all matches', async () => {
    queryCurrent.mockResolvedValueOnce({ success: true, data: { ...page, matches: page.matches.map((match) => ({
      ...match, participants: [{
        participantId: 1, teamId: 100, playerName: 'Test', isCurrentPlayer: true,
        championId: match.championId, result: match.result, kills: match.kills, deaths: match.deaths, assists: match.assists,
        damageToChampions: match.gameId * 10_000, damageTaken: null, goldEarned: 1_000, minionsKilled: null,
        totalHeal: null, damageToTurrets: null, spell1Id: null, spell2Id: null,
        tripleKills: null, quadraKills: null, pentaKills: null, items: [], augments: [],
      }],
    })) } })
    render()
    await flushPromises()
    const original = wrapper.getComponent(MatchHistoryOverview).text()
    expect(original).toContain('25,000')
    await wrapper.findAll('select')[1].setValue('win')
    expect(wrapper.findAll('article')).toHaveLength(1)
    expect(wrapper.getComponent(MatchHistoryOverview).text()).toBe(original)
    await wrapper.findAll('select')[0].setValue('266')
    expect(wrapper.findAll('article')).toHaveLength(0)
    expect(wrapper.getComponent(MatchHistoryOverview).text()).toBe(original)
    expect(queryCurrent).toHaveBeenCalledTimes(1)
  })

  it('combines champion and result filters locally and restores matches on reset', async () => {
    render()
    await flushPromises()
    expect(wrapper.findAll('article')).toHaveLength(3)
    expect(wrapper.findAll('select')[0].findAll('option')).toHaveLength(3)
    await wrapper.findAll('select')[0].setValue('103')
    await wrapper.findAll('select')[1].setValue('win')
    expect(wrapper.findAll('article')).toHaveLength(1)
    expect(wrapper.get('article').text()).toContain('阿狸')
    expect(wrapper.text()).toContain('显示 1 / 3 场')
    expect(queryCurrent).toHaveBeenCalledTimes(1)
    await button('清除筛选').trigger('click')
    expect(wrapper.findAll('article')).toHaveLength(3)
  })

  it('keeps pagination usable when the current page has no filter matches', async () => {
    render()
    await flushPromises()
    await wrapper.findAll('select')[0].setValue('266')
    await wrapper.findAll('select')[1].setValue('win')
    expect(wrapper.text()).toContain('本页没有符合条件的对局')
    expect(wrapper.text()).not.toContain('这一页没有可展示')
    queryCurrent.mockResolvedValueOnce({ success: true, data: { ...page, startIndex: 10, hasPrevious: true } })
    await button('下一页').trigger('click')
    await flushPromises()
    expect(queryCurrent).toHaveBeenLastCalledWith({ startIndex: 10, count: 10 })
    expect(wrapper.findAll('article')).toHaveLength(3)
    expect(wrapper.text()).toContain('第 2 页')
  })

  it('retains the loaded page and filters on failure, then retries the same offset', async () => {
    render()
    await flushPromises()
    await wrapper.findAll('select')[1].setValue('loss')
    queryCurrent.mockRejectedValueOnce(new Error('offline'))
    await button('下一页').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('offline')
    expect(wrapper.findAll('article')).toHaveLength(1)
    expect(wrapper.text()).toContain('第 1 页')
    await button('下一页').trigger('click')
    await flushPromises()
    expect(queryCurrent).toHaveBeenLastCalledWith({ startIndex: 10, count: 10 })
  })

  it('shows a loading state without fabricated performance while the first query is pending', async () => {
    let resolve!: (value: unknown) => void
    queryCurrent.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    render('en-US')
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toContain('Querying')
    expect(wrapper.text()).not.toContain('0%')
    expect(wrapper.attributes('aria-busy')).toBe('true')
    resolve({ success: true, data: page })
    await flushPromises()
    expect(wrapper.attributes('aria-busy')).toBe('false')
    expect(wrapper.text()).toContain('Page performance')
  })

  it('opens a selected encounter even when filters hid it, and can reopen it after manual collapse', async () => {
    render()
    await flushPromises()
    await wrapper.findAll('select')[1].setValue('loss')
    expect(wrapper.findAll('article')).toHaveLength(1)
    wrapper.getComponent(MatchEncounters).vm.$emit('selectGame', 3)
    await flushPromises()
    expect(wrapper.findAll('article')).toHaveLength(3)
    const disclosure = wrapper.findAll('article')[0].get('details')
    expect((disclosure.element as HTMLDetailsElement).open).toBe(true)
    ;(disclosure.element as HTMLDetailsElement).open = false
    await disclosure.trigger('toggle')
    wrapper.getComponent(MatchEncounters).vm.$emit('selectGame', 3)
    await flushPromises()
    expect((disclosure.element as HTMLDetailsElement).open).toBe(true)
    expect(queryCurrent).toHaveBeenCalledTimes(1)
  })

  it('closes asset descriptions while a page request is pending and when a filter removes the match', async () => {
    queryCurrent.mockResolvedValueOnce({ success: true, data: { ...page, matches: page.matches.map((match, index) => ({
      ...match, augments: index === 0 ? [{ id: 18, name: 'Lotus', description: 'Local description', rarity: 'kGold' }] : [],
    })) } })
    render()
    await flushPromises()
    const trigger = () => wrapper.getComponent(MatchAssetTooltip).get('[tabindex]')
    await trigger().trigger('focus')
    await flushPromises()
    expect(document.querySelector('.match-asset-tooltip')?.textContent).toContain('Local description')
    let resolve!: (value: unknown) => void
    queryCurrent.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    await button('下一页').trigger('click')
    await flushPromises()
    expect(document.querySelector('.match-asset-tooltip')).toBeNull()
    expect(trigger().attributes('tabindex')).toBe('-1')
    resolve({ success: false, error: 'offline' })
    await flushPromises()
    await trigger().trigger('focus')
    await flushPromises()
    expect(document.querySelector('.match-asset-tooltip')).not.toBeNull()
    await wrapper.findAll('select')[1].setValue('loss')
    await flushPromises()
    expect(document.querySelector('.match-asset-tooltip')).toBeNull()
  })
})

describe('post-game match history refresh', () => {
  beforeEach(() => { vi.useFakeTimers() })

  it('waits for EndOfGame, then refreshes page one, filters, list, and page performance exactly once', async () => {
    render()
    await flushPromises()
    queryCurrent.mockResolvedValueOnce({ success: true, data: { ...page, startIndex: 10, hasPrevious: true } })
    await button('下一页').trigger('click')
    await flushPromises()
    await wrapper.findAll('select')[1].setValue('loss')
    const oldPerformance = wrapper.getComponent(MatchHistoryOverview).text()
    const latest = { ...page, returnedCount: 1, hasMore: false, snapshotId: 'new-game', matches: [
      { ...page.matches[0], gameId: 4, championName: '赛后新对局', kills: 20, deaths: 1, assists: 30 },
    ] }
    queryCurrent.mockResolvedValueOnce({ success: true, data: latest })

    phase('InProgress')
    phase('WaitingForStats', 'InProgress')
    await vi.advanceTimersByTimeAsync(10_000)
    phase('PreEndOfGame', 'WaitingForStats')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(queryCurrent).toHaveBeenCalledTimes(2)
    phase('EndOfGame', 'PreEndOfGame')
    await vi.advanceTimersByTimeAsync(1199)
    expect(queryCurrent).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()

    expect(queryCurrent).toHaveBeenCalledTimes(3)
    expect(queryCurrent).toHaveBeenLastCalledWith({ startIndex: 0, count: 10 })
    expect(wrapper.text()).toContain('第 1 页')
    expect(wrapper.findAll('article')).toHaveLength(1)
    expect(wrapper.get('article').text()).toContain('赛后新对局')
    expect(wrapper.findAll('select').map(select => (select.element as HTMLSelectElement).value)).toEqual(['0', 'all'])
    expect(wrapper.getComponent(MatchHistoryOverview).props('matches')).toEqual(latest.matches)
    expect(wrapper.getComponent(MatchHistoryOverview).text()).not.toBe(oldPerformance)
    expect(wrapper.getComponent(MatchEncounters).props('matches')).toEqual(latest.matches)

    phase('EndOfGame', 'PreEndOfGame')
    phase('Lobby', 'EndOfGame')
    phase('None', 'Lobby')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(queryCurrent).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['WaitingForStats', 'Lobby'], ['PreEndOfGame', 'None'], ['InProgress', 'Lobby'], ['InProgress', 'None'],
  ] as const)('refreshes once when %s returns directly to %s without EndOfGame', async (previous, idle) => {
    render()
    await flushPromises()
    phase(previous)
    phase(idle, previous)
    await vi.advanceTimersByTimeAsync(1200)
    expect(queryCurrent).toHaveBeenCalledTimes(2)
    phase('EndOfGame', idle)
    phase('Lobby', 'EndOfGame')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(queryCurrent).toHaveBeenCalledTimes(2)
  })

  it('uses the observed previous phase if the renderer missed InProgress, without refreshing on startup or canceled selection', async () => {
    render()
    await flushPromises()
    phase('Lobby')
    phase('ChampSelect', 'Lobby')
    phase('Lobby', 'ChampSelect')
    phase('None', 'Lobby')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(queryCurrent).toHaveBeenCalledOnce()
    phase('Lobby', 'InProgress')
    await vi.advanceTimersByTimeAsync(1200)
    expect(queryCurrent).toHaveBeenCalledTimes(2)
  })

  it('resets deduplication for the next game without losing an already scheduled refresh', async () => {
    render()
    await flushPromises()
    phase('EndOfGame')
    phase('ChampSelect', 'EndOfGame')
    await vi.advanceTimersByTimeAsync(1200)
    expect(queryCurrent).toHaveBeenCalledTimes(2)
    phase('GameStart', 'ChampSelect')
    phase('InProgress', 'GameStart')
    phase('EndOfGame', 'InProgress')
    await vi.advanceTimersByTimeAsync(1200)
    expect(queryCurrent).toHaveBeenCalledTimes(3)
  })

  it('queues page one if a manual page request is still in flight when the post-game timer fires', async () => {
    render()
    await flushPromises()
    let finish!: (value: unknown) => void
    queryCurrent.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await button('下一页').trigger('click')
    phase('EndOfGame')
    await vi.advanceTimersByTimeAsync(1200)
    expect(queryCurrent).toHaveBeenCalledTimes(2)
    finish({ success: true, data: { ...page, startIndex: 10, hasPrevious: true } })
    await flushPromises()
    expect(queryCurrent).toHaveBeenCalledTimes(3)
    expect(queryCurrent).toHaveBeenLastCalledWith({ startIndex: 0, count: 10 })
    expect(wrapper.text()).toContain('第 1 页')
  })

  it('rejects a slow old-language automatic response and drains one queued reload in the committed language', async () => {
    render()
    await flushPromises()
    let finish!: (value: unknown) => void
    queryCurrent.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    queryCurrent.mockResolvedValueOnce({ success: true, data: { ...page, locale: 'en-US', playerName: 'New locale' } })
    phase('EndOfGame')
    await vi.advanceTimersByTimeAsync(1200)
    emit('locale-changed', { locale: 'en-US' })
    await flushPromises()
    expect(wrapper.findAll('article')).toHaveLength(0)
    finish({ success: true, data: { ...page, playerName: 'Stale locale' } })
    await flushPromises()
    expect(queryCurrent).toHaveBeenCalledTimes(3)
    expect(wrapper.text()).toContain('New locale')
    expect(wrapper.text()).not.toContain('Stale locale')
  })

  it('retains the existing page on an invalidated account response and leaves manual retry available without polling', async () => {
    render()
    await flushPromises()
    await wrapper.findAll('select')[1].setValue('loss')
    queryCurrent.mockResolvedValueOnce({ success: false, errorCode: 'snapshot-invalid' })
    phase('EndOfGame')
    await vi.advanceTimersByTimeAsync(1200)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('快照已失效')
    expect(wrapper.findAll('article')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(queryCurrent).toHaveBeenCalledTimes(2)
    await wrapper.get('.match-history-refresh').trigger('click')
    await flushPromises()
    expect(queryCurrent).toHaveBeenCalledTimes(3)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('cancels its delayed work and unsubscribes both events when unmounted', async () => {
    render()
    await flushPromises()
    phase('EndOfGame')
    const unsubscribes = onEvent.mock.results.map(result => result.value)
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(60_000)
    phase('EndOfGame')
    expect(queryCurrent).toHaveBeenCalledOnce()
    expect(unsubscribes).toHaveLength(2)
    unsubscribes.forEach(unsubscribe => expect(unsubscribe).toHaveBeenCalledOnce())
  })

  it('does not drain a queued automatic refresh after unmounting during a manual request', async () => {
    let finish!: (value: unknown) => void
    queryCurrent.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    render()
    phase('EndOfGame')
    await vi.advanceTimersByTimeAsync(1200)
    wrapper.unmount()
    finish({ success: true, data: page })
    await flushPromises()
    expect(queryCurrent).toHaveBeenCalledOnce()
  })
})
