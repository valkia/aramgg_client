import type { BrowserWindow } from 'electron'

export function createWindowLoader(
    getWindow: () => BrowserWindow | null,
    createWindow: () => Promise<BrowserWindow>,
): () => Promise<BrowserWindow> {
    let pending: Promise<BrowserWindow> | null = null

    return () => {
        // A BrowserWindow exists before its renderer is ready.
        if (pending) return pending
        const window = getWindow()
        if (window && !window.isDestroyed()) return Promise.resolve(window)

        pending = createWindow().catch((error) => {
            const failedWindow = getWindow()
            if (failedWindow && !failedWindow.isDestroyed()) failedWindow.destroy()
            throw error
        }).finally(() => {
            pending = null
        })
        return pending
    }
}
