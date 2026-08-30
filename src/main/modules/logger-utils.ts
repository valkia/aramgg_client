import path from 'path'

export const DEFAULT_LOG_MAX_FILE_BYTES = 5 * 1024 * 1024
export const DEFAULT_LOG_FILES_PER_DAY = 3

export function isBrokenPipeError(error: unknown): boolean {
    return (error as NodeJS.ErrnoException | null)?.code === 'EPIPE'
}

export function getRotatedLogFilePath(logFilePath: string, index: number): string {
    if (!Number.isInteger(index) || index < 1) {
        throw new Error('Log rotation index must be a positive integer')
    }

    const extension = path.extname(logFilePath)
    const basePath = extension
        ? logFilePath.slice(0, -extension.length)
        : logFilePath
    return `${basePath}.${index}${extension}`
}

export function shouldRotateLogFile(
    currentSize: number,
    incomingSize: number,
    maxFileBytes: number = DEFAULT_LOG_MAX_FILE_BYTES
): boolean {
    return currentSize > 0 && currentSize + incomingSize > maxFileBytes
}
