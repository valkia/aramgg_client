import { EventEmitter } from 'node:events'
import type { BrowserWindow, WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWindowLoader } from '../../src/main/modules/lazy-window.ts'
import { markRendererReady, waitForRendererReady } from '../../src/main/modules/renderer-ready.ts'

function makeWindow() {
  let destroyed = false
  return {
    isDestroyed: () => destroyed,
    destroy: vi.fn(() => { destroyed = true }),
  } as unknown as BrowserWindow
}

afterEach(() => vi.useRealTimers())

describe('on-demand window creation', () => {
  it('coalesces requests and waits for readiness even after the native window exists', async () => {
    let window: BrowserWindow | null = null
    let resolve!: (window: BrowserWindow) => void
    const create = vi.fn(() => {
      window = makeWindow()
      return new Promise<BrowserWindow>(done => { resolve = done })
    })
    const load = createWindowLoader(() => window, create)
    expect(create).not.toHaveBeenCalled()
    const first = load()
    const second = load()
    const ready = vi.fn()
    void second.then(ready)
    await Promise.resolve()
    expect(create).toHaveBeenCalledTimes(1)
    expect(ready).not.toHaveBeenCalled()
    resolve(window!)
    expect(await first).toBe(await second)
    expect(await load()).toBe(window)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('destroys a failed creation and permits a retry', async () => {
    let window: BrowserWindow | null = null
    const create = vi.fn(async () => {
      window = makeWindow()
      if (create.mock.calls.length === 1) throw new Error('load failed')
      return window
    })
    const load = createWindowLoader(() => window, create)
    await expect(load()).rejects.toThrow('load failed')
    expect(window!.isDestroyed()).toBe(true)
    expect((await load()).isDestroyed()).toBe(false)
    expect(create).toHaveBeenCalledTimes(2)
  })
})

describe('renderer readiness', () => {
  it('waits for the owning renderer to register its listeners', async () => {
    vi.useFakeTimers()
    const contents = new EventEmitter() as WebContents
    const other = new EventEmitter() as WebContents
    const done = vi.fn()
    const ready = waitForRendererReady(contents).then(done)
    markRendererReady(other)
    await Promise.resolve()
    expect(done).not.toHaveBeenCalled()
    markRendererReady(contents)
    await ready
    expect(done).toHaveBeenCalledOnce()
    expect(contents.listenerCount('destroyed')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects and cleans up when the renderer is destroyed before mounting', async () => {
    vi.useFakeTimers()
    const contents = new EventEmitter() as WebContents
    const rejected = expect(waitForRendererReady(contents)).rejects.toThrow('Window closed')
    contents.emit('destroyed')
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds a renderer that never becomes ready', async () => {
    vi.useFakeTimers()
    const contents = new EventEmitter() as WebContents
    const rejected = expect(waitForRendererReady(contents)).rejects.toThrow('30 seconds')
    await vi.advanceTimersByTimeAsync(30000)
    await rejected
    expect(contents.listenerCount('destroyed')).toBe(0)
  })
})
