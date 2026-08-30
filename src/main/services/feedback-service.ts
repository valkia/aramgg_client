import type {
  FeedbackCategory,
  FeedbackSubmissionPayload,
  FeedbackSubmissionResult,
  SupportedDataLocale,
} from '../../shared/ipc-contract.ts'
import {
  collectRecentFeedbackLogs,
  type FeedbackLogsArchive,
} from './feedback-log-collector.ts'

const FEEDBACK_ENDPOINT = 'https://aramgg.com/api/feedback'
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_MESSAGE_LENGTH = 2000
const MAX_CONTACT_LENGTH = 200
const REQUEST_TIMEOUT_MS = 15_000
const ALLOWED_CATEGORIES = new Set<FeedbackCategory>([
  'suggestion', 'question', 'bug', 'other',
])
const REMOTE_LOCALES: Record<SupportedDataLocale, string> = {
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
  'en-US': 'en',
}

type FeedbackFetch = (
  input: string,
  init?: Parameters<typeof globalThis.fetch>[1],
) => Promise<Response>
type FeedbackLogCollector = () => Promise<FeedbackLogsArchive>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

export function validateFeedbackSubmission(value: unknown): FeedbackSubmissionPayload {
  if (!isRecord(value)) throw new Error('Feedback payload must be an object')

  const category = value.category
  const message = typeof value.message === 'string' ? value.message.trim() : ''
  const contact = typeof value.contact === 'string' ? value.contact.trim() : ''
  const locale = value.locale

  if (typeof category !== 'string' || !ALLOWED_CATEGORIES.has(category as FeedbackCategory)) {
    throw new Error('Feedback category is invalid')
  }
  if (message.length < 2 || message.length > MAX_MESSAGE_LENGTH) {
    throw new Error('Feedback message length is invalid')
  }
  if (contact.length > MAX_CONTACT_LENGTH) throw new Error('Feedback contact is too long')
  if (typeof locale !== 'string' || !(locale in REMOTE_LOCALES)) {
    throw new Error('Feedback locale is invalid')
  }

  let image: Uint8Array | undefined
  if (value.image != null) {
    if (!(value.image instanceof Uint8Array)) throw new Error('Feedback image must be binary data')
    if (value.image.byteLength === 0 || value.image.byteLength > MAX_IMAGE_BYTES) {
      throw new Error('Feedback image size is invalid')
    }
    image = Uint8Array.from(value.image)
  }

  return {
    category: category as FeedbackCategory,
    message,
    contact: contact || undefined,
    locale: locale as SupportedDataLocale,
    image,
  }
}

function toBlob(data: Uint8Array, type: string): Blob {
  return new Blob([data.slice().buffer as ArrayBuffer], { type })
}

export async function submitFeedback(
  value: unknown,
  fetcher: FeedbackFetch,
  collectLogs: FeedbackLogCollector = collectRecentFeedbackLogs,
): Promise<FeedbackSubmissionResult> {
  const payload = validateFeedbackSubmission(value)
  const logs = await collectLogs()
  const form = new FormData()
  form.set('category', payload.category)
  form.set('message', payload.message)
  form.set('contact', payload.contact ?? '')
  form.set('locale', REMOTE_LOCALES[payload.locale])
  form.set('pagePath', '/client')
  form.set('logs', toBlob(logs.data, 'application/gzip'), 'client-logs.txt.gz')

  if (payload.image) {
    form.set('image', toBlob(payload.image, 'image/webp'), 'feedback.webp')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetcher(FEEDBACK_ENDPOINT, {
      method: 'POST',
      body: form,
      headers: {
        Accept: 'application/json',
        'X-ARAMGG-Client-Feedback': '1',
      },
      signal: controller.signal,
    })
    const responseBody = await response.json().catch(() => null) as Record<string, unknown> | null
    if (!response.ok) throw new Error(`Feedback service returned ${response.status}`)

    return {
      success: true,
      id: typeof responseBody?.id === 'string' ? responseBody.id : undefined,
      logsIncluded: logs.fileCount,
    }
  } finally {
    clearTimeout(timeout)
  }
}
