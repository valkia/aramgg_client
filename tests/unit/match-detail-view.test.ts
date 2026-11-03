// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import MatchDetailView from '../../src/renderer/components/MatchDetailView.vue'
import MatchScoreboardContent from '../../src/renderer/components/MatchScoreboardContent.vue'
import { i18n, setAppLocale } from '../../src/renderer/i18n/index.ts'
import { matchDetailMessages } from '../../src/renderer/i18n/match-detail.ts'
const mocks = vi.hoisted(() => ({ getSnapshot: vi.fn(), ready: vi.fn() }))
vi.mock('../../src/renderer/native/electron-api.ts', () => ({
  hasElectronAPI: () => true,
  electronAPI: { matchHistory: { getDetailSnapshot: mocks.getSnapshot }, windows: { ready: mocks.ready } },
}))
afterEach(() => { document.body.innerHTML = ''; setAppLocale('zh-CN'); vi.clearAllMocks() })

describe('standalone match details', () => {
  it('shows shared content with the snapshot language before announcing renderer readiness', async () => {
    setAppLocale('zh-CN')
    mocks.getSnapshot.mockResolvedValue({ success: true, data: {
      playerName: 'One', platformId: 'HN1', locale: 'en-US', queriedAt: 1000,
      match: { gameId: 123, gameCreation: 1000, gameDuration: 900, gameVersion: '16.21', result: 'win', participants: [] },
    } })
    mocks.ready.mockImplementationOnce(() => {
      expect(document.body.textContent).toContain('Match details')
      expect(document.body.textContent).toContain('#123')
      expect(document.body.textContent).not.toContain('Loading match snapshot')
    })
    const wrapper = mount(MatchDetailView, { attachTo: document.body, global: { plugins: [i18n] } })
    await flushPromises()
    expect(wrapper.getComponent(MatchScoreboardContent).props('wide')).toBe(true)
    expect(mocks.ready).toHaveBeenCalledOnce()
    expect(document.title).toContain('#123')
    wrapper.unmount()
  })

  it('provides a readable localized error when opened without an owned snapshot', async () => {
    mocks.getSnapshot.mockRejectedValue(new Error('no owner'))
    const wrapper = mount(MatchDetailView, { global: { plugins: [i18n] } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe(matchDetailMessages['zh-CN'].expired)
    expect(wrapper.findComponent(MatchScoreboardContent).exists()).toBe(false)
    expect(mocks.ready).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('keeps identical localization keys for every supported language', () => {
    for (const messages of Object.values(matchDetailMessages)) expect(Object.keys(messages)).toEqual(Object.keys(matchDetailMessages['zh-CN']))
  })
})
