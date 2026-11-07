import type { ChampSelectSnapshot } from './types.ts'
import type { LcuJsonApiEvent } from './lcu-wamp-socket.ts'

export const SUBSET_CHAMPIONS_PATH = '/lol-lobby-team-builder/champ-select/v1/subset-champion-list'
const SESSION_PATHS = new Set([
  '/lol-champ-select/v1/session',
  '/lol-lobby-team-builder/champ-select/v1/session',
])
const PROBE_INTERVAL_MS = 2000
const HEARTBEAT_MS = 10000
const MAX_IDS = 24

type ProbeResult = { status: number | null; data?: unknown; errorCode?: string }
type Options = {
  enabled: boolean
  readSubset: () => Promise<ProbeResult>
  log: (message: string, details: Record<string, unknown>) => void
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
const integer = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null
const boolean = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null
const shortString = (value: unknown): string | null =>
  typeof value === 'string' ? value.slice(0, 48) : null
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []

function summarizeIds(data: unknown) {
  const values = array(data)
  const invalidCount = values.filter((value) => integer(value) === null).length
  return {
    responseType: Array.isArray(data) ? 'array' : data === null ? 'null' : typeof data,
    count: Array.isArray(data) ? values.length : null,
    ids: values.slice(0, MAX_IDS).map(integer),
    invalidCount,
    truncated: values.length > MAX_IDS,
    validIdArray: Array.isArray(data) && invalidCount === 0,
  }
}

function summarizeSession(data: unknown) {
  const session = record(data)
  const timer = record(session.timer)
  return {
    available: data !== null && typeof data === 'object' && !Array.isArray(data),
    queueId: integer(session.queueId),
    allowSubsetChampionPicks: boolean(session.allowSubsetChampionPicks),
    localPlayerCellId: integer(session.localPlayerCellId),
    benchEnabled: boolean(session.benchEnabled),
    benchChampionIds: array(session.benchChampions).slice(0, MAX_IDS).map((item) => integer(record(item).championId)),
    myTeam: array(session.myTeam).slice(0, 10).map((item) => {
      const member = record(item)
      return { cellId: integer(member.cellId), championId: integer(member.championId), championPickIntent: integer(member.championPickIntent) }
    }),
    actions: array(session.actions).slice(0, 20).flatMap((group) => array(group).slice(0, 10).map((item) => {
      const action = record(item)
      return { id: integer(action.id), actorCellId: integer(action.actorCellId), championId: integer(action.championId), type: shortString(action.type), completed: boolean(action.completed), isInProgress: boolean(action.isInProgress) }
    })),
    timerPhase: shortString(timer.phase),
    adjustedTimeLeftInPhase: integer(timer.adjustedTimeLeftInPhase),
  }
}

/** Diagnostic-only observations: never change the recommendation snapshot or invoke LCU writes. */
export class ChampSelectDiagnostics {
  private generation = 0
  private runId: string | null = null
  private startedAt = 0
  private lastProbeAt = -Infinity
  private inFlight = false
  private requests = 0
  private sessionEvents = 0
  private subsetEvents = 0
  private lastSubset: ReturnType<typeof summarizeIds> | null = null
  private lastSnapshot: { selfChampionId: number | null; candidateChampionIds: number[] } | null = null
  private samples = new Map<string, { signature: string; at: number }>()

  constructor(private readonly options: Options) {}

  get revision(): number { return this.generation }

  observePhase(phase: unknown, source: string): void {
    if (!this.options.enabled) return
    if (phase === 'ChampSelect') {
      if (this.runId) return
      this.generation += 1
      this.startedAt = Date.now()
      this.runId = `${this.startedAt}-${this.generation}`
      this.lastProbeAt = -Infinity
      this.requests = this.sessionEvents = this.subsetEvents = 0
      this.lastSubset = this.lastSnapshot = null
      this.samples.clear()
      this.write('start', { source, probeIntervalMs: PROBE_INTERVAL_MS, heartbeatMs: HEARTBEAT_MS, endpoint: SUBSET_CHAMPIONS_PATH })
    } else if (this.runId) {
      this.write('end', { source, nextPhase: shortString(phase), requests: this.requests, sessionEvents: this.sessionEvents, subsetEvents: this.subsetEvents, lastSubset: this.lastSubset })
      this.runId = null
      this.generation += 1
      this.lastSubset = this.lastSnapshot = null
      this.samples.clear()
    }
  }

  observeSnapshot(snapshot: ChampSelectSnapshot, candidateChampionIds: number[], revision: number): void {
    if (!this.runId || revision !== this.generation) return
    this.lastSnapshot = { selfChampionId: snapshot.selfChampionId, candidateChampionIds: candidateChampionIds.slice(0, 50) }
    this.observeSession(snapshot.champSelectSession, 'http', { snapshotStatus: snapshot.status, ...this.lastSnapshot })
    this.compareCandidates()
    this.probe()
  }

  observeEvent(event: LcuJsonApiEvent): void {
    if (!this.runId) return
    if (event.uri === SUBSET_CHAMPIONS_PATH) {
      this.subsetEvents += 1
      const summary = summarizeIds(event.data)
      this.lastSubset = event.eventType === 'Delete' ? null : summary
      this.changed('subset-websocket', { eventType: shortString(event.eventType), ...summary }, { uri: event.uri, eventCount: this.subsetEvents })
      this.compareCandidates()
    } else if (SESSION_PATHS.has(event.uri || '')) {
      this.sessionEvents += 1
      this.observeSession(event.data, 'websocket', { uri: event.uri, eventType: shortString(event.eventType), eventCount: this.sessionEvents })
      if (event.eventType === 'Delete') this.observePhase(null, 'session-deleted')
    }
  }

  private observeSession(data: unknown, source: string, extra: Record<string, unknown>) {
    const { adjustedTimeLeftInPhase, ...summary } = summarizeSession(data)
    // Countdown ticks must not defeat change detection.
    this.changed(`session-${source}`, { ...summary, ...(source === 'http' ? extra : { eventType: extra.eventType }) }, { ...extra, adjustedTimeLeftInPhase })
  }

  private probe(): void {
    if (this.inFlight || Date.now() - this.lastProbeAt < PROBE_INTERVAL_MS) return
    this.lastProbeAt = Date.now()
    this.inFlight = true
    this.requests += 1
    const generation = this.generation
    const runId = this.runId
    const startedAt = Date.now()
    void this.options.readSubset().then((result) => {
      if (generation !== this.generation) {
        this.options.log('[champ-select diagnostics] stale-response', { runId, status: result.status, durationMs: Date.now() - startedAt })
        return
      }
      const summary = summarizeIds(result.data)
      this.lastSubset = result.status === 200 && summary.validIdArray ? summary : null
      this.changed('subset-http', { status: result.status, errorCode: result.errorCode || null, ...summary }, {
        endpoint: SUBSET_CHAMPIONS_PATH, durationMs: Date.now() - startedAt, requestCount: this.requests,
      })
      this.compareCandidates()
    }).catch(() => {
      if (generation !== this.generation) return
      this.lastSubset = null
      this.changed('subset-http', { status: null, errorCode: 'probe-failed' })
    }).finally(() => { this.inFlight = false })
  }

  private compareCandidates(): void {
    if (!this.lastSnapshot) return
    const subset = this.lastSubset?.validIdArray ? this.lastSubset.ids : null
    this.changed('candidate-coverage', {
      ...this.lastSnapshot,
      subsetChampionIds: subset,
      subsetTruncated: this.lastSubset?.truncated ?? false,
      missingFromRecommendation: subset?.filter((id) => id !== null && id > 0 && !this.lastSnapshot!.candidateChampionIds.includes(id)) ?? null,
    })
  }

  private changed(event: string, stable: Record<string, unknown>, extra: Record<string, unknown> = {}): void {
    const signature = JSON.stringify(stable)
    const previous = this.samples.get(event)
    if (previous?.signature === signature && Date.now() - previous.at < HEARTBEAT_MS) return
    this.samples.set(event, { signature, at: Date.now() })
    this.write(event, { reason: previous?.signature === signature ? 'heartbeat' : 'changed', ...stable, ...extra })
  }

  private write(event: string, details: Record<string, unknown>): void {
    this.options.log(`[champ-select diagnostics] ${event}`, { runId: this.runId, elapsedMs: Date.now() - this.startedAt, ...details })
  }
}
