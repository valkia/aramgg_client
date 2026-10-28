import type { ChampionRankingEntry, ChampionRankings, SupportedDataLocale } from '../../shared/ipc-contract.ts'

type RecordValue = Record<string, unknown>
type RankingContext = { locale: SupportedDataLocale; dataVersion: string; gamePatch?: string; generatedAt?: string }

const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

function number(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function integer(value: unknown, minimum = 0): number | null {
  const parsed = number(value)
  return parsed !== null && Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null
}

function rate(value: unknown): number | null {
  const parsed = number(value)
  return parsed !== null && parsed <= 1 ? parsed : null
}

/** The client-v1 champion index stores fractional rates; absent samples stay absent. */
export function mapChampionRankings(payload: unknown, context: RankingContext): ChampionRankings {
  const envelope = record(payload)
  const meta = record(envelope.meta)
  if (text(envelope.locale || meta.locale) && text(envelope.locale || meta.locale) !== context.locale) {
    throw new Error('Champion ranking data locale does not match the requested locale')
  }
  const declaredVersion = text(envelope.dataVersion || meta.dataVersion)
  if (declaredVersion && declaredVersion !== context.dataVersion) {
    throw new Error('Champion ranking data version does not match the active dataset')
  }
  const data = envelope.data ?? payload
  const entries = Array.isArray(data) ? data : record(data).champions ?? envelope.champions
  if (!Array.isArray(entries)) throw new Error('Champion ranking index is invalid')
  const gamePatch = text(meta.gamePatch || envelope.gamePatch || context.gamePatch)
  const generatedAt = text(meta.generatedAt || envelope.generatedAt || context.generatedAt)
  const seen = new Set<number>()
  const champions: ChampionRankingEntry[] = []
  for (const entry of entries) {
    const champion = record(entry)
    const championId = integer(champion.id ?? champion.championId, 1)
    if (championId === null || seen.has(championId)) continue
    seen.add(championId)
    const stats = record(champion.stats ?? champion)
    champions.push({
      championId,
      name: text(champion.name || champion.nameCN),
      alias: text(champion.alias || champion.nameEN),
      title: text(champion.title),
      iconUrl: text(champion.iconUrl) || null,
      tier: integer(stats.tier, 1),
      winRate: rate(stats.winRate),
      pickRate: rate(stats.pickRate),
      numGames: integer(stats.games ?? stats.numGames),
      gamePatch: text(stats.gamePatch) || gamePatch,
      statsDate: text(stats.date),
      source: text(stats.source),
      region: text(stats.region),
    })
  }
  return { locale: context.locale, dataVersion: context.dataVersion, gamePatch, generatedAt, champions }
}
