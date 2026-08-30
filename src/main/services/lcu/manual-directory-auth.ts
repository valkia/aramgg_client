import { readFile, readdir, stat } from 'fs/promises'
import path from 'path'
import {
  findLeagueClientLogFiles,
  getLeagueClientLogDirectoryCandidates,
  normalizeLolPath,
} from '../../modules/lol-path.ts'
import logger from '../../modules/logger.ts'
import {
  parseLcuAuthFromLockfile,
  parseLcuAuthFromLogContent,
} from './process-auth-discovery.ts'
import type { TokenLoadResult } from './types.ts'

const MANUAL_DISCOVERY_DIAGNOSTIC_LOG_INTERVAL_MS = 5 * 60 * 1000
let lastManualDiscoveryDiagnosticAt = 0
let lastManualDiscoveryDiagnosticPath = ''

type CandidateDiagnostic = {
  path: string
  status: 'missing' | 'stat-error' | 'not-file' | 'read-error' | 'invalid-auth' | 'auth-found'
  errorCode?: string
  size?: number
  modifiedAt?: string
}

type DirectoryDiagnostic = {
  path: string
  status: 'missing' | 'not-directory' | 'available' | 'stat-error' | 'read-error'
  errorCode?: string
}

type ProcessLiveness = 'running' | 'not-running' | 'access-denied' | 'unknown'

function getErrorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' && code ? code : 'UNKNOWN'
}

function getCandidateMetadata(fileStat: Awaited<ReturnType<typeof stat>>) {
  return {
    size: Number(fileStat.size),
    modifiedAt: fileStat.mtime.toISOString(),
  }
}

function getCandidateAgeMs(fileStat: Awaited<ReturnType<typeof stat>>): number {
  return Math.max(0, Date.now() - Number(fileStat.mtimeMs))
}

function getLockfileProcessId(content: string): number | null {
  const processId = Number(content.trim().split(':')[1])
  return Number.isInteger(processId) && processId > 0 ? processId : null
}

function getLogProcessId(filePath: string): number | null {
  const match = path.basename(filePath).match(/_(\d+)_LeagueClientUx\.log$/)
  const processId = Number(match?.[1])
  return Number.isInteger(processId) && processId > 0 ? processId : null
}

function getProcessLiveness(processId: number | null): ProcessLiveness {
  if (!processId) {
    return 'unknown'
  }

  try {
    process.kill(processId, 0)
    return 'running'
  } catch (error) {
    const errorCode = getErrorCode(error)
    if (errorCode === 'ESRCH') {
      return 'not-running'
    }
    if (errorCode === 'EPERM' || errorCode === 'EACCES') {
      return 'access-denied'
    }
    return 'unknown'
  }
}

function logSelectedAuthCandidate(params: {
  normalizedPath: string
  source: 'lockfile' | 'LeagueClientUx-log'
  candidatePath: string
  fileStat: Awaited<ReturnType<typeof stat>>
  port: string
  processId: number | null
}): void {
  if (!shouldLogManualDiscoveryDiagnostic(params.normalizedPath)) {
    return
  }

  logger.debug('[LCU manual discovery] auth candidate selected', {
    configuredPath: params.normalizedPath,
    source: params.source,
    candidatePath: params.candidatePath,
    port: params.port,
    processId: params.processId,
    processLiveness: getProcessLiveness(params.processId),
    candidateAgeMs: getCandidateAgeMs(params.fileStat),
    ...getCandidateMetadata(params.fileStat),
    sensitiveValuesLogged: false,
  })
}

function shouldLogManualDiscoveryDiagnostic(normalizedPath: string): boolean {
  const now = Date.now()
  if (
    normalizedPath === lastManualDiscoveryDiagnosticPath &&
    now - lastManualDiscoveryDiagnosticAt < MANUAL_DISCOVERY_DIAGNOSTIC_LOG_INTERVAL_MS
  ) {
    return false
  }

  lastManualDiscoveryDiagnosticAt = now
  lastManualDiscoveryDiagnosticPath = normalizedPath
  return true
}

function getManualLockfileCandidates(normalizedPath: string): string[] {
  return [
    path.join(normalizedPath, 'lockfile'),
    path.join(normalizedPath, 'LeagueClient', 'lockfile'),
    path.resolve(normalizedPath, '..', 'lockfile'),
  ]
}

async function readAuthFromManualLockfiles(
  normalizedPath: string,
  diagnostics: CandidateDiagnostic[]
): Promise<TokenLoadResult> {
  const seen = new Set<string>()

  for (const lockfilePath of getManualLockfileCandidates(normalizedPath)) {
    if (seen.has(lockfilePath)) {
      continue
    }
    seen.add(lockfilePath)

    let fileStat
    try {
      fileStat = await stat(lockfilePath)
    } catch (error) {
      const errorCode = getErrorCode(error)
      diagnostics.push({
        path: lockfilePath,
        status: errorCode === 'ENOENT' ? 'missing' : 'stat-error',
        errorCode,
      })
      continue
    }

    if (!fileStat.isFile()) {
      diagnostics.push({ path: lockfilePath, status: 'not-file' })
      continue
    }

    try {
      const content = await readFile(lockfilePath, 'utf8')
      const result = parseLcuAuthFromLockfile(content)
      if (result[0] && result[1]) {
        diagnostics.push({
          path: lockfilePath,
          status: 'auth-found',
          ...getCandidateMetadata(fileStat),
        })
        logSelectedAuthCandidate({
          normalizedPath,
          source: 'lockfile',
          candidatePath: lockfilePath,
          fileStat,
          port: result[1],
          processId: getLockfileProcessId(content),
        })
        return result
      }
      diagnostics.push({
        path: lockfilePath,
        status: 'invalid-auth',
        ...getCandidateMetadata(fileStat),
      })
    } catch (error) {
      diagnostics.push({
        path: lockfilePath,
        status: 'read-error',
        errorCode: getErrorCode(error),
        ...getCandidateMetadata(fileStat),
      })
      // League Client can rewrite or lock the file while starting.
    }
  }

  return [null, null, null]
}

async function getFileMtime(filePath: string): Promise<number> {
  try {
    const fileStat = await stat(filePath)
    return fileStat.mtimeMs
  } catch {
    return 0
  }
}

async function getSortedLogFiles(lolPath: string): Promise<string[]> {
  const logFiles = await findLeagueClientLogFiles(lolPath)
  const withMtime = await Promise.all(
    logFiles.map(async (filePath) => ({
      filePath,
      mtimeMs: await getFileMtime(filePath),
    }))
  )

  return withMtime
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.filePath.localeCompare(a.filePath))
    .map((candidate) => candidate.filePath)
}

async function readAuthFromManualLogs(
  normalizedPath: string,
  diagnostics: CandidateDiagnostic[]
): Promise<{ result: TokenLoadResult; candidateCount: number }> {
  const logFiles = await getSortedLogFiles(normalizedPath)

  for (const logFilePath of logFiles.slice(0, 5)) {
    let fileStat = null
    try {
      fileStat = await stat(logFilePath)
    } catch {
      // The file can rotate between directory enumeration and reading.
    }

    try {
      const content = await readFile(logFilePath, 'utf8')
      const result = parseLcuAuthFromLogContent(content)
      if (result[0] && result[1]) {
        diagnostics.push({
          path: logFilePath,
          status: 'auth-found',
          ...(fileStat ? getCandidateMetadata(fileStat) : {}),
        })
        if (fileStat) {
          logSelectedAuthCandidate({
            normalizedPath,
            source: 'LeagueClientUx-log',
            candidatePath: logFilePath,
            fileStat,
            port: result[1],
            processId: getLogProcessId(logFilePath),
          })
        }
        return { result, candidateCount: logFiles.length }
      }
      diagnostics.push({
        path: logFilePath,
        status: 'invalid-auth',
        ...(fileStat ? getCandidateMetadata(fileStat) : {}),
      })
    } catch (error) {
      diagnostics.push({
        path: logFilePath,
        status: 'read-error',
        errorCode: getErrorCode(error),
        ...(fileStat ? getCandidateMetadata(fileStat) : {}),
      })
      // Log files can be locked or rotate while League Client starts.
    }
  }

  return { result: [null, null, null], candidateCount: logFiles.length }
}

async function inspectLogDirectories(normalizedPath: string): Promise<DirectoryDiagnostic[]> {
  return Promise.all(
    getLeagueClientLogDirectoryCandidates(normalizedPath).map(async (directoryPath) => {
      try {
        const directoryStat = await stat(directoryPath)
        if (!directoryStat.isDirectory()) {
          return { path: directoryPath, status: 'not-directory' }
        }

        try {
          await readdir(directoryPath)
        } catch (error) {
          return {
            path: directoryPath,
            status: 'read-error',
            errorCode: getErrorCode(error),
          }
        }

        return {
          path: directoryPath,
          status: 'available',
        }
      } catch (error) {
        const errorCode = getErrorCode(error)
        return {
          path: directoryPath,
          status: errorCode === 'ENOENT' ? 'missing' : 'stat-error',
          errorCode,
        }
      }
    })
  )
}

export async function discoverLcuAuthFromManualDirectory(
  lolPath: string | null | undefined
): Promise<TokenLoadResult> {
  const normalizedPath = normalizeLolPath(lolPath)
  if (!normalizedPath) {
    return [null, null, null]
  }

  const lockfileDiagnostics: CandidateDiagnostic[] = []
  const logDiagnostics: CandidateDiagnostic[] = []
  const lockfileResult = await readAuthFromManualLockfiles(normalizedPath, lockfileDiagnostics)
  if (lockfileResult[0] && lockfileResult[1]) {
    return lockfileResult
  }

  const logResult = await readAuthFromManualLogs(normalizedPath, logDiagnostics)
  if (logResult.result[0] && logResult.result[1]) {
    return logResult.result
  }

  if (shouldLogManualDiscoveryDiagnostic(normalizedPath)) {
    logger.warn('[LCU manual discovery] no auth found in configured directory', {
      configuredPath: normalizedPath,
      lockfiles: lockfileDiagnostics,
      logDirectories: await inspectLogDirectories(normalizedPath),
      logCandidateCount: logResult.candidateCount,
      inspectedLogs: logDiagnostics,
      sensitiveValuesLogged: false,
    })
  }

  return logResult.result
}
