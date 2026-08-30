import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import { getLogDir } from '../modules/app-paths.ts'

const gzipAsync = promisify(gzip)
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const RECENT_DAY_COUNT = 2
const MAX_COMPRESSED_BYTES = 6 * 1024 * 1024

export interface FeedbackLogsArchive {
  data: Uint8Array
  fileCount: number
}

function getRecentDateKeys(now: Date): string[] {
  return Array.from({ length: RECENT_DAY_COUNT }, (_, index) => (
    new Date(now.getTime() + BEIJING_OFFSET_MS - index * DAY_MS)
      .toISOString()
      .slice(0, 10)
  ))
}

export function redactFeedbackLogText(value: string): string {
  return value
    .replace(/(--(?:remoting|riotclient)-auth-token=)[^\s"']+/giu, '$1[REDACTED]')
    .replace(/\b(Basic|Bearer)\s+[A-Za-z0-9._~+/=-]+/giu, '$1 [REDACTED]')
    .replace(
      /(["']?(?:authorization|cookie|password|token|secret|puuid|summonerId|accountId|gameName|tagLine)["']?\s*[:=]\s*)(["'][^"']*["']|[^\s,}\]]+)/giu,
      '$1[REDACTED]',
    )
}

export async function collectRecentFeedbackLogs(
  now: Date = new Date(),
  logDir: string = getLogDir(),
): Promise<FeedbackLogsArchive> {
  const dateKeys = getRecentDateKeys(now)
  const allowedNames = new RegExp(
    `^app-(?:${dateKeys.join('|')})(?:\\.\\d+)?\\.log$`,
    'u',
  )
  const entries = await readdir(logDir, { withFileTypes: true })
  const files = await Promise.all(entries
    .filter((entry) => entry.isFile() && allowedNames.test(entry.name))
    .map(async (entry) => {
      const filePath = path.join(logDir, entry.name)
      return { name: entry.name, filePath, mtimeMs: (await stat(filePath)).mtimeMs }
    }))

  files.sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name))

  const sections = [
    '# ARAMGG client diagnostic logs',
    `# Generated at ${now.toISOString()}`,
    `# Included dates ${dateKeys.slice().reverse().join(' to ')}`,
  ]

  for (const file of files) {
    const content = await readFile(file.filePath, 'utf8')
    sections.push(`\n===== ${file.name} =====\n${redactFeedbackLogText(content)}`)
  }
  if (files.length === 0) {
    sections.push('\nNo matching local log files were found.')
  }

  const compressed = await gzipAsync(sections.join('\n'), { level: 9 })
  if (compressed.byteLength > MAX_COMPRESSED_BYTES) {
    throw new Error('Recent client logs exceed the 6 MB compressed limit')
  }

  return { data: Uint8Array.from(compressed), fileCount: files.length }
}
