import { afterEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import {
  DEFAULT_APP_LOCALE,
  normalizeAppLocale,
  setAppLocale,
  SUPPORTED_APP_LOCALES,
  translate,
} from '../../src/renderer/i18n/index.ts'
import { messages } from '../../src/renderer/i18n/messages.ts'
import {
  formatAugmentWinRate,
  formatDataSource,
  getLocalizedText,
} from '../../src/renderer/service/overlay-formatters.ts'

function collectLeafKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') {
    return [prefix]
  }

  return Object.entries(value)
    .flatMap(([key, child]) => collectLeafKeys(child, prefix ? `${prefix}.${key}` : key))
    .sort()
}

afterEach(() => {
  setAppLocale(DEFAULT_APP_LOCALE)
})

describe('renderer i18n', () => {
  it('keeps the locale contract aligned with client data locales', () => {
    expect(SUPPORTED_APP_LOCALES).toEqual(['zh-CN', 'en-US', 'zh-TW'])
    expect(normalizeAppLocale('en-GB')).toBe('en-US')
    expect(normalizeAppLocale('zh-Hant')).toBe('zh-TW')
    expect(normalizeAppLocale('unsupported')).toBe(DEFAULT_APP_LOCALE)
  })

  it('keeps every locale message tree structurally complete', () => {
    const expectedKeys = collectLeafKeys(messages['zh-CN'])

    expect(collectLeafKeys(messages['en-US'])).toEqual(expectedKeys)
    expect(collectLeafKeys(messages['zh-TW'])).toEqual(expectedKeys)
  })

  it('switches interface text and data-derived labels together', () => {
    const localizedValue = {
      zh_CN: '中文说明',
      en_US: 'English description',
      zh_TW: '繁體說明',
    }

    setAppLocale('en-US')
    expect(translate('display.appLanguage')).toBe('Interface and data language')
    expect(formatAugmentWinRate(null)).toBe('Insufficient games')
    expect(formatDataSource('remote')).toBe('Remote data')
    expect(getLocalizedText(localizedValue)).toBe('English description')

    setAppLocale('zh-TW')
    expect(translate('display.appLanguage')).toBe('介面與資料語言')
    expect(formatAugmentWinRate(null)).toBe('場次不足')
    expect(formatDataSource('remote')).toBe('遠端資料')
    expect(getLocalizedText(localizedValue)).toBe('繁體說明')
  })

  it('does not keep locale loading blocked on the remote version refresh', async () => {
    const source = await readFile(
      new URL('../../src/renderer/components/Display.vue', import.meta.url),
      'utf8',
    )
    const changeLocaleBlock = source.slice(
      source.indexOf('const changeLocale = async'),
      source.indexOf('const setManualPathStatus'),
    )

    expect(changeLocaleBlock).not.toContain('await loadVersionInfo()')
    expect(changeLocaleBlock).toContain("trackAnalyticsEvent('language_switch'")
    expect(changeLocaleBlock).toContain("trackAnalyticsEvent('language_switch_failure'")
    expect(source).not.toContain('cursor: wait')
    expect(source).toContain('class="locale-loading-icon"')
  })
})
