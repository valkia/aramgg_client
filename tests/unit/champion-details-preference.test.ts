// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ElectronAPI } from '../../src/shared/ipc-contract.ts'
import OverlayPreferences from '../../src/renderer/components/OverlayPreferences.vue'
import { messages } from '../../src/renderer/i18n/messages.ts'

afterEach(() => {
  delete window.electronAPI
})

describe('Champion Details visibility preference', () => {
  it('defaults on, hides immediately when disabled, and does not show immediately when enabled', async () => {
    const get = vi.fn().mockResolvedValue(undefined)
    const set = vi.fn().mockResolvedValue(undefined)
    const hidePopup = vi.fn()

    window.electronAPI = {
      store: { get, set, delete: vi.fn() },
      windows: {
        hidePopup,
        hideFloating: vi.fn(),
        hideAugmentSidePanel: vi.fn(),
      },
    } as unknown as ElectronAPI

    const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages })
    const wrapper = mount(OverlayPreferences, { global: { plugins: [i18n] } })
    await flushPromises()

    expect(set).toHaveBeenCalledWith('championInsight.showDetails', true)
    expect(set).toHaveBeenCalledWith('championInsight.hideOnGameStart', true)
    expect(set).toHaveBeenCalledWith('championInsight.alwaysOnTop', false)
    const championDetailsSwitch = wrapper.findAll('[role="switch"]')[0]
    expect(championDetailsSwitch.attributes('aria-checked')).toBe('true')

    await championDetailsSwitch.trigger('click')
    await flushPromises()
    expect(set).toHaveBeenLastCalledWith('championInsight.showDetails', false)
    expect(hidePopup).toHaveBeenCalledTimes(1)

    await championDetailsSwitch.trigger('click')
    await flushPromises()
    expect(set).toHaveBeenLastCalledWith('championInsight.showDetails', true)
    expect(hidePopup).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('preserves saved settings and lets users toggle closing and pinning independently', async () => {
    const values = new Map<string, unknown>([
      ['championInsight.hideOnGameStart', false],
      ['championInsight.alwaysOnTop', true],
    ])
    const set = vi.fn(async (key, value) => { values.set(key, value) })
    window.electronAPI = {
      store: { get: vi.fn(async key => values.get(key)), set },
      windows: { hidePopup: vi.fn() },
    } as unknown as ElectronAPI
    const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages })
    const wrapper = mount(OverlayPreferences, { global: { plugins: [i18n] } })
    await flushPromises()

    const closeSwitch = wrapper.get('[aria-label="进游戏关闭英雄详情页"]')
    const pinSwitch = wrapper.get('[aria-label="英雄详情强制置顶"]')
    expect(closeSwitch.attributes('aria-checked')).toBe('false')
    expect(pinSwitch.attributes('aria-checked')).toBe('true')
    expect(set).not.toHaveBeenCalledWith('championInsight.hideOnGameStart', expect.anything())
    expect(set).not.toHaveBeenCalledWith('championInsight.alwaysOnTop', expect.anything())

    await pinSwitch.trigger('click')
    await flushPromises()
    expect(set).toHaveBeenLastCalledWith('championInsight.alwaysOnTop', false)
    expect(closeSwitch.attributes('aria-checked')).toBe('false')
    await closeSwitch.trigger('click')
    await flushPromises()
    expect(set).toHaveBeenLastCalledWith('championInsight.hideOnGameStart', true)
    expect(pinSwitch.attributes('aria-checked')).toBe('false')
    wrapper.unmount()
  })
})
