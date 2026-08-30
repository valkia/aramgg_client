import { net } from 'electron'
import logger from '../modules/logger.ts'
import { trustedIpcMain as ipcMain } from '../security/trusted-ipc.ts'
import { submitFeedback } from '../services/feedback-service.ts'

export function registerFeedbackIpcHandlers(): void {
  ipcMain.handle('feedback-submit', async (_event, payload: unknown) => {
    try {
      return await submitFeedback(payload, (url, init) => net.fetch(url, init))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('[feedback] submission failed', { error: message })
      return { success: false, error: message }
    }
  })
}
