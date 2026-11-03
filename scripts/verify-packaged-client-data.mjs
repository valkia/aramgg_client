import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

assert.ok(process.argv[2], 'Provide the packaged client-data directory')
const root = path.resolve(process.argv[2])
const locales = [
  ['zh-CN', 'current.json', 'versions'],
  ['en-US', 'current.en-US.json', 'versions/en-US'],
  ['zh-TW', 'current.zh-TW.json', 'versions/zh-TW'],
]
const requiredFiles = [
  'manifest.json', 'augments.json', 'champions.json', 'items.json', 'champion-shards/index.json',
]

for (const [locale, pointer, prefix] of locales) {
  const current = JSON.parse(await readFile(path.join(root, pointer), 'utf8'))
  assert.equal(current.locale, locale, `Packaged locale mismatch in ${pointer}`)
  assert.ok(current.dataVersion, `Missing dataVersion in ${pointer}`)
  const versionDir = path.join(root, prefix, current.dataVersion)
  for (const file of requiredFiles) await access(path.join(versionDir, file))
  const shards = (await readdir(path.join(versionDir, 'champion-shards'), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'index.json')
  assert.ok(shards.length >= 40, `Packaged ${locale} shard count is too low: ${shards.length}`)
  console.log(
    `Packaged client-data locale=${locale} dataVersion=${current.dataVersion} ` +
    `gamePatch=${current.gamePatch} files=${current.bundledFileCount} ` +
    `shards=${shards.length} bytes=${current.bundledBytes}`,
  )
}
