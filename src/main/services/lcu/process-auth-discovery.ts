import { execFile } from 'child_process'
import { readdir, readFile, stat } from 'fs/promises'
import path from 'path'
import { promisify } from 'util'
import logger from '../../modules/logger.ts'
import type { TokenLoadResult } from './types.ts'

const execFileAsync = promisify(execFile)

const LEAGUE_CLIENT_PROCESS_FILTER =
  "Name='LeagueClientUx.exe' OR Name='LeagueClient.exe'"
const DISCOVERY_DIAGNOSTIC_LOG_INTERVAL_MS = 30 * 1000
let lastDiscoveryDiagnosticLogAt = 0

type Win32ProcessRecord = {
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

async function queryLeagueClientProcesses(): Promise<Win32ProcessRecord[]> {
  if (process.platform !== 'win32') {
    return []
  }

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Process -Filter "${LEAGUE_CLIENT_PROCESS_FILTER}" | Select-Object Name,ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`,
      ],
      {
        timeout: 3000,
        windowsHide: true,
        maxBuffer: 1024 * 256,
      }
    )

    return parsePowerShellJson(stdout)
  } catch (error) {
    const err = error as Error
    if (shouldLogDiscoveryDiagnostic()) {
      logger.warn('[LCU discovery] process query failed:', err.message)
    }
    return []
  }
}

export async function discoverLcuAuthFromProcess(): Promise<TokenLoadResult> {
  const records = await queryLeagueClientProcesses()
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
      return result
    }

    const lockfileResult = await readLcuAuthFromProcessLockfile(record)
    if (lockfileResult[0] && lockfileResult[1]) {
      return lockfileResult
    }

    const logResult = await readLcuAuthFromProcessLog(record)
    if (logResult[0] && logResult[1]) {
      return logResult
    }
  }

  if (shouldLogDiscoveryDiagnostic()) {
    logger.warn('[LCU discovery] no process auth found', {
      processCount: sortedRecords.length,
      processes: sortedRecords.map(summarizeProcessRecord),
    })
  }

  return [null, null, null]
}
