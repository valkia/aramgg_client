import { createHmac, randomBytes } from 'node:crypto'
import type { ClientRequest, IncomingMessage } from 'node:http'
import WebSocket from 'ws'
import type { ClientOptions, RawData } from 'ws'
import { createDiagnosticSanitizer } from './augment-api-capture.ts'
import type { CaptureRow } from './augment-api-capture.ts'

const ORIGIN = 'wss://127.0.0.1:2999/'
const TOPICS = ['OnJsonApiEvent', 'OnCallback', 'OnAugmentSelected', 'OnAugmentRerolled'] as const
const TOPIC_SET = new Set<string>(TOPICS)
const JSON_API_PATHS = new Set([
  '/liveclientdata/allgamedata', '/liveclientdata/activeplayer', '/liveclientdata/activeplayername',
  '/liveclientdata/activeplayerabilities', '/liveclientdata/activeplayerrunes', '/liveclientdata/playerlist',
  '/liveclientdata/playeritems', '/liveclientdata/playerscores', '/liveclientdata/playersummonerspells',
  '/liveclientdata/playermainrunes', '/liveclientdata/eventdata', '/liveclientdata/gamestats',
])
const MAX_PAYLOAD = 1024 * 1024
const MAX_MESSAGES_PER_SECOND = 120
const MAX_ATTEMPTS = 3
const RETRY_MS = 10000
const HANDSHAKE_MS = 1500
const ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND'])
const URI_HINTS = ['augment', 'hextech', 'kiwi', 'select', 'selection', 'reroll']

export interface GameEventSocket {
  readonly protocol: string
  on(event: 'open', listener: () => void): unknown
  on(event: 'message', listener: (data: RawData, isBinary: boolean) => void): unknown
  on(event: 'error', listener: (error: Error & { code?: string }) => void): unknown
  on(event: 'close', listener: (code: number) => void): unknown
  on(event: 'unexpected-response', listener: (request: ClientRequest, response: IncomingMessage) => void): unknown
  send(data: string, callback?: (error?: Error) => void): void
  terminate(): void
}

type Options = {
  emit: (row: CaptureRow) => void | Promise<void>
  createSocket?: (url: string, protocols: string[], options: ClientOptions) => GameEventSocket
}

function opaqueStrings(value: unknown, key: Buffer, depth = 0): unknown {
  if (depth > 60) return { __diagnosticTruncated: 'depth-limit' }
  if (typeof value === 'string') return {
    __diagnosticStringHmacSha256: createHmac('sha256', key).update(value).digest('hex'),
    length: value.length,
  }
  if (Array.isArray(value)) return value.map((entry) => opaqueStrings(entry, key, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([name, child]) => [name, opaqueStrings(child, key, depth + 1)]),
  )
  return value
}

/** Experimental subscriptions only; sending or silence cannot establish event availability. */
export class GameEventCapture {
  private readonly sanitize = createDiagnosticSanitizer()
  private readonly stringKey = randomBytes(32)
  private socket: GameEventSocket | null = null
  private active = false
  private stopped = false
  private generation = 0
  private attempts = 0
  private handshake: ReturnType<typeof setTimeout> | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private messagesAt = 0
  private messagesInWindow = 0
  private connectionsAttempted = 0
  private connectionsOpened = 0
  private subscriptionsSent = 0
  private eventsObserved = 0
  private framesRejected = 0
  private rateLimitStops = 0

  constructor(private readonly options: Options) {}

  get summary() {
    return {
      gameEventConnectionsAttempted: this.connectionsAttempted,
      gameEventConnectionsOpened: this.connectionsOpened,
      gameEventSubscriptionsSent: this.subscriptionsSent,
      gameEventsObserved: this.eventsObserved,
      gameEventFramesRejected: this.framesRejected,
      gameEventRateLimitStops: this.rateLimitStops,
      gameEventActive: this.active,
      gameEventConclusion: 'unconfirmed',
    }
  }

  setActive(active: boolean): void {
    if (this.stopped || active === this.active) return
    this.active = active
    this.clearConnection()
    if (active) {
      this.attempts = 0
      this.connect()
    } else this.emit('inactive')
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.active = false
    this.clearConnection()
  }

  private emit(event: string, details: Record<string, unknown> = {}): void {
    if (this.stopped) return
    try {
      void Promise.resolve(this.options.emit({
        kind: 'game-event', event, observedAt: new Date().toISOString(), origin: ORIGIN,
        experimental: true, completion: 'unconfirmed', attempt: this.attempts, ...details,
      })).catch(() => this.stop())
    } catch { this.stop() }
  }

  private clearConnection(): void {
    this.generation += 1
    if (this.handshake) clearTimeout(this.handshake)
    if (this.retry) clearTimeout(this.retry)
    this.handshake = this.retry = null
    const socket = this.socket
    this.socket = null
    // Keep error listeners installed: terminate may emit asynchronously after invalidation.
    try { socket?.terminate() } catch { /* Already closed. */ }
  }

  private connect(): void {
    if (this.stopped || !this.active || this.socket || this.attempts >= MAX_ATTEMPTS) return
    this.attempts += 1
    this.connectionsAttempted += 1
    const generation = ++this.generation
    this.emit('connection-attempt')
    if (this.stopped) return
    let socket: GameEventSocket
    try {
      socket = (this.options.createSocket ?? ((url, protocols, options) => new WebSocket(url, protocols, options)))(
        ORIGIN, ['wamp'], {
          rejectUnauthorized: false, followRedirects: false, perMessageDeflate: false,
          maxPayload: MAX_PAYLOAD, handshakeTimeout: HANDSHAKE_MS,
        },
      )
    } catch {
      this.emit('connection-failed', { reason: 'socket-create-error' })
      this.scheduleRetry()
      return
    }
    this.socket = socket
    let opened = false
    let protocolReady = false
    this.messagesAt = Date.now()
    this.messagesInWindow = 0
    const current = () => !this.stopped && this.active && this.generation === generation && this.socket === socket
    const finish = (event: string, details: Record<string, unknown> = {}) => {
      if (!current()) return
      this.emit(event, details)
      this.clearConnection()
      this.scheduleRetry()
    }
    this.handshake = setTimeout(() => finish('connection-failed', { reason: 'handshake-timeout' }), HANDSHAKE_MS)
    this.handshake.unref?.()
    socket.on('open', () => {
      if (!current()) return
      if (socket.protocol !== 'wamp') {
        finish('connection-failed', { reason: 'unexpected-subprotocol' })
        return
      }
      if (this.handshake) clearTimeout(this.handshake)
      this.handshake = setTimeout(() => finish('connection-failed', { reason: 'wamp-welcome-timeout' }), HANDSHAKE_MS)
      this.handshake.unref?.()
      opened = true
      this.connectionsOpened += 1
      this.emit('connected', { protocolState: 'awaiting-welcome' })
    })
    const acceptWelcome = (): boolean => {
      if (!current() || !opened || protocolReady) return false
      protocolReady = true
      if (this.handshake) clearTimeout(this.handshake)
      this.handshake = null
      this.emit('welcome-observed', { protocolVersion: 1 })
      for (const topic of TOPICS) {
        if (!current()) break
        try {
          socket.send(JSON.stringify([5, topic]), (error) => {
            if (error) finish('connection-failed', { reason: 'subscription-send-error' })
          })
          if (!current()) break
          this.subscriptionsSent += 1
          this.emit('subscription-sent', { topic, acknowledgement: 'not-established' })
        } catch {
          finish('connection-failed', { reason: 'subscription-send-error' })
        }
      }
      return true
    }
    socket.on('error', (error) => {
      if (!current()) return
      if (error.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') {
        this.framesRejected += 1
        finish('connection-limited', { reason: 'message-byte-limit', maxBytes: MAX_PAYLOAD })
      } else finish('connection-failed', {
        reason: error.code && ERROR_CODES.has(error.code) ? error.code : 'socket-error',
      })
    })
    socket.on('close', (code) => finish('disconnected', { closeCode: Number.isInteger(code) ? code : null }))
    socket.on('unexpected-response', (request, response) => {
      if (current()) {
        const status = response.statusCode
        finish('connection-failed', { reason: 'upgrade-rejected', status: status && status >= 100 && status <= 599 ? status : null })
      }
      response.destroy()
      request.destroy()
    })
    socket.on('message', (data, isBinary) => {
      if (!current()) return
      if (Date.now() - this.messagesAt >= 1000) { this.messagesAt = Date.now(); this.messagesInWindow = 0 }
      if (++this.messagesInWindow > MAX_MESSAGES_PER_SECOND) {
        this.rateLimitStops += 1
        finish('connection-limited', { reason: 'message-rate-limit', maxMessagesPerSecond: MAX_MESSAGES_PER_SECOND })
        return
      }
      const bytes = Buffer.isBuffer(data) ? data : data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.concat(data)
      if (bytes.length > MAX_PAYLOAD) {
        this.framesRejected += 1
        finish('connection-limited', { reason: 'message-byte-limit', maxBytes: MAX_PAYLOAD })
        return
      }
      if (isBinary) { this.framesRejected += 1; return }
      this.observeMessage(bytes, acceptWelcome, protocolReady)
    })
  }

  private scheduleRetry(): void {
    if (this.stopped || !this.active || this.attempts >= MAX_ATTEMPTS) return
    this.retry = setTimeout(() => { this.retry = null; this.connect() }, RETRY_MS)
    this.retry.unref?.()
  }

  private observeMessage(bytes: Buffer, acceptWelcome: () => boolean, protocolReady: boolean): void {
    let message: unknown
    try { message = JSON.parse(bytes.toString('utf8')) } catch { this.framesRejected += 1; return }
    if (!Array.isArray(message)) { this.framesRejected += 1; return }
    if (message[0] === 0) {
      const valid = message.length === 4 && typeof message[1] === 'string' && message[1].length > 0
        && message[1].length <= 256 && message[2] === 1 && typeof message[3] === 'string'
      if (!valid || !acceptWelcome()) this.framesRejected += 1
      return
    }
    if (!protocolReady) { this.framesRejected += 1; return }
    if (message.length !== 3 || message[0] !== 8 || typeof message[1] !== 'string' || !TOPIC_SET.has(message[1])) {
      this.framesRejected += 1
      return
    }
    const topic = message[1], payload: unknown = message[2]
    let data: unknown
    let stringPolicy = 'opaque-strings-hmac-sha256'
    if (topic === 'OnJsonApiEvent') {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) { this.framesRejected += 1; return }
      const event = payload as Record<string, unknown>
      if (typeof event.uri !== 'string') { this.framesRejected += 1; return }
      if (JSON_API_PATHS.has(event.uri)) {
        stringPolicy = 'known-identity-keys'
        data = {
          uri: event.uri,
          eventType: ['Create', 'Update', 'Delete'].includes(String(event.eventType)) ? event.eventType : null,
          data: event.uri === '/liveclientdata/activeplayername' ? opaqueStrings(event.data, this.stringKey) : this.sanitize(event.data),
        }
      } else {
        const pathOnly = event.uri.split(/[?#]/, 1)[0]
        data = {
          uriPolicy: 'opaque-unrecognized-uri',
          uriHmacSha256: createHmac('sha256', this.stringKey).update(event.uri).digest('hex'),
          uriSegmentCount: pathOnly.split('/').filter(Boolean).length,
          uriHints: URI_HINTS.filter((hint) => pathOnly.toLowerCase().includes(hint)),
          payload: opaqueStrings(this.sanitize(Object.fromEntries(Object.entries(event).filter(([name]) => name !== 'uri'))), this.stringKey),
        }
      }
    } else {
      // Generic callback arguments have no identity schema; keep numeric IDs, hash all free strings.
      data = opaqueStrings(this.sanitize(payload), this.stringKey)
    }
    this.eventsObserved += 1
    this.emit('event-observed', { topic, data, stringPolicy })
  }
}
