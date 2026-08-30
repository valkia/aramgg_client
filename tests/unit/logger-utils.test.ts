import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOG_MAX_FILE_BYTES,
  getRotatedLogFilePath,
  isBrokenPipeError,
  shouldRotateLogFile,
} from '../../src/main/modules/logger-utils.ts'

describe('logger utilities', () => {
  it('recognizes broken pipe errors without treating unrelated errors as EPIPE', () => {
    expect(isBrokenPipeError(Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))).toBe(true)
    expect(isBrokenPipeError(Object.assign(new Error('missing'), { code: 'ENOENT' }))).toBe(false)
    expect(isBrokenPipeError(null)).toBe(false)
  })

  it('builds bounded daily rotation paths', () => {
    const logFile = path.join('logs', 'app-2026-08-08.log')

    expect(getRotatedLogFilePath(logFile, 1)).toBe(
      path.join('logs', 'app-2026-08-08.1.log')
    )
    expect(getRotatedLogFilePath(logFile, 2)).toBe(
      path.join('logs', 'app-2026-08-08.2.log')
    )
    expect(() => getRotatedLogFilePath(logFile, 0)).toThrow()
  })

  it('rotates before an append would cross the file cap', () => {
    expect(shouldRotateLogFile(DEFAULT_LOG_MAX_FILE_BYTES - 10, 10)).toBe(false)
    expect(shouldRotateLogFile(DEFAULT_LOG_MAX_FILE_BYTES - 10, 11)).toBe(true)
    expect(shouldRotateLogFile(0, DEFAULT_LOG_MAX_FILE_BYTES + 1)).toBe(false)
  })
})
