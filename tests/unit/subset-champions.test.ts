import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SubsetChampions, SUBSET_CHAMPIONS_PATH, type SubsetChampionResult } from '../../src/main/services/lcu/subset-champions.ts'

const deferred = () => {
  let resolve!: (result: SubsetChampionResult) => void
  const promise = new Promise<SubsetChampionResult>((done) => { resolve = done })
  return { promise, resolve }
}
const push = (data: unknown, eventType = 'Update') => ({ uri: SUBSET_CHAMPIONS_PATH, eventType, data })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('local offered champion cache', () => {
  it('prewarms once, shares the diagnostic request, and preserves the full ordered list', async () => {
    const response = deferred()
    const read = vi.fn(() => response.promise)
    const source = new SubsetChampions(read)
    expect(await source.getForSnapshot()).toEqual([])
    expect(read).not.toHaveBeenCalled()
    source.observePhase('ChampSelect')
    const diagnostic = source.read()
    const snapshot = source.getForSnapshot()
    const ids = Array.from({ length: 30 }, (_, i) => i + 1)
    response.resolve({ status: 200, data: [...ids, 2] })
    expect(await diagnostic).toMatchObject({ status: 200 })
    expect(await snapshot).toEqual(ids)
    expect(await source.getForSnapshot()).toEqual(ids)
    expect(await source.read()).toMatchObject({ source: 'http', cacheHit: true })
    expect(read).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds the first wait and accepts a late response on the next refresh', async () => {
    const response = deferred()
    const source = new SubsetChampions(() => response.promise)
    source.observePhase('ChampSelect')
    const first = source.getForSnapshot()
    await vi.advanceTimersByTimeAsync(150)
    expect(await first).toEqual([])
    response.resolve({ status: 200, data: [105, 26] })
    await source.read()
    expect(await source.getForSnapshot()).toEqual([105, 26])
  })

  it.each(['Update', 'Delete'])('does not let an old HTTP request overwrite a newer %s push', async (eventType) => {
    const response = deferred()
    const source = new SubsetChampions(() => response.promise)
    source.observePhase('ChampSelect')
    source.observeEvent(push([875, 111, 266], eventType))
    expect(await source.read()).toMatchObject({ source: 'websocket', cacheHit: true })
    response.resolve({ status: 200, data: [105, 26] })
    await vi.advanceTimersByTimeAsync(0)
    expect(await source.getForSnapshot()).toEqual(eventType === 'Delete' ? [] : [875, 111, 266])
  })

  it.each([
    { status: 404, data: [99] },
    { status: 200, data: { errorCode: 'BAD_STATE' } },
    { status: 200, data: [0, 99] },
    { status: 200, data: ['99'] },
    { status: 200, data: [true] },
    { status: 200, data: [] },
  ])('clears cards on unavailable or invalid responses: %j', async (result) => {
    const read = vi.fn().mockResolvedValue(result)
    const source = new SubsetChampions(read)
    source.observePhase('ChampSelect')
    await source.read()
    source.observeEvent(push([105, 26]))
    expect(await source.getForSnapshot()).toEqual([105, 26])
    await vi.advanceTimersByTimeAsync(2000)
    await source.read()
    expect(await source.getForSnapshot()).toEqual([])
  })

  it.each(['phase', 'session', 'connection'])('discards pending results after %s reset and never leaks them to the next lobby', async (reset) => {
    const response = deferred()
    const read = vi.fn().mockReturnValueOnce(response.promise).mockResolvedValue({ status: 200, data: [99] })
    const source = new SubsetChampions(read)
    source.observePhase('ChampSelect')
    const old = source.read()
    if (reset === 'phase') source.observePhase('InProgress')
    else if (reset === 'session') source.observeEvent({ uri: '/lol-champ-select/v1/session', eventType: 'Delete' })
    else source.reset()
    source.observeEvent(push([103]))
    expect(await source.getForSnapshot()).toEqual([])
    source.observePhase('ChampSelect')
    await source.read()
    response.resolve({ status: 200, data: [105, 26] })
    await old
    expect(await source.getForSnapshot()).toEqual([99])
  })

  it('expires cached IDs when a refresh hangs and recovers after a request failure', async () => {
    const pending = deferred()
    const read = vi.fn().mockResolvedValueOnce({ status: 200, data: [105, 26] })
      .mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error('offline'))
    const source = new SubsetChampions(read)
    source.observePhase('ChampSelect')
    await source.read()
    await vi.advanceTimersByTimeAsync(6000)
    const snapshot = source.getForSnapshot()
    await vi.advanceTimersByTimeAsync(150)
    expect(await snapshot).toEqual([])
    pending.resolve({ status: 200, data: [99] })
    await source.read()
    expect(await source.getForSnapshot()).toEqual([99])
    await vi.advanceTimersByTimeAsync(2000)
    await source.read()
    expect(await source.getForSnapshot()).toEqual([])
    source.observeEvent(push([875, 111, 266]))
    expect(await source.getForSnapshot()).toEqual([875, 111, 266])
  })
})
