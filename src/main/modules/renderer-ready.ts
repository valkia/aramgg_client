import type { WebContents } from 'electron'

const pending = new WeakMap<WebContents, () => void>()

export function markRendererReady(contents: WebContents): void {
    pending.get(contents)?.()
}

export function waitForRendererReady(contents: WebContents): Promise<void> {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timeout)
            contents.removeListener('destroyed', onDestroyed)
            pending.delete(contents)
        }
        const onDestroyed = () => {
            cleanup()
            reject(new Error('Window closed before its renderer was ready'))
        }
        const timeout = setTimeout(() => {
            cleanup()
            reject(new Error('Renderer did not become ready within 30 seconds'))
        }, 30000)

        contents.once('destroyed', onDestroyed)
        pending.set(contents, () => {
            cleanup()
            resolve()
        })
    })
}
