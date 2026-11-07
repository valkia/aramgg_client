import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { getGameDiagnosticCaptureDir } from '../../modules/app-paths.ts'
import logger, { subscribeLogEvents } from '../../modules/logger.ts'
import { createLocalGameReader } from './augment-api-capture.ts'
import { GameDiagnosticSession } from './game-diagnostic-session.ts'
import { isGameDiagnosticsEnabled } from './diagnostic-settings.ts'

let session: GameDiagnosticSession | null = null

export function startGameDiagnostics(metadata: Record<string, unknown>): void {
  if (session || !isGameDiagnosticsEnabled()) return
  try {
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`
    const directory = path.join(getGameDiagnosticCaptureDir(), runId)
    const reader = createLocalGameReader()
    session = new GameDiagnosticSession({
      directory, read: reader.read, closeReader: reader.close, subscribe: subscribeLogEvents,
      notify: (message, details) => logger.info(`[game diagnostics] ${message}`, details),
      metadata: { ...metadata, runId },
    })
    logger.info('[game diagnostics] 统一监听已启动：选人卡片、局内接口、实验性事件通道和 OCR 共用一份记录', { directory })
  } catch (error) {
    logger.warn('[game diagnostics] 启动失败', { code: (error as NodeJS.ErrnoException).code })
  }
}

export function observeGameDiagnosticPhase(phase: string, source: string): void {
  session?.observePhase(phase, source)
}

export async function stopGameDiagnostics(reason: string): Promise<void> {
  await session?.stop(reason)
}
