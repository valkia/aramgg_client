import type { SupportedDataLocale } from './ipc-contract.ts'

export interface ChampionTrendPoint {
  gamePatch: string
  publicPatch: string | null
  date: string
  tier: number | null
  winRate: number | null
  pickRate: number | null
  numGames: number | null
}

export interface PatchChangeRecord {
  kind: 'augment' | 'champion' | 'system'
  subjectId: number | null
  title: string
  lines: string[]
}

export interface ChampionPatchEvidence {
  locale: SupportedDataLocale
  championId: number
  dataVersion: string
  queueId: 2400
  source: string
  region: string
  current: ChampionTrendPoint
  notes: {
    publicPatch: string
    effectiveDate: string
    sourceUrl: string
    verifiedAt: string
    records: PatchChangeRecord[]
  } | null
  history: {
    status: 'ready' | 'insufficient' | 'unmatched'
    sourceUrl: string
    archivedAt: string
    points: ChampionTrendPoint[]
  }
}
