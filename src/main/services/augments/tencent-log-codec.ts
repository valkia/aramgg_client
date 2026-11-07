import { createDecipheriv, createHash } from 'node:crypto'

// Observed in icreate-pc-lol 0.7.0. Unknown formats fail closed to OCR.
const BIZ = '10014'
const MAX_LINE = 256 * 1024
const utf8 = new TextDecoder('utf-8', { fatal: true })
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const augmentKey = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_]{0,128}$/.test(v)

export type TencentAugmentEvent =
  | { kind: 'candidates'; at: number; keys: string[] }
  | { kind: 'selected'; at: number; index: number }
  | { kind: 'owned'; at: number; players: Array<{ netId: number; keys: string[] }> }

export type TencentLogRecord = { at: number; event: TencentAugmentEvent | null }

export function isTencentRegion(region: unknown): boolean {
  return typeof region === 'string' && /^(TENCENT|CN|CHINA)$/i.test(region)
}

export function createTencentLogKey(puuid: string): Buffer {
  return Buffer.from(createHash('sha256').update(BIZ + puuid).digest('hex').slice(0, 16), 'utf8')
}

/** Credentials and decrypted non-game text never leave this decoder. */
export function decodeTencentLogLine(line: string, key: Buffer): TencentLogRecord | null {
  if (line.length > MAX_LINE) return null
  const timestamp = line.match(/\b(20\d\d-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3})\b/)?.[1]
  // Tencent's log timestamp uses the local Windows timezone, including abroad.
  const at = timestamp ? new Date(timestamp.replace(' ', 'T')).getTime() : NaN
  if (!Number.isFinite(at)) return null
  const cipher = line.match(/(?:^|\s)([a-fA-F0-9]{32,})\s*$/)?.[1]
  if (!cipher || cipher.length % 32 !== 0) return null
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, key)
    const text = utf8.decode(Buffer.concat([decipher.update(Buffer.from(cipher, 'hex')), decipher.final()]))
    const marker = text.indexOf('game-log-> ')
    if (marker < 0) return null
    const data = object(JSON.parse(text.slice(marker + 11)))
    if (!data || data.form !== 'game' || !Number.isSafeInteger(data.dwSubCmd)) return null
    const params = object(data.params)
    if (!params) return null
    let event: TencentAugmentEvent | null = null
    if (data.dwSubCmd === 693) {
      const list = params.astAugments
      if (!Array.isArray(list) || list.length < 3 || list.length > 5) return null
      const keys = list.map(item => object(item)?.szAugmentName)
      if (!keys.every(augmentKey)) return null
      event = { kind: 'candidates', at, keys }
    } else if (data.dwSubCmd === 694) {
      const index = params.dwAugmentIndex
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 4) return null
      event = { kind: 'selected', at, index }
    } else if (data.dwSubCmd === 696) {
      const list = params.astPlayerHextechAugmentSelectionList
      if (!Array.isArray(list) || list.length > 10) return null
      const players: Array<{ netId: number; keys: string[] }> = []
      for (const value of list) {
        const player = object(value)
        if (!player || typeof player.dwHeroNetID !== 'number' || !Number.isSafeInteger(player.dwHeroNetID)
          || !Array.isArray(player.astAugments) || player.astAugments.length > 6) return null
        const keys = player.astAugments.map(item => object(item)?.szAugmentName)
        if (!keys.every(augmentKey)) return null
        players.push({ netId: player.dwHeroNetID, keys })
      }
      event = { kind: 'owned', at, players }
    }
    return { at, event }
  } catch {
    return null
  }
}
