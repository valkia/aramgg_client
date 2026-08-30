export const MAX_FEEDBACK_SOURCE_BYTES = 12 * 1024 * 1024
export const MAX_FEEDBACK_IMAGE_BYTES = 2 * 1024 * 1024

const COMPRESSION_STEPS = [
  [1600, 0.84],
  [1400, 0.76],
  [1200, 0.68],
  [1000, 0.6],
] as const

interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
  close(): void
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('encode_failed')),
      'image/webp',
      quality,
    )
  })
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      }
    } catch {
      // 部分运行时不支持 imageOrientation，继续使用图片元素解码。
    }
  }

  const objectUrl = URL.createObjectURL(file)
  const image = new Image()
  image.src = objectUrl
  try {
    await image.decode()
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => URL.revokeObjectURL(objectUrl),
  }
}

export async function compressFeedbackImage(file: File): Promise<Blob> {
  if (file.size > MAX_FEEDBACK_SOURCE_BYTES) throw new Error('source_too_large')

  const decoded = await decodeImage(file)
  try {
    let lastBlob: Blob | null = null
    for (const [maxDimension, quality] of COMPRESSION_STEPS) {
      const scale = Math.min(1, maxDimension / Math.max(decoded.width, decoded.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(decoded.width * scale))
      canvas.height = Math.max(1, Math.round(decoded.height * scale))
      const context = canvas.getContext('2d', { alpha: true })
      if (!context) throw new Error('canvas_unavailable')
      context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height)
      lastBlob = await canvasToBlob(canvas, quality)
      canvas.width = 1
      canvas.height = 1
      if (lastBlob.size <= MAX_FEEDBACK_IMAGE_BYTES) return lastBlob
    }
    throw new Error(lastBlob ? 'compressed_too_large' : 'encode_failed')
  } finally {
    decoded.close()
  }
}

export function formatFeedbackImageBytes(bytes: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024)} KB`
}
