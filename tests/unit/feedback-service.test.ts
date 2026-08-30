import { gunzipSync } from 'node:zlib'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectRecentFeedbackLogs,
  redactFeedbackLogText,
} from '../../src/main/services/feedback-log-collector.ts'
import {
  submitFeedback,
  validateFeedbackSubmission,
} from '../../src/main/services/feedback-service.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('feedback log collection', () => {
  it('collects only today and yesterday logs and redacts credentials', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aramgg-feedback-'))
    temporaryDirectories.push(directory)
    await writeFile(path.join(directory, 'app-2026-08-30.log'), 'Authorization: Bearer secret-token\n')
    await writeFile(path.join(directory, 'app-2026-08-29.1.log'), '{"puuid":"player-id"}\n')
    await writeFile(path.join(directory, 'app-2026-08-28.log'), 'must not upload\n')

    const archive = await collectRecentFeedbackLogs(
      new Date('2026-08-30T01:00:00.000Z'),
      directory,
    )
    const content = gunzipSync(archive.data).toString('utf8')

    expect(archive.fileCount).toBe(2)
    expect(content).toContain('app-2026-08-30.log')
    expect(content).toContain('app-2026-08-29.1.log')
    expect(content).not.toContain('app-2026-08-28.log')
    expect(content).not.toContain('secret-token')
    expect(content).not.toContain('player-id')
    expect(content).toContain('[REDACTED]')
  })

  it('redacts common command-line and header credentials', () => {
    const redacted = redactFeedbackLogText(
      '--riotclient-auth-token=abc123 Cookie=session-value password=secret',
    )
    expect(redacted).not.toContain('abc123')
    expect(redacted).not.toContain('session-value')
    expect(redacted).not.toContain('secret')
  })
})

describe('feedback submission', () => {
  it('validates fields and submits the compressed screenshot with recent logs', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData
      expect(form.get('locale')).toBe('en')
      expect(form.get('pagePath')).toBe('/client')
      expect((form.get('image') as File).type).toBe('image/webp')
      expect((form.get('logs') as File).type).toBe('application/gzip')
      expect(new Headers(init?.headers).get('X-ARAMGG-Client-Feedback')).toBe('1')
      return new Response(JSON.stringify({ id: 'feedback-id', received: true }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const result = await submitFeedback({
      category: 'bug',
      message: '  overlay did not open  ',
      contact: '',
      locale: 'en-US',
      image: new Uint8Array([1, 2, 3]),
    }, fetcher, async () => ({
      data: new Uint8Array([31, 139, 8, 0]),
      fileCount: 2,
    }))

    expect(result).toEqual({ success: true, id: 'feedback-id', logsIncluded: 2 })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('rejects invalid renderer payloads before collecting logs', () => {
    expect(() => validateFeedbackSubmission({
      category: 'invalid',
      message: 'ok',
      locale: 'zh-CN',
    })).toThrow('category')
  })
})
