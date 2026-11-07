import type { LcuJsonApiEvent } from './lcu-wamp-socket.ts'

export const SUBSET_CHAMPIONS_PATH = '/lol-lobby-team-builder/champ-select/v1/subset-champion-list'
const REFRESH_INTERVAL_MS = 2000
const MAX_AGE_MS = 6000
const FOREGROUND_WAIT_MS = 150
export type SubsetChampionResult = {
  status: number | null
  data?: unknown
  errorCode?: string
  source?: 'http' | 'websocket'
  cacheHit?: boolean
}
const unavailable = (): SubsetChampionResult => ({ status: null, errorCode: 'subset-unavailable' })

function normalizeIds(result: SubsetChampionResult): number[] {
  if (result.status !== 200 || !Array.isArray(result.data) ||
      !result.data.every((id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)) return []
  return [...new Set<number>(result.data)]
}

/** One read-only cache shared by recommendations and diagnostics. */
export class SubsetChampions {
  private active = false
  private generation = 0
  private dataRevision = 0
  private lastRequestAt = -Infinity
  private updatedAt = -Infinity
  private result: SubsetChampionResult = unavailable()
  private inFlight: Promise<SubsetChampionResult> | null = null

  constructor(private readonly request: () => Promise<SubsetChampionResult>) {}

  get revision(): number { return this.generation }

  reset(): void {
    this.active = false
    this.generation += 1
    this.dataRevision += 1
    this.lastRequestAt = this.updatedAt = -Infinity
    this.result = unavailable()
    this.inFlight = null
  }

  observePhase(phase: unknown): void {
    if (phase !== 'ChampSelect') {
      if (this.active) this.reset()
      return
    }
    if (this.active) return
    this.active = true
    this.generation += 1
    // Prewarm alongside the normal session read; never delay a phase event.
    void this.read()
  }

  observeEvent(event: LcuJsonApiEvent): void {
    if (!this.active) return
    if (event.eventType === 'Delete' && (
      event.uri === '/lol-champ-select/v1/session' ||
      event.uri === '/lol-lobby-team-builder/champ-select/v1/session'
    )) {
      this.reset()
    } else if (event.uri === SUBSET_CHAMPIONS_PATH) {
      this.dataRevision += 1
      this.result = { ...(event.eventType === 'Delete' ? unavailable() : { status: 200, data: event.data }), source: 'websocket' }
      this.updatedAt = this.lastRequestAt = Date.now()
    }
  }

  read(): Promise<SubsetChampionResult> {
    if (!this.active) return Promise.resolve(unavailable())
    if (Date.now() - this.lastRequestAt < REFRESH_INTERVAL_MS && Date.now() - this.updatedAt < MAX_AGE_MS) {
      return Promise.resolve({ ...this.result, cacheHit: true })
    }
    if (this.inFlight) return this.inFlight
    this.lastRequestAt = Date.now()
    const generation = this.generation
    const dataRevision = this.dataRevision
    const pending = this.request().catch(() => unavailable()).then((result) => {
      if (generation !== this.generation) return unavailable()
      // A newer push (including Delete) wins over an older HTTP response.
      if (dataRevision === this.dataRevision) {
        this.result = { ...result, source: 'http' }
        this.updatedAt = Date.now()
      }
      return { ...this.result, cacheHit: dataRevision !== this.dataRevision }
    }).finally(() => {
      if (this.inFlight === pending) this.inFlight = null
    })
    this.inFlight = pending
    return pending
  }

  async getForSnapshot(): Promise<number[]> {
    if (!this.active) return []
    const generation = this.generation
    const pending = this.read()
    // Cached/pushed cards are immediate. A slow optional endpoint cannot block the existing view.
    if (Date.now() - this.updatedAt >= MAX_AGE_MS) {
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        pending,
        new Promise<void>((resolve) => { timer = setTimeout(resolve, FOREGROUND_WAIT_MS) }),
      ]).finally(() => clearTimeout(timer))
    }
    return generation === this.generation && this.active && Date.now() - this.updatedAt < MAX_AGE_MS
      ? normalizeIds(this.result) : []
  }
}
