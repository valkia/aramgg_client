import { describe, expect, it, vi } from 'vitest'
import https from 'node:https'
import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import {
  AugmentApiCapture, changedJsonPaths, createDiagnosticSanitizer, createLocalGameReader,
  extractV1DocumentPaths, isSafeCapturePath, LIVE_DATA_PATH,
} from '../../src/main/services/diagnostics/augment-api-capture.ts'
import type { ApiResponse, CaptureRow } from '../../src/main/services/diagnostics/augment-api-capture.ts'

const response = (path: string, data: unknown, status = 200): ApiResponse => ({
  path, data, status, durationMs: 1, bytes: 100,
  requestStartedAt: '2026-11-07T00:00:00.000Z', requestFinishedAt: '2026-11-07T00:00:00.001Z',
})

describe('augment API discovery capture', () => {
  it('never follows redirects and bounds network time and response size', async () => {
    vi.useFakeTimers()
    const requests: Array<EventEmitter & { destroy: ReturnType<typeof vi.fn> }> = []
    let reply!: (response: IncomingMessage) => void
    const get = vi.spyOn(https, 'get').mockImplementation(((_options: unknown, callback: typeof reply) => {
      reply = callback
      const request = Object.assign(new EventEmitter(), { destroy: vi.fn() })
      requests.push(request)
      return request
    }) as unknown as typeof https.get)
    const reader = createLocalGameReader()
    try {
      const pending = reader.read(LIVE_DATA_PATH)
      const redirect = Object.assign(new EventEmitter(), { statusCode: 302, destroy: vi.fn() })
      reply(redirect as unknown as IncomingMessage)
      redirect.emit('data', Buffer.from('{"location":"https://example.com/"}'))
      redirect.emit('end')
      expect((await pending).status).toBe(302)
      expect(get).toHaveBeenCalledTimes(1)
      expect(get).toHaveBeenCalledWith(expect.objectContaining({ hostname: '127.0.0.1', port: 2999, path: LIVE_DATA_PATH }), expect.any(Function))

      const timed = reader.read(LIVE_DATA_PATH)
      await vi.advanceTimersByTimeAsync(1500)
      expect((await timed).error).toBe('request-timeout')
      expect(requests[1].destroy).toHaveBeenCalledOnce()

      const oversized = reader.read(LIVE_DATA_PATH)
      const response = Object.assign(new EventEmitter(), { statusCode: 200, destroy: vi.fn() })
      reply(response as unknown as IncomingMessage)
      response.emit('data', Buffer.alloc(4 * 1024 * 1024 + 1))
      expect((await oversized).error).toBe('response-byte-limit')
      expect(response.destroy).toHaveBeenCalledOnce()
    } finally {
      reader.close()
      get.mockRestore()
      vi.useRealTimers()
    }
  })

  it('preserves unknown choice fields, ordering and schema metadata while pseudonymizing identities', () => {
    const sanitize = createDiagnosticSanitizer(Buffer.alloc(32, 1))
    const input = {
      activePlayer: { summonerName: 'private-name', puuid: 'private-id', abilities: {}, rerollTokens: 2 },
      events: { Events: [{ EventName: 'UnlistedEvent', KillerName: 'private-name', Assisters: ['private-name'] }] },
      unknownFeature: { options: [{ id: 300, name: 'Third' }, { id: 100, displayName: 'First' }], visible: false },
      authentication: { accessToken: 'private-token' },
      definitions: { player: { properties: { summonerName: { type: 'string' }, token: { type: 'string' } } } },
    }
    const clean = sanitize(input) as typeof input
    expect(clean.unknownFeature).toEqual(input.unknownFeature)
    expect(clean.activePlayer.rerollTokens).toBe(2)
    expect(clean.events.Events[0].KillerName).toBe(clean.activePlayer.summonerName)
    expect(clean.events.Events[0].Assisters).toEqual([clean.activePlayer.summonerName])
    expect(clean.definitions).toEqual(input.definitions)
    expect(clean.authentication.accessToken).toBe('[redacted]')
    expect(JSON.stringify(clean)).not.toContain('private-')
    expect(input.activePlayer.summonerName).toBe('private-name')
    expect(createDiagnosticSanitizer(Buffer.alloc(32, 2))(input)).not.toEqual(clean)
  })

  it('only admits known read-only endpoints and bounded Swagger document references', async () => {
    for (const path of ['/liveclientdata/allgamedata', '/swagger/v1/api-docs/liveclientdata']) expect(isSafeCapturePath(path)).toBe(true)
    for (const path of ['https://example.com/', '//example.com', '/swagger/v1/api-docs/../../replay', '/swagger/v1/api-docs/%2e%2e', '/replay/playback', '/liveclientdata/unknown', '/liveclientdata/eventdata?eventID=10']) expect(isSafeCapturePath(path)).toBe(false)
    expect(extractV1DocumentPaths({ apis: [
      { path: '/liveclientdata' }, { path: '/swagger/v1/api-docs/replay' },
      { path: 'https://example.com' }, { path: '/../secret' },
      { path: '/liveclientdata/allgamedata', operations: [{ method: 'GET' }] },
    ] })).toEqual(['/swagger/v1/api-docs/liveclientdata', '/swagger/v1/api-docs/replay'])
    const reader = createLocalGameReader()
    await expect(reader.read('/replay/playback')).rejects.toThrow('allowlist')
    reader.close()
  })

  it('distinguishes missing, null and false fields and bounds only the diff summary', () => {
    expect(changedJsonPaths({}, { offer: null })).toEqual({ paths: ['/offer'], truncated: false })
    expect(changedJsonPaths({ offer: null }, { offer: false }).paths).toEqual(['/offer'])
    expect(changedJsonPaths({ offers: [2, 1] }, { offers: [1, 2] }).paths).toEqual(['/offers/0', '/offers/1'])
    expect(changedJsonPaths({ a: 1, b: 1 }, { a: 2, b: 2 }, 1)).toEqual({ paths: ['/a'], truncated: true })
  })

  it('samples separately, retains unknown payloads and inventories routes without executing them', async () => {
    let now = 0
    const rows: CaptureRow[] = []
    const read = vi.fn(async (path: string) => response(path, path.startsWith('/swagger/')
      ? { paths: { '/liveclientdata/hidden-offers': { get: {} }, '/replay/playback': { post: {} } } }
      : { gameData: { gameTime: now / 1000 + 20, gameMode: 'KIWI' }, newUnknownField: [12, 5, 9] }))
    const capture = new AugmentApiCapture({ read, emit: async (row) => { rows.push(row) }, notify: vi.fn(), now: () => now })
    await capture.step()
    now = 500
    await capture.step()
    now = 1000
    await capture.step()
    expect(read.mock.calls.filter(([path]) => path === LIVE_DATA_PATH)).toHaveLength(3)
    expect(read.mock.calls.filter(([path]) => path === '/liveclientdata/activeplayer')).toHaveLength(2)
    expect(read.mock.calls.filter(([path]) => path === '/liveclientdata/eventdata')).toHaveLength(2)
    expect(read.mock.calls.filter(([path]) => path === '/liveclientdata/hidden-offers')).toHaveLength(0)
    expect(read.mock.calls.filter(([path]) => path === '/replay/playback')).toHaveLength(0)
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'http', path: LIVE_DATA_PATH, data: expect.objectContaining({ newUnknownField: [12, 5, 9] }) }))
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'schema-routes', routes: expect.arrayContaining([{ path: '/liveclientdata/hidden-offers', methods: ['get'] }]) }))
  })

  it('records outages, retries metadata, and starts a new segment on reconnect or game-time rollback', async () => {
    let now = 0, online = false, gameTime = 50, schemaReady = false
    const rows: CaptureRow[] = []
    const read = vi.fn(async (path: string) => {
      if (!online) return { ...response(path, undefined), status: null, error: 'ECONNREFUSED' }
      if (path.startsWith('/swagger/')) return response(path, schemaReady ? { paths: {} } : { errorCode: 'not-ready' }, schemaReady ? 200 : 404)
      return response(path, { gameData: { gameTime } })
    })
    const capture = new AugmentApiCapture({ read, emit: async (row) => { rows.push(row) }, notify: vi.fn(), now: () => now })
    await capture.step()
    now = 500
    await capture.step()
    expect(rows.filter((row) => row.kind === 'http')).toHaveLength(1)
    online = true
    await capture.step()
    now = 16000; schemaReady = true
    await capture.step()
    expect(read.mock.calls.filter(([path]) => path === '/swagger/v3/openapi.json')).toHaveLength(2)
    online = false; now = 17000
    await capture.step()
    online = true; now = 18000
    await capture.step()
    gameTime = 1; now = 19000
    await capture.step()
    expect(rows.filter((row) => row.kind === 'segment').map((row) => row.reason)).toEqual(['online-or-reconnected', 'online-or-reconnected', 'game-time-rollback'])
    expect(rows.filter((row) => row.kind === 'http' && row.path === LIVE_DATA_PATH && row.segment === 3)[0].changedPaths).toEqual(['/'])
  })

  it('does not overlap cycles or grow a backlog when a request is slow', async () => {
    let release!: (value: ApiResponse) => void
    const read = vi.fn(async (path: string) => path === LIVE_DATA_PATH
      ? new Promise<ApiResponse>((resolve) => { release = resolve }) : response(path, {}))
    const capture = new AugmentApiCapture({ read, emit: async () => {}, notify: vi.fn() })
    const pending = capture.step()
    await capture.step()
    expect(read).toHaveBeenCalledTimes(1)
    release(response(LIVE_DATA_PATH, { gameData: { gameTime: 1 } }))
    await pending
    expect(read.mock.calls.filter(([path]) => path === LIVE_DATA_PATH)).toHaveLength(1)
  })

  it('temporarily increases known projection sampling after a possible selection and then restores cadence', async () => {
    let now = 0
    const read = vi.fn(async (path: string) => response(path, { gameData: { gameTime: now / 1000 } }))
    const capture = new AugmentApiCapture({ read, emit: async () => {}, notify: vi.fn(), now: () => now })
    await capture.step()
    capture.focusAfterSelection(2000)
    now = 500; await capture.step()
    now = 1000; await capture.step()
    now = 1500; await capture.step()
    expect(read.mock.calls.filter(([path]) => path === '/liveclientdata/activeplayer')).toHaveLength(4)
    for (const path of ['activeplayerabilities', 'activeplayerrunes', 'playerlist', 'gamestats']) {
      expect(read.mock.calls.filter(([endpoint]) => endpoint === `/liveclientdata/${path}`)).toHaveLength(1)
    }
    const previous = read.mock.calls.length
    now = 2000; await capture.step()
    expect(read.mock.calls.slice(previous).map(([path]) => path)).toEqual([LIVE_DATA_PATH])
  })
})
