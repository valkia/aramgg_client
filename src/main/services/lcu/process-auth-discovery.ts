import { execFile } from 'child_process'
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
        `$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Process -Filter "${LEAGUE_CLIENT_PROCESS_FILTER}" | Select-Object Name,ProcessId,CommandLine | ConvertTo-Json -Compress`,
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
  }

  if (shouldLogDiscoveryDiagnostic()) {
    logger.warn('[LCU discovery] no process auth found', {
      processCount: sortedRecords.length,
      processes: sortedRecords.map(summarizeProcessRecord),
    })
  }

  return [null, null, null]
}
