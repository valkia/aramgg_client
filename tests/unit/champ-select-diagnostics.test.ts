import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChampSelectDiagnostics, SUBSET_CHAMPIONS_PATH } from '../../src/main/services/lcu/champ-select-diagnostics.ts'
import type { ChampSelectSnapshot } from '../../src/main/services/lcu/types.ts'
import { LcuWampSocket } from '../../src/main/services/lcu/lcu-wamp-socket.ts'

const makeSnapshot = (): ChampSelectSnapshot => ({
  connected: true, gameflowPhase: 'ChampSelect', isInChampSelect: true,
  champSelectSession: {
    queueId: 2400, allowSubsetChampionPicks: true, localPlayerCellId: 1,
    myTeam: [{ cellId: 1, championId: 22, summonerId: 123, puuid: 'private-puuid' }],
    theirTeam: [], actions: [], benchEnabled: true, benchChampions: [{ championId: 99 }],
    timer: { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 15000 },
    token: 'private-token', chatDetails: { password: 'private-password' },
  },
  localPlayerCellId: 1, selfChampionId: 22, benchEnabled: true,
  benchChampions: [{ championId: 99 }], myTeam: [], actions: [], timer: null,
  status: 'ready', reason: null, updatedAt: Date.now(),
})
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T00:00:00Z')) })
afterEach(() => { vi.useRealTimers() })

describe('read-only champion card diagnostics', () => {
  it('records ordered cards and coverage without leaking identifiers or changing the snapshot', async () => {
    const log = vi.fn()
    const readSubset = vi.fn().mockResolvedValue({ status: 200, data: [99, 22, 103] })
    const diagnostics = new ChampSelectDiagnostics({ enabled: true, log, readSubset })
    const snapshot = makeSnapshot()
    const before = structuredClone(snapshot)
    diagnostics.observePhase('ChampSelect', 'http')
    diagnostics.observeSnapshot(snapshot, [22, 99], diagnostics.revision)
    await flush()
    expect(log).toHaveBeenCalledWith('[champ-select diagnostics] subset-http', expect.objectContaining({ status: 200, ids: [99, 22, 103], validIdArray: true }))
    expect(log).toHaveBeenCalledWith('[champ-select diagnostics] candidate-coverage', expect.objectContaining({ missingFromRecommendation: [103] }))
    expect(snapshot).toEqual(before)
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-|summonerId|puuid|password/)
  })

  it('retries a 404 and distinguishes malformed responses from a successful empty array', async () => {
    const log = vi.fn()
    const readSubset = vi.fn()
      .mockResolvedValueOnce({ status: 404, data: { message: 'private-error-body' } })
      .mockResolvedValueOnce({ status: 200, data: { champions: [22] } })
      .mockResolvedValueOnce({ status: 200, data: [] })
    const diagnostics = new ChampSelectDiagnostics({ enabled: true, log, readSubset })
    diagnostics.observePhase('ChampSelect', 'http')
    for (let i = 0; i < 3; i++) {
      diagnostics.observeSnapshot(makeSnapshot(), [22], diagnostics.revision)
      await flush()
      vi.advanceTimersByTime(2000)
    }
    const responses = log.mock.calls.filter(([message]) => message.endsWith('subset-http')).map(([, value]) => value)
    expect(responses.map(({ status, count, validIdArray }) => ({ status, count, validIdArray }))).toEqual([
      { status: 404, count: null, validIdArray: false },
      { status: 200, count: null, validIdArray: false },
      { status: 200, count: 0, validIdArray: true },
    ])
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-error-body')
  })

  it('limits requests and logs while preserving heartbeat evidence', async () => {
    const log = vi.fn()
    const readSubset = vi.fn().mockResolvedValue({ status: 200, data: [22] })
    const diagnostics = new ChampSelectDiagnostics({ enabled: true, log, readSubset })
    diagnostics.observePhase('ChampSelect', 'http')
    for (let i = 0; i <= 10; i++) {
      const snapshot = makeSnapshot()
      snapshot.champSelectSession!.timer!.adjustedTimeLeftInPhase = 15000 - i * 1000
      diagnostics.observeSnapshot(snapshot, [22], diagnostics.revision)
      await flush()
      vi.advanceTimersByTime(1000)
    }
    expect(readSubset).toHaveBeenCalledTimes(6)
    expect(log.mock.calls.filter(([message]) => message.endsWith('session-http'))).toHaveLength(2)
    expect(log.mock.calls.filter(([message]) => message.endsWith('subset-http'))).toHaveLength(2)
    expect(log).toHaveBeenCalledWith('[champ-select diagnostics] subset-http', expect.objectContaining({ reason: 'heartbeat', requestCount: 6 }))
  })

  it('ignores unrelated events, records deletion, and discards a response after selection ends', async () => {
    const log = vi.fn()
    let resolve!: (result: { status: number; data: number[] }) => void
    const readSubset = vi.fn(() => new Promise<{ status: number; data: number[] }>((done) => { resolve = done }))
    const diagnostics = new ChampSelectDiagnostics({ enabled: true, log, readSubset })
    diagnostics.observePhase('ChampSelect', 'http')
    const oldRevision = diagnostics.revision
    diagnostics.observeSnapshot(makeSnapshot(), [22], oldRevision)
    diagnostics.observeSnapshot(makeSnapshot(), [22], oldRevision)
    expect(readSubset).toHaveBeenCalledTimes(1)
    diagnostics.observeEvent({ uri: '/lol-chat/v1/conversations', data: 'private-chat' })
    diagnostics.observeEvent({ uri: SUBSET_CHAMPIONS_PATH, eventType: 'Update', data: [103, 22] })
    diagnostics.observeEvent({ uri: SUBSET_CHAMPIONS_PATH, eventType: 'Delete', data: null })
    diagnostics.observePhase('InProgress', 'websocket')
    diagnostics.observePhase('ChampSelect', 'websocket')
    diagnostics.observeSnapshot(makeSnapshot(), [22], oldRevision)
    resolve({ status: 200, data: [999] })
    await flush()
    expect(log).toHaveBeenCalledWith('[champ-select diagnostics] subset-websocket', expect.objectContaining({ ids: [103, 22], eventType: 'Update' }))
    expect(log).toHaveBeenCalledWith('[champ-select diagnostics] end', expect.objectContaining({ subsetEvents: 2, lastSubset: null }))
    expect(log).toHaveBeenCalledWith('[champ-select diagnostics] stale-response', expect.objectContaining({ status: 200 }))
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-chat|999/)
  })

  it('does no work outside selection or when disabled', () => {
    const log = vi.fn(), readSubset = vi.fn()
    for (const enabled of [true, false]) {
      const diagnostics = new ChampSelectDiagnostics({ enabled, log, readSubset })
      if (!enabled) diagnostics.observePhase('ChampSelect', 'http')
      diagnostics.observeSnapshot(makeSnapshot(), [22], diagnostics.revision)
      diagnostics.observeEvent({ uri: SUBSET_CHAMPIONS_PATH, data: [22] })
    }
    expect(readSubset).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })
})

it('routes non-gameflow WAMP events to the observer and preserves phase delivery', () => {
  const onJsonApiEvent = vi.fn(), onGameflowPhase = vi.fn(), onError = vi.fn()
  const socket = new LcuWampSocket({ token: 'isolated-test', port: '1', onJsonApiEvent, onGameflowPhase, onError })
  const deliver = (socket as unknown as { handleTextFrame: (text: string) => void }).handleTextFrame.bind(socket)
  const event = { uri: SUBSET_CHAMPIONS_PATH, eventType: 'Update', data: [22] }
  deliver(JSON.stringify([8, 'OnJsonApiEvent', event]))
  expect(onJsonApiEvent).toHaveBeenCalledWith(event)
  expect(onGameflowPhase).not.toHaveBeenCalled()
  onJsonApiEvent.mockImplementationOnce(() => { throw new Error('observer failed') })
  deliver(JSON.stringify([8, 'OnJsonApiEvent', { uri: '/lol-gameflow/v1/gameflow-phase', data: 'ChampSelect' }]))
  expect(onGameflowPhase).toHaveBeenCalledWith('ChampSelect', expect.any(Object))
  expect(onError).toHaveBeenCalledTimes(1)
})
