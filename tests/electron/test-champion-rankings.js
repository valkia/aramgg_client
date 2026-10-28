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
  for (const [locale, expected] of [['zh-CN', '薇恩'], ['en-US', 'Vayne'], ['zh-TW', '汎']]) {
    setDataLocale(locale)
    const result = await loadChampionRankings()
    assert.equal(result.locale, locale)
    assert.equal(result.dataVersion, '16.15.2')
    assert.equal(result.gamePatch, '16.15')
    assert.equal(result.champions.length, 173)
    assert.equal(result.champions[0].name, expected)
    assert.equal(result.champions[0].numGames, null)
    assert.equal(result.champions[0].winRate, 0.5732)
  }
  assert.ok(attemptedUrls.every((url) => /\/config(?:\?|$)/.test(url)), 'Only background config checks may attempt network; no champion detail or per-hero requests')
  console.log('Real champion index loading passed for all three isolated locales, offline; no per-hero/detail requests or real LCU/user data.')
} finally {
  mock.restoreAll(); process.chdir(originalCwd); await rm(fixtureRoot, { recursive: true, force: true })
}
