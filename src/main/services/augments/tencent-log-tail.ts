import { open } from 'node:fs/promises'

const MAX_READ = 256 * 1024
const MAX_PARTIAL = 256 * 1024

/** Bounded, read-only tail. A replacement/truncation invalidates the source state. */
export class TencentLogTail {
  private identity = ''
  private offset = 0
  private anchor = Buffer.alloc(0)
  private partial = ''
  private discardPartial = false

  constructor(private readonly file: string) {}

  async read(): Promise<{ lines: string[]; reset: boolean }> {
    const handle = await open(this.file, 'r')
    try {
      const stat = await handle.stat()
      if (!stat.isFile()) throw new Error('not-file')
      const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`
      let reset = !!this.identity && (identity !== this.identity || stat.size < this.offset)
      if (!reset && this.anchor.length) {
        const check = Buffer.alloc(this.anchor.length)
        const result = await handle.read(check, 0, check.length, this.offset - check.length)
        reset = result.bytesRead !== check.length || !check.equals(this.anchor)
      }
      if (!this.identity || reset || stat.size - this.offset > MAX_READ) {
        reset ||= !!this.identity
        this.offset = Math.max(0, stat.size - MAX_READ)
        this.partial = ''
        this.discardPartial = this.offset > 0
        this.anchor = Buffer.alloc(0)
      }
      this.identity = identity
      const buffer = Buffer.alloc(Math.min(MAX_READ, Math.max(0, stat.size - this.offset)))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.offset)
      this.offset += bytesRead
      if (bytesRead) this.anchor = Buffer.from(buffer.subarray(Math.max(0, bytesRead - 64), bytesRead))
      // Ciphertext and the timestamp prefix are ASCII; partial UTF-8 does not carry payload data.
      const text = this.partial + buffer.subarray(0, bytesRead).toString('utf8')
      const lines = text.split('\n')
      this.partial = lines.pop() ?? ''
      if (this.discardPartial && lines.length) {
        lines.shift()
        this.discardPartial = false
      }
      if (this.partial.length > MAX_PARTIAL) {
        this.partial = ''
        this.discardPartial = true
        reset = true
      }
      return { lines, reset }
    } finally {
      await handle.close()
    }
  }
}
