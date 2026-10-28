import type { PlayerNote, PlayerNoteDraft, PlayerNoteLabel } from './ipc-contract.ts'

export const PLAYER_NOTE_LABELS: readonly PlayerNoteLabel[] = ['friendly', 'neutral', 'caution', 'avoid']
export const MAX_PLAYER_NOTES = 1000
export const MAX_NOTE_TEXT_LENGTH = 500
export const MAX_NOTES_FILE_BYTES = 4 * 1024 * 1024

export function isPlayerKey(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9-]{2,24}:[a-f0-9]{64}$/.test(value)
}

export function parseNoteDraft(value: unknown): PlayerNoteDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid player note')
  const note = value as Record<string, unknown>
  if (!isPlayerKey(note.playerKey)
    || !PLAYER_NOTE_LABELS.includes(note.label as PlayerNoteLabel)
    || typeof note.playerName !== 'string' || note.playerName.length > 128
    || typeof note.text !== 'string' || note.text.length > MAX_NOTE_TEXT_LENGTH) {
    throw new Error('Invalid player note')
  }
  return { playerKey: note.playerKey, playerName: note.playerName.trim(), label: note.label as PlayerNoteLabel, text: note.text.trim() }
}

export function parseNotes(value: unknown): PlayerNote[] {
  if (!Array.isArray(value) || value.length > MAX_PLAYER_NOTES) throw new Error('Invalid player notes list')
  const keys = new Set<string>()
  return value.map((entry) => {
    const note = parseNoteDraft(entry)
    if (!Number.isSafeInteger(entry.updatedAt) || entry.updatedAt <= 0 || keys.has(note.playerKey)) throw new Error('Invalid player note timestamp or duplicate key')
    keys.add(note.playerKey)
    return { ...note, updatedAt: entry.updatedAt }
  })
}
