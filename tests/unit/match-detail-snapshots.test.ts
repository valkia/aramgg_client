import { describe, expect, it } from 'vitest'
import { MatchDetailSnapshotStore, type MatchDetailContext } from '../../src/main/services/match-history/match-detail-snapshots.ts'
import type { HextechAramMatchHistoryPage } from '../../src/shared/ipc-contract.ts'

const context: MatchDetailContext = { accountKey: 'account-a', platformId: 'HN1', locale: 'zh-CN' }
const page = { platformId: 'HN1', playerName: 'One', queriedAt: 1000, matches: [{ gameId: 1, championName: 'Ahri' }] } as HextechAramMatchHistoryPage

describe('ephemeral match detail snapshots', () => {
  it('selects only the latest successful page and owns independent copies', () => {
    const store = new MatchDetailSnapshotStore()
    const first = store.capture(page, context, store.revision)
    first.matches[0].championName = 'renderer mutation'
    const selection = { snapshotId: first.snapshotId!, gameId: 1 }
    const opened = store.select(selection, context)
    expect(opened.data.match.championName).toBe('Ahri')
    opened.data.match.championName = 'window mutation'
    expect(store.select(selection, context).data.match.championName).toBe('Ahri')
    const second = store.capture(page, context, store.revision)
    expect(second.snapshotId).not.toBe(first.snapshotId)
    expect(() => store.select(selection, context)).toThrow('expired')
    // Pinned windows own their copy; replacing the page does not destroy it.
    expect(opened.data.match.gameId).toBe(1)
  })

  it('rejects wrong accounts, platforms, locales, unknown matches and arbitrary window options', () => {
    const store = new MatchDetailSnapshotStore()
    const captured = store.capture(page, context, store.revision)
    const selection = { snapshotId: captured.snapshotId!, gameId: 1 }
    for (const altered of [{ accountKey: 'account-b' }, { platformId: 'NA1' }, { locale: 'en-US' as const }]) {
      expect(() => store.select(selection, { ...context, ...altered })).toThrow('expired')
    }
    for (const value of [null, [], { ...selection, url: 'https://evil.test' }, { ...selection, gameId: '1' }, { ...selection, gameId: -1 }, { ...selection, snapshotId: 'guessed' }]) {
      expect(() => store.select(value, context)).toThrow('expired')
    }
    expect(() => store.select({ ...selection, gameId: 2 }, context)).toThrow('latest queried page')
  })

  it('invalidates in-flight captures on reset and bounds the selectable cache to one page', () => {
    const store = new MatchDetailSnapshotStore()
    const revision = store.revision
    store.clear()
    expect(() => store.capture(page, context, revision)).toThrow('changed')
    expect(() => store.capture({ ...page, matches: Array(21).fill(page.matches[0]) }, context, store.revision)).toThrow('changed')
    expect(() => store.capture(page, { ...context, platformId: 'NA1' }, store.revision)).toThrow('changed')
    store.capture(page, context, store.revision)
    expect(() => store.capture(page, { ...context, accountKey: 'account-b' }, store.revision)).toThrow('changed')
  })
})
