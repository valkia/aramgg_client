import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { mock } from 'node:test'

// Real bundled public indexes, isolated app paths, no LCU or live data requests.
// node --experimental-transform-types tests/electron/test-patch-evidence.js
const originalCwd = process.cwd()
const root = await mkdtemp(path.join(os.tmpdir(), 'aramgg-patch-evidence-'))
const attempted = []
async function json(file, value) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value)) }
try {
  mock.method(os, 'homedir', () => root)
  mock.method(globalThis, 'fetch', async (url) => { attempted.push(String(url)); throw new Error('Fixture network disabled') })
  const dataRoot = path.join(root, '.aramgg_client', 'data')
  for (const locale of ['zh-CN', 'en-US', 'zh-TW']) {
    const prefix = locale === 'zh-CN' ? '' : `${locale}/`
    const version = path.join(dataRoot, 'versions', prefix, '16.15.2')
    const index = JSON.parse(await readFile(new URL(`../../resources/client-data/versions/${prefix}16.15.2/champions.json`, import.meta.url), 'utf8'))
    await json(path.join(dataRoot, locale === 'zh-CN' ? 'current.json' : `current.${locale}.json`), { locale, dataVersion: '16.15.2' })
    await json(path.join(version, 'manifest.json'), { locale, dataVersion: '16.15.2', files: [{ path: 'champions.json' }, { path: 'champions/103.json' }] })
    await json(path.join(version, 'champions.json'), index)
    await json(path.join(version, 'champions/103.json'), { champion: index.data.find((champion) => champion.id === 103), augments: [] })
    await json(path.join(version, 'items.json'), { items: [] })
    await json(path.join(version, 'augments.json'), { augments: [] })
    await json(path.join(version, 'champion-shards/index.json'), { shards: [] })
  }
  process.chdir(root)
  const { default: logger } = await import('../../src/main/modules/logger.ts')
  mock.method(logger, 'warn', () => {})
  const { clearCache, getChampionDetailData, loadChampionStats, setDataLocale } = await import('../../src/main/data-loader.ts')
  for (const locale of ['zh-CN', 'en-US', 'zh-TW']) {
    setDataLocale(locale)
    const detail = await getChampionDetailData(103)
    assert.equal(detail.locale, locale)
    assert.equal(detail.patchEvidence.locale, locale)
    assert.equal(detail.patchEvidence.current.gamePatch, detail.stats.version)
    assert.equal(detail.patchEvidence.current.date, detail.stats.date)
    assert.equal(detail.patchEvidence.current.winRate, detail.stats.winRate)
    assert.equal(detail.patchEvidence.current.numGames, null)
    assert.equal(detail.patchEvidence.history.status, 'ready')
    assert.deepEqual(detail.patchEvidence.history.points.map((point) => point.date), ['2026-07-28', '2026-07-30'])
    assert.equal(detail.patchEvidence.notes.publicPatch, '26.15')
    assert.equal((await loadChampionStats(103)).numGames, 0, 'Legacy detail consumer semantics remain unchanged')
  }
  // A raw fallback detail can differ from active metadata. Evidence follows the raw record.
  setDataLocale('zh-CN'); clearCache()
  const version = path.join(dataRoot, 'versions/16.15.2')
  await json(path.join(version, 'champions.json'), { data: [] })
  await json(path.join(version, 'champions/103.json'), { champion: {
    id: 103, name: 'Fallback fixture', stats: { gamePatch: '16.20', date: '2026-10-12', source: 'tencent', region: 'CN', tier: 3, winRate: 0.5214, pickRate: 0.0522, games: null },
  }, augments: [] })
  const fallback = await getChampionDetailData(103)
  assert.equal(fallback.dataVersion, '16.15.2')
  assert.equal(fallback.patchEvidence.dataVersion, '', 'Do not label a raw shard with unproven active data version')
  assert.equal(fallback.patchEvidence.current.gamePatch, '16.20')
  assert.equal(fallback.patchEvidence.notes.publicPatch, '26.20')
  assert.equal(fallback.patchEvidence.history.status, 'ready')
  clearCache()
  await json(path.join(version, 'champions/103.json'), { champion: {
    id: 103, stats: { gamePatch: '16.20', date: '2026-10-13', source: 'tencent', region: 'CN', tier: 3, winRate: 0.522, pickRate: 0.0522, games: null },
  }, augments: [] })
  const nextDay = await getChampionDetailData(103)
  assert.equal(nextDay.patchEvidence.history.status, 'ready')
  assert.equal(nextDay.patchEvidence.current.date, '2026-10-13')
  assert.equal(nextDay.patchEvidence.history.points.at(-1).winRate, 0.522)
  clearCache()
  await json(path.join(version, 'champions/103.json'), { champion: {
    id: 103, stats: { queueId: 450, gamePatch: '16.20', date: '2026-10-13', source: 'tencent', region: 'CN', tier: 3, winRate: 0.522, pickRate: 0.0522 },
  }, augments: [] })
  const wrongMode = await getChampionDetailData(103)
  assert.equal(wrongMode.patchEvidence, null, 'An explicit non-Mayhem queue must never be relabeled')
  assert.equal(wrongMode.stats.winRate, 0.522, 'Evidence failure must retain legacy champion details')
  assert.ok(attempted.every((url) => /\/config(?:\?|$)/.test(url)), `Unexpected foreground network attempts: ${attempted.join(', ')}`)
  console.log('Three-locale real index → detail evidence, unknown samples, actual fallback metadata and seven-patch archive passed offline; no LCU/user data or foreground network.')
} finally {
  mock.restoreAll(); process.chdir(originalCwd); await rm(root, { recursive: true, force: true })
}
