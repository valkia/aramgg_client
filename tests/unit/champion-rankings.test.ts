import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { mapChampionRankings } from '../../src/main/services/champion-rankings.ts'
import { filterChampionRankings, sortChampionRankings } from '../../src/renderer/services/champion-rankings.ts'

const context = { locale: 'zh-CN' as const, dataVersion: 'fixture-v1', gamePatch: '16.21', generatedAt: '2026-10-28' }
const make = (id: number, stats: object = {}) => ({ id, name: `英雄${id}`, stats })
const mapped = (rows: unknown[]) => mapChampionRankings({ champions: rows }, context).champions

describe('champion ranking index', () => {
  it.each(['zh-CN', 'en-US', 'zh-TW'] as const)('maps the actual bundled client-v1 payload in %s without inventing game samples', async (locale) => {
    const prefix = locale === 'zh-CN' ? '' : `${locale}/`
    const payload = JSON.parse(await readFile(new URL(`../../resources/client-data/versions/${prefix}16.15.2/champions.json`, import.meta.url), 'utf8'))
    const result = mapChampionRankings(payload, { locale, dataVersion: '16.15.2' })
    expect(result).toMatchObject({ locale, dataVersion: '16.15.2', gamePatch: '16.15', generatedAt: '2026-07-31T04:59:23.717Z' })
    expect(result.champions).toHaveLength(payload.total)
    expect(result.champions[0]).toEqual({
      championId: 67, name: payload.data[0].name, alias: 'Vayne', title: payload.data[0].title,
      iconUrl: 'https://cdn.dtodo.cn/hextech/champion-icons/67.png', tier: 1, winRate: 0.5732,
      pickRate: 0.1388, numGames: null, gamePatch: '16.15', statsDate: '2026-07-30', source: 'tencent', region: 'CN',
    })
    expect(result.champions.every((row) => row.numGames === null)).toBe(true)
    expect(result.champions.map((row) => row.iconUrl)).toEqual(payload.data.map((row: { iconUrl: string }) => row.iconUrl))
    expect(result.champions.every((row) => row.iconUrl === `https://cdn.dtodo.cn/hextech/champion-icons/${row.championId}.png`)).toBe(true)
  })

  it('preserves real zeroes and fractional rates while rejecting invalid or missing scalars', () => {
    const rows = mapped([
      make(1), make(2, { tier: '2', winRate: '0', pickRate: 0, games: 0 }),
      make(3, { tier: 0, winRate: 55, pickRate: -1, games: 1.5 }),
      make(4, { tier: true, winRate: {}, pickRate: '', games: Number.MAX_SAFE_INTEGER + 1 }),
      make(5, { tier: -1, winRate: Infinity, pickRate: null, numGames: '123' }),
    ])
    expect(rows[0]).toMatchObject({ tier: null, winRate: null, pickRate: null, numGames: null })
    expect(rows[1]).toMatchObject({ tier: 2, winRate: 0, pickRate: 0, numGames: 0 })
    expect(rows.slice(2).map(({ tier, winRate, pickRate, numGames }) => ({ tier, winRate, pickRate, numGames }))).toEqual([
      { tier: null, winRate: null, pickRate: null, numGames: null },
      { tier: null, winRate: null, pickRate: null, numGames: null },
      { tier: null, winRate: null, pickRate: null, numGames: 123 },
    ])
  })

  it('rejects index locale/version mismatches and malformed indexes, and removes duplicate or invalid identities', () => {
    expect(() => mapChampionRankings({ locale: 'en-US', champions: [] }, context)).toThrow(/locale/)
    expect(() => mapChampionRankings({ dataVersion: 'other', champions: [] }, context)).toThrow(/version/)
    expect(() => mapChampionRankings({ data: {} }, context)).toThrow(/invalid/)
    expect(mapChampionRankings({ data: [] }, context).champions).toEqual([])
    expect(mapped([make(0), make(-1), make(1.5), make(1), make(1), { championId: '2' }]).map((row) => row.championId)).toEqual([1, 2])
  })

  it('filters names, aliases and titles locally with case, width, whitespace and combined terms', () => {
    const rows = mapped([{ id: 103, name: '阿狸', alias: 'Ahri', title: '九尾妖狐' }, { id: 63, name: '布兰德', alias: 'Brand', title: '复仇焰魂' }])
    for (const search of [' 阿狸 ', 'ＡＨＲＩ', '妖狐', 'ahri 九尾']) {
      expect(filterChampionRankings(rows, search).map((row) => row.championId)).toEqual([103])
    }
    expect(filterChampionRankings(rows, 'missing')).toEqual([])
    expect(filterChampionRankings(rows, ' ')).toBe(rows)
    expect(rows).toHaveLength(2)
  })

  it.each(['tier', 'winRate', 'pickRate'] as const)('sorts %s with null last in both directions and stable ID ties', (key) => {
    const rows = mapped([make(3), make(2, { tier: 1, winRate: 0, pickRate: 0, games: 0 }), make(1, { tier: 1, winRate: 0, pickRate: 0, games: 0 }), make(4, { tier: 2, winRate: 1, pickRate: 1, games: 100 })])
    expect(sortChampionRankings(rows, key, 'ascending').map((row) => row.championId)).toEqual([1, 2, 4, 3])
    expect(sortChampionRankings(rows, key, 'descending').map((row) => row.championId)).toEqual([4, 1, 2, 3])
    expect(rows.map((row) => row.championId)).toEqual([3, 2, 1, 4])
  })
})
