import { execFile } from 'child_process'
import { readdir, readFile, stat } from 'fs/promises'
import path from 'path'
import { promisify } from 'util'
import logger from '../../modules/logger.ts'
import type { TokenLoadResult } from './types.ts'

const execFileAsync = promisify(execFile)

const LEAGUE_CLIENT_PROCESS_FILTER =
  "Name='LeagueClientUx.exe' OR Name='LeagueClient.exe'"
const CIM_PROCESS_QUERY_TIMEOUT_MS = 8000
const GET_PROCESS_QUERY_TIMEOUT_MS = 4000
const DISCOVERY_DIAGNOSTIC_LOG_INTERVAL_MS = 30 * 1000
const DISCOVERY_SUCCESS_CACHE_MS = 60 * 1000
let lastDiscoveryDiagnosticLogAt = 0
let lastFallbackSuccessLogAt = 0
let processDiscoveryQueryCount = 0
let processDiscoveryPowershellAttemptCount = 0
let processDiscoveryTotalDurationMs = 0
let lastProcessDiscoveryQueryAt: number | null = null
let lastProcessDiscoveryQueryDurationMs = 0
let lastProcessDiscoveryAttemptDurationsMs: number[] = []
let lastProcessDiscoveryRecordCount = 0
let cachedLcuAuthResult: TokenLoadResult | null = null
let cachedLcuAuthAt = 0

export type Win32ProcessRecord = {
  Name?: string
  ProcessId?: number
  CommandLine?: string | null
  ExecutablePath?: string | null
}

type LogCandidate = {
  path: string
  mtimeMs: number
  processIdMatch: boolean
}

type ProcessQueryErrorDiagnostic = {
  name: string
  message: string
  code: string | number | null
  killed: boolean
  signal: string | null
  timedOut: boolean
  stderr: string | null
}

export type ProcessQueryAttempt = {
  strategy: 'get-cim-instance' | 'get-process'
  timeoutMs: number
  durationMs: number
  succeeded: boolean
  recordCount: number
  usableRecordCount: number
  error: ProcessQueryErrorDiagnostic | null
}

export type ProcessQueryResult = {
  records: Win32ProcessRecord[]
  attempts: ProcessQueryAttempt[]
}

export type LcuProcessDiscoveryStats = {
  queryCount: number
  powershellAttemptCount: number
  totalDurationMs: number
  lastQueryAt: number | null
  lastQueryDurationMs: number
  lastAttemptDurationsMs: number[]
  lastRecordCount: number
}

export type ProcessQueryRunner = (script: string, timeoutMs: number) => Promise<string>

const PROCESS_QUERY_STRATEGIES: Array<{
  name: ProcessQueryAttempt['strategy']
  timeoutMs: number
  script: string
}> = [
  {
    name: 'get-cim-instance',
    timeoutMs: CIM_PROCESS_QUERY_TIMEOUT_MS,
    script: `$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Filter "${LEAGUE_CLIENT_PROCESS_FILTER}" | Select-Object Name,ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`,
  },
  {
    name: 'get-process',
    timeoutMs: GET_PROCESS_QUERY_TIMEOUT_MS,
    script: "$ErrorActionPreference='SilentlyContinue'; @(Get-Process -Name LeagueClientUx,LeagueClient -ErrorAction SilentlyContinue) | Select-Object @{Name='Name';Expression={$_.ProcessName + '.exe'}},@{Name='ProcessId';Expression={$_.Id}},@{Name='ExecutablePath';Expression={$_.Path}},@{Name='CommandLine';Expression={$null}} | ConvertTo-Json -Compress; exit 0",
  },
]

function buildUrlWithAuth(token: string, port: string, protocol = 'https'): string {
  return `${protocol}://riot:${token}@127.0.0.1:${port}`
}

function normalizeProcessRecords(value: unknown): Win32ProcessRecord[] {
  if (!value) {
    return []
  }

  return Array.isArray(value)
    ? value.filter((item): item is Win32ProcessRecord => !!item && typeof item === 'object')
    : [value as Win32ProcessRecord]
}

function parsePowerShellJson(stdout: string): Win32ProcessRecord[] {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return []
  }

  try {
    return normalizeProcessRecords(JSON.parse(trimmed))
  } catch (error) {
    const err = error as Error
    logger.debug('[LCU discovery] failed to parse process query output:', err.message)
    return []
  }
}

function hasUsableProcessMetadata(record: Win32ProcessRecord): boolean {
  return Boolean(record.CommandLine || record.ExecutablePath)
}

function mergeProcessRecords(
  currentRecords: Win32ProcessRecord[],
  incomingRecords: Win32ProcessRecord[]
): Win32ProcessRecord[] {
  const merged = new Map<string, Win32ProcessRecord>()

  for (const record of [...currentRecords, ...incomingRecords]) {
    const key = record.ProcessId
      ? `pid:${record.ProcessId}`
      : `name:${record.Name || 'unknown'}:${merged.size}`
    const previous = merged.get(key)
    merged.set(key, {
      ...previous,
      ...record,
      ExecutablePath: record.ExecutablePath || previous?.ExecutablePath || null,
      CommandLine: record.CommandLine || previous?.CommandLine || null,
    })
  }

  return [...merged.values()]
}

function summarizeProcessQueryError(error: unknown): ProcessQueryErrorDiagnostic {
  const err = error as Error & {
    code?: string | number
    killed?: boolean
    signal?: string
    stderr?: string | Buffer
  }
  const stderr = String(err.stderr || '').trim()
  const message = String(err.message || error || 'Unknown process query error')
  const timedOut =
    err.code === 'ETIMEDOUT' ||
    err.killed === true ||
    /timed out|timeout/i.test(message)

  return {
    name: err.name || 'Error',
    message: message.slice(0, 500),
    code: err.code ?? null,
    killed: err.killed === true,
    signal: err.signal || null,
    timedOut,
    stderr: stderr ? stderr.slice(0, 500) : null,
  }
}

async function defaultProcessQueryRunner(script: string, timeoutMs: number): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ],
    {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 256,
      encoding: 'utf8',
    }
  )

  return String(stdout || '')
}

export async function queryLeagueClientProcessesWithRunner(
  runner: ProcessQueryRunner
): Promise<ProcessQueryResult> {
  const attempts: ProcessQueryAttempt[] = []
  let records: Win32ProcessRecord[] = []

  for (const strategy of PROCESS_QUERY_STRATEGIES) {
    const startedAt = Date.now()
    try {
      const stdout = await runner(strategy.script, strategy.timeoutMs)
      const strategyRecords = parsePowerShellJson(stdout)
      records = mergeProcessRecords(records, strategyRecords)
      attempts.push({
        strategy: strategy.name,
        timeoutMs: strategy.timeoutMs,
        durationMs: Date.now() - startedAt,
        succeeded: true,
        recordCount: strategyRecords.length,
        usableRecordCount: strategyRecords.filter(hasUsableProcessMetadata).length,
        error: null,
      })

      if (records.some(hasUsableProcessMetadata)) {
        break
      }
    } catch (error) {
      attempts.push({
        strategy: strategy.name,
        timeoutMs: strategy.timeoutMs,
        durationMs: Date.now() - startedAt,
        succeeded: false,
        recordCount: 0,
        usableRecordCount: 0,
        error: summarizeProcessQueryError(error),
      })
    }
  }

  return { records, attempts }
}

function parseCommandLineArgument(commandLine: string, argumentName: string): string | null {
  const pattern = /(?:^|\s)"?--([A-Za-z0-9-]+)=(?:"([^"]*)"|'([^']*)'|([^\s"]+))"?/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(commandLine))) {
    if (match[1] === argumentName) {
      return match[2] ?? match[3] ?? match[4] ?? null
    }
  }

  return null
}

function isValidPort(value: string | null): value is string {
  if (!value) {
    return false
  }

  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port <= 65535
}

function shouldLogDiscoveryDiagnostic(): boolean {
  const now = Date.now()
  if (now - lastDiscoveryDiagnosticLogAt < DISCOVERY_DIAGNOSTIC_LOG_INTERVAL_MS) {
    return false
  }

  lastDiscoveryDiagnosticLogAt = now
  return true
}

function summarizeProcessRecord(record: Win32ProcessRecord) {
  const commandLine = String(record.CommandLine || '')
  const appPort = parseCommandLineArgument(commandLine, 'app-port')

  return {
    processName: record.Name || null,
    processId: record.ProcessId || null,
    hasExecutablePath: !!record.ExecutablePath,
    hasCommandLine: commandLine.length > 0,
    hasAppPort: !!appPort,
    hasAuthToken: !!parseCommandLineArgument(commandLine, 'remoting-auth-token'),
    appPort: isValidPort(appPort) ? appPort : null,
    commandLineLength: commandLine.length,
  }
}

export function parseLcuAuthFromCommandLine(commandLine: string | null | undefined): TokenLoadResult {
  if (!commandLine) {
    return [null, null, null]
  }

  const token = parseCommandLineArgument(commandLine, 'remoting-auth-token')
  const port = parseCommandLineArgument(commandLine, 'app-port')

  if (!token || !isValidPort(port)) {
    return [null, null, null]
  }

  return [token, port, buildUrlWithAuth(token, port)]
}

export function parseLcuAuthFromLogContent(logContent: string | null | undefined): TokenLoadResult {
  const content = logContent || ''
  if (!content) {
    return [null, null, null]
  }

  const commandLineResult = parseLcuAuthFromCommandLine(content)
  if (commandLineResult[0] && commandLineResult[1]) {
    return commandLineResult
  }

  const urlMatch = content.match(/https?:\/\/riot:([^@\s]+)@127\.0\.0\.1:(\d+)/)
  if (!urlMatch) {
    return [null, null, null]
  }

  const token = urlMatch[1]
  const port = urlMatch[2]
  if (!token || !isValidPort(port)) {
    return [null, null, null]
  }

  return [token, port, buildUrlWithAuth(token, port)]
}

export function parseLcuAuthFromLockfile(lockfileContent: string | null | undefined): TokenLoadResult {
  const trimmed = lockfileContent?.trim()
  if (!trimmed) {
    return [null, null, null]
  }

  const parts = trimmed.split(':')
  if (parts.length < 5) {
    return [null, null, null]
  }

  const port = parts[2] || null
  const token = parts[3] || null
  const protocol = parts[4] || 'https'

  if (!token || !isValidPort(port) || !/^https?$/.test(protocol)) {
    return [null, null, null]
  }

  return [token, port, buildUrlWithAuth(token, port, protocol)]
}

function getLockfileCandidates(record: Win32ProcessRecord): string[] {
  const executablePath = record.ExecutablePath
  if (!executablePath) {
    return []
  }

  const executableDir = path.dirname(executablePath)
  return [
    path.join(executableDir, 'lockfile'),
    path.resolve(executableDir, '..', 'lockfile'),
  ]
}

async function readLcuAuthFromProcessLockfile(record: Win32ProcessRecord): Promise<TokenLoadResult> {
  const seen = new Set<string>()

  for (const lockfilePath of getLockfileCandidates(record)) {
    if (seen.has(lockfilePath)) {
      continue
    }
    seen.add(lockfilePath)

    try {
      const content = await readFile(lockfilePath, 'utf8')
      const result = parseLcuAuthFromLockfile(content)
      if (result[0] && result[1]) {
        logger.debug('[LCU discovery] token extracted from lockfile fallback', {
          processName: record.Name || null,
          processId: record.ProcessId || null,
          port: result[1],
        })
        return result
      }
    } catch {
      // Missing or inaccessible lockfiles are expected while the client starts or runs elevated.
    }
  }

  return [null, null, null]
}

async function getUxLogCandidates(record: Win32ProcessRecord): Promise<LogCandidate[]> {
  const executablePath = record.ExecutablePath
  if (!executablePath) {
    return []
  }

  const executableDir = path.dirname(executablePath)
  let entries
  try {
    entries = await readdir(executableDir, { withFileTypes: true })
  } catch {
    return []
  }

  const processId = record.ProcessId ? String(record.ProcessId) : null
  const candidates: LogCandidate[] = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('_LeagueClientUx.log')) {
      continue
    }

    const logPath = path.join(executableDir, entry.name)
    try {
      const fileStat = await stat(logPath)
      const processIdMatch = processId ? entry.name.includes(`_${processId}_`) : false
      candidates.push({
        path: logPath,
        mtimeMs: fileStat.mtimeMs,
        processIdMatch,
      })
    } catch {
      // Logs can rotate while the client starts.
    }
  }

  return candidates
    .sort((a, b) => {
      if (a.processIdMatch !== b.processIdMatch) {
        return a.processIdMatch ? -1 : 1
      }
      return b.mtimeMs - a.mtimeMs
    })
    .slice(0, 3)
}

async function readLcuAuthFromProcessLog(record: Win32ProcessRecord): Promise<TokenLoadResult> {
  const candidates = await getUxLogCandidates(record)

  for (const candidate of candidates) {
    try {
      const content = await readFile(candidate.path, 'utf8')
      const result = parseLcuAuthFromLogContent(content)
      if (result[0] && result[1]) {
        logger.debug('[LCU discovery] token extracted from LeagueClientUx log fallback', {
          processName: record.Name || null,
          processId: record.ProcessId || null,
          port: result[1],
          processIdMatch: candidate.processIdMatch,
        })
        return result
      }
    } catch {
      // Log files can be locked, missing, or rewritten while the client starts.
    }
  }

  return [null, null, null]
}

async function queryLeagueClientProcesses(): Promise<ProcessQueryResult> {
  if (process.platform !== 'win32') {
    return { records: [], attempts: [] }
  }

  const startedAt = Date.now()
  const result = await queryLeagueClientProcessesWithRunner(defaultProcessQueryRunner)
  const durationMs = Date.now() - startedAt
  processDiscoveryQueryCount += 1
  processDiscoveryPowershellAttemptCount += result.attempts.length
  processDiscoveryTotalDurationMs += durationMs
  lastProcessDiscoveryQueryAt = Date.now()
  lastProcessDiscoveryQueryDurationMs = durationMs
  lastProcessDiscoveryAttemptDurationsMs = result.attempts.map(attempt => attempt.durationMs)
  lastProcessDiscoveryRecordCount = result.records.length
  const fallbackAttempt = result.attempts.find((attempt) => attempt.strategy === 'get-process')
  const now = Date.now()

  if (
    fallbackAttempt?.succeeded &&
    fallbackAttempt.usableRecordCount > 0 &&
    now - lastFallbackSuccessLogAt >= DISCOVERY_DIAGNOSTIC_LOG_INTERVAL_MS
  ) {
    lastFallbackSuccessLogAt = now
    logger.info('[LCU discovery] fallback process query recovered League metadata', {
      attempts: result.attempts,
      processes: result.records.map(summarizeProcessRecord),
      sensitiveValuesLogged: false,
    })
  }

  return result
}

export function getLcuProcessDiscoveryStats(): LcuProcessDiscoveryStats {
  return {
    queryCount: processDiscoveryQueryCount,
    powershellAttemptCount: processDiscoveryPowershellAttemptCount,
    totalDurationMs: processDiscoveryTotalDurationMs,
    lastQueryAt: lastProcessDiscoveryQueryAt,
    lastQueryDurationMs: lastProcessDiscoveryQueryDurationMs,
    lastAttemptDurationsMs: [...lastProcessDiscoveryAttemptDurationsMs],
    lastRecordCount: lastProcessDiscoveryRecordCount,
  }
}

function cacheLcuAuthResult(result: TokenLoadResult): TokenLoadResult {
    if (result[0] && result[1]) {
        cachedLcuAuthResult = result
        cachedLcuAuthAt = Date.now()
    }

    return result
}

export function shouldUseDiscoveryCache(
    cachedAt: number,
    now: number,
    forceRefresh: boolean
): boolean {
    return !forceRefresh && cachedAt > 0 && now - cachedAt < DISCOVERY_SUCCESS_CACHE_MS
}

export async function discoverLcuAuthFromProcess(
    forceRefresh: boolean = false
): Promise<TokenLoadResult> {
    if (shouldUseDiscoveryCache(cachedLcuAuthAt, Date.now(), forceRefresh) && cachedLcuAuthResult) {
        return cachedLcuAuthResult
    }

    const { records, attempts } = await queryLeagueClientProcesses()
  const sortedRecords = records.sort((a, b) => {
    const aIsUx = a.Name === 'LeagueClientUx.exe' ? 1 : 0
    const bIsUx = b.Name === 'LeagueClientUx.exe' ? 1 : 0
    return bIsUx - aIsUx
  })

    for (const record of sortedRecords) {
        const result = parseLcuAuthFromCommandLine(record.CommandLine)
        if (result[0] && result[1]) {
      logger.debug('[LCU discovery] token extracted from process command line', {
        processName: record.Name || null,
        processId: record.ProcessId || null,
        port: result[1],
      })
            return cacheLcuAuthResult(result)
        }

        const lockfileResult = await readLcuAuthFromProcessLockfile(record)
        if (lockfileResult[0] && lockfileResult[1]) {
            return cacheLcuAuthResult(lockfileResult)
        }

        const logResult = await readLcuAuthFromProcessLog(record)
        if (logResult[0] && logResult[1]) {
            return cacheLcuAuthResult(logResult)
        }
    }

    if (forceRefresh) {
        cachedLcuAuthResult = null
        cachedLcuAuthAt = 0
    }

  if (shouldLogDiscoveryDiagnostic()) {
    const metadataAccessLikelyRestricted =
      sortedRecords.length > 0 &&
      sortedRecords.every((record) => !record.ExecutablePath && !record.CommandLine)
    const queryTimedOut = attempts.some((attempt) => attempt.error?.timedOut)
    const queryFailed = attempts.some((attempt) => !attempt.succeeded)
    const diagnosticHints: string[] = []
    if (metadataAccessLikelyRestricted) {
      diagnosticHints.push('League processes are visible, but executable paths and command lines are unavailable; check privilege mismatch or security software restrictions.')
    }
    if (queryTimedOut) {
      diagnosticHints.push('PowerShell process discovery timed out; check WMI/CIM health, endpoint security software, or system load.')
    } else if (queryFailed) {
      diagnosticHints.push('A PowerShell process discovery strategy failed; inspect attempt error codes and stderr for policy, WMI, or PowerShell failures.')
    }
    if (sortedRecords.length === 0) {
      diagnosticHints.push('No League client process was visible; verify LeagueClientUx.exe is running and both applications use the same privilege level.')
    } else if (!metadataAccessLikelyRestricted) {
      diagnosticHints.push('League processes were found, but no usable auth was present in command lines, lockfiles, or recent client logs.')
    }

    logger.debug('[LCU discovery] no process auth found', {
      processCount: sortedRecords.length,
      processes: sortedRecords.map(summarizeProcessRecord),
      attempts,
      metadataAccessLikelyRestricted,
      diagnosticHints,
      sensitiveValuesLogged: false,
    })
  }

  return [null, null, null]
}
