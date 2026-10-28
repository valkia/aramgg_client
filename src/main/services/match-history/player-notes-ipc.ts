import { BrowserWindow, dialog } from 'electron'
import type { PlayerNotesFileResult, PlayerNotesImportPreviewResult, PlayerNotesResult } from '../../../shared/ipc-contract.ts'
import { trustedIpcMain as ipcMain } from '../../security/trusted-ipc.ts'
import { playerNotesService } from './player-notes-service.ts'
import { PlayerNotesBackupService } from './player-notes-backup.ts'

const backups = new PlayerNotesBackupService(playerNotesService)
const dialogOwners = new Set<number>()
const watchedOwners = new Set<number>()

export function registerPlayerNotesIpcHandlers(): void {
  const notesResult = async (operation: () => Promise<NonNullable<PlayerNotesResult['notes']>>): Promise<PlayerNotesResult> => {
    try { return { success: true, notes: await operation() } } catch {
      return { success: false, error: 'Player notes operation failed' }
    }
  }
  ipcMain.handle('player-notes-list', () => notesResult(() => playerNotesService.list()))
  ipcMain.handle('player-notes-save', (_event, payload: unknown) => notesResult(() => playerNotesService.save(payload)))
  ipcMain.handle('player-notes-remove', (_event, playerKey: unknown) => notesResult(() => playerNotesService.remove(playerKey)))
  ipcMain.handle('player-notes-import-apply', (event, token: unknown) => notesResult(() => backups.apply(event.sender.id, token)))
  ipcMain.handle('player-notes-import-cancel', (event, token: unknown) => {
    backups.cancel(event.sender.id, token)
    return { success: true }
  })

  ipcMain.handle('player-notes-export', async (event): Promise<PlayerNotesFileResult> => {
    const ownerId = event.sender.id
    if (dialogOwners.has(ownerId)) return { success: false }
    dialogOwners.add(ownerId)
    try {
      const owner = BrowserWindow.fromWebContents(event.sender)
      if (!owner) return { success: false }
      const selection = await dialog.showSaveDialog(owner, {
        defaultPath: `aramgg-player-notes-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (selection.canceled || !selection.filePath || event.sender.isDestroyed()) return { success: true, canceled: true }
      await backups.export(selection.filePath)
      return { success: true }
    } catch { return { success: false, error: 'Notes export failed' } }
    finally { dialogOwners.delete(ownerId) }
  })

  ipcMain.handle('player-notes-import-preview', async (event): Promise<PlayerNotesImportPreviewResult> => {
    const ownerId = event.sender.id
    if (dialogOwners.has(ownerId)) return { success: false }
    dialogOwners.add(ownerId)
    try {
      const owner = BrowserWindow.fromWebContents(event.sender)
      if (!owner) return { success: false }
      if (!watchedOwners.has(ownerId)) {
        watchedOwners.add(ownerId)
        event.sender.once('destroyed', () => { backups.forget(ownerId); watchedOwners.delete(ownerId) })
      }
      backups.forget(ownerId)
      const selection = await dialog.showOpenDialog(owner, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (selection.canceled || !selection.filePaths[0] || event.sender.isDestroyed()) return { success: true, canceled: true }
      const preview = await backups.preview(ownerId, selection.filePaths[0])
      if (event.sender.isDestroyed()) { backups.forget(ownerId); return { success: true, canceled: true } }
      return { success: true, preview }
    } catch { return { success: false, error: 'Notes import preview failed' } }
    finally { dialogOwners.delete(ownerId) }
  })
}
