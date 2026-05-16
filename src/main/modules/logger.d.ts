export interface Logger {
  debug(message: unknown, ...args: unknown[]): void
  info(message: unknown, ...args: unknown[]): void
  warn(message: unknown, ...args: unknown[]): void
  error(message: unknown, ...args: unknown[]): void
  getLogDir(): string
  getCurrentLogFile(): string
  cleanupOldLogs(keepDays?: number): Promise<void>
}

export const logger: Logger
export default logger
