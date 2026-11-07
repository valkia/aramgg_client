import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogEvent } from '../../src/main/modules/logger.ts'
import type { ApiResponse } from '../../src/main/services/diagnostics/augment-api-capture.ts'
import type { CaptureRow } from '../../src/main/services/diagnostics/augment-api-capture.ts'
import { GameDiagnosticSession } from '../../src/main/services/diagnostics/game-diagnostic-session.ts'

let directory: string
let session: GameDiagnosticSession
let listener: ((event: LogEvent) => void) | null
const reply = (endpoint: string): ApiResponse => ({
  path: endpoint, status: 200, bytes: 100, durationMs: 1,
  requestStartedAt: new Date().toISOString(), requestFinishedAt: new Date().toISOString(),
  data: { gameData: { gameTime: 10, gameMode: 'ARAM' }, unknownChoices: [300, 100, 200] },
})
const read = vi.fn(async (endpoint: string) => reply(endpoint))
const closeReader = vi.fn()
const notify = vi.fn()
const eventCapture = { setActive: vi.fn(), stop: vi.fn(), summary: { experimental: true } }
let emitGameEvent: (row: CaptureRow) => Promise<void>
function log(message: string, args: unknown[] = [], level: LogEvent['level'] = 'INFO') {
  listener?.({ observedAt: new Date().toISOString(), level, message, args })
}
async function rows() {
  return (await readFile(path.join(directory, 'capture.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
}
async function summary() { return JSON.parse(await readFile(path.join(directory, 'summary.json'), 'utf8')) }
function start(limits: { byteLimit?: number; pendingByteLimit?: number; durationMs?: number } = {}) {
  session = new GameDiagnosticSession({
    directory, read, closeReader, notify, ...limits,
    createEventCapture: (emit) => { emitGameEvent = emit; return eventCapture },
    subscribe: (callback) => { listener = callback; return () => { listener = null } },
  })
  return session.flush()
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'aramgg-unified-diagnostics-'))
  vi.useFakeTimers()
  read.mockImplementation(async (endpoint: string) => reply(endpoint))
})
afterEach(async () => {
  await session?.stop('test-cleanup')
  vi.useRealTimers()
  await rm(directory, { recursive: true, force: true })
})

describe('unified client diagnostic session', () => {
  it('includes Tencent candidates and confirmed selections in the existing capture', async () => {
    await start()
    log('[tencent augments]', [{ event: 'source-status', source: 'ocr', reason: 'logs-unavailable' }], 'DEBUG')
    log('[tencent augments]', [{ event: 'candidates-applied', candidateSlots: [2005, 1079, 1361] }], 'DEBUG')
    log('[tencent augments]', [{ event: 'selection-completed', candidateIndex: 2, augmentKey: 'ARAM_Quest_VoidImmolation', selectedAugmentId: null, puuid: 'private-player-id' }], 'DEBUG')
    await session.stop()
    const captured = await rows()
    const records = captured.filter(row => row.source === 'tencent-log')
    expect(records).toHaveLength(3)
    expect(records.every(row => row.kind === 'client-log')).toBe(true)
    expect(records[2].args[0]).toMatchObject({ event: 'selection-completed', candidateIndex: 2, augmentKey: 'ARAM_Quest_VoidImmolation', selectedAugmentId: null })
    expect(JSON.stringify(captured)).not.toContain('private-player-id')
  })

  it('writes champion cards, game responses and DEBUG OCR observations into one ordered file', async () => {
    await start()
    session.observePhase('ChampSelect', 'websocket')
    log('[champ-select diagnostics] subset-http', [{ championIds: [22, 51, 222], token: 'private-token' }])
    log('unrelated diagnostic', [{ privateField: 'must-not-be-copied' }])
    await vi.advanceTimersByTimeAsync(5000)
    expect(read).not.toHaveBeenCalled()
    session.observePhase('InProgress', 'websocket')
    log('Augment full detection diagnostics', [{ currentIds: [300, 100, 200], changedSlots: [1] }], 'DEBUG')
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(1))
    session.observePhase('EndOfGame', 'websocket')
    await session.stop('app-quit')
    const captured = await rows()
    expect(captured.filter((row) => row.kind === 'client-log').map((row) => row.source)).toEqual(['champ-select', 'ocr'])
    expect(captured.find((row) => row.source === 'champ-select').args[0]).toEqual({ championIds: [22, 51, 222], token: '[redacted]' })
    expect(captured.find((row) => row.source === 'ocr')).toMatchObject({ level: 'DEBUG', args: [{ currentIds: [300, 100, 200], changedSlots: [1] }] })
    expect(captured.find((row) => row.kind === 'http').data.unknownChoices).toEqual([300, 100, 200])
    expect(JSON.stringify(captured)).not.toContain('must-not-be-copied')
    expect(captured.every((row) => typeof row.capturedAt === 'string')).toBe(true)
    expect((await summary()).recordsWritten).toBe(captured.length)
    expect(listener).toBeNull()
    expect(closeReader).toHaveBeenCalledOnce()
    const count = read.mock.calls.length
    await vi.advanceTimersByTimeAsync(10000)
    expect(read).toHaveBeenCalledTimes(count)
  })

  it('does not overlap a slow request and waits for it when quitting', async () => {
    await start()
    let resolve!: (response: ApiResponse) => void
    read.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    session.observePhase('InProgress', 'startup')
    await vi.advanceTimersByTimeAsync(10000)
    expect(read).toHaveBeenCalledOnce()
    expect(eventCapture.setActive).not.toHaveBeenCalledWith(true)
    const stopping = session.stop('app-quit')
    expect(closeReader).not.toHaveBeenCalled()
    expect(session.stop('duplicate')).toBe(stopping)
    resolve({ ...reply('/liveclientdata/allgamedata'), status: null, error: 'ECONNREFUSED' })
    await stopping
    expect(closeReader).toHaveBeenCalledOnce()
    expect((await summary()).stopReason).toBe('app-quit')
  })

  it('captures experimental events in the same timeline only after game HTTP is online and closes at phase exit', async () => {
    await start()
    read.mockImplementation(async (endpoint) => ({ ...reply(endpoint), status: null, error: 'ECONNREFUSED' }))
    session.observePhase('GameStart', 'websocket')
    await vi.advanceTimersByTimeAsync(0)
    expect(eventCapture.setActive).not.toHaveBeenCalledWith(true)
    read.mockImplementation(async (endpoint) => reply(endpoint))
    await vi.advanceTimersByTimeAsync(2000)
    await vi.waitFor(() => expect(eventCapture.setActive).toHaveBeenCalledWith(true))
    await emitGameEvent({ kind: 'game-event', event: 'event-observed', topic: 'OnAugmentSelected', experimental: true, completion: 'unconfirmed', data: { id: 1048 } })
    session.observePhase('EndOfGame', 'websocket')
    expect(eventCapture.setActive).toHaveBeenLastCalledWith(false)
    await session.stop()
    expect(eventCapture.stop).toHaveBeenCalledOnce()
    await emitGameEvent({ kind: 'game-event', event: 'late-event-must-be-ignored' })
    const events = (await rows()).filter((row) => row.kind === 'game-event')
    expect(events).toEqual([expect.objectContaining({ event: 'event-observed', completion: 'unconfirmed', data: { id: 1048 } })])
    expect((await summary()).gameEvents).toEqual({ experimental: true })
  })

  it('adds selection-completion observations to the same file without claiming an OCR disappearance is a pick', async () => {
    await start()
    session.observePhase('InProgress', 'websocket')
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(1))
    log('Augment selection UI observed', [{ candidateSlots: [1413, null, 1048] }], 'DEBUG')
    log('Augment overlay manually hidden; suppressing immediate reshows')
    log('Augment overlay cleared after OCR miss', [{ ageMs: 0, previousIds: [1413, 1048], reason: 'no-augments-detected' }])
    await session.flush()
    session.observePhase('EndOfGame', 'websocket')
    await session.stop('app-quit')
    const selection = (await rows()).filter((row) => row.kind === 'augment-selection')
    expect(selection.map((row) => row.event)).toEqual(['panel-observed', 'panel-disappeared', 'selection-window-summary'])
    expect(selection[1]).toMatchObject({ candidateSlots: [1413, null, 1048], selectedAugmentId: null, completion: 'unconfirmed' })
    expect(selection[2]).toMatchObject({ reason: 'gameflow:EndOfGame', conclusion: 'observation-interrupted' })
    expect(await summary()).toMatchObject({ selectionWindows: 1, pendingSelectionWindow: false })
  })

  it('stops game polling outside matches and restarts it on the next match', async () => {
    await start()
    read.mockImplementation(async (endpoint) => ({ ...reply(endpoint), status: null, error: 'ECONNREFUSED' }))
    session.observePhase('GameStart', 'websocket')
    await vi.advanceTimersByTimeAsync(0)
    await session.flush()
    session.observePhase('Lobby', 'websocket')
    await vi.advanceTimersByTimeAsync(10000)
    expect(read).toHaveBeenCalledOnce()
    session.observePhase('InProgress', 'websocket')
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('arms the duration limit at selection, not while waiting in the lobby', async () => {
    await start({ durationMs: 1000 })
    session.observePhase('Lobby', 'startup')
    await vi.advanceTimersByTimeAsync(10000)
    expect(listener).not.toBeNull()
    session.observePhase('ChampSelect', 'websocket')
    await vi.advanceTimersByTimeAsync(1000)
    await session.stop()
    expect((await summary()).stopReason).toBe('duration-limit')
    expect(read).not.toHaveBeenCalled()
  })

  it.each([
    [{ byteLimit: 1024 }, 'output-byte-limit'],
    [{ pendingByteLimit: 1024 }, 'write-backlog-limit'],
  ])('bounds output and queued data with %j', async (limits, reason) => {
    await start(limits)
    log('[champ-select diagnostics] subset-http', [{ oversized: 'x'.repeat(2048) }])
    await session.stop()
    expect((await summary()).stopReason).toBe(reason)
    expect((await rows()).map((row) => row.kind)).toEqual(['capture-start'])
    expect(listener).toBeNull()
  })

  it('contains file-open errors without starting network work or breaking the client', async () => {
    const originalDirectory = directory
    directory = path.join(directory, 'capture.jsonl', 'invalid-child')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path.join(originalDirectory, 'capture.jsonl'), 'occupied')
    await start()
    await session.stop()
    expect(notify).toHaveBeenLastCalledWith('统一诊断采集结束', expect.objectContaining({ reason: 'write-error' }))
    expect(listener).toBeNull()
    expect(read).not.toHaveBeenCalled()
    directory = originalDirectory
  })
})
