import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import archiveData from '../../src/main/data/patch-evidence.json'
import { buildChampionPatchEvidence, type PatchEvidenceArchive } from '../../src/main/services/patch-evidence.ts'
import { mapChampionRankings } from '../../src/main/services/champion-rankings.ts'
import type { ChampionRankingEntry } from '../../src/shared/ipc-contract.ts'

const context = { locale: 'en-US' as const, dataVersion: '16.15.2' }
const ahri: ChampionRankingEntry = { championId: 103, name: 'Ahri', alias: 'Ahri', title: '', iconUrl: null, tier: 3, winRate: 0.5272, pickRate: 0.0524, numGames: null, gamePatch: '16.15', statsDate: '2026-07-30', source: 'tencent', region: 'CN' }
const archive = (): PatchEvidenceArchive => structuredClone(archiveData) as unknown as PatchEvidenceArchive

describe('patch evidence and actual public history', () => {
  it.each(['zh-CN', 'en-US', 'zh-TW'] as const)('anchors all 173 real %s bundled records without using future or other-source snapshots', async (locale) => {
    const prefix = locale === 'zh-CN' ? '' : `${locale}/`
    const raw = JSON.parse(await readFile(new URL(`../../resources/client-data/versions/${prefix}16.15.2/champions.json`, import.meta.url), 'utf8'))
    const rankings = mapChampionRankings(raw, { locale, dataVersion: '16.15.2' })
    for (const champion of rankings.champions) {
      const evidence = buildChampionPatchEvidence(champion, { locale, dataVersion: rankings.dataVersion })
      expect(evidence.history.status).toBe('ready')
      expect(evidence.history.points.map((point) => point.gamePatch)).toEqual(['16.14', '16.15'])
      expect(evidence.history.points.at(-1)).toEqual(evidence.current)
      expect(evidence.history.points[0].date).toBe('2026-07-28')
      expect(evidence.history.points.every((point) => point.numGames === null && point.date <= champion.statsDate)).toBe(true)
      expect(evidence.notes?.publicPatch).toBe('26.15')
    }
    expect(rankings.champions).toHaveLength(173)
  })

  it('keeps official records separate from actual statistical deltas and excludes Classic additions', () => {
    const evidence = buildChampionPatchEvidence(ahri, context)
    expect(evidence.notes?.records.filter((record) => record.kind === 'champion')).toEqual([{ kind: 'champion', subjectId: 103, title: '', lines: ['Healing: 90% → 100%'] }])
    expect(evidence.notes?.records.filter((record) => record.kind === 'augment')).toHaveLength(11)
    expect(evidence.notes?.records.some((record) => record.subjectId === 7001)).toBe(false)
    expect(evidence.notes?.records.flatMap((record) => record.lines).find((line) => line.includes('250%'))).toContain('Not provided → 250%')
    expect(evidence.history.points.map((point) => point.winRate)).toEqual([0.5219, 0.5272])
    expect(evidence.history.points.map((point) => point.tier)).toEqual([4, 3])
    const morgana = buildChampionPatchEvidence({ ...ahri, championId: 25 }, context)
    expect(morgana.notes?.records.find((record) => record.kind === 'champion')?.lines).toEqual(['Damage taken (announcement notation): -10% → 0%'])
  })

  it.each([
    { source: 'iesdev' }, { region: 'NA' }, { statsDate: '2026-99-99' }, { statsDate: '2026-07-29', winRate: NaN },
    { winRate: 0.52 }, { pickRate: 0 }, { tier: 2 }, { numGames: 0 }, { gamePatch: '16.22' },
  ])('refuses an unmatched anchor: %j', (change) => {
    const result = buildChampionPatchEvidence({ ...ahri, ...change }, context)
    expect(result.history.status).toBe('unmatched')
    expect(result.history.points).toHaveLength(1)
  })

  it('uses a newer real detail record as the current point without inventing past statistics', () => {
    const next = buildChampionPatchEvidence({ ...ahri, statsDate: '2026-07-31', winRate: 0.528 }, context)
    expect(next.history.status).toBe('ready')
    expect(next.history.points.map((point) => [point.gamePatch, point.date, point.winRate])).toEqual([
      ['16.14', '2026-07-28', 0.5219], ['16.15', '2026-07-31', 0.528],
    ])
    const afterArchive = buildChampionPatchEvidence({ ...ahri, gamePatch: '16.21', statsDate: '2026-10-28', winRate: 0.518 }, context)
    expect(afterArchive.history.status).toBe('ready')
    expect(afterArchive.history.points.at(-1)?.date).toBe('2026-10-28')
    expect(afterArchive.history.points.at(-1)?.winRate).toBe(0.518)
    expect(afterArchive.history.points.at(-2)?.gamePatch).toBe('16.20')
  })

  it('preserves real zeroes, nulls and insufficient history rather than synthesizing a prior patch', () => {
    const data = archive()
    data.champions['103'] = [{ source: 'tencent', version: '16.15', date: ahri.statsDate, tier: '3', winRate: 0, pickRate: 0, numGames: 0 }]
    const zero = buildChampionPatchEvidence({ ...ahri, winRate: 0, pickRate: 0, numGames: 0 }, context, data)
    expect(zero.history.status).toBe('insufficient')
    expect(zero.history.points[0]).toMatchObject({ winRate: 0, pickRate: 0, numGames: 0 })
    const missing = buildChampionPatchEvidence({ ...ahri, winRate: null }, context, data)
    expect(missing.current.winRate).toBeNull()
    expect(missing.history.status).toBe('unmatched')
  })

  it('rejects malformed, other-source and conflicting duplicate history and deduplicates equal snapshots', () => {
    const data = archive()
    const points = data.champions['103']
    const current = points.find((point) => point.date === ahri.statsDate)!
    points.push({ ...current }, { ...current, source: 'iesdev', winRate: 0.99 }, { ...current, date: '2026-99-99' })
    points.push(
      { ...current, version: '16.14', date: '2026-07-29', winRate: Infinity },
      { ...current, version: '16.14', date: '2026-07-29', pickRate: -1 },
      { ...current, version: '16.14', date: '2026-07-29', numGames: -1 },
      { ...current, version: '16.14', date: '2026-07-29', tier: '9007199254740992' },
    )
    expect(buildChampionPatchEvidence(ahri, context, data).history.status).toBe('ready')
    expect(buildChampionPatchEvidence(ahri, context, data).history.points[0].date).toBe('2026-07-28')
    points.push({ ...current, winRate: 0.99 })
    expect(buildChampionPatchEvidence(ahri, context, data).history.status).toBe('unmatched')
  })

  it('serves later archived patches only when the actual record reaches them and retains missing samples', () => {
    const data = archive()
    const latest = data.champions['103'].at(-1)!
    const result = buildChampionPatchEvidence({ ...ahri, gamePatch: latest.version, statsDate: latest.date, tier: Number(latest.tier), winRate: latest.winRate, pickRate: latest.pickRate }, context)
    expect(result.current.publicPatch).toBe('26.21')
    expect(result.history.status).toBe('ready')
    expect(result.history.points).toHaveLength(8)
    expect(result.notes?.records).toHaveLength(48)
    expect(result.notes?.records.every((record) => record.kind === 'augment' && Number.isSafeInteger(record.subjectId))).toBe(true)
  })

  it('ships source hashes and complete locale keys for the audited seven-patch archive', () => {
    expect(archiveData.queueId).toBe(2400)
    expect(Object.keys(archiveData.upstream.hashes)).toHaveLength(181)
    for (const patch of Object.values(archiveData.patches)) {
      expect(Object.keys(patch.locales).sort()).toEqual(['en-US', 'zh-CN', 'zh-TW'])
      expect(patch.sourceUrl).toMatch(/^https:\/\/www\.leagueoflegends\.com\//)
      expect(patch.locales['en-US'].length).toBe(patch.locales['zh-CN'].length)
      expect(patch.locales['zh-TW'].length).toBe(patch.locales['zh-CN'].length)
    }
  })
})
