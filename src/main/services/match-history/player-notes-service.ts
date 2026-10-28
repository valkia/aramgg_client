import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PlayerNote } from '../../../shared/ipc-contract.ts'
import { isPlayerKey, MAX_NOTES_FILE_BYTES, MAX_PLAYER_NOTES, parseNoteDraft, parseNotes } from '../../../shared/player-notes.ts'
import { getConfigDir } from '../../modules/app-paths.ts'

export async function readBoundedNotesFile(filePath: string): Promise<string> {
  const file = await open(filePath, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > MAX_NOTES_FILE_BYTES) throw new Error('Invalid player notes file')
    const buffer = Buffer.alloc(MAX_NOTES_FILE_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > MAX_NOTES_FILE_BYTES) throw new Error('Player notes file is too large')
    return buffer.subarray(0, length).toString('utf8')
  } finally { await file.close() }
}

export class PlayerNotesService {
  private pending: Promise<unknown> = Promise.resolve()

  constructor(private readonly getFilePath = () => path.join(getConfigDir(), 'player-notes.json')) {}

  private async read(): Promise<PlayerNote[]> {
    let content: string
    try { content = await readBoundedNotesFile(this.getFilePath()) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const document = JSON.parse(content)
    if (document?.schemaVersion !== 1) throw new Error('Unsupported player notes file')
    return parseNotes(document.notes)
  }

  private async write(notes: PlayerNote[]): Promise<void> {
    const filePath = this.getFilePath()
    await mkdir(path.dirname(filePath), { recursive: true })
    const tempPath = `${filePath}.${randomUUID()}.tmp`
    try {
      await writeFile(tempPath, JSON.stringify({ schemaVersion: 1, notes }), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      await rename(tempPath, filePath)
    } finally { await unlink(tempPath).catch(() => {}) }
  }

  async list(): Promise<PlayerNote[]> {
    await this.pending
    return this.read()
  }

  private mutate(update: (notes: PlayerNote[]) => PlayerNote[]): Promise<PlayerNote[]> {
    const operation = this.pending.then(async () => {
      const notes = update(await this.read()).sort((a, b) => b.updatedAt - a.updatedAt || a.playerKey.localeCompare(b.playerKey))
      if (notes.length > MAX_PLAYER_NOTES) throw new Error('Player notes limit reached')
      await this.write(notes)
      return notes
    })
    this.pending = operation.catch(() => {})
    return operation
  }

  save(payload: unknown): Promise<PlayerNote[]> {
    const draft = parseNoteDraft(payload)
    return this.mutate((notes) => {
      const updatedAt = Date.now()
      return [...notes.filter((note) => note.playerKey !== draft.playerKey), { ...draft, updatedAt }]
    })
  }

  remove(playerKey: unknown): Promise<PlayerNote[]> {
    if (!isPlayerKey(playerKey)) throw new Error('Invalid player key')
    return this.mutate((notes) => notes.filter((note) => note.playerKey !== playerKey))
  }

  mergeMissing(payload: unknown): Promise<PlayerNote[]> {
    const incoming = parseNotes(payload)
    return this.mutate((notes) => {
      const existing = new Set(notes.map((note) => note.playerKey))
      return [...notes, ...incoming.filter((note) => !existing.has(note.playerKey))]
    })
  }
}

export const playerNotesService = new PlayerNotesService()
