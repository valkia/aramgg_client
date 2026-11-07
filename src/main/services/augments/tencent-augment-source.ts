import { createTencentLogKey, decodeTencentLogLine, isTencentRegion } from './tencent-log-codec.ts'
import { TencentLogTail } from './tencent-log-tail.ts'
import { TencentAugmentState, TENCENT_SOURCE_STALE_MS } from './tencent-augment-state.ts'
import type { AugmentEntry } from './tencent-augment-state.ts'

type Identity = { region: string; puuid: string }
const FILE_CHANGE_MIN_INTERVAL_MS = 50
const FILE_WATCH_RETRY_MS = 60_000
export type TencentCandidateTiming = { observedAt: number; receivedAt: number }
type Options = {
  supported: boolean
  readIdentity: () => Promise<Identity | null>
  locate: () => Promise<string | null>
  watch?: (file: string, changed: () => void, failed: () => void) => () => void
  catalogue: () => Promise<AugmentEntry[]>
  selected: (details: { at: number; index: number; key: string | null; id: number | null }) => void
  candidatesReady?: (timing: TencentCandidateTiming) => void
  diagnostic: (event: string, details: Record<string, unknown>) => void
  now?: () => number
}

/** Optional local source. Its failures never stop the screenshot/OCR service. */
export class TencentAugmentSource {
  private readonly state = new TencentAugmentState()
  private readonly now: () => number
  private active = false
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending: Promise<void> | null = null
  private cataloguePending: Promise<void> | null = null
  private since = 0
  private refreshAt = 0
  private identity: Identity | null = null
  private key: Buffer | null = null
  private tail: TencentLogTail | null = null
  private entries: AugmentEntry[] = []
  private lastStatus = ''
  private announcedCandidates = ''
  private candidateReceivedAt = 0
  private stopWatch: (() => void) | null = null
  private watchRevision = 0
  private watchRetryAt = 0
  private watchedFile: string | null = null
  private fileChangePending = false
  private lastReadStartedAt = 0

  constructor(private readonly options: Options) { this.now = options.now ?? Date.now }

  start(): void {
    if (this.active) return
    if (!this.options.supported) { this.status('unsupported-platform'); return }
    this.active = true
    this.generation++
    this.since = this.now()
    this.refreshAt = 0
    this.watchRetryAt = 0
    this.schedule(0)
  }

  stop(): void {
    this.active = false
    this.generation++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.closeWatch()
    this.watchedFile = null
    this.fileChangePending = false
    this.identity = null
    this.key?.fill(0)
    this.key = null
    this.tail = null
    this.entries = []
    this.clearState()
  }

  getCandidates(): AugmentEntry[] | null {
    if (!this.active) return null
    const candidates = this.state.getCandidates(this.now(), this.entries)
    if (candidates) this.status('ready')
    else {
      this.announcedCandidates = ''
      if (this.lastStatus === 'ready') this.status('ocr-fallback')
    }
    return candidates
  }

  private clearState(): void {
    this.state.reset()
    this.announcedCandidates = ''
    this.candidateReceivedAt = 0
  }

  private announceCandidates(): void {
    const candidates = this.getCandidates()
    const observedAt = this.state.candidateObservedAt
    if (!candidates || observedAt === null) return
    const signature = JSON.stringify(candidates.map(a => [a.key, a.id]))
    if (signature === this.announcedCandidates) return
    this.announcedCandidates = signature
    this.options.candidatesReady?.({ observedAt, receivedAt: this.candidateReceivedAt })
  }

  /** Public for isolated file-backed regression tests; calls remain serialized. */
  poll(): Promise<void> {
    if (this.pending) return this.pending
    const generation = this.generation
    this.lastReadStartedAt = this.now()
    this.pending = this.read(generation).finally(() => { this.pending = null })
    return this.pending
  }

  private current(generation: number): boolean { return this.active && generation === this.generation }

  private schedule(delay: number): void {
    if (!this.active) return
    if (this.timer) clearTimeout(this.timer)
    const generation = this.generation
    this.timer = setTimeout(() => {
      this.timer = null
      this.fileChangePending = false
      void this.poll().finally(() => {
        if (!this.current(generation)) return
        this.schedule(this.fileChangePending ? this.fileChangeDelay() : this.tail ? 500 : 5000)
      })
    }, delay)
    this.timer.unref?.()
  }

  private fileChangeDelay(): number {
    return Math.max(0, FILE_CHANGE_MIN_INTERVAL_MS - (this.now() - this.lastReadStartedAt))
  }

  private closeWatch(): void {
    this.watchRevision++
    const close = this.stopWatch
    this.stopWatch = null
    try { close?.() } catch { /* Polling remains independent of OS watcher teardown. */ }
  }

  private ensureWatch(generation: number): void {
    if (!this.options.watch || !this.watchedFile || this.stopWatch || this.now() < this.watchRetryAt) return
    const revision = ++this.watchRevision
    const current = () => this.current(generation) && revision === this.watchRevision
    const failed = () => {
      if (!current()) return
      this.closeWatch()
      this.watchRetryAt = this.now() + FILE_WATCH_RETRY_MS
      this.options.diagnostic('file-watch-status', { enabled: false, fallback: 'polling' })
    }
    try {
      const close = this.options.watch(this.watchedFile, () => {
        if (!current()) return
        this.fileChangePending = true
        // Coalesce bursts and never overlap a slow read/identity refresh.
        if (!this.pending) this.schedule(this.fileChangeDelay())
      }, failed)
      if (!current()) { close(); return }
      this.stopWatch = close
      this.options.diagnostic('file-watch-status', { enabled: true, fallback: 'polling' })
    } catch { failed() }
  }

  private status(reason: string): void {
    if (reason === this.lastStatus) return
    this.lastStatus = reason
    this.options.diagnostic('source-status', { source: reason === 'ready' ? 'tencent-log' : 'ocr', reason })
  }

  private refreshCatalogue(generation: number): void {
    if (this.cataloguePending) return
    // A data download must not delay reading a local pick; its ID can remain null.
    this.cataloguePending = (async () => {
      try {
        const entries = await this.options.catalogue()
        if (this.current(generation)) {
          this.entries = entries
          this.announceCandidates()
        }
      } catch {
        if (!this.current(generation)) return
        this.entries = []
        this.status('catalogue-unavailable')
      }
    })().finally(() => { this.cataloguePending = null })
  }

  private async read(generation: number): Promise<void> {
    if (!this.current(generation)) return
    try {
      if (this.now() >= this.refreshAt) {
        this.refreshAt = this.now() + 15_000
        const identity = await this.options.readIdentity()
        if (!this.current(generation)) return
        if (!identity || !isTencentRegion(identity.region) || !/^[A-Za-z0-9_-]{5,128}$/.test(identity.puuid)) {
          this.since = this.now()
          this.clearState()
          this.tail = null
          this.closeWatch()
          this.watchedFile = null
          this.key?.fill(0)
          this.key = null
          this.identity = null
          this.entries = []
          this.status(identity && !isTencentRegion(identity.region) ? 'non-tencent-region' : 'identity-unavailable')
          return
        }
        if (this.identity?.puuid !== identity.puuid) {
          if (this.identity) this.since = this.now()
          this.clearState()
          this.tail = null
          this.closeWatch()
          this.watchedFile = null
          this.key?.fill(0)
          this.key = createTencentLogKey(identity.puuid)
          this.identity = identity
        }
        this.refreshCatalogue(generation)
      }
      if (!this.key) return
      if (!this.tail) {
        const file = await this.options.locate()
        if (!this.current(generation)) return
        if (!file) { this.clearState(); this.status('logs-unavailable'); return }
        this.tail = new TencentLogTail(file)
        this.watchedFile = file
      }
      this.ensureWatch(generation)
      const batch = await this.tail.read()
      if (!this.current(generation)) return
      if (batch.reset) {
        this.clearState()
        // Never replay a prior pick/candidate from a replaced or truncated file.
        this.since = this.now()
        this.status('log-reset')
      }
      for (const line of batch.lines) {
        const record = decodeTencentLogLine(line, this.key)
        if (!record || record.at < this.since || this.now() - record.at > TENCENT_SOURCE_STALE_MS || record.at > this.now() + 2000) continue
        this.state.heartbeat(record.at)
        if (!record.event) continue
        const selection = this.state.observe(record.event)
        if (record.event.kind === 'candidates' && this.state.candidateObservedAt === record.at) this.candidateReceivedAt = this.now()
        this.options.diagnostic('event', { observedAt: new Date(record.at).toISOString(), ...record.event })
        if (selection?.selected) {
          const matches = this.entries.filter(a => a.key === selection.key)
          const id = matches.length === 1 && Number.isSafeInteger(Number(matches[0].id)) && Number(matches[0].id) > 0 ? Number(matches[0].id) : null
          this.options.selected({ at: record.at, index: selection.index!, key: selection.key, id })
        }
      }
      this.announceCandidates()
    } catch {
      if (!this.current(generation)) return
      this.clearState()
      this.since = this.now()
      this.tail = null
      this.closeWatch()
      this.watchedFile = null
      this.entries = []
      this.refreshAt = this.now() + 5000
      this.status('read-or-decode-unavailable')
    }
  }
}
