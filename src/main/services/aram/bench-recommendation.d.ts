import type { ChampSelectSnapshot, GameflowPhase } from '../lcu/types.ts'
import type { AramRecommendationDecisionReason } from '../../../shared/ipc-contract.ts'

export type AramBenchRecommendationStatus =
  | 'ready'
  | 'inactive'
  | 'no-current-champion'
  | 'no-bench'
  | 'no-candidates'

export interface AramBenchCandidate {
  championId: number
  source: 'current' | 'bench' | 'teammate'
  sourceLabel: string
  isCurrent: boolean
  isBench: boolean
  isTeammate: boolean
  name: string
  iconUrl: string | null
  tier: number | null
  winRate: number | null
  pickRate: number | null
  games: number | null
  score: number
  confidence: number
  dataAvailable: boolean
  availableStatsFields: string[]
  reasons: string[]
}

export interface AramBenchRecommendation {
  readOnly: true
  status: AramBenchRecommendationStatus
  reason: string | null
  decisionReason: AramRecommendationDecisionReason | null
  gameflowPhase: GameflowPhase | null
  benchEnabled: boolean
  currentChampion: AramBenchCandidate | null
  recommendedChampion: AramBenchCandidate | null
  candidates: AramBenchCandidate[]
  deltaScore: number
  confidence: number
  reasons: string[]
  generatedAt: number
}

export function collectAramCandidateChampionIds(
  snapshot: ChampSelectSnapshot | null | undefined
): number[]

export function createEmptyAramBenchRecommendation(
  reason?: string
): AramBenchRecommendation

export function getAramBenchRecommendation(
  snapshot: ChampSelectSnapshot | null | undefined,
  championStatsById?: Record<string, unknown> | Map<string | number, unknown>
): AramBenchRecommendation
