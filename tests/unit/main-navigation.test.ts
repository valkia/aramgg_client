// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import type { LcuConnectionState, SupportedDataLocale } from '../../src/shared/ipc-contract.ts'
import MainNavigation from '../../src/renderer/components/MainNavigation.vue'
import { messages } from '../../src/renderer/i18n/messages.ts'

const mocks = vi.hoisted(() => ({ get: vi.fn(), available: true, listeners: new Set<(state: LcuConnectionState) => void>() }))
vi.mock('../../src/renderer/native/electron-api.ts', () => ({
  hasElectronAPI: () => mocks.available,
  electronAPI: { lcu: { getConnectionState: mocks.get }, events: { on: (channel, listener) => {
    expect(channel).toBe('lcu-connection-changed')
    mocks.listeners.add(listener)
    return () => mocks.listeners.delete(listener)
  } } },
}))
let wrapper: VueWrapper | undefined
const state = (connection: LcuConnectionState['connection'], phase: LcuConnectionState['phase'], revision: number): LcuConnectionState => ({ connection, phase, revision })
const emit = (value: LcuConnectionState) => mocks.listeners.forEach(listener => listener(value))
function render(locale: SupportedDataLocale = 'zh-CN') {
  wrapper = mount(MainNavigation, {
    attachTo: document.body, props: { modelValue: 'home', 'onUpdate:modelValue': (value) => wrapper?.setProps({ modelValue: value }) },
    global: { plugins: [createI18n({ legacy: false, locale, messages })] },
  })
  return wrapper
}
beforeEach(() => { vi.useFakeTimers(); mocks.available = true; mocks.listeners.clear(); mocks.get.mockResolvedValue(state('disconnected', null, 1)) })
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.useRealTimers() })

describe('main section navigation and connection status', () => {
  it.each([
    ['zh-CN', '主页', '战绩', '英雄', '未连接', '选择英雄'],
    ['en-US', 'Home', 'History', 'Champions', 'Disconnected', 'Champion select'],
    ['zh-TW', '首頁', '戰績', '英雄', '未連線', '選擇英雄'],
  ] as const)('keeps every section available offline and localizes real phases in %s', async (locale, home, history, champions, disconnected, selecting) => {
    const view = render(locale)
    await flushPromises()
    expect(view.findAll('[role="tab"]').map(tab => tab.text())).toEqual([home, history, champions])
    expect(view.text()).toContain(disconnected)
    expect(view.findAll('[role="tab"]').every(tab => tab.attributes('disabled') === undefined)).toBe(true)
    emit(state('connected', 'ChampSelect', 2))
    await flushPromises()
    expect(view.get('[role="status"]').text()).toContain(selecting)
    expect(view.text()).not.toContain('mainNavigation.')
    let revision = 2
    for (const phase of ['None', 'Lobby', 'Matchmaking', 'CheckedIntoGame', 'ReadyCheck', 'GameStart', 'InProgress', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame'] as const) {
      emit(state('connected', phase, ++revision))
      await flushPromises()
      expect(view.text()).not.toContain('mainNavigation.')
    }
  })

  it('uses roving tab focus and supports arrows, Home and End with matching panel IDs', async () => {
    const view = render()
    await flushPromises()
    const tabs = view.findAll('[role="tab"]')
    expect(tabs.map(tab => tab.attributes('tabindex'))).toEqual(['0', '-1', '-1'])
    await tabs[0].trigger('keydown', { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tabs[2].element)
    expect(tabs[2].attributes('aria-selected')).toBe('true')
    expect(tabs[2].attributes('aria-controls')).toBe('main-panel-champions')
    await tabs[2].trigger('keydown', { key: 'Home' })
    expect(document.activeElement).toBe(tabs[0].element)
    expect(tabs[0].attributes('id')).toBe('main-tab-home')
    expect(tabs[0].attributes('aria-controls')).toBe('main-panel-home')
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    await tabs[0].trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(tabs[2].element)
    await tabs[2].trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs[0].element)
    await tabs[1].trigger('click')
    expect(tabs[1].attributes('aria-selected')).toBe('true')
  })

  it('keeps a newer pushed disconnection over an old initial game phase, without timers or repeated reads', async () => {
    let finish!: (state: LcuConnectionState) => void
    mocks.get.mockReturnValueOnce(new Promise<LcuConnectionState>(resolve => { finish = resolve }))
    const view = render('en-US')
    emit(state('disconnected', null, 5))
    finish(state('connected', 'InProgress', 4))
    await flushPromises()
    expect(view.text()).toContain('Disconnected')
    expect(view.text()).not.toContain('In game')
    emit(state('connected', 'InProgress', 3))
    await vi.advanceTimersByTimeAsync(60000)
    expect(view.text()).toContain('Disconnected')
    expect(mocks.get).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps state events working after a failed initial read and unsubscribes while a read is pending', async () => {
    mocks.get.mockRejectedValueOnce(new Error('isolated IPC failure'))
    const view = render('en-US')
    await flushPromises()
    expect(view.text()).toContain('Connection status unavailable')
    emit(state('connected', null, 0))
    await flushPromises()
    expect(view.text()).toContain('Phase unavailable')
    view.unmount(); wrapper = undefined
    expect(mocks.listeners.size).toBe(0)
    let finish!: (state: LcuConnectionState) => void
    mocks.get.mockReturnValueOnce(new Promise<LcuConnectionState>(resolve => { finish = resolve }))
    render().unmount(); wrapper = undefined
    finish(state('connected', 'InProgress', 7))
    await flushPromises()
    expect(mocks.listeners.size).toBe(0)
  })
})
