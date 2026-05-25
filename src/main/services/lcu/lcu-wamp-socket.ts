import crypto from 'crypto'
import tls from 'tls'

export interface LcuJsonApiEvent<TData = unknown> {
  data?: TData
  eventType?: string
  uri?: string
  [key: string]: unknown
}

export interface LcuWampSocketOptions {
  token: string
  port: string
  onGameflowPhase: (phase: string, event: LcuJsonApiEvent<string>) => void | Promise<void>
  onOpen?: () => void
  onClose?: (reason: string) => void
  onError?: (error: Error) => void
}

const LCU_WAMP_TOPIC = 'OnJsonApiEvent'
const GAMEFLOW_PHASE_URI = '/lol-gameflow/v1/gameflow-phase'
const WAMP_SUBSCRIBE = 5
const WAMP_EVENT = 8
const OPCODE_TEXT = 0x1
const OPCODE_CLOSE = 0x8
const OPCODE_PING = 0x9
const OPCODE_PONG = 0xa

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const isJsonApiEvent = (value: unknown): value is LcuJsonApiEvent => {
  return isRecord(value) && typeof value.uri === 'string'
}

const extractJsonApiEvent = (message: unknown[]): LcuJsonApiEvent | null => {
  for (const part of message) {
    if (isJsonApiEvent(part)) {
      return part
    }
  }

  return null
}

interface WebSocketFrame {
  opcode: number
  payload: Buffer
}

export class LcuWampSocket {
  private socket: tls.TLSSocket | null = null
  private handshakeBuffer = Buffer.alloc(0)
  private frameBuffer = Buffer.alloc(0)
  private connected = false
  private subscribed = false
  private closing = false
  private closeNotified = false

  constructor(private readonly options: LcuWampSocketOptions) {}

  connect(): void {
    if (this.socket) {
      return
    }

    const port = Number(this.options.port)
    if (!Number.isInteger(port) || port <= 0) {
      this.notifyError(new Error(`Invalid LCU WebSocket port: ${this.options.port}`))
      this.notifyClose('invalid-port')
      return
    }

    this.closing = false
    this.closeNotified = false
    this.socket = tls.connect(
      {
        host: '127.0.0.1',
        port,
        rejectUnauthorized: false,
      },
      () => {
        this.sendHandshake()
      }
    )

    this.socket.setNoDelay(true)
    this.socket.on('data', (chunk) => this.handleData(chunk))
    this.socket.on('error', (error) => this.notifyError(error))
    this.socket.on('close', () => this.notifyClose(this.closing ? 'closed' : 'socket-closed'))
    this.socket.on('end', () => this.notifyClose('socket-ended'))
  }

  close(): void {
    this.closing = true

    if (!this.socket) {
      this.notifyClose('closed')
      return
    }

    if (!this.socket.destroyed) {
      if (this.connected) {
        this.sendFrame(OPCODE_CLOSE, Buffer.alloc(0))
      }
      this.socket.end()
      this.socket.destroy()
    }
  }

  isConnected(): boolean {
    return this.connected && !!this.socket && !this.socket.destroyed
  }

  private sendHandshake(): void {
    const websocketKey = crypto.randomBytes(16).toString('base64')
    const authorization = Buffer.from(`riot:${this.options.token}`).toString('base64')
    const request = [
      'GET / HTTP/1.1',
      `Host: 127.0.0.1:${this.options.port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${websocketKey}`,
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Protocol: wamp',
      `Authorization: Basic ${authorization}`,
      '',
      '',
    ].join('\r\n')

    this.socket?.write(request)
  }

  private handleData(chunk: Buffer): void {
    if (!this.connected) {
      this.handshakeBuffer = Buffer.concat([this.handshakeBuffer, chunk])
      const headerEnd = this.handshakeBuffer.indexOf('\r\n\r\n')

      if (headerEnd === -1) {
        return
      }

      const responseHeader = this.handshakeBuffer.subarray(0, headerEnd).toString('utf8')
      const remaining = this.handshakeBuffer.subarray(headerEnd + 4)
      this.handshakeBuffer = Buffer.alloc(0)

      if (!responseHeader.startsWith('HTTP/1.1 101')) {
        const firstLine = responseHeader.split('\r\n')[0] || 'unknown response'
        this.notifyError(new Error(`LCU WebSocket handshake failed: ${firstLine}`))
        this.close()
        return
      }

      this.connected = true
      this.options.onOpen?.()
      this.subscribe()

      if (remaining.length > 0) {
        this.handleFrameData(remaining)
      }
      return
    }

    this.handleFrameData(chunk)
  }

  private handleFrameData(chunk: Buffer): void {
    this.frameBuffer = Buffer.concat([this.frameBuffer, chunk])

    while (true) {
      const frame = this.readFrame()
      if (!frame) {
        return
      }

      this.handleFrame(frame)
    }
  }

  private readFrame(): WebSocketFrame | null {
    if (this.frameBuffer.length < 2) {
      return null
    }

    const firstByte = this.frameBuffer[0]
    const secondByte = this.frameBuffer[1]
    const opcode = firstByte & 0x0f
    const masked = (secondByte & 0x80) !== 0
    let payloadLength = secondByte & 0x7f
    let offset = 2

    if (payloadLength === 126) {
      if (this.frameBuffer.length < 4) {
        return null
      }
      payloadLength = this.frameBuffer.readUInt16BE(2)
      offset = 4
    } else if (payloadLength === 127) {
      if (this.frameBuffer.length < 10) {
        return null
      }
      const extendedLength = this.frameBuffer.readBigUInt64BE(2)
      if (extendedLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        this.notifyError(new Error('LCU WebSocket frame is too large'))
        this.close()
        return null
      }
      payloadLength = Number(extendedLength)
      offset = 10
    }

    const maskLength = masked ? 4 : 0
    const frameLength = offset + maskLength + payloadLength
    if (this.frameBuffer.length < frameLength) {
      return null
    }

    const maskingKey = masked ? this.frameBuffer.subarray(offset, offset + 4) : null
    const payloadStart = offset + maskLength
    const rawPayload = this.frameBuffer.subarray(payloadStart, payloadStart + payloadLength)
    const payload = maskingKey ? Buffer.alloc(rawPayload.length) : Buffer.from(rawPayload)

    if (maskingKey) {
      for (let index = 0; index < rawPayload.length; index += 1) {
        payload[index] = rawPayload[index] ^ maskingKey[index % 4]
      }
    }

    this.frameBuffer = this.frameBuffer.subarray(frameLength)
    return { opcode, payload }
  }

  private handleFrame(frame: WebSocketFrame): void {
    switch (frame.opcode) {
      case OPCODE_TEXT:
        this.handleTextFrame(frame.payload.toString('utf8'))
        break
      case OPCODE_PING:
        this.sendFrame(OPCODE_PONG, frame.payload)
        break
      case OPCODE_CLOSE:
        this.close()
        break
      default:
        break
    }
  }

  private handleTextFrame(text: string): void {
    let message: unknown
    try {
      message = JSON.parse(text)
    } catch (error) {
      this.notifyError(error instanceof Error ? error : new Error(String(error)))
      return
    }

    if (!Array.isArray(message) || message[0] !== WAMP_EVENT) {
      return
    }

    const event = extractJsonApiEvent(message)
    if (!event || event.uri !== GAMEFLOW_PHASE_URI || typeof event.data !== 'string') {
      return
    }

    Promise.resolve(this.options.onGameflowPhase(event.data, event as LcuJsonApiEvent<string>)).catch(
      (error: unknown) => {
        this.notifyError(error instanceof Error ? error : new Error(String(error)))
      }
    )
  }

  private subscribe(): void {
    if (this.subscribed) {
      return
    }

    this.subscribed = true
    this.sendText(JSON.stringify([WAMP_SUBSCRIBE, LCU_WAMP_TOPIC]))
  }

  private sendText(text: string): void {
    this.sendFrame(OPCODE_TEXT, Buffer.from(text, 'utf8'))
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    if (!this.socket || this.socket.destroyed) {
      return
    }

    const headerLength = payload.length < 126 ? 2 : payload.length <= 65535 ? 4 : 10
    const header = Buffer.alloc(headerLength)
    header[0] = 0x80 | opcode

    if (payload.length < 126) {
      header[1] = 0x80 | payload.length
    } else if (payload.length <= 65535) {
      header[1] = 0x80 | 126
      header.writeUInt16BE(payload.length, 2)
    } else {
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(payload.length), 2)
    }

    const maskingKey = crypto.randomBytes(4)
    const maskedPayload = Buffer.alloc(payload.length)
    for (let index = 0; index < payload.length; index += 1) {
      maskedPayload[index] = payload[index] ^ maskingKey[index % 4]
    }

    this.socket.write(Buffer.concat([header, maskingKey, maskedPayload]))
  }

  private notifyError(error: Error): void {
    this.options.onError?.(error)
  }

  private notifyClose(reason: string): void {
    if (this.closeNotified) {
      return
    }

    this.closeNotified = true
    this.connected = false
    this.subscribed = false
    this.socket = null
    this.options.onClose?.(reason)
  }
}
