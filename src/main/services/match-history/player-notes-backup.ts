import { randomUUID } from 'node:crypto'
import { rename, unlink, writeFile } from 'node:fs/promises'
import type { PlayerNote, PlayerNotesImportPreview } from '../../../shared/ipc-contract.ts'
import { MAX_PLAYER_NOTES, parseNotes } from '../../../shared/player-notes.ts'
import { PlayerNotesService, readBoundedNotesFile } from './player-notes-service.ts'

const IMPORT_TTL_MS = 10 * 60 * 1000
const BACKUP_FORMAT = 'aramgg-player-notes'

export function parseNotesBackup(content: string): PlayerNote[] {
  const document = JSON.parse(content)
  if (document?.format !== BACKUP_FORMAT || document.schemaVersion !== 1) throw new Error('Unsupported notes backup')
  return parseNotes(document.notes)
}

export class PlayerNotesBackupService {
  private readonly pending = new Map<number, { token: string; expiresAt: number; notes: PlayerNote[] }>()
  constructor(private readonly notes: PlayerNotesService, private readonly now = Date.now) {}

  async export(filePath: string): Promise<void> {
    const notes = await this.notes.list()
    const content = JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: 1, notes }, null, 2)
    const tempPath = `${filePath}.${randomUUID()}.tmp`
    try {
      await writeFile(tempPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      await rename(tempPath, filePath)
    } finally { await unlink(tempPath).catch(() => {}) }
  }

  async preview(owner: number, filePath: string): Promise<PlayerNotesImportPreview> {
    this.pending.delete(owner)
    for (const [key, preview] of this.pending) if (preview.expiresAt <= this.now()) this.pending.delete(key)
    const incoming = parseNotesBackup(await readBoundedNotesFile(filePath))
    const current = await this.notes.list()
    const keys = new Set(current.map((note) => note.playerKey))
    const added = incoming.filter((note) => !keys.has(note.playerKey)).length
    if (current.length + added > MAX_PLAYER_NOTES) throw new Error('Player notes limit reached')
    const token = randomUUID()
    this.pending.set(owner, { token, expiresAt: this.now() + IMPORT_TTL_MS, notes: incoming })
    return { token, total: incoming.length, added, kept: incoming.length - added, samples: incoming.slice(0, 10) }
  }

  async apply(owner: number, token: unknown): Promise<PlayerNote[]> {
    const preview = this.pending.get(owner)
    if (typeof token !== 'string' || !preview || preview.token !== token || preview.expiresAt <= this.now()) {
      throw new Error('Notes import preview has expired')
    }
    // Recheck current disk contents inside the serialized write; edits made since preview win.
    const notes = await this.notes.mergeMissing(preview.notes)
    if (this.pending.get(owner) === preview) this.pending.delete(owner)
    return notes
  }

  cancel(owner: number, token: unknown): void {
    if (this.pending.get(owner)?.token === token) this.pending.delete(owner)
  }

  forget(owner: number): void { this.pending.delete(owner) }
}
