import { EventEmitter } from 'node:events'
import type { AddressInfo } from 'node:net'
import WebSocket, { WebSocketServer } from 'ws'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureRow } from '../../src/main/services/diagnostics/augment-api-capture.ts'
import { GameEventCapture } from '../../src/main/services/diagnostics/game-event-capture.ts'
import type { GameEventSocket } from '../../src/main/services/diagnostics/game-event-capture.ts'

class FakeSocket extends EventEmitter implements GameEventSocket {
  protocol = 'wamp'
  send = vi.fn((_data: string, callback?: (error?: Error) => void) => callback?.())
  terminate = vi.fn()
  message(data: unknown, binary = false) { this.emit('message', Buffer.from(JSON.stringify(data)), binary) }
  ready() { this.emit('open'); this.message([0, 'private-session', 1, 'private-server-description']) }
}

let sockets: FakeSocket[]
let rows: CaptureRow[]
let capture: GameEventCapture
const createSocket = vi.fn(() => { const socket = new FakeSocket(); sockets.push(socket); return socket })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-07T00:00:00Z'))
  sockets = []; rows = []
  createSocket.mockClear()
  capture = new GameEventCapture({ emit: (row) => { rows.push(row) }, createSocket })
})
afterEach(() => { capture.stop(); vi.useRealTimers() })

describe('experimental local game event capture', () => {
  it('receives fragmented WAMP messages through the real ws transport on an isolated loopback server', async () => {
    vi.useRealTimers()
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
    const frames: unknown[] = []
    server.on('connection', (peer) => {
      const welcome = JSON.stringify([0, 'isolated-test-session', 1, 'test-server'])
      peer.send(welcome.slice(0, 12), { fin: false })
      peer.send(welcome.slice(12), { fin: true })
      peer.on('message', (bytes) => {
        frames.push(JSON.parse(bytes.toString()))
        if (frames.length === 4) {
          const event = JSON.stringify([8, 'OnAugmentSelected', { id: 1048, choices: [1048, 1413] }])
          peer.send(event.slice(0, 20), { fin: false })
          peer.send(event.slice(20), { fin: true })
        }
      })
    })
    const port = (server.address() as AddressInfo).port
    capture = new GameEventCapture({
      emit: (row) => { rows.push(row) },
      createSocket: (_origin, protocols, options) => new WebSocket(`ws://127.0.0.1:${port}/`, protocols, options),
    })
    try {
      capture.setActive(true)
      await vi.waitFor(() => expect(rows.find((row) => row.event === 'event-observed')).toMatchObject({ topic: 'OnAugmentSelected', data: { id: 1048, choices: [1048, 1413] }, completion: 'unconfirmed' }))
      expect(frames).toHaveLength(4)
      expect(frames.every((frame) => Array.isArray(frame) && frame[0] === 5)).toBe(true)
    } finally {
      capture.stop()
      for (const peer of server.clients) peer.terminate()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('uses only the fixed local origin and four subscription frames, with no gameplay calls', () => {
    expect(createSocket).not.toHaveBeenCalled()
    capture.setActive(true)
    expect(createSocket).toHaveBeenCalledWith('wss://127.0.0.1:2999/', ['wamp'], {
      rejectUnauthorized: false, followRedirects: false, perMessageDeflate: false,
      maxPayload: 1024 * 1024, handshakeTimeout: 1500,
    })
    sockets[0].emit('open')
    expect(sockets[0].send).not.toHaveBeenCalled()
    sockets[0].message([0, 'private-session', 1, 'private-server-description'])
    expect(sockets[0].send.mock.calls.map(([text]) => JSON.parse(text))).toEqual([
      [5, 'OnJsonApiEvent'], [5, 'OnCallback'], [5, 'OnAugmentSelected'], [5, 'OnAugmentRerolled'],
    ])
    expect(rows.filter((row) => row.event === 'subscription-sent')).toHaveLength(4)
    expect(rows.filter((row) => row.event === 'event-observed')).toHaveLength(0)
    expect(rows.every((row) => row.completion === 'unconfirmed' && row.experimental === true)).toBe(true)
    expect(capture.summary).toMatchObject({ gameEventSubscriptionsSent: 4, gameEventsObserved: 0, gameEventConclusion: 'unconfirmed' })
  })

  it('requires the negotiated subprotocol and a valid WAMP v1 welcome before any subscription', async () => {
    capture.setActive(true)
    sockets[0].protocol = ''
    sockets[0].emit('open')
    expect(rows.at(-1)).toMatchObject({ reason: 'unexpected-subprotocol' })
    expect(sockets[0].send).not.toHaveBeenCalled()
    capture.setActive(false)
    capture.setActive(true)
    const socket = sockets[1]
    socket.emit('open')
    socket.message([0, 'private-session', 2, 'private-server'])
    socket.message([8, 'OnAugmentSelected', { id: 1048 }])
    expect(socket.send).not.toHaveBeenCalled()
    expect(capture.summary.gameEventsObserved).toBe(0)
    await vi.advanceTimersByTimeAsync(1500)
    expect(rows.at(-1)).toMatchObject({ reason: 'wamp-welcome-timeout' })
    expect(socket.terminate).toHaveBeenCalledOnce()
  })

  it('bounds handshake time and retries to three attempts in each active period', async () => {
    capture.setActive(true)
    await vi.advanceTimersByTimeAsync(1499)
    expect(sockets[0].terminate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(sockets[0].terminate).toHaveBeenCalledOnce()
    expect(rows.at(-1)).toMatchObject({ event: 'connection-failed', reason: 'handshake-timeout' })
    await vi.advanceTimersByTimeAsync(9999)
    expect(createSocket).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(createSocket).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(30000)
    expect(createSocket).toHaveBeenCalledTimes(3)
    capture.setActive(true)
    expect(createSocket).toHaveBeenCalledTimes(3)
    capture.setActive(false)
    capture.setActive(true)
    expect(createSocket).toHaveBeenCalledTimes(4)
    expect(capture.summary.gameEventConclusion).toBe('unconfirmed')
  })

  it('closes on deactivation or stop and ignores late callbacks from an old connection', async () => {
    capture.setActive(true)
    const old = sockets[0]
    capture.setActive(false)
    const count = rows.length
    old.emit('open')
    old.emit('error', new Error('private-error'))
    old.emit('close', 1006, Buffer.from('private-reason'))
    old.message([8, 'OnAugmentSelected', { id: 123 }])
    const lateRequest = { destroy: vi.fn() }, lateResponse = { statusCode: 401, destroy: vi.fn() }
    old.emit('unexpected-response', lateRequest, lateResponse)
    await vi.advanceTimersByTimeAsync(60000)
    expect(rows).toHaveLength(count)
    expect(old.send).not.toHaveBeenCalled()
    expect(lateRequest.destroy).toHaveBeenCalledOnce()
    expect(lateResponse.destroy).toHaveBeenCalledOnce()
    expect(createSocket).toHaveBeenCalledOnce()
    capture.setActive(true)
    sockets[1].ready()
    capture.stop()
    const stoppedCount = rows.length
    sockets[1].message([8, 'OnAugmentSelected', { id: 123 }])
    capture.setActive(true)
    await vi.advanceTimersByTimeAsync(60000)
    expect(rows).toHaveLength(stoppedCount)
    expect(createSocket).toHaveBeenCalledTimes(2)
  })

  it('preserves numeric callback IDs while hashing free strings and dropping welcome session details', () => {
    capture.setActive(true)
    const socket = sockets[0]
    socket.emit('open')
    socket.message([0, 'private-session', 1, 'private-server-description'])
    socket.message([8, 'OnCallback', { id: 7, parameters: ['private-name', { augmentId: 1048, token: 'private-token', label: 'private-label' }] }])
    expect(rows.find((row) => row.event === 'welcome-observed')).toMatchObject({ protocolVersion: 1 })
    const event = rows.find((row) => row.event === 'event-observed')!
    expect(event).toMatchObject({ topic: 'OnCallback', stringPolicy: 'opaque-strings-hmac-sha256', data: { id: 7, parameters: [
      { __diagnosticStringHmacSha256: expect.stringMatching(/^[0-9a-f]{64}$/), length: 12 },
      { augmentId: 1048, label: { __diagnosticStringHmacSha256: expect.any(String) } },
    ] } })
    expect(JSON.stringify(rows)).not.toContain('private-')
    expect(event.completion).toBe('unconfirmed')
  })

  it('hashes unknown augment strings consistently within a capture and differently in another capture', () => {
    capture.setActive(true)
    sockets[0].ready()
    for (const topic of ['OnAugmentSelected', 'OnAugmentRerolled']) {
      sockets[0].message([8, topic, { augmentId: 1048, argument: 'private-name' }])
    }
    const first = rows.filter((row) => row.event === 'event-observed').map((row) => row.data)
    expect(first[0]).toEqual(first[1])
    expect(first[0]).toMatchObject({ augmentId: 1048, argument: { __diagnosticStringHmacSha256: expect.any(String) } })
    capture.stop()
    capture = new GameEventCapture({ emit: (row) => { rows.push(row) }, createSocket })
    capture.setActive(true)
    sockets[1].ready()
    sockets[1].message([8, 'OnAugmentSelected', { augmentId: 1048, argument: 'private-name' }])
    expect(rows.at(-1)!.data).not.toEqual(first[0])
    expect(JSON.stringify(rows)).not.toContain('private-')
  })

  it('does not persist malformed JSON, binary messages or non-event WAMP frames', () => {
    capture.setActive(true)
    const socket = sockets[0]
    socket.ready()
    socket.emit('message', Buffer.from('private-unparsed-text'), false)
    socket.message({ private: 'private-object' })
    socket.message([8, 'OnCallback', ['private-binary']], true)
    socket.message([3, 'private-call-id', { private: 'private-result' }])
    expect(capture.summary.gameEventFramesRejected).toBe(4)
    expect(capture.summary.gameEventsObserved).toBe(0)
    expect(JSON.stringify(rows)).not.toContain('private-')
  })

  it('keeps known gameplay URIs and sanitizes identity fields while making other URIs opaque', () => {
    capture.setActive(true)
    const socket = sockets[0]
    socket.ready()
    socket.message([8, 'OnJsonApiEvent', { uri: '/liveclientdata/allgamedata', eventType: 'Update', data: {
      activePlayer: { summonerName: 'private-name', puuid: 'private-puuid' }, choices: [{ id: 7, name: 'augment label' }],
    }, unused: 'private-extra' }])
    socket.message([8, 'OnJsonApiEvent', { uri: '/liveclientdata/activeplayername', eventType: 'Update', data: 'private-name' }])
    for (const uri of ['/liveclientdata/unknown', '/liveclientdata/playeritems?name=private-name', '/lol-chat/v1/messages', 'https://example.com/']) {
      socket.message([8, 'OnJsonApiEvent', { uri, data: 'private-body' }])
    }
    socket.message([8, 'UnknownTopic', { id: 123 }])
    const events = rows.filter((row) => row.event === 'event-observed')
    expect(events).toHaveLength(6)
    expect(events[0]).toMatchObject({ data: { data: { choices: [{ id: 7, name: 'augment label' }] } } })
    expect(JSON.stringify(rows)).not.toContain('private-')
    expect(events.slice(2).every((row) => (row.data as Record<string, unknown>).uriPolicy === 'opaque-unrecognized-uri')).toBe(true)
    expect(capture.summary.gameEventFramesRejected).toBe(1)
  })

  it('retains numeric payloads from unknown resources without exposing or requesting their URI', () => {
    capture.setActive(true)
    const socket = sockets[0]
    socket.ready()
    const uri = '/private-name/kiwi/augment-selection?token=private-token&reroll=1'
    socket.message([8, 'OnJsonApiEvent', { uri, eventType: 'Update', data: {
      candidates: [1358, 2140, 2077], selectedId: 2140, visible: false, message: 'private-name',
    } }])
    expect(rows.at(-1)).toMatchObject({ topic: 'OnJsonApiEvent', stringPolicy: 'opaque-strings-hmac-sha256', data: {
      uriPolicy: 'opaque-unrecognized-uri', uriHmacSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      uriSegmentCount: 3, uriHints: ['augment', 'kiwi', 'select', 'selection'],
      payload: { data: { candidates: [1358, 2140, 2077], selectedId: 2140, visible: false,
        message: { __diagnosticStringHmacSha256: expect.any(String) } } },
    } })
    expect(JSON.stringify(rows)).not.toContain('private-')
    expect(JSON.stringify(rows)).not.toContain('?token=')
    expect(socket.send).toHaveBeenCalledTimes(4)
    expect(socket.send.mock.calls.every(([frame]) => JSON.parse(frame)[0] === 5)).toBe(true)
    expect(createSocket).toHaveBeenCalledOnce()
  })

  it('limits incoming message rate and message size without persisting raw frames', () => {
    capture.setActive(true)
    const socket = sockets[0]
    socket.ready()
    for (let i = 0; i < 121; i++) socket.message([8, 'OnAugmentRerolled', { id: i }])
    expect(capture.summary.gameEventsObserved).toBe(119)
    expect(capture.summary.gameEventRateLimitStops).toBe(1)
    expect(rows.at(-1)).toMatchObject({ event: 'connection-limited', reason: 'message-rate-limit' })
    expect(socket.terminate).toHaveBeenCalledOnce()
    capture.setActive(false)
    capture.setActive(true)
    sockets[1].emit('message', Buffer.alloc(1024 * 1024 + 1, 'x'), false)
    expect(rows.at(-1)).toMatchObject({ event: 'connection-limited', reason: 'message-byte-limit' })
    expect(JSON.stringify(rows)).not.toContain('xxx')
  })

  it('records bounded upgrade/error metadata and does not follow redirects', () => {
    capture.setActive(true)
    const request = { destroy: vi.fn() }
    const response = { statusCode: 302, headers: { location: 'https://example.com/private' }, destroy: vi.fn() }
    sockets[0].emit('unexpected-response', request, response)
    expect(rows.at(-1)).toMatchObject({ event: 'connection-failed', reason: 'upgrade-rejected', status: 302 })
    expect(request.destroy).toHaveBeenCalledOnce()
    expect(response.destroy).toHaveBeenCalledOnce()
    expect(createSocket).toHaveBeenCalledOnce()
    expect(JSON.stringify(rows)).not.toContain('example.com')
    capture.setActive(false)
    capture.setActive(true)
    sockets[1].emit('error', Object.assign(new Error('private-error'), { code: 'private-code' }))
    expect(rows.at(-1)).toMatchObject({ reason: 'socket-error' })
    expect(JSON.stringify(rows)).not.toContain('private-')
  })

  it('reports the ws parser payload limit when the oversized message never reaches the message handler', () => {
    capture.setActive(true)
    sockets[0].ready()
    sockets[0].emit('error', Object.assign(new Error('private-parser-message'), { code: 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH' }))
    expect(rows.at(-1)).toMatchObject({ event: 'connection-limited', reason: 'message-byte-limit', maxBytes: 1024 * 1024 })
    expect(capture.summary.gameEventFramesRejected).toBe(1)
    expect(sockets[0].terminate).toHaveBeenCalledOnce()
    expect(JSON.stringify(rows)).not.toContain('private-parser-message')
  })
})
