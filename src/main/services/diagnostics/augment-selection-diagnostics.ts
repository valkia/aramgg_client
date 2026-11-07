import type { LogEvent } from '../../modules/logger.ts'
import { changedJsonPaths, LIVE_DATA_PATH } from './augment-api-capture.ts'
import type { CaptureRow } from './augment-api-capture.ts'

export const POST_SELECTION_WINDOW_MS = 15000
const HISTORY_MS = 12000
const HISTORY_BYTES = 4 * 1024 * 1024
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const positiveId = (value: unknown): number | null => (typeof value === 'number' || typeof value === 'string') && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null
const ids = (value: unknown): Array<number | null> => [0, 1, 2].map((slot) => Array.isArray(value) ? positiveId(value[slot]) : null)
const time = (value: unknown): number => typeof value === 'string' ? Date.parse(value) : NaN

type Sample = { sequence: unknown; at: number; startedAt: number; data: unknown; bytes: number }
type Panel = { id: number; openedAt: number; lastSeenAt: number; candidateSlots: Array<number | null>; legacyCandidateIds?: number[] }
type Window = { panel: Panel; closedAt: number; baseline: Sample | null; samples: number; hints: Set<string>; possibleIds: Set<number> }

function atPointer(data: unknown, pointer: string): unknown {
  if (pointer === '/') return data
  return pointer.slice(1).split('/').reduce<unknown>((value, key) => value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)[key.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined, data)
}

function preview(value: unknown): unknown {
  if (value === undefined) return { missing: true }
  const text = JSON.stringify(value)
  return text.length > 1500 ? { truncated: true, preview: text.slice(0, 1500) } : value
}

function possibleIds(value: unknown, key = '', depth = 0): number[] {
  if (depth > 4) return []
  if (Array.isArray(value)) return value.slice(0, 16).flatMap((child) => possibleIds(child, key, depth + 1))
  if (value && typeof value === 'object') return Object.entries(value).slice(0, 32).flatMap(([name, child]) => possibleIds(child, name, depth + 1))
  const normalized = key.toLowerCase().replace(/[_-]/g, '')
  const id = positiveId(value)
  return id && /^(id|augmentid|selectedaugmentid|pickedaugmentid|chosenaugmentid|cardid|selectedaugments|pickedaugments)$/.test(normalized) ? [id] : []
}

/** Correlation evidence only: an OCR miss or a stat change never proves a pick. */
export class AugmentSelectionDiagnostics {
  private panel: Panel | null = null
  private pending: Window | null = null
  private history: Sample[] = []
  private counter = 0
  private windows = 0
  private hintWindows = 0

  constructor(private readonly emit: (row: CaptureRow) => void, private readonly focus: (until: number) => void) {}

  get summary() { return { selectionWindows: this.windows, selectionWindowsWithApiHints: this.hintWindows, pendingSelectionWindow: this.pending !== null } }

  observeLog(event: LogEvent): void {
    const at = time(event.observedAt)
    if (!Number.isFinite(at)) return
    const details = record(event.args[0])
    if (event.message === 'Augment selection UI observed' || event.message === 'Augment full detection diagnostics') {
      const slots = event.message === 'Augment selection UI observed' ? ids(details.candidateSlots) : ids(details.currentIds)
      const noCards = typeof details.cardCount === 'number' && details.cardCount <= 0
      // A pixel cue with no readable candidates must not interrupt a pending API observation.
      if (noCards || slots.every((id) => id === null)) {
        this.emit({ kind: 'augment-selection', event: 'visual-cue-unconfirmed', observedAt: event.observedAt,
          candidateSlots: slots, cardCount: typeof details.cardCount === 'number' ? details.cardCount : null,
          relatedSelectionId: this.pending?.panel.id ?? this.panel?.id ?? null,
          completion: 'unconfirmed', reason: noCards ? 'no-recognized-cards' : 'no-readable-candidate-ids',
        })
        return
      }
      if (this.pending) this.finish('panel-reappeared', at)
      if (!this.panel) {
        this.panel = { id: ++this.counter, openedAt: at, lastSeenAt: at, candidateSlots: slots }
        this.write('panel-observed', this.panel, at)
      } else {
        this.panel.lastSeenAt = at
        if (JSON.stringify(slots) !== JSON.stringify(this.panel.candidateSlots)) {
          this.panel.candidateSlots = slots
          this.write('candidates-observed', this.panel, at)
        }
      }
      return
    }
    if (event.message === 'Augment overlay cleared after OCR miss') {
      if (this.pending) return
      const age = typeof details.ageMs === 'number' && Number.isFinite(details.ageMs) && details.ageMs >= 0 ? details.ageMs : null
      const retainedAt = age === null ? at : at - age
      const lastSeenAt = this.panel ? Math.min(this.panel.lastSeenAt, retainedAt) : retainedAt
      const panel = this.panel ?? { id: ++this.counter, openedAt: lastSeenAt, lastSeenAt, candidateSlots: [null, null, null],
        legacyCandidateIds: ids(details.previousIds).filter((id): id is number => id !== null) }
      panel.lastSeenAt = lastSeenAt
      // previousIds is compacted by legacy OCR; never overwrite ordered slot observations with it.
      const baseline = [...this.history].reverse().find((sample) => sample.at <= lastSeenAt && lastSeenAt - sample.at <= HISTORY_MS) ?? null
      this.pending = { panel, closedAt: at, baseline, samples: 0, hints: new Set(), possibleIds: new Set() }
      this.panel = null
      this.windows += 1
      this.write('panel-disappeared', panel, at, {
        completion: 'unconfirmed', selectedAugmentId: null, reason: details.reason,
        lastVisibleAt: new Date(lastSeenAt).toISOString(), baselineSequence: baseline?.sequence ?? null,
        lastVisibleAtSource: 'ocr-observation-or-retention-timestamp',
        baselineAt: baseline ? new Date(baseline.at).toISOString() : null,
        postWindowMs: POST_SELECTION_WINDOW_MS,
      })
      this.focus(at + POST_SELECTION_WINDOW_MS)
      // Include changes between last visible OCR and its delayed clearing notification.
      for (const sample of this.history) if (sample.at > lastSeenAt) this.inspect(sample, true)
    } else if (event.message === 'Augment state cleared') {
      this.reset('ocr-state-reset', at)
    }
    // Hiding our overlay manually is not a selection completion signal.
  }

  observeApi(row: CaptureRow): void {
    if (row.kind !== 'http' || row.path !== LIVE_DATA_PATH) return
    const at = time(row.requestFinishedAt)
    if (!Number.isFinite(at)) return
    if (row.status === 200 && !row.error && row.data && typeof row.data === 'object') {
      const sample = { sequence: row.sequence, at, startedAt: time(row.requestStartedAt), data: row.data, bytes: Buffer.byteLength(JSON.stringify(row.data)) }
      if (sample.bytes <= HISTORY_BYTES) {
        this.history.push(sample)
        let size = this.history.reduce((sum, item) => sum + item.bytes, 0)
        while (this.history.length > 32 || size > HISTORY_BYTES || at - this.history[0].at > HISTORY_MS) size -= this.history.shift()!.bytes
      }
      if (this.pending && at <= this.pending.closedAt + POST_SELECTION_WINDOW_MS) this.inspect(sample, false)
    }
    this.advance(at)
  }

  advance(at: number): void {
    if (this.pending && at >= this.pending.closedAt + POST_SELECTION_WINDOW_MS) this.finish('post-window-complete', at)
  }

  reset(reason: string, at: number): void {
    this.finish(reason, at)
    this.panel = null
    this.history = []
  }

  private inspect(sample: Sample, historical: boolean): void {
    const window = this.pending
    if (!window) return
    window.samples += 1
    const baseline = window.baseline
    const diff = baseline ? changedJsonPaths(baseline.data, sample.data) : { paths: [], truncated: false }
    const changes = diff.paths.filter((path) => path !== '/gameData/gameTime').map((path) => {
      const before = atPointer(baseline?.data, path), after = atPointer(sample.data, path)
      return { path, before: preview(before), after: preview(after) }
    })
    const hints = changes.filter(({ path, after }) => {
      const normalizedPath = path.toLowerCase()
      const eventName = record(after).EventName ?? (path.endsWith('/EventName') ? after : null)
      return /augment|hextech/.test(normalizedPath)
        || (typeof eventName === 'string' && /augment|hextech/i.test(eventName))
    }).map((change) => {
      const eventName = String(record(change.after).EventName ?? '')
      const selectionNamed = /select|pick|chos|choos|acquir|grant|owned/i.test(change.path + eventName)
      const idHints = selectionNamed ? possibleIds(change.after, change.path.split('/').at(-1)) : []
      for (const id of idHints) window.possibleIds.add(id)
      window.hints.add(change.path)
      return { ...change, selectionNamed, possibleAugmentIds: idHints, semanticsVerified: false }
    })
    this.write('post-selection-sample', window.panel, sample.at, {
      completion: 'unconfirmed', selectedAugmentId: null, httpSequence: sample.sequence,
      baselineSequence: baseline?.sequence ?? null, baselineMissing: !baseline,
      requestStartedAt: Number.isFinite(sample.startedAt) ? new Date(sample.startedAt).toISOString() : null,
      relativeToDisappearanceMs: sample.at - window.closedAt, historical,
      changes: changes.slice(0, 40), changesTruncated: diff.truncated || changes.length > 40,
      apiHints: hints.slice(0, 16), apiHintsTruncated: hints.length > 16,
    })
  }

  private finish(reason: string, at: number): void {
    if (!this.pending) return
    const window = this.pending
    this.pending = null
    this.focus(0)
    if (window.hints.size) this.hintWindows += 1
    this.write('selection-window-summary', window.panel, at, {
      reason, completion: 'unconfirmed', selectedAugmentId: null, samples: window.samples,
      baselineSequence: window.baseline?.sequence ?? null, apiHintPaths: [...window.hints],
      possibleAugmentIds: [...window.possibleIds],
      conclusion: reason === 'panel-reappeared' ? 'panel-reappeared-not-a-confirmed-pick'
        : reason !== 'post-window-complete' ? 'observation-interrupted'
          : !window.baseline ? 'insufficient-baseline'
            : window.hints.size ? 'api-hints-require-verification' : 'no-direct-api-signal-observed',
    })
  }

  private write(event: string, panel: Panel, at: number, details: CaptureRow = {}): void {
    this.emit({ kind: 'augment-selection', event, selectionId: panel.id, observedAt: new Date(at).toISOString(),
      candidateSlots: panel.candidateSlots, candidateIdsWithoutSlot: panel.legacyCandidateIds,
      panelFirstObservedAt: new Date(panel.openedAt).toISOString(), ...details })
  }
}
