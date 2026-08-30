import { describe, expect, it } from 'vitest'
import {
  getChangelogEntries,
  LOCAL_CHANGELOG_ENTRIES,
  normalizeChangelogEntries,
} from '../../src/main/changelog.ts'

describe('changelog entries', () => {
  it('includes the 0.2.11 augment and logging announcement', () => {
    const latestEntry = LOCAL_CHANGELOG_ENTRIES[0]

    expect(latestEntry.version).toBe('0.2.11')
    expect(latestEntry.date).toBe('2026-08-09')
    expect(latestEntry.title).toBe('海克斯胜率回归与日志优化')
    expect(latestEntry.changes).toEqual(expect.arrayContaining([
      expect.stringContaining('胜率展示'),
      expect.stringContaining('海克斯浮窗'),
      expect.stringContaining('高频诊断日志'),
      expect.stringContaining('5 MB'),
    ]))
  })

  it('includes the Tencent build compatibility announcement', () => {
    const latestEntry = LOCAL_CHANGELOG_ENTRIES.find((entry) => entry.version === '0.2.8')

    expect(latestEntry?.version).toBe('0.2.8')
    expect(latestEntry?.date).toBe('2026-08-02')
    expect(latestEntry?.title).toBe('修复英雄装备配置')
    expect(latestEntry?.changes).toEqual(expect.arrayContaining([
      expect.stringContaining('An object could not be cloned'),
      expect.stringContaining('单条综合路线'),
      expect.stringContaining('完整出装'),
      expect.stringContaining('15 至 18 级'),
    ]))
  })

  it('records 0.2.6 as the official augment rank display release', () => {
    const rankDisplayEntry = LOCAL_CHANGELOG_ENTRIES.find((entry) => entry.version === '0.2.6')

    expect(rankDisplayEntry?.version).toBe('0.2.6')
    expect(rankDisplayEntry?.date).toBe('2026-07-31')
    expect(rankDisplayEntry?.title).toBe('海克斯官方排名展示')
    expect(rankDisplayEntry?.changes).toEqual(expect.arrayContaining([
      expect.stringContaining('英雄详情'),
      expect.stringContaining('海克斯浮窗'),
      expect.stringContaining('原胜率位置'),
    ]))
  })

  it('records 0.2.5 as the official augment rank compatibility release', () => {
    const compatibilityEntry = LOCAL_CHANGELOG_ENTRIES.find((entry) => entry.version === '0.2.5')

    expect(compatibilityEntry?.version).toBe('0.2.5')
    expect(compatibilityEntry?.date).toBe('2026-07-31')
    expect(compatibilityEntry?.changes).toEqual(expect.arrayContaining([
      expect.stringContaining('rank'),
      expect.stringContaining('海克斯浮窗'),
      expect.stringContaining('不再提供海克斯胜率'),
      expect.stringContaining('旧缓存'),
    ]))
  })

  it('records 0.2.4 as the 16.15 compatibility release', () => {
    const compatibilityEntry = LOCAL_CHANGELOG_ENTRIES.find((entry) => entry.version === '0.2.4')

    expect(compatibilityEntry?.version).toBe('0.2.4')
    expect(compatibilityEntry?.date).toBe('2026-07-28')
    expect(compatibilityEntry?.title).toBe('兼容 16.15 版本')
    expect(compatibilityEntry?.changes).toEqual(expect.arrayContaining([
      expect.stringContaining('兼容 16.15'),
      expect.stringContaining('Windows 完整安装包'),
    ]))
  })

  it('normalizes array based remote changelog entries', () => {
    const entries = normalizeChangelogEntries([
      {
        version: 'v0.2.0',
        publishedAt: '2026-07-01T10:00:00.000Z',
        title: 'Release notes',
        changes: ['New control panel', { text: 'Better update prompt' }],
      },
    ])

    expect(entries).toEqual([
      {
        version: '0.2.0',
        date: '2026-07-01T10:00:00.000Z',
        title: 'Release notes',
        summary: '',
        changes: ['New control panel', 'Better update prompt'],
      },
    ])
  })

  it('normalizes version keyed changelog objects', () => {
    const entries = normalizeChangelogEntries({
      '0.2.0': ['Add update log', 'Improve tray menu'],
      '0.1.15': 'Stabilize augment overlays',
    })

    expect(entries.map((entry) => entry.version)).toEqual(['0.2.0', '0.1.15'])
    expect(entries[0].changes).toEqual(['Add update log', 'Improve tray menu'])
    expect(entries[1].changes).toEqual(['Stabilize augment overlays'])
  })

  it('prefers remote client changelog and falls back to local entries', () => {
    const remoteEntries = getChangelogEntries(
      {},
      {
        changelog: {
          version: '0.2.0',
          changes: ['Remote entry'],
        },
      }
    )
    const fallbackEntries = getChangelogEntries({}, {})

    expect(remoteEntries).toHaveLength(1)
    expect(remoteEntries[0].changes).toEqual(['Remote entry'])
    expect(fallbackEntries[0].version).toBe(LOCAL_CHANGELOG_ENTRIES[0].version)
  })
})
