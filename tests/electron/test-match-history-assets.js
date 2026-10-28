import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { mock } from 'node:test'

// Run with: node --experimental-transform-types tests/electron/test-match-history-assets.js
const originalCwd = process.cwd()
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'aramgg-match-assets-'))
const dataVersion = 'match-assets-fixture-v1'
const locales = ['zh-CN', 'en-US', 'zh-TW']
const names = ['鞋子', 'Boots', '鞋子']
const descriptions = ['移动速度', 'Move speed', '跑速']
const puuid = '11111111-1111-1111-1111-111111111111'
const attemptedUrls = []

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(payload), 'utf8')
}

try {
  mock.method(os, 'homedir', () => fixtureRoot)
  // Local foreground data must still work when every remote check is unavailable.
  mock.method(globalThis, 'fetch', async (url) => {
    attemptedUrls.push(String(url))
    throw new Error('Network disabled in the match-history asset fixture')
  })
  process.chdir(fixtureRoot)
  for (const [index, locale] of locales.entries()) {
    const dataRoot = path.join(fixtureRoot, '.aramgg_client', 'data')
    const pointerName = locale === 'zh-CN' ? 'current.json' : `current.${locale}.json`
    const versionDir = locale === 'zh-CN'
      ? path.join(dataRoot, 'versions', dataVersion)
      : path.join(dataRoot, 'versions', locale, dataVersion)
    await writeJson(path.join(dataRoot, pointerName), { locale, dataVersion })
    await writeJson(path.join(versionDir, 'manifest.json'), {
      locale, dataVersion, files: ['champions.json', 'items.json', 'augments.json'].map((file) => ({ path: file })),
    })
    await writeJson(path.join(versionDir, 'champions.json'), { champions: [{ id: 103, name: 'Ahri' }] })
    await writeJson(path.join(versionDir, 'champion-shards', 'index.json'), { shards: [] })
    await writeJson(path.join(versionDir, 'items.json'), { items: [{ id: 1001, name: names[index], description: descriptions[index] }] })
    await writeJson(path.join(versionDir, 'augments.json'), { augments: [{ id: 18, name: `Lotus ${locale}`, description: descriptions[index], rarity: 1 }] })
  }

  const { default: logger } = await import('../../src/main/modules/logger.ts')
  mock.method(logger, 'warn', () => {})
  const { loadItems, setDataLocale } = await import('../../src/main/data-loader.ts')
  const { SgpMatchHistoryService } = await import('../../src/main/services/match-history/sgp-match-history-service.ts')
  mock.method(SgpMatchHistoryService.prototype, 'getHextechAramSummaries', async () => [{
    gameId: 1, gameCreation: 1_000, gameDuration: 900, gameMode: 'KIWI', queueId: 2400,
    participants: [{ participantId: 1, puuid, championId: 103, teamId: 100, win: true, item0: 1001, item1: 9999, playerAugment1: 18 }],
  }])
  const { HextechAramQueryService } = await import('../../src/main/services/match-history/hextech-aram-query-service.ts')
  const service = new HextechAramQueryService({ getCurrentSummoner: async () => ({ puuid, platformId: 'HN1' }) })

  for (const [index, locale] of locales.entries()) {
    setDataLocale(locale)
    assert.equal((await loadItems(locale))[0].name.en_us, names[index])
    const match = (await service.queryCurrent()).matches[0]
    assert.deepEqual(match.items, [
      { id: 1001, name: names[index], description: descriptions[index] }, { id: 9999 },
    ])
    assert.deepEqual(match.augments, [
      { id: 18, name: `Lotus ${locale}`, description: descriptions[index], rarity: 'kGold' },
    ])
    assert.deepEqual(match.participants[0].items, match.items)
    assert.deepEqual(match.participants[0].augments, match.augments)
  }
  assert.ok(attemptedUrls.every((url) => /\/config(?:\?|$)/.test(url)), 'Only background config checks may attempt network access')
  console.log('Match-history local asset fixtures passed for zh-CN, en-US and zh-TW; no live LCU, user data or asset requests.')
} finally {
  mock.restoreAll()
  process.chdir(originalCwd)
  await rm(fixtureRoot, { recursive: true, force: true })
}
