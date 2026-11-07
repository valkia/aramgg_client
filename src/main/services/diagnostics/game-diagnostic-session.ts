import { mkdir, open, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { LogEvent } from '../../modules/logger.ts'
import { AugmentApiCapture, createDiagnosticSanitizer } from './augment-api-capture.ts'
import type { CaptureRead, CaptureRow } from './augment-api-capture.ts'
import { AugmentSelectionDiagnostics } from './augment-selection-diagnostics.ts'
import { GameEventCapture } from './game-event-capture.ts'

const GAME_PHASES = new Set(['GameStart', 'InProgress', 'Reconnect'])
const OCR_MESSAGES = [
  'Augment detected:', 'Augment partial update accepted:', 'Augment partial initial accepted:',
  'Augment full detection diagnostics', 'Augment state cleared',
  'Augment overlay cleared after OCR miss', 'Augment overlay manually hidden;',
  'Auto screenshot capture mode changed',
  'Augment selection UI observed',
  'Augment detection notification sent',
]
type EventCapture = Pick<GameEventCapture, 'setActive' | 'stop'> & { readonly summary: Record<string, unknown> }

type Options = {
  directory: string
  read: CaptureRead
  closeReader: () => void
  subscribe: (listener: (event: LogEvent) => void) => () => void
  notify: (message: string, details: Record<string, unknown>) => void
  metadata?: Record<string, unknown>
  byteLimit?: number
  pendingByteLimit?: number
  durationMs?: number
  createEventCapture?: (emit: (row: CaptureRow) => Promise<void>) => EventCapture
}

/** One ordered timeline for champion cards, game APIs and existing OCR observations. */
export class GameDiagnosticSession {
  private readonly options: Options
  private readonly capture: AugmentApiCapture
  private readonly selection: AugmentSelectionDiagnostics
  private readonly events: EventCapture
  private readonly sanitize = createDiagnosticSanitizer()
  private readonly startedAt = new Date().toISOString()
  private readonly file: ReturnType<typeof open>
  private readonly unsubscribe: () => void
  private readonly byteLimit: number
  private readonly pendingByteLimit: number
  private readonly durationMs: number
  private writeQueue: Promise<void> = Promise.resolve()
  private bytesWritten = 0
  private pendingBytes = 0
  private recordsWritten = 0
  private phase: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private deadline: ReturnType<typeof setTimeout> | null = null
  private deadlineStarted = false
  private tickInFlight: Promise<void> | null = null
  private stopping: Promise<void> | null = null
  private stopReason = ''
  private eventActivationPending = false

  constructor(options: Options) {
    this.options = options
    this.byteLimit = options.byteLimit ?? 128 * 1024 * 1024
    this.pendingByteLimit = options.pendingByteLimit ?? 8 * 1024 * 1024
    this.durationMs = options.durationMs ?? 2 * 60 * 60 * 1000
    this.file = mkdir(options.directory, { recursive: true })
      .then(() => open(path.join(options.directory, 'capture.jsonl'), 'wx'))
    this.selection = new AugmentSelectionDiagnostics((row) => { void this.emit(row) }, (until) => this.capture.focusAfterSelection(until))
    this.capture = new AugmentApiCapture({
      read: options.read,
      emit: async (row) => {
        await this.emit(row)
        if (row.kind === 'segment' && Number(row.segment) > 1) this.selection.reset('api-segment-changed', Date.now())
        this.selection.observeApi(row)
      },
      notify: (message) => options.notify(message, { directory: options.directory }),
    })
    this.events = options.createEventCapture?.((row) => this.emit(row))
      ?? new GameEventCapture({ emit: (row) => this.emit(row) })
    this.unsubscribe = options.subscribe((event) => this.observeLog(event))
    void this.emit({ kind: 'capture-start', protocolVersion: 5, startedAt: this.startedAt,
      ...options.metadata, byteLimit: this.byteLimit, durationMs: this.durationMs,
      origin: 'https://127.0.0.1:2999', method: 'GET', intervalMs: 500,
      scope: ['champ-select', 'game-api', 'ocr', 'augment-selection-completion', 'experimental-game-events', 'tencent-augment-log'],
      eventOrigin: 'wss://127.0.0.1:2999/', eventProtocol: 'wamp', eventActivation: 'first-successful-game-http',
      note: 'Duration starts at first champion selection or game phase. OCR is an observation, not proof of API availability.',
    })
  }

  /** Also useful for verifying disk readiness without starting a game request. */
  async flush(): Promise<void> { await this.writeQueue }

  observePhase(phase: string, source: string): void {
    if (this.stopReason || phase === this.phase) return
    const previousPhase = this.phase
    this.phase = phase
    if (!GAME_PHASES.has(phase)) this.selection.reset(`gameflow:${phase}`, Date.now())
    if (GAME_PHASES.has(phase) && !GAME_PHASES.has(previousPhase ?? '')) {
      this.capture.markGameBoundary()
      this.eventActivationPending = true
    }
    void this.emit({ kind: 'gameflow', previousPhase, phase, source })
    if (!GAME_PHASES.has(phase)) {
      this.eventActivationPending = false
      this.events.setActive(false)
    }
    if (!this.deadlineStarted && (phase === 'ChampSelect' || GAME_PHASES.has(phase))) {
      this.deadlineStarted = true
      this.deadline = setTimeout(() => { void this.stop('duration-limit') }, this.durationMs)
      this.deadline.unref?.()
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (GAME_PHASES.has(phase) && !this.tickInFlight) this.schedule(0)
  }

  private observeLog(event: LogEvent): void {
    if (event.message === '[tencent augments]') {
      void this.emit({ kind: 'client-log', source: 'tencent-log', ...event, args: this.sanitize(event.args) })
      return
    }
    const champion = event.message.startsWith('[champ-select diagnostics]')
      || event.message === '[LCU] ARAM bench recommendation completed'
    const ocr = OCR_MESSAGES.some((prefix) => event.message.startsWith(prefix))
    if (!champion && !ocr) return
    void this.emit({ kind: 'client-log', source: champion ? 'champ-select' : 'ocr',
      ...event, args: this.sanitize(event.args) })
    if (ocr && this.phase === 'InProgress') this.selection.observeLog(event)
  }

  private schedule(delay: number): void {
    if (this.stopReason || !GAME_PHASES.has(this.phase ?? '')) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.tickInFlight = this.tick().finally(() => { this.tickInFlight = null })
    }, delay)
    this.timer.unref?.()
  }

  private async tick(): Promise<void> {
    const startedAt = Date.now()
    try {
      const online = await this.capture.step()
      // Wait for the game server so startup time does not consume the bounded WS attempts.
      if (online && this.eventActivationPending && !this.stopReason && GAME_PHASES.has(this.phase ?? '')) {
        this.eventActivationPending = false
        this.events.setActive(true)
      }
      this.selection.advance(Date.now())
      this.schedule(Math.max(0, (online ? 500 : 2000) - (Date.now() - startedAt)))
    } catch {
      void this.stop('capture-error')
    }
  }

  private emit(row: CaptureRow): Promise<void> {
    if (this.stopReason) return Promise.resolve()
    const line = JSON.stringify({ capturedAt: new Date().toISOString(), phase: this.phase, ...row }) + '\n'
    const bytes = Buffer.byteLength(line)
    if (this.bytesWritten + this.pendingBytes + bytes > this.byteLimit) {
      void this.stop('output-byte-limit')
      return Promise.resolve()
    }
    if (this.pendingBytes + bytes > this.pendingByteLimit) {
      void this.stop('write-backlog-limit')
      return Promise.resolve()
    }
    this.pendingBytes += bytes
    this.writeQueue = this.writeQueue.then(async () => {
      await (await this.file).writeFile(line, 'utf8')
      this.bytesWritten += bytes
      this.recordsWritten += 1
    }).catch(() => {
      void this.stop('write-error')
    }).finally(() => { this.pendingBytes -= bytes })
    return this.writeQueue
  }

  stop(reason = 'app-quit'): Promise<void> {
    if (this.stopping) return this.stopping
    this.stopReason = reason
    this.eventActivationPending = false
    this.events.stop()
    this.unsubscribe()
    if (this.timer) clearTimeout(this.timer)
    if (this.deadline) clearTimeout(this.deadline)
    this.timer = this.deadline = null
    // Wait for bounded in-flight requests before closing the file; no new cycle is scheduled.
    this.stopping = this.finish()
    return this.stopping
  }

  private async finish(): Promise<void> {
    try {
      await this.tickInFlight
      this.options.closeReader()
      await this.writeQueue
      await (await this.file).close()
      await writeFile(path.join(this.options.directory, 'summary.json'), JSON.stringify({
        startedAt: this.startedAt, finishedAt: new Date().toISOString(), stopReason: this.stopReason,
        bytesWritten: this.bytesWritten, recordsWritten: this.recordsWritten, ...this.capture.summary, ...this.selection.summary,
        gameEvents: this.events.summary,
      }, null, 2))
    } catch {
      this.options.closeReader()
      this.stopReason = 'write-error'
    }
    this.options.notify('统一诊断采集结束', { reason: this.stopReason, directory: this.options.directory })
  }
}
