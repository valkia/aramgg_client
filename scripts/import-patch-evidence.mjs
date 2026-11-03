// Read only public aggregate artifacts from the ARAMGG data repository.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const sourceRoot = process.argv[2]
if (!sourceRoot || !path.isAbsolute(sourceRoot)) throw new Error('Pass the absolute ARAMGG repository path')
const output = fileURLToPath(new URL('../src/main/data/patch-evidence.json', import.meta.url))
const hashes = {}
async function read(relative) {
  const text = await readFile(path.join(sourceRoot, relative), 'utf8')
  hashes[relative] = createHash('sha256').update(text).digest('hex')
  return JSON.parse(text)
}
const localeKeys = { 'zh-CN': 'zh_cn', 'en-US': 'en_us', 'zh-TW': 'zh_tw' }
// Numeric facts transcribed from Riot's 26.15 ARAM: Mayhem > Champions section.
// Signed damage-taken notation is preserved, never converted to a final multiplier.
const championChanges = {
  103: [['healing', '90%', '100%']], 166: [['dealt', '105%', '100%'], ['taken', '5%', '0%']],
  12: [['healing', '80%', '100%'], ['modifier', '95%', '100%']], 799: [['taken', '-5%', '0%']],
  1: [['shield', '90%', '100%'], ['taken', '-5%', '0%']], 22: [['dealt', '105%', '100%']],
  42: [['taken', '10%', '5%']], 245: [['dealt', '110%', '105%']], 910: [['minions', '60%', '100%']],
  202: [['taken', '-5%', '0%']], 145: [['taken', '10%', '0%']], 203: [['dealt', '110%', '100%']],
  96: [['dealt', '88%', '90%']], 236: [['dealt', '105%', '100%']], 90: [['minions', '60%', '100%']],
  21: [['taken', '-5%', '0%']], 82: [['taken', '-2%', '0%']], 25: [['taken', '-10%', '0%']],
  75: [['taken', '-5%', '0%']], 246: [['dealt', '115%', '110%']],
  13: [['dealt', '105%', '100%'], ['taken', '5%', '0%']], 235: [['dealt', '97%', '100%']],
  27: [['taken', '-8%', '0%']], 901: [['haste', '-10', '0']], 16: [['healing', '105%', '100%']],
  17: [['haste', '-10', '0'], ['minions', '60%', '100%']], 48: [['taken', '-5%', '0%']],
  5: [['dealt', '95%', '100%']], 26: [['dealt', '105%', '100%'], ['taken', '5%', '0%']],
  115: [['dealt', '87%', '90%'], ['minions', '60%', '100%']],
}
const fieldLabels = {
  'zh-CN': { healing: '治疗', dealt: '造成伤害', taken: '承受伤害（公告记法）', modifier: '伤害修正', shield: '护盾', minions: '对小兵伤害', haste: '技能急速' },
  'zh-TW': { healing: '治療', dealt: '造成傷害', taken: '承受傷害（公告記法）', modifier: '傷害修正', shield: '護盾', minions: '對士兵傷害', haste: '技能疾速' },
  'en-US': { healing: 'Healing', dealt: 'Damage dealt', taken: 'Damage taken (announcement notation)', modifier: 'Damage modifier', shield: 'Shielding', minions: 'Damage to minions', haste: 'Ability haste' },
}
const index = await read('public/data/champion-trends/index.json')
const champions = {}
for (const file of (await readdir(path.join(sourceRoot, 'public/data/champion-trends'))).sort()) {
  if (!/^\d+\.json$/.test(file)) continue
  const data = await read(`public/data/champion-trends/${file}`)
  if (String(data.championId) !== file.replace('.json', '')) throw new Error(`Champion ID mismatch: ${file}`)
  // Earlier records omit source and mean iesdev. Never infer Tencent from those.
  champions[data.championId] = data.points.filter((point) => point.source === 'tencent')
}
const patches = {}
// Reviewed Mayhem-only artifact allowlist, including manual sections; never discover new patches automatically.
const effectiveDates = { '16.15': '2026-07-30', '16.16': '2026-08-13', '16.17': '2026-08-27', '16.18': '2026-09-10', '16.19': '2026-09-23', '16.20': '2026-10-07', '16.21': '2026-10-21' }
for (let minor = 15; minor <= 21; minor += 1) {
  const gamePatch = `16.${minor}`
  const publicPatch = `26.${minor}`
  const data = await read(`public/data/augments-changelog/${gamePatch}.json`)
  if (data.currentVersion !== gamePatch) throw new Error(`Patch mismatch: ${gamePatch}`)
  // These two generated files omit source metadata; their official registry was audited.
  const verifiedFallbacks = {
    '16.15': { url: 'https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-15-notes/', effectiveDate: '2026-07-30' },
    '16.16': { url: 'https://www.leagueoflegends.com/zh-tw/news/game-updates/league-of-legends-patch-26-16-notes/', effectiveDate: '2026-08-13' },
  }
  const source = data.source || verifiedFallbacks[gamePatch]
  if (!source) throw new Error(`No audited source: ${gamePatch}`)
  const sourceUrl = new URL(source.url)
  if (sourceUrl.origin !== 'https://www.leagueoflegends.com' || !new RegExp(`^/(en-us|zh-tw)/news/game-updates/league-of-legends-patch-26-${minor}-notes/$`).test(sourceUrl.pathname)) throw new Error(`Unverified official patch source: ${gamePatch}`)
  if (source.effectiveDate !== effectiveDates[gamePatch]) throw new Error(`Unverified effective date: ${gamePatch}`)
  const locales = {}
  for (const [locale, key] of Object.entries(localeKeys)) {
    const records = []
    const formatValue = (value) => value === null || value === undefined || value === ''
      ? { 'zh-CN': '未提供', 'zh-TW': '未提供', 'en-US': 'Not provided' }[locale] : String(value)
    if (minor === 15) for (const [id, changes] of Object.entries(championChanges)) {
      records.push({ kind: 'champion', subjectId: Number(id), title: '', lines: changes.map(([field, before, after]) => `${fieldLabels[locale][field]}: ${before} → ${after}`) })
    }
    for (const entry of data.changed) {
      if (entry.mode && entry.mode !== 'standard') continue
      const lines = []
      for (const change of entry.changes) {
        if (change.type === 'values') {
          for (const detail of change.details || []) {
            if (!detail.labels?.[key]) throw new Error(`Missing localized value: ${gamePatch}/${entry.id}/${key}`)
            lines.push(`${detail.labels[key]}: ${formatValue(detail.old)} → ${formatValue(detail.new)}`)
          }
        } else if (change.type === 'description') {
          const text = change.locales?.[key]
          if (!text || !text.new) throw new Error(`Missing localized description: ${gamePatch}/${entry.id}/${key}`)
          lines.push(text.old ? `${text.old} → ${text.new}` : text.new)
        } else if (change.type === 'enabled') {
          const labels = { 'zh-CN': ['不可选', '可选'], 'zh-TW': ['不可選', '可選'], 'en-US': ['Unavailable', 'Available'] }[locale]
          lines.push(`${labels[Number(change.old)]} → ${labels[Number(change.new)]}`)
        } else if (change.type === 'rarity') {
          const labels = { 'zh-CN': ['银色', '金色', '棱彩'], 'zh-TW': ['銀色', '金色', '稜彩'], 'en-US': ['Silver', 'Gold', 'Prismatic'] }[locale]
          if (!labels[change.old] || !labels[change.new]) throw new Error('Invalid rarity')
          lines.push(`${labels[change.old]} → ${labels[change.new]}`)
        } else throw new Error(`Unsupported change: ${gamePatch}/${change.type}`)
      }
      if (lines.length) records.push({ kind: 'augment', subjectId: Number(entry.id), title: '', lines })
    }
    for (const kind of ['added', 'removed']) {
      const entries = data[kind].filter((entry) => !entry.mode || entry.mode === 'standard')
      for (const entry of entries) records.push({
        kind: 'augment', subjectId: Number(entry.id ?? entry), title: '',
        lines: [{ added: { 'zh-CN': '新增', 'zh-TW': '新增', 'en-US': 'Added' }, removed: { 'zh-CN': '移出可选池', 'zh-TW': '移出可選池', 'en-US': 'Removed from the pool' } }[kind][locale]],
      })
    }
    for (const section of data.manualSections || []) {
      const text = key === 'zh_cn' ? section : section.locales?.[key]
      if (!text?.title || !Array.isArray(text.items)) throw new Error(`Missing localized section: ${gamePatch}/${key}`)
      records.push({ kind: 'system', subjectId: null, title: text.title, lines: text.items })
    }
    locales[locale] = records
  }
  patches[gamePatch] = { publicPatch, effectiveDate: source.effectiveDate, sourceUrl: source.url, locales }
}
// These mappings are an explicit imported registry, not a general 16.x -> 26.x rule.
const patchVersions = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`16.${i + 14}`, `26.${i + 14}`]))
const archive = {
  schemaVersion: 1, queueId: 2400, source: 'tencent', region: 'CN', verifiedAt: '2026-10-28',
  archivedAt: index.generatedAt, sourceUrl: 'https://aramgg.com/data/champion-trends',
  upstream: { title: 'ARAMGG public aggregate artifacts', sourceHead: execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), paths: 'public/data/champion-trends; public/data/augments-changelog', hashes },
  patchVersions, patches, champions,
}
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(archive)}\n`)
console.log(JSON.stringify({ champions: Object.keys(champions).length, points: Object.values(champions).reduce((sum, points) => sum + points.length, 0), patches: Object.keys(patches), output }))
