import { describe, expect, it, vi } from 'vitest'
import { AugmentSelectionDiagnostics, POST_SELECTION_WINDOW_MS } from '../../src/main/services/diagnostics/augment-selection-diagnostics.ts'
import { LIVE_DATA_PATH } from '../../src/main/services/diagnostics/augment-api-capture.ts'
import type { CaptureRow } from '../../src/main/services/diagnostics/augment-api-capture.ts'

const iso = (ms: number) => new Date(ms).toISOString()
const body = (critChance = 0) => ({ activePlayer: { championStats: { critChance }, currentGold: 1400 }, events: { Events: [] }, gameData: { gameTime: 0 } })
function setup() {
  const rows: CaptureRow[] = [], focus = vi.fn()
  const diagnostic = new AugmentSelectionDiagnostics((row) => rows.push(row), focus)
  const api = (ms: number, data: unknown, status = 200) => diagnostic.observeApi({ kind: 'http', path: LIVE_DATA_PATH, status, sequence: ms, requestStartedAt: iso(ms - 1), requestFinishedAt: iso(ms), data })
  const log = (ms: number, message: string, details: Record<string, unknown>) => diagnostic.observeLog({ observedAt: iso(ms), message, args: [details], level: 'DEBUG' })
  const visible = (ms: number, slots: Array<number | null> = [1413, null, 1048]) => log(ms, 'Augment selection UI observed', { candidateSlots: slots })
  const disappear = (ms: number, ageMs: number | null = 2000) => log(ms, 'Augment overlay cleared after OCR miss', { reason: 'no-augments-detected', ageMs, previousIds: [1413, 1048] })
  return { diagnostic, rows, focus, api, log, visible, disappear }
}

describe('augment selection completion investigation', () => {
  it('keeps empty visual cues from creating a panel, replacing candidates or refreshing the last readable frame', () => {
    const { api, visible, log, disappear, rows } = setup()
    visible(500, [null, null, null])
    expect(rows).toEqual([expect.objectContaining({ event: 'visual-cue-unconfirmed', relatedSelectionId: null })])
    api(1000, body()); visible(1200)
    api(3000, body(0.25))
    log(3500, 'Augment selection UI observed', { candidateSlots: [null, null, null], cardCount: 0 })
    log(3600, 'Augment full detection diagnostics', { currentIds: [] })
    disappear(4200, 0)
    expect(rows.filter((row) => row.event === 'panel-observed')).toHaveLength(1)
    expect(rows.find((row) => row.event === 'panel-disappeared')).toMatchObject({
      selectionId: 1, candidateSlots: [1413, null, 1048], lastVisibleAt: iso(1200), baselineSequence: 1000,
    })
  })

  it('keeps a post-selection window running through empty cues and still accepts a later readable panel', () => {
    const { api, visible, log, disappear, diagnostic, rows, focus } = setup()
    api(1000, body()); visible(1200); disappear(3200)
    log(5000, 'Augment selection UI observed', { candidateSlots: [1413, null, 1048], cardCount: 0 })
    visible(10000, [null, null, null])
    expect(diagnostic.summary.pendingSelectionWindow).toBe(true)
    expect(focus).toHaveBeenLastCalledWith(18200)
    api(17500, body(0.25))
    diagnostic.advance(18200)
    expect(rows.at(-1)).toMatchObject({ event: 'selection-window-summary', reason: 'post-window-complete', completion: 'unconfirmed' })
    log(19000, 'Augment full detection diagnostics', { currentIds: [1413, null, 1048] })
    disappear(21000)
    log(22000, 'Augment selection UI observed', { candidateSlots: [2005, 1079, null], cardCount: 2 })
    expect(rows.filter((row) => row.event === 'selection-window-summary').at(-1)).toMatchObject({ reason: 'panel-reappeared' })
    expect(rows.at(-1)).toMatchObject({ event: 'panel-observed', candidateSlots: [2005, 1079, null] })
  })

  it('preserves slot order and captures changes before delayed OCR clearing without asserting a selected ID', () => {
    const { api, visible, disappear, diagnostic, rows, focus } = setup()
    api(1000, body())
    visible(1200)
    visible(2200)
    api(3000, body(0.25))
    disappear(4200)
    expect(focus).toHaveBeenCalledWith(4200 + POST_SELECTION_WINDOW_MS)
    const sample = rows.find((row) => row.event === 'post-selection-sample')!
    expect(sample).toMatchObject({ candidateSlots: [1413, null, 1048], completion: 'unconfirmed', selectedAugmentId: null,
      historical: true, baselineSequence: 1000, httpSequence: 3000, relativeToDisappearanceMs: -1200,
      changes: [{ path: '/activePlayer/championStats/critChance', before: 0, after: 0.25 }], apiHints: [] })
    api(19500, body(0.25))
    expect(rows.at(-1)).toMatchObject({ event: 'selection-window-summary', selectedAugmentId: null, possibleAugmentIds: [], conclusion: 'no-direct-api-signal-observed' })
    expect(diagnostic.summary.pendingSelectionWindow).toBe(false)
  })

  it('records named selection fields and ID-free completion events as unverified API hints', () => {
    const { api, visible, disappear, rows, diagnostic } = setup()
    api(1000, body()); visible(1200); disappear(3200)
    api(4000, { ...body(), activePlayer: { selectedAugmentId: 1048, currentGold: 1413 }, events: { Events: [{ EventID: 7, EventName: 'AugmentSelectionCompleted' }] } })
    const sample = rows.find((row) => row.event === 'post-selection-sample')!
    expect(sample).toMatchObject({ completion: 'unconfirmed', selectedAugmentId: null, apiHints: expect.arrayContaining([
      expect.objectContaining({ path: '/activePlayer/selectedAugmentId', after: 1048, possibleAugmentIds: [1048], semanticsVerified: false }),
      expect.objectContaining({ path: '/events/Events/0', possibleAugmentIds: [], selectionNamed: true }),
    ]) })
    api(4499, { ...body(), activePlayer: { selectedAugmentId: 2077 } })
    diagnostic.advance(19000)
    expect(rows.at(-1)).toMatchObject({ possibleAugmentIds: [1048, 2077], conclusion: 'api-hints-require-verification' })
  })

  it('does not confuse offered IDs, gold, manual hiding, rerolls or reappearing panels with completion', () => {
    const { api, visible, disappear, log, rows, diagnostic } = setup()
    api(1000, body()); visible(1200)
    log(1300, 'Augment overlay manually hidden; suppressing immediate reshows', { augmentIds: [1413, 1048] })
    visible(2000, [1358, 2140, 2077])
    expect(rows.some((row) => row.event === 'panel-disappeared')).toBe(false)
    disappear(4000)
    api(4500, { ...body(), offeredAugments: [1358, 2140, 2077] })
    visible(5000, [1358, 2140, 2077])
    expect(rows.find((row) => row.event === 'selection-window-summary')).toMatchObject({ completion: 'unconfirmed', possibleAugmentIds: [], conclusion: 'panel-reappeared-not-a-confirmed-pick' })
    expect(diagnostic.summary.pendingSelectionWindow).toBe(false)
  })

  it('keeps missing, null and false distinct and never infers an ID from a boolean', () => {
    const { api, visible, disappear, rows } = setup()
    api(1000, { ...body(), selectedAugment: null }); visible(1200); disappear(3200)
    api(4000, { ...body(), selectedAugment: false })
    expect(rows.find((row) => row.event === 'post-selection-sample')).toMatchObject({
      changes: [{ path: '/selectedAugment', before: null, after: false }],
      apiHints: [expect.objectContaining({ possibleAugmentIds: [] })],
    })
  })

  it('does not assign slots to the compacted IDs in an old partial OCR log', () => {
    const { api, disappear, rows } = setup()
    api(1000, body()); disappear(3200)
    expect(rows[0]).toMatchObject({ event: 'panel-disappeared', candidateSlots: [null, null, null], candidateIdsWithoutSlot: [1413, 1048] })
  })

  it('reports missing coverage and interruption rather than negative completion evidence', () => {
    const { api, visible, disappear, rows, diagnostic } = setup()
    visible(1200); disappear(3200)
    api(4000, body())
    expect(rows.find((row) => row.event === 'post-selection-sample')).toMatchObject({ baselineMissing: true, baselineSequence: null })
    diagnostic.advance(19000)
    expect(rows.at(-1)?.conclusion).toBe('insufficient-baseline')
    visible(20000); disappear(22000)
    diagnostic.reset('gameflow:EndOfGame', 23000)
    expect(rows.at(-1)).toMatchObject({ reason: 'gameflow:EndOfGame', conclusion: 'observation-interrupted' })
  })

  it('does not carry a baseline across matches, accepts failures without using their bodies, and bounds history', () => {
    const { api, visible, disappear, diagnostic, rows } = setup()
    api(1000, body())
    diagnostic.reset('new-match', 2000)
    api(3000, { selectedAugmentId: 1048 }, 404)
    visible(3200); disappear(5200)
    api(6000, body()); diagnostic.advance(21000)
    expect(rows.at(-1)).toMatchObject({ baselineSequence: null, possibleAugmentIds: [] })
    api(30000, body())
    for (let ms = 40000; ms <= 60000; ms += 500) api(ms, body())
    visible(60001); disappear(62001)
    expect(rows.at(-1)).toMatchObject({ event: 'panel-disappeared', baselineSequence: 60000 })
  })
})
