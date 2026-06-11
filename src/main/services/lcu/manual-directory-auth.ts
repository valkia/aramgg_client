import { readFile, stat } from 'fs/promises'
import path from 'path'
import {
  findLeagueClientLogFiles,
  normalizeLolPath,
} from '../../modules/lol-path.ts'
import {
  parseLcuAuthFromLockfile,
  parseLcuAuthFromLogContent,
} from './process-auth-discovery.ts'
import type { TokenLoadResult } from './types.ts'

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath)
    return fileStat.isFile()
  } catch {
    return false
  }
}

function getManualLockfileCandidates(normalizedPath: string): string[] {
  return [
    path.join(normalizedPath, 'lockfile'),
    path.join(normalizedPath, 'LeagueClient', 'lockfile'),
    path.resolve(normalizedPath, '..', 'lockfile'),
  ]
}

async function readAuthFromManualLockfiles(normalizedPath: string): Promise<TokenLoadResult> {
  const seen = new Set<string>()

  for (const lockfilePath of getManualLockfileCandidates(normalizedPath)) {
    if (seen.has(lockfilePath)) {
      continue
    }
    seen.add(lockfilePath)

    if (!(await fileExists(lockfilePath))) {
      continue
    }

    try {
      const content = await readFile(lockfilePath, 'utf8')
      const result = parseLcuAuthFromLockfile(content)
      if (result[0] && result[1]) {
        return result
      }
    } catch {
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

async function readAuthFromManualLogs(normalizedPath: string): Promise<TokenLoadResult> {
  const logFiles = await getSortedLogFiles(normalizedPath)

  for (const logFilePath of logFiles.slice(0, 5)) {
    try {
      const content = await readFile(logFilePath, 'utf8')
      const result = parseLcuAuthFromLogContent(content)
      if (result[0] && result[1]) {
        return result
      }
    } catch {
      // Log files can be locked or rotate while League Client starts.
    }
  }

  return [null, null, null]
}

export async function discoverLcuAuthFromManualDirectory(
  lolPath: string | null | undefined
): Promise<TokenLoadResult> {
  const normalizedPath = normalizeLolPath(lolPath)
  if (!normalizedPath) {
    return [null, null, null]
  }

  const lockfileResult = await readAuthFromManualLockfiles(normalizedPath)
  if (lockfileResult[0] && lockfileResult[1]) {
    return lockfileResult
  }

  return readAuthFromManualLogs(normalizedPath)
}
