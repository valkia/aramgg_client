function normalizeRateValue(value: unknown): number | null {
  if (value == null || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return number > 1 ? number / 100 : number
}

export function getLocalizedText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  const localized = value as Record<string, unknown>
  const localeKeys = {
    'zh-CN': ['zh_CN', 'zh_cn', 'zh-CN'],
    'en-US': ['en_US', 'en_us', 'en-US'],
    'zh-TW': ['zh_TW', 'zh_tw', 'zh-TW', 'zh_Hant'],
  }[i18n.global.locale.value] || []
  const fallbackKeys = ['zh_CN', 'zh_cn', 'en_US', 'en_us']
  const text = [...localeKeys, ...fallbackKeys]
    .map(key => localized[key])
    .find(candidate => typeof candidate === 'string')
  return typeof text === 'string' ? text : ''
}

export function normalizeTooltipText(value: unknown): string {
  const raw = getLocalizedText(value)
  if (!raw) {
    return ''
  }

  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function formatAugmentTier(value: unknown): string {
  const tier = Number(value)
  return Number.isInteger(tier) && tier > 0 ? `T${tier}` : '--'
}

export function formatPercent(value: unknown): string {
  const normalized = normalizeRateValue(value)
  return normalized == null ? '--' : `${(normalized * 100).toFixed(1)}%`
}

export function formatAugmentWinRate(value: unknown): string {
  if (value == null || value === '') {
    return translate('augment.insufficientGames')
  }

  return formatPercent(value)
}

export function getWinRateClass(value: unknown): string {
  const normalized = normalizeRateValue(value)
  if (!normalized) return ''
  if (normalized >= 0.55) return 'high'
  if (normalized >= 0.5) return 'medium'
  return 'low'
}

export function formatNumber(value: unknown): string {
  const number = Number(value)
  if (!Number.isFinite(number) || number === 0) return '--'
  if (number < 10000) return String(number)
  return new Intl.NumberFormat(i18n.global.locale.value, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(number)
}

export function formatDataSource(source: unknown): string {
  const labelKeys: Record<string, string> = {
    local: 'dataSource.local',
    remote: 'dataSource.remote',
    pending: 'dataSource.pending',
    unavailable: 'dataSource.unavailable',
    test: 'dataSource.test',
    'auto-analysis': 'dataSource.autoAnalysis',
    'local-analysis': 'dataSource.localAnalysis',
    fallback: 'dataSource.fallback',
  }
  const key = typeof source === 'string' ? source : ''
  return labelKeys[key] ? translate(labelKeys[key]) : key || translate('dataSource.unknown')
}

export function formatTime(value: unknown): string {
  if (!value) return ''
  const date = new Date(value as string | number | Date)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(i18n.global.locale.value)
}

export function handleImageError(event: Event): void {
  if (event.target instanceof HTMLImageElement) {
    event.target.style.display = 'none'
  }
}
import { i18n, translate } from '../i18n/index.ts'
