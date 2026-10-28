import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { mock } from 'node:test'

// node --experimental-transform-types tests/electron/test-champion-rankings.js
const originalCwd = process.cwd()
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'aramgg-champion-rankings-'))
const attemptedUrls = []
async function writeJson(file, data) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data)) }
try {
  mock.method(os, 'homedir', () => fixtureRoot)
  mock.method(globalThis, 'fetch', async (url) => { attemptedUrls.push(String(url)); throw new Error('Ranking fixture: network disabled') })
  for (const locale of ['zh-CN', 'en-US', 'zh-TW']) {
    const prefix = locale === 'zh-CN' ? '' : `${locale}/`
    // Copy real bundled index documents into isolated cache paths; no seasonal API or real user data.
    const payload = JSON.parse(await readFile(new URL(`../../resources/client-data/versions/${prefix}16.15.2/champions.json`, import.meta.url), 'utf8'))
    assert.equal(payload.data.length, 173)
    assert.ok(payload.data.every((champion) => champion.stats.games === null), 'The real source indexes have missing games, not zero')
    // Append explicit synthetic boundary rows without changing the 173 real bundled entries.
    payload.data.push(
      { id: 900001, name: `Zero fixture ${locale}`, stats: { tier: 2, winRate: 0, pickRate: 0, games: 0 } },
      { id: 900002, stats: { tier: 0, winRate: 105, pickRate: -1, games: -2 } },
      { id: 900003, stats: {} },
    )
    const root = path.join(fixtureRoot, '.aramgg_client', 'data')
    const version = path.join(root, 'versions', prefix, '16.15.2')
    await writeJson(path.join(root, locale === 'zh-CN' ? 'current.json' : `current.${locale}.json`), { locale, dataVersion: '16.15.2' })
    await writeJson(path.join(version, 'manifest.json'), { locale, dataVersion: '16.15.2', files: [{ path: 'champions.json' }] })
    await writeJson(path.join(version, 'champions.json'), payload)
    await writeJson(path.join(version, 'items.json'), { items: [] })
    await writeJson(path.join(version, 'augments.json'), { augments: [] })
    await writeJson(path.join(version, 'champion-shards', 'index.json'), { shards: [] })
  }
  process.chdir(fixtureRoot)
  const { default: logger } = await import('../../src/main/modules/logger.ts')
  mock.method(logger, 'warn', () => {})
  const { loadChampionRankings, setDataLocale } = await import('../../src/main/data-loader.ts')
  const { loadChampionStatsForRecommendation } = await import('../../src/main/services/aram/bench-recommendation-data.ts')
  const { getAramBenchRecommendation } = await import('../../src/main/services/aram/bench-recommendation.ts')
  for (const [locale, expected] of [['zh-CN', '薇恩'], ['en-US', 'Vayne'], ['zh-TW', '汎']]) {
    setDataLocale(locale)
    const result = await loadChampionRankings()
    assert.equal(result.locale, locale)
    assert.equal(result.dataVersion, '16.15.2')
    assert.equal(result.gamePatch, '16.15')
    assert.equal(result.champions.length, 176)
    assert.equal(result.champions[0].name, expected)
    assert.equal(result.champions[0].numGames, null)
    assert.equal(result.champions[0].winRate, 0.5732)
    assert.ok(result.champions.slice(0, 173).every((champion) => champion.iconUrl === `https://cdn.dtodo.cn/hextech/champion-icons/${champion.championId}.png`), 'Real source champion icons must survive the local index and rankings mapper')
    const stats = await loadChampionStatsForRecommendation([67, 900001, 900002, 900003, 999999])
    const recommendation = getAramBenchRecommendation({
      gameflowPhase: 'ChampSelect', selfChampionId: 67,
      benchChampions: [900001, 900002, 900003, 999999].map((championId) => ({ championId })),
    }, stats)
    assert.equal(recommendation.currentChampion.name, expected)
    assert.equal(recommendation.currentChampion.games, null, 'Raw bundled null must survive real dataset reading and recommendation mapping')
    assert.equal(recommendation.currentChampion.winRate, 0.5732)
    const zero = recommendation.candidates.find((candidate) => candidate.championId === 900001)
    assert.equal(zero.games, 0)
    assert.equal(zero.winRate, 0)
    assert.equal(zero.pickRate, 0)
    for (const id of [900002, 900003, 999999]) {
      const missing = recommendation.candidates.find((candidate) => candidate.championId === id)
      assert.equal(missing.name, String(id))
      assert.equal(missing.games, null)
      assert.equal(missing.winRate, null)
      assert.equal(missing.pickRate, null)
      assert.equal(missing.tier, null)
      assert.equal(missing.dataAvailable, false)
    }
    assert.equal(recommendation.candidates.length, 5)
    assert.ok(recommendation.candidates.every((candidate) => Number.isFinite(candidate.score)))
  }
  assert.ok(attemptedUrls.every((url) => /\/config(?:\?|$)/.test(url)), 'Only background config checks may attempt network; no champion detail or per-hero requests')
  console.log('Real three-locale index → recommendation null preservation, synthetic zero/invalid fields and unknown candidates passed offline; no per-hero/detail requests or real LCU/user data.')
} finally {
  mock.restoreAll(); process.chdir(originalCwd); await rm(fixtureRoot, { recursive: true, force: true })
}
