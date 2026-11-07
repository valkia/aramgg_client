import { createHmac, randomBytes } from 'node:crypto'
import https from 'node:https'

export const LIVE_DATA_PATH = '/liveclientdata/allgamedata'
const CORE_PATHS = ['/liveclientdata/activeplayer', '/liveclientdata/eventdata']
const PROJECTION_PATHS = [
  '/liveclientdata/activeplayerabilities', '/liveclientdata/activeplayerrunes',
  '/liveclientdata/playerlist', '/liveclientdata/gamestats',
]
const SCHEMA_PATHS = ['/swagger/v3/openapi.json', '/swagger/v2/swagger.json', '/swagger/v1/api-docs']
const FIXED_PATHS = new Set([LIVE_DATA_PATH, ...CORE_PATHS, ...PROJECTION_PATHS, ...SCHEMA_PATHS])
const IDENTITY_KEYS = new Set([
  'summonername', 'summonerid', 'puuid', 'accountid', 'playername', 'playerid',
  'riotid', 'riotidgamename', 'riotidtagline', 'killername', 'victimname', 'assisters',
  'recipientname',
])
const SECRET_KEYS = new Set([
  'authorization', 'password', 'token', 'authtoken', 'accesstoken', 'refreshtoken',
  'idtoken', 'remotingauthtoken', 'secret', 'apikey', 'cookie',
])

export type ApiResponse = {
  path: string
  requestStartedAt: string
  requestFinishedAt: string
  durationMs: number
  status: number | null
  bytes: number
  data?: unknown
  error?: string
}
export type CaptureRow = Record<string, unknown>
export type CaptureRead = (endpoint: string) => Promise<ApiResponse>
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null

export function isSafeCapturePath(endpoint: string): boolean {
  return FIXED_PATHS.has(endpoint) || /^\/swagger\/v1\/api-docs\/[a-zA-Z0-9_-]{1,80}$/.test(endpoint)
}

/** Preserve unknown gameplay fields and array order; pseudonymize only explicit identity keys. */
export function createDiagnosticSanitizer(key: Buffer = randomBytes(32)) {
  const identity = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(identity)
    if (value === null || value === '') return value
    return `player-${createHmac('sha256', key).update(String(value)).digest('hex').slice(0, 16)}`
  }
  const sanitize = (value: unknown, depth = 0): unknown => {
    if (depth > 60) return { __diagnosticTruncated: 'depth-limit' }
    if (Array.isArray(value)) return value.map((child) => sanitize(child, depth + 1))
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([name, child]) => {
      const normalized = name.toLowerCase().replace(/[_-]/g, '')
      // Schema properties named summonerName/token contain type metadata, not identity values.
      const scalarOrList = child === null || typeof child !== 'object' || (Array.isArray(child) && child.every((item) => item === null || typeof item !== 'object'))
      return [name, scalarOrList && SECRET_KEYS.has(normalized) ? '[redacted]' : scalarOrList && IDENTITY_KEYS.has(normalized) ? identity(child) : sanitize(child, depth + 1)]
    }))
  }
  return sanitize
}

export function extractSchemaRoutes(data: unknown): Array<{ path: string; methods: string[] }> {
  const root = object(data)
  const routes = Object.entries(object(root.paths)).map(([path, methods]) => ({
    path, methods: Object.keys(object(methods)).filter((method) => /^(get|post|put|patch|delete|head|options)$/i.test(method)),
  }))
  for (const entry of Array.isArray(root.apis) ? root.apis : []) {
    const api = object(entry)
    if (typeof api.path !== 'string') continue
    routes.push({ path: api.path, methods: (Array.isArray(api.operations) ? api.operations : [])
      .map((operation) => object(operation).method).filter((method): method is string => typeof method === 'string') })
  }
  return routes
}

/** Only follow Swagger v1 document references, never gameplay routes discovered in a schema. */
export function extractV1DocumentPaths(data: unknown): string[] {
  return extractSchemaRoutes(data).flatMap(({ path, methods }) => {
    if (methods.length) return []
    const candidate = path.startsWith('/swagger/v1/api-docs/') ? path
      : /^\/?[a-zA-Z0-9_-]{1,80}$/.test(path) ? `/swagger/v1/api-docs/${path.replace(/^\//, '')}` : ''
    return isSafeCapturePath(candidate) ? [candidate] : []
  }).slice(0, 16)
}

export function changedJsonPaths(previous: unknown, current: unknown, limit = 160): { paths: string[]; truncated: boolean } {
  const paths: string[] = []
  let truncated = false
  const walk = (before: unknown, after: unknown, path: string, depth: number) => {
    if (Object.is(before, after)) return
    if (paths.length >= limit) { truncated = true; return }
    if (depth < 30 && before !== null && after !== null && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
      const left = before as Record<string, unknown>, right = after as Record<string, unknown>
      for (const name of new Set([...Object.keys(left), ...Object.keys(right)])) {
        if (paths.length >= limit) { truncated = true; break }
        walk(left[name], right[name], `${path}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`, depth + 1)
      }
    } else paths.push(path || '/')
  }
  walk(previous, current, '', 0)
  return { paths, truncated }
}

export function createLocalGameReader(): { read: CaptureRead; close: () => void } {
  const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 4 })
  const read: CaptureRead = async (endpoint) => {
    if (!isSafeCapturePath(endpoint)) throw new Error('Endpoint is outside the read-only capture allowlist')
    const startedAt = Date.now()
    return new Promise((resolve) => {
      let settled = false
      let bytes = 0
      let status: number | null = null
      const finish = (result: { data?: unknown; error?: string }) => {
        if (settled) return
        settled = true
        clearTimeout(deadline)
        resolve({ path: endpoint, requestStartedAt: new Date(startedAt).toISOString(), requestFinishedAt: new Date().toISOString(), durationMs: Date.now() - startedAt, status, bytes, ...result })
      }
      const request = https.get({ hostname: '127.0.0.1', port: 2999, path: endpoint, agent, headers: { Accept: 'application/json' } }, (response) => {
        status = response.statusCode ?? null
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > 4 * 1024 * 1024) {
            finish({ error: 'response-byte-limit' })
            response.destroy()
            request.destroy()
          } else chunks.push(chunk)
        })
        response.on('error', () => finish({ error: 'response-error' }))
        response.on('end', () => {
          if (settled) return
          try { finish({ data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }) }
          catch { finish({ error: 'non-json-response' }) }
        })
      })
      const deadline = setTimeout(() => {
        finish({ error: 'request-timeout' })
        request.destroy()
      }, 1500)
      request.on('error', (error: NodeJS.ErrnoException) => finish({ error: error.code || 'request-error' }))
    })
  }
  return { read, close: () => agent.destroy() }
}

type CaptureOptions = {
  read: CaptureRead
  emit: (row: CaptureRow) => Promise<void>
  notify: (message: string) => void
  now?: () => number
}

export class AugmentApiCapture {
  private options: CaptureOptions
  private sanitize = createDiagnosticSanitizer()
  private inFlight = false
  private online = false
  private nextSegment = false
  private segment = 0
  private lastGameTime: number | null = null
  private lastCoreAt = -Infinity
  private lastProjectionAt = -Infinity
  private projectionIndex = 0
  private previous = new Map<string, unknown>()
  private schemaAttempts = new Map<string, { count: number; at: number; complete: boolean }>()
  private lastFailure = { signature: '', at: -Infinity }
  private responseCount = 0
  private selectionFocusUntil = 0

  constructor(options: CaptureOptions) { this.options = options }

  private now(): number { return this.options.now?.() ?? Date.now() }

  get summary() { return { segments: this.segment, responses: this.responseCount, online: this.online } }

  markGameBoundary(): void { this.nextSegment = true; this.selectionFocusUntil = 0 }

  focusAfterSelection(until: number): void { this.selectionFocusUntil = until }

  async step(): Promise<boolean> {
    if (this.inFlight) return this.online
    this.inFlight = true
    try {
      const response = await this.options.read(LIVE_DATA_PATH)
      const game = object(object(response.data).gameData)
      const gameTime = finite(game.gameTime)
      const success = response.status === 200 && response.data !== null && typeof response.data === 'object' && !response.error
      if (!success) {
        const signature = JSON.stringify([response.status, response.error])
        if (this.online || signature !== this.lastFailure.signature || this.now() - this.lastFailure.at >= 10000) {
          await this.emitResponse(response)
          this.lastFailure = { signature, at: this.now() }
        }
        if (this.online) this.options.notify('游戏接口离线，继续等待重连。')
        this.online = false
        return false
      }
      const rollback = gameTime !== null && this.lastGameTime !== null && gameTime < this.lastGameTime - 5
      if (!this.online || rollback || this.nextSegment) {
        const reason = this.nextSegment ? 'gameflow-entry' : rollback ? 'game-time-rollback' : 'online-or-reconnected'
        this.nextSegment = false
        this.segment += 1
        this.previous.clear()
        this.schemaAttempts = new Map(SCHEMA_PATHS.map((path) => [path, { count: 0, at: -Infinity, complete: false }]))
        this.lastCoreAt = this.lastProjectionAt = -Infinity
        await this.options.emit({ kind: 'segment', segment: this.segment, observedAt: new Date(this.now()).toISOString(), reason, gameTime, gameMode: game.gameMode ?? null })
        this.options.notify(`游戏接口在线，开始采样（段 ${this.segment}，模式 ${String(game.gameMode ?? 'unknown')}）。`)
      }
      this.online = true
      this.lastGameTime = gameTime
      await this.emitResponse(response)

      const paths: string[] = []
      const selectionFocus = this.now() < this.selectionFocusUntil
      if (this.now() - this.lastCoreAt >= (selectionFocus ? 500 : 1000)) {
        this.lastCoreAt = this.now()
        paths.push(...CORE_PATHS)
      }
      if (this.now() - this.lastProjectionAt >= (selectionFocus ? 500 : 5000)) {
        this.lastProjectionAt = this.now()
        paths.push(PROJECTION_PATHS[this.projectionIndex++ % PROJECTION_PATHS.length])
      }
      // One metadata document per cycle bounds startup gaps; retry unavailable docs three times.
      const schema = [...this.schemaAttempts].find(([, state]) => !state.complete && state.count < 3 && this.now() - state.at >= 15000)
      if (schema) {
        schema[1].count += 1
        schema[1].at = this.now()
        paths.push(schema[0])
      }
      const results = await Promise.all(paths.map((path) => this.options.read(path)))
      for (const result of results) {
        await this.emitResponse(result)
        if (!result.path.startsWith('/swagger/') || result.status !== 200 || result.error) continue
        const state = this.schemaAttempts.get(result.path)
        const document = object(result.data)
        const recognizedSchema = (document.paths !== null && typeof document.paths === 'object' && !Array.isArray(document.paths)) || Array.isArray(document.apis)
        if (state) state.complete = recognizedSchema
        const routes = extractSchemaRoutes(result.data)
        await this.options.emit({ kind: 'schema-routes', segment: this.segment, path: result.path, recognizedSchema, routes, note: 'Discovered gameplay routes are inventoried, not automatically requested.' })
        if (result.path === '/swagger/v1/api-docs') {
          for (const path of extractV1DocumentPaths(result.data)) {
            if (!this.schemaAttempts.has(path)) this.schemaAttempts.set(path, { count: 0, at: -Infinity, complete: false })
          }
        }
      }
      return true
    } finally { this.inFlight = false }
  }

  private async emitResponse(response: ApiResponse): Promise<void> {
    const data = this.sanitize(response.data)
    const previous = this.previous.get(response.path)
    const differences = changedJsonPaths(previous, data)
    if (response.status === 200 && !response.error) this.previous.set(response.path, data)
    this.responseCount += 1
    await this.options.emit({ kind: 'http', segment: this.segment, sequence: this.responseCount, ...response, data,
      changedPaths: differences.paths, changedPathsTruncated: differences.truncated })
  }
}
