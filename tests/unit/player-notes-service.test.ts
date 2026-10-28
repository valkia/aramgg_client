import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlayerNotesService } from '../../src/main/services/match-history/player-notes-service.ts'
import { getPlayerNoteKey } from '../../src/main/services/match-history/player-identity.ts'
import { parseNoteDraft, parseNotes } from '../../src/shared/player-notes.ts'
import type { PlayerNoteDraft } from '../../src/shared/ipc-contract.ts'

let directory: string
let file: string
let service: PlayerNotesService
const key = getPlayerNoteKey('HN1', 'player-0001')!
const draft: PlayerNoteDraft = { playerKey: key, playerName: 'Player#CN1', label: 'friendly', text: 'Good teamwork' }
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'aramgg-notes-')); file = path.join(directory, 'notes.json'); service = new PlayerNotesService(() => file) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('player identity and notes', () => {
  it('uses stable region-scoped opaque keys and rejects missing identities', () => {
    expect(key).toMatch(/^HN1:[a-f0-9]{64}$/)
    expect(key).not.toContain('player-0001')
    expect(getPlayerNoteKey('hn1', 'player-0001')).toBe(key)
    expect(getPlayerNoteKey('HN10', 'player-0001')).not.toBe(key)
    expect(getPlayerNoteKey('HN1', 'player-0002')).not.toBe(key)
    expect(getPlayerNoteKey('UNKNOWN', 'player-0001')).toBeUndefined()
    expect(getPlayerNoteKey('HN1', null)).toBeUndefined()
  })

  it('persists concurrent edits without lost updates and survives a new service instance', async () => {
    expect(await service.list()).toEqual([])
    await Promise.all(Array.from({ length: 12 }, (_, index) => service.save({ ...draft, playerKey: getPlayerNoteKey('HN1', `player-${1000 + index}`) })))
    expect(await new PlayerNotesService(() => file).list()).toHaveLength(12)
    await service.save({ ...draft, text: 'Updated' })
    expect((await service.list()).find((note) => note.playerKey === key)?.text).toBe('Updated')
    await service.remove(key)
    expect((await service.list()).some((note) => note.playerKey === key)).toBe(false)
  })

  it('rejects invalid keys, oversized text and duplicate saved entries', () => {
    expect(() => parseNoteDraft({ ...draft, playerKey: '__proto__' })).toThrow()
    expect(() => parseNoteDraft({ ...draft, text: 'a'.repeat(501) })).toThrow()
    expect(() => parseNoteDraft({ ...draft, label: 'unexpected' })).toThrow()
    expect(() => parseNotes([{ ...draft, updatedAt: 10 }, { ...draft, updatedAt: 10 }])).toThrow()
    expect(() => parseNotes([{ ...draft, updatedAt: Infinity }])).toThrow()
  })

  it('fails closed on a corrupted file and can retry once storage is repaired', async () => {
    await writeFile(file, '{broken')
    await expect(service.save(draft)).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe('{broken')
    await writeFile(file, JSON.stringify({ schemaVersion: 1, notes: [] }))
    expect(await service.save(draft)).toHaveLength(1)
  })

  it('does not merge same-name players from different regions or identities', async () => {
    await service.save(draft)
    await service.save({ ...draft, playerKey: getPlayerNoteKey('HN10', 'player-0001')!, text: 'Other region' })
    await service.save({ ...draft, playerKey: getPlayerNoteKey('HN1', 'player-0002')!, text: 'Other player' })
    expect(await service.list()).toHaveLength(3)
  })
})
