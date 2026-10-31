import archiveData from '../data/patch-evidence.json' with { type: 'json' }
import type { ChampionRankingEntry, SupportedDataLocale } from '../../shared/ipc-contract.ts'
import type { ChampionPatchEvidence, ChampionTrendPoint, PatchChangeRecord } from '../../shared/patch-evidence.ts'

type ArchivePoint = { source: string; version: string; date: string; tier: string; winRate: number; pickRate: number; numGames: number | null }
type Patch = { publicPatch: string; effectiveDate: string; sourceUrl: string; locales: Record<SupportedDataLocale, PatchChangeRecord[]> }
export type PatchEvidenceArchive = {
  schemaVersion: number; queueId: number; source: string; region: string
  verifiedAt: string; archivedAt: string; sourceUrl: string
  patchVersions: Record<string, string>; patches: Record<string, Patch>; champions: Record<string, ArchivePoint[]>
}
const archive = archiveData as unknown as PatchEvidenceArchive
const validDate = (date: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const value = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date
}
const rate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const samples = (value: unknown): boolean => value === null || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Bind evidence to the raw record used for this detail, not a later active dataset. */
export function buildChampionPatchEvidence(
  champion: ChampionRankingEntry,
  context: { locale: SupportedDataLocale; dataVersion: string },
  data: PatchEvidenceArchive = archive,
): ChampionPatchEvidence {
  const publicPatch = data.patchVersions[champion.gamePatch] || null
  const current: ChampionTrendPoint = {
    gamePatch: champion.gamePatch, publicPatch, date: champion.statsDate,
    tier: champion.tier, winRate: champion.winRate, pickRate: champion.pickRate, numGames: champion.numGames,
  }
  const evidence: ChampionPatchEvidence = {
    ...context, championId: champion.championId, queueId: 2400,
    source: champion.source, region: champion.region, current, notes: null,
    history: { status: 'unmatched', sourceUrl: `${data.sourceUrl}/${champion.championId}.json`, archivedAt: data.archivedAt, points: [current] },
  }
  if (data.schemaVersion !== 1 || data.queueId !== 2400 || champion.source !== data.source || champion.region !== data.region) return evidence
  if (!validDate(champion.statsDate)) return evidence
  const patch = data.patches[champion.gamePatch]
  if (patch?.publicPatch === publicPatch && patch.effectiveDate <= champion.statsDate) {
    evidence.notes = {
      publicPatch: patch.publicPatch, effectiveDate: patch.effectiveDate,
      sourceUrl: patch.sourceUrl, verifiedAt: data.verifiedAt,
      records: patch.locales[context.locale].filter((record) => record.kind !== 'champion' || record.subjectId === champion.championId),
    }
  }
  if (!publicPatch || !rate(champion.winRate) || !rate(champion.pickRate) || !samples(champion.numGames) || champion.tier === null || !Number.isSafeInteger(champion.tier) || champion.tier < 1) return evidence
  const seen = new Map<string, ArchivePoint>()
  for (const point of data.champions[String(champion.championId)] || []) {
    if (point.source !== champion.source || !validDate(point.date) || point.date > champion.statsDate || !data.patchVersions[point.version]) continue
    if (!rate(point.winRate) || !rate(point.pickRate) || !samples(point.numGames) || !/^[1-9]\d*$/.test(point.tier) || !Number.isSafeInteger(Number(point.tier))) continue
    const key = `${point.version}|${point.date}`
    const previous = seen.get(key)
    // Conflicting duplicate points cannot establish an anchor or a comparison.
    if (previous && JSON.stringify(previous) !== JSON.stringify(point)) return evidence
    seen.set(key, point)
  }
  const anchor = seen.get(`${champion.gamePatch}|${champion.statsDate}`)
  if (anchor && (anchor.winRate !== champion.winRate || anchor.pickRate !== champion.pickRate || Number(anchor.tier) !== champion.tier || anchor.numGames !== champion.numGames)) return evidence
  // The current point is the real detail record, so daily dataset updates remain usable.
  // Only earlier points come from the shipped public archive; no synthetic history is added.
  seen.set(`${champion.gamePatch}|${champion.statsDate}`, {
    source: champion.source, version: champion.gamePatch, date: champion.statsDate,
    tier: String(champion.tier), winRate: champion.winRate, pickRate: champion.pickRate, numGames: champion.numGames,
  })
  const perPatch = new Map<string, ArchivePoint>()
  for (const point of seen.values()) {
    if (point.version.localeCompare(champion.gamePatch, undefined, { numeric: true }) > 0) continue
    const previous = perPatch.get(point.version)
    if (!previous || previous.date < point.date) perPatch.set(point.version, point)
  }
  const points = [...perPatch.values()].sort((a, b) => a.date.localeCompare(b.date) || a.version.localeCompare(b.version, undefined, { numeric: true })).slice(-8)
  evidence.history.points = points.map((point) => ({
    gamePatch: point.version, publicPatch: data.patchVersions[point.version], date: point.date,
    tier: Number(point.tier), winRate: point.winRate, pickRate: point.pickRate, numGames: point.numGames,
  }))
  evidence.history.status = points.length >= 2 ? 'ready' : 'insufficient'
  return evidence
}
