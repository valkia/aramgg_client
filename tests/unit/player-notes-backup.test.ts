import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlayerNotesService } from '../../src/main/services/match-history/player-notes-service.ts'
import { PlayerNotesBackupService, parseNotesBackup } from '../../src/main/services/match-history/player-notes-backup.ts'
import { MAX_NOTES_FILE_BYTES, MAX_PLAYER_NOTES } from '../../src/shared/player-notes.ts'
import type { PlayerNote } from '../../src/shared/ipc-contract.ts'

let directory: string
let backupFile: string
let service: PlayerNotesService
let backups: PlayerNotesBackupService
let now: number
const note = (id: number, text = 'Imported'): PlayerNote => ({ playerKey: `HN1:${id.toString(16).padStart(64, '0')}`, playerName: 'Player', label: 'friendly', text, updatedAt: 10 })
const document = (notes: PlayerNote[]) => JSON.stringify({ format: 'aramgg-player-notes', schemaVersion: 1, notes })
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'aramgg-notes-backup-'))
  backupFile = path.join(directory, 'backup.json')
  service = new PlayerNotesService(() => path.join(directory, 'notes.json'))
  now = 1000
  backups = new PlayerNotesBackupService(service, () => now)
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('local player notes backups', () => {
  it('roundtrips only allowlisted note fields without config or credentials', async () => {
    await service.save({ ...note(1), apiKey: 'secret', authToken: 'secret' })
    await backups.export(backupFile)
    const content = await readFile(backupFile, 'utf8')
    expect(content).not.toContain('secret')
    expect(Object.keys(JSON.parse(content)).sort()).toEqual(['format', 'notes', 'schemaVersion'])
    expect(parseNotesBackup(content)).toEqual(await service.list())
  })

  it('previews without writing and preserves local edits made before or after preview', async () => {
    await service.save(note(1, 'Local'))
    await writeFile(backupFile, document([note(1), note(2), note(3)]))
    const preview = await backups.preview(11, backupFile)
    expect(preview).toMatchObject({ total: 3, added: 2, kept: 1 })
    expect(await service.list()).toHaveLength(1)
    await service.save(note(2, 'Edited since preview'))
    await writeFile(backupFile, '{modified file after preview}')
    const result = await backups.apply(11, preview.token)
    expect(result.find((entry) => entry.playerKey === note(1).playerKey)?.text).toBe('Local')
    expect(result.find((entry) => entry.playerKey === note(2).playerKey)?.text).toBe('Edited since preview')
    expect(result.find((entry) => entry.playerKey === note(3).playerKey)?.text).toBe('Imported')
    await expect(backups.apply(11, preview.token)).rejects.toThrow()
  })

  it('binds previews to the owning window, supports cancellation, and expires tokens', async () => {
    await writeFile(backupFile, document([note(1)]))
    const preview = await backups.preview(11, backupFile)
    await expect(backups.apply(12, preview.token)).rejects.toThrow()
    await expect(backups.apply(11, 'wrong')).rejects.toThrow()
    backups.cancel(12, preview.token)
    backups.cancel(11, preview.token)
    await expect(backups.apply(11, preview.token)).rejects.toThrow()
    const second = await backups.preview(11, backupFile)
    now += 10 * 60 * 1000
    await expect(backups.apply(11, second.token)).rejects.toThrow()
    const third = await backups.preview(11, backupFile)
    backups.forget(11)
    await expect(backups.apply(11, third.token)).rejects.toThrow()
    expect(await service.list()).toEqual([])
  })

  it('rejects invalid, oversized or duplicate documents without changing local notes', async () => {
    await service.save(note(1, 'Keep'))
    for (const content of ['{broken', JSON.stringify({ notes: [note(2)] }), document([note(2), note(2)]), document([{ ...note(2), text: 'x'.repeat(501) }]), ' '.repeat(MAX_NOTES_FILE_BYTES + 1)]) {
      await writeFile(backupFile, content)
      await expect(backups.preview(11, backupFile)).rejects.toThrow()
      expect(await service.list()).toMatchObject([{ text: 'Keep' }])
    }
  })

  it('rechecks the combined limit at apply time and retains the preview for a safe retry', async () => {
    await service.mergeMissing(Array.from({ length: MAX_PLAYER_NOTES - 1 }, (_, index) => note(index)))
    await writeFile(backupFile, document([note(1001)]))
    const preview = await backups.preview(11, backupFile)
    await service.save(note(1002))
    await expect(backups.apply(11, preview.token)).rejects.toThrow('limit')
    expect(await service.list()).toHaveLength(MAX_PLAYER_NOTES)
    await service.remove(note(1002).playerKey)
    expect(await backups.apply(11, preview.token)).toHaveLength(MAX_PLAYER_NOTES)
  })
})
