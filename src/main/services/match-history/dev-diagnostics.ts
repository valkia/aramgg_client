import logger from '../../modules/logger.ts'

export const MATCH_HISTORY_DEV_DIAGNOSTICS_ENABLED =
  process.env.ARAMGG_MATCH_HISTORY_DIAGNOSTICS === '1' ||
  process.env.NODE_ENV === 'development'

function toMiB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10
}

export function getMatchHistoryMemorySnapshot(): Record<string, number> {
  const memory = process.memoryUsage()
  return {
    rssMiB: toMiB(memory.rss),
    heapUsedMiB: toMiB(memory.heapUsed),
    externalMiB: toMiB(memory.external),
    arrayBuffersMiB: toMiB(memory.arrayBuffers),
  }
}

/** Development-only diagnostics. Never pass tokens, PUUIDs, or response bodies. */
export function logMatchHistoryDev(
  event: string,
  details: Record<string, unknown> = {},
): void {
  if (!MATCH_HISTORY_DEV_DIAGNOSTICS_ENABLED) {
    return
  }

  logger.info(`[match-history][dev] ${event}`, {
    ...details,
    memory: getMatchHistoryMemorySnapshot(),
    sensitiveValuesLogged: false,
  })
}
