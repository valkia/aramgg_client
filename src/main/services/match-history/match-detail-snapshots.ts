import { randomUUID } from 'node:crypto'
import type { HextechAramMatchHistoryPage, MatchDetailSelection, MatchDetailSnapshot, SupportedDataLocale } from '../../../shared/ipc-contract.ts'

export const MAX_MATCH_DETAIL_WINDOWS = 4

export class MatchDetailSnapshotExpiredError extends Error {
  constructor() { super('Match history account or language changed; refresh the match list') }
}

export interface MatchDetailContext {
  accountKey: string
  platformId: string
  locale: SupportedDataLocale
}

export interface OwnedMatchDetailSnapshot {
  accountKey: string
  data: MatchDetailSnapshot
}

/** One successful page (at most 20 matches), held only in memory. Failed queries leave it intact. */
export class MatchDetailSnapshotStore {
  private current: { id: string; context: MatchDetailContext; page: HextechAramMatchHistoryPage } | null = null
  private generation = 0

  get revision(): number { return this.generation }

  clear(): void {
    this.current = null
    this.generation += 1
  }

  matchesContext(context: MatchDetailContext): boolean {
    return !this.current || sameMatchDetailContext(this.current.context, context)
  }

  capture(page: HextechAramMatchHistoryPage, context: MatchDetailContext, revision: number): HextechAramMatchHistoryPage {
    if (revision !== this.generation || page.platformId !== context.platformId || page.matches.length > 20 || !this.matchesContext(context)) {
      throw new MatchDetailSnapshotExpiredError()
    }
    const id = randomUUID()
    const copy = structuredClone({ ...page, snapshotId: id, locale: context.locale })
    this.current = { id, context: { ...context }, page: copy }
    return structuredClone(copy)
  }

  select(selection: unknown, context: MatchDetailContext): OwnedMatchDetailSnapshot {
    const current = this.current
    if (!isMatchDetailSelection(selection) || !current || selection.snapshotId !== current.id ||
        !sameMatchDetailContext(current.context, context)) {
      throw new Error('Match history snapshot expired; refresh the match list')
    }
    const match = current.page.matches.find((candidate) => candidate.gameId === selection.gameId)
    if (!match) throw new Error('Match is not in the latest queried page')
    return {
      accountKey: current.context.accountKey,
      data: structuredClone({
        match, playerName: current.page.playerName, platformId: current.context.platformId,
        locale: current.context.locale, queriedAt: current.page.queriedAt,
      }),
    }
  }
}

function isMatchDetailSelection(value: unknown): value is MatchDetailSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const selection = value as Record<string, unknown>
  return typeof selection.snapshotId === 'string' && /^[a-f0-9-]{36}$/.test(selection.snapshotId) &&
    Number.isSafeInteger(selection.gameId) && (selection.gameId as number) > 0 &&
    Object.keys(selection).every((key) => key === 'snapshotId' || key === 'gameId')
}

export function sameMatchDetailContext(left: MatchDetailContext, right: MatchDetailContext): boolean {
  return left.accountKey === right.accountKey && left.platformId === right.platformId && left.locale === right.locale
}

export const matchDetailSnapshots = new MatchDetailSnapshotStore()
