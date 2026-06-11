import path from 'path'
import { readdir, stat } from 'fs/promises'

export type LeagueInstallLayout = 'client-directory' | 'root-client'

export type LeagueInstallInfo = {
  normalizedPath: string
  exists: boolean
  isDirectory: boolean
  valid: boolean
  layout: LeagueInstallLayout | null
}

const LOL_CHILD_DIRECTORY_NAMES = [
  'League of Legends',
  'LeagueOfLegends',
  '英雄联盟',
]

async function pathStats(filePath: string) {
  try {
    return await stat(filePath)
  } catch {
    return null
  }
}

export function normalizeLolPath(lolPath: string | null | undefined): string {
  const trimmedPath = String(lolPath || '').trim()
  return trimmedPath ? path.resolve(trimmedPath) : ''
}

export async function directoryExists(directoryPath: string): Promise<boolean> {
  const stats = await pathStats(directoryPath)
  return !!stats?.isDirectory()
}

async function fileExists(filePath: string): Promise<boolean> {
  const stats = await pathStats(filePath)
  return !!stats?.isFile()
}

async function getLeagueInstallLayout(normalizedPath: string): Promise<LeagueInstallLayout | null> {
  if (await directoryExists(path.join(normalizedPath, 'LeagueClient'))) {
    return 'client-directory'
  }

  const hasRootClient =
    await fileExists(path.join(normalizedPath, 'LeagueClient.exe')) ||
    await fileExists(path.join(normalizedPath, 'LeagueClientUx.exe'))

  return hasRootClient ? 'root-client' : null
}

export async function inspectLeagueInstallDirectory(
  lolPath: string | null | undefined
): Promise<LeagueInstallInfo> {
  const normalizedPath = normalizeLolPath(lolPath)
  const stats = normalizedPath ? await pathStats(normalizedPath) : null
  const exists = !!stats
  const isDirectory = !!stats?.isDirectory()
  const layout = isDirectory ? await getLeagueInstallLayout(normalizedPath) : null

  return {
    normalizedPath,
    exists,
    isDirectory,
    valid: !!layout,
    layout,
  }
}

export async function isLeagueInstallDirectory(lolPath: string | null | undefined): Promise<boolean> {
  const info = await inspectLeagueInstallDirectory(lolPath)
  return info.valid
}

export async function findLeagueInstallChildPath(directoryPath: string): Promise<string | null> {
  for (const directoryName of LOL_CHILD_DIRECTORY_NAMES) {
    const candidatePath = path.join(directoryPath, directoryName)
    if (await isLeagueInstallDirectory(candidatePath)) {
      return candidatePath
    }
  }

  return null
}

export async function getLeagueClientLogDirectories(lolPath: string): Promise<string[]> {
  const normalizedPath = normalizeLolPath(lolPath)
  const candidates = [
    path.join(normalizedPath, 'LeagueClient'),
    path.join(normalizedPath, 'Logs', 'LeagueClient Logs'),
    path.join(normalizedPath, 'Logs'),
    normalizedPath,
  ]

  const existingDirectories: string[] = []
  for (const directoryPath of candidates) {
    if (!existingDirectories.includes(directoryPath) && await directoryExists(directoryPath)) {
      existingDirectories.push(directoryPath)
    }
  }

  return existingDirectories
}

export async function findLeagueClientLogFiles(lolPath: string): Promise<string[]> {
  const directories = await getLeagueClientLogDirectories(lolPath)
  const logFiles: string[] = []

  for (const directoryPath of directories) {
    try {
      const entries = await readdir(directoryPath, { withFileTypes: true })
      entries
        .filter((entry) =>
          entry.isFile() &&
          entry.name.includes('LeagueClientUx.log') &&
          !entry.name.includes('-tracing')
        )
        .forEach((entry) => logFiles.push(path.join(directoryPath, entry.name)))
    } catch {
      // Log directories are optional and can appear only while the client is running.
    }
  }

  return logFiles.sort((a, b) => a.localeCompare(b))
}
