// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import MatchAssetTooltip from '../../src/renderer/components/MatchAssetTooltip.vue'
import { messages } from '../../src/renderer/i18n/messages.ts'
import type { HextechAramMatchHistoryAsset } from '../../src/shared/ipc-contract.ts'

let wrapper: VueWrapper
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = '' })
function render(asset: HextechAramMatchHistoryAsset, kind: 'item' | 'augment' = 'augment', locale = 'zh-CN') {
  wrapper = mount(MatchAssetTooltip, {
    attachTo: document.body, props: { asset, kind }, slots: { default: '<span>icon</span>' },
    global: { plugins: [createI18n({ legacy: false, locale, messages })] },
  })
  return wrapper.get('[tabindex]')
}
function panel() { return document.querySelector('.match-asset-tooltip') }
async function show() {
  const element = wrapper.get('[tabindex]').element as HTMLElement
  element.blur()
  element.focus()
  expect(document.activeElement).toBe(element)
  await flushPromises()
}

describe('match asset descriptions', () => {
  it.each([
    ['zh-CN', 'kSilver', '白银'], ['en-US', 'kGold', 'Gold'], ['zh-TW', 'kPrismatic', '稜彩'],
  ])('shows localized rarity and an accessible description for %s', async (locale, rarity, label) => {
    const trigger = render({ id: 18, name: 'Lotus', description: 'First<br>Second &amp; third', rarity }, 'augment', locale)
    expect(trigger.attributes('tabindex')).toBe('0')
    await show()
    expect(panel()?.textContent).toContain('Lotus')
    expect(panel()?.textContent).toContain(label)
    expect(panel()?.textContent).toContain('First\nSecond & third')
    const descriptionId = trigger.attributes('aria-describedby')
    expect(document.getElementById(descriptionId)?.getAttribute('role')).toBe('tooltip')
    expect(document.getElementById(descriptionId)?.textContent).toContain(label)
  })

  it('renders decoded remote markup as text without creating elements or executable attributes', async () => {
    render({ id: 1, name: '<img src=x onerror=alert(1)>', description: '<span onclick="alert(1)">Safe</span><br>&lt;img src=x onerror=alert(1)&gt;<svg onload="alert(1)"></svg>' }, 'item')
    await show()
    expect(panel()?.textContent).toContain('Safe\n<img src=x onerror=alert(1)>')
    expect(panel()?.querySelector('img,svg,script,[onclick],[onerror],[onload]')).toBeNull()
  })

  it('falls back for unknown IDs, descriptions, and rarities without inventing item rarity', async () => {
    render({ id: 42 }, 'augment', 'en-US')
    await show()
    expect(panel()?.textContent).toContain('Augment #42')
    expect(panel()?.textContent).toContain('Unknown rarity')
    expect(panel()?.textContent).toContain('No description')
    await wrapper.setProps({ kind: 'item', asset: { id: 1001 } })
    await flushPromises()
    await show()
    expect(panel()?.textContent).toContain('Item #1001')
    expect(panel()?.textContent).not.toContain('Unknown rarity')
  })

  it('opens on pointer hover and closes on Escape, trigger blur, window blur, resize and hiding', async () => {
    const trigger = render({ id: 18, name: 'Lotus', rarity: 'kGold' })
    await trigger.trigger('pointermove', { pointerType: 'mouse' })
    await vi.waitFor(() => expect(panel()).not.toBeNull())
    await trigger.trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(panel()).toBeNull()
    await show()
    await trigger.trigger('blur')
    await flushPromises()
    expect(panel()).toBeNull()
    for (const [target, event] of [[window, 'blur'], [window, 'resize'], [document, 'visibilitychange']] as const) {
      await show()
      target.dispatchEvent(new Event(event))
      await flushPromises()
      expect(panel()).toBeNull()
    }
  })

  it('closes when the asset changes or querying disables it, and removes its portal on unmount', async () => {
    render({ id: 18 })
    await show()
    await wrapper.setProps({ asset: { id: 19 } })
    await flushPromises()
    expect(panel()).toBeNull()
    await show()
    await wrapper.setProps({ disabled: true })
    await flushPromises()
    expect(panel()).toBeNull()
    expect(wrapper.get('[tabindex]').attributes('tabindex')).toBe('-1')
    await show()
    expect(panel()).toBeNull()
    await wrapper.setProps({ disabled: false })
    await show()
    wrapper.unmount()
    expect(panel()).toBeNull()
  })
})
