import { createHash } from 'node:crypto'

export function getPlayerNoteKey(platformId: string, puuid: string | null): string | undefined {
  const platform = platformId.trim().toUpperCase()
  if (!/^[A-Z0-9-]{2,24}$/.test(platform) || platform === 'UNKNOWN'
    || !puuid || !/^[a-zA-Z0-9_-]{8,128}$/.test(puuid)) return undefined
  return `${platform}:${createHash('sha256').update(puuid).digest('hex')}`
}
